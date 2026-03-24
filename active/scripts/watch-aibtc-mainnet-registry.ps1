param (
    [int]$IntervalSeconds = 300,
    [int]$Iterations = 0
)

if ($IntervalSeconds -lt 30) {
    Write-Error "Use um intervalo de pelo menos 30 segundos."
    exit 1
}

$registryUrl = "https://stx402.com/agent/registry"
$stateDir = Join-Path $PSScriptRoot "..\state"
$snapshotPath = Join-Path $stateDir "aibtc-mainnet-registry-status.json"
$opsLogPath = Join-Path $stateDir "aibtc-ops-log.jsonl"

function Get-RegistrySnapshot {
    try {
        $response = Invoke-WebRequest -UseBasicParsing $registryUrl -TimeoutSec 30
        $body = $response.Content | ConvertFrom-Json
        $mainnet = $body.networks.mainnet

        return [pscustomobject]@{
            ok = $true
            checkedAtUtc = [datetime]::UtcNow.ToString("o")
            statusCode = $response.StatusCode
            mainnetPublished = ($null -ne $mainnet)
            mainnet = $mainnet
            body = $body
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            checkedAtUtc = [datetime]::UtcNow.ToString("o")
            statusCode = $null
            mainnetPublished = $false
            mainnet = $null
            error = $_.Exception.Message
        }
    }
}

function Load-PreviousSnapshot {
    if (-not (Test-Path $snapshotPath)) {
        return $null
    }

    try {
        return Get-Content $snapshotPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Save-Snapshot {
    param (
        [object]$Snapshot
    )

    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $Snapshot | ConvertTo-Json -Depth 10 | Set-Content -Path $snapshotPath -Encoding UTF8
}

function Write-RegistryChangeEvent {
    param (
        [object]$Snapshot,
        [string]$Change
    )

    $record = [ordered]@{
        loggedAt = [datetime]::UtcNow.ToString("o")
        type = "registry_state_change"
        details = [ordered]@{
            change = $Change
            mainnetPublished = $Snapshot.mainnetPublished
            statusCode = $Snapshot.statusCode
            checkedAtUtc = $Snapshot.checkedAtUtc
            mainnet = $Snapshot.mainnet
        }
    }

    $record | ConvertTo-Json -Compress -Depth 10 | Add-Content -Path $opsLogPath
}

function Show-SnapshotSummary {
    param (
        [object]$Snapshot,
        [object]$Previous
    )

    Write-Host "checagem UTC: $($Snapshot.checkedAtUtc)"
    if (-not $Snapshot.ok) {
        Write-Host "[err] falha ao consultar registry: $($Snapshot.error)"
        return
    }

    if ($Snapshot.mainnetPublished) {
        Write-Host "[ok] mainnet registry publicado"
        if ($null -eq $Previous -or -not $Previous.mainnetPublished) {
            Write-Host "[change] mainnet mudou de indisponivel para publicado"
            Write-RegistryChangeEvent -Snapshot $Snapshot -Change "published"
        }
        $Snapshot.mainnet | ConvertTo-Json -Depth 8
        return
    }

    Write-Host "[warn] mainnet registry ainda indisponivel"
    if ($null -ne $Previous -and $Previous.mainnetPublished) {
        Write-Host "[change] mainnet voltou a ficar indisponivel"
        Write-RegistryChangeEvent -Snapshot $Snapshot -Change "unpublished"
    }
}

$count = 0
while ($true) {
    $count += 1
    $previous = Load-PreviousSnapshot
    $snapshot = Get-RegistrySnapshot
    Save-Snapshot -Snapshot $snapshot

    if ($count -gt 1) {
        Write-Host ""
    }
    Write-Host "AIBTC Registry Watch"
    Write-Host "iteracao: $count"
    Show-SnapshotSummary -Snapshot $snapshot -Previous $previous

    if ($Iterations -gt 0 -and $count -ge $Iterations) {
        break
    }

    Start-Sleep -Seconds $IntervalSeconds
}
