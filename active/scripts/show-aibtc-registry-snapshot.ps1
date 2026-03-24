param (
    [switch]$Plain,
    [string]$Timezone = "E. South America Standard Time"
)

$snapshotPath = Join-Path $PSScriptRoot "..\state\aibtc-mainnet-registry-status.json"

function Convert-ToLocalString {
    param (
        [string]$TimestampIso
    )

    if (-not $TimestampIso) {
        return $null
    }

    try {
        $utc = [datetime]::Parse($TimestampIso).ToUniversalTime()
        return [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($utc, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
    } catch {
        return $null
    }
}

if (-not (Test-Path $snapshotPath)) {
    Write-Host "[warn] nenhum snapshot local do registry encontrado"
    exit 0
}

$snapshot = Get-Content $snapshotPath -Raw | ConvertFrom-Json
$checkedAtLocal = Convert-ToLocalString $snapshot.checkedAtUtc

$result = [pscustomobject]@{
    summary = if ($snapshot.mainnetPublished) { "registry mainnet publicado" } else { "registry ainda indisponivel" }
    checkedAtUtc = $snapshot.checkedAtUtc
    checkedAtLocal = $checkedAtLocal
    statusCode = $snapshot.statusCode
    mainnetPublished = $snapshot.mainnetPublished
    mainnet = $snapshot.mainnet
}

if ($Plain) {
    Write-Host "snapshot registry: $($result.summary)"
    Write-Host "checado em: $($result.checkedAtLocal)"
    Write-Host "http: $($result.statusCode)"
    exit 0
}

$result | ConvertTo-Json -Depth 8
