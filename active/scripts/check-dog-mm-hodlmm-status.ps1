param (
    [switch]$Plain
)

$poolsUrl = "https://bff.bitflowapis.finance/api/quotes/v1/pools"
$stateDir = Join-Path $PSScriptRoot "..\state"
$snapshotPath = Join-Path $stateDir "dog-mm-hodlmm-status.json"

function Convert-ToLogicalBoolean {
    param($Value)

    if ($null -eq $Value) {
        return $false
    }

    $text = $Value.ToString().Trim().ToLowerInvariant()
    return ($text -eq "true" -or $text -eq "1")
}

function Get-HodlmmPools {
    try {
        $response = Invoke-WebRequest -UseBasicParsing $poolsUrl -TimeoutSec 30
        $body = $response.Content | ConvertFrom-Json
        return @($body.pools)
    } catch {
        Write-Error "Falha ao consultar pools do HODLMM: $($_.Exception.Message)"
        exit 1
    }
}

function Save-Snapshot {
    param (
        [object]$Snapshot
    )

    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $tempPath = "$snapshotPath.tmp.$PID"
    $json = $Snapshot | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($tempPath, $json, [System.Text.Encoding]::UTF8)
    [System.IO.File]::Copy($tempPath, $snapshotPath, $true)
    [System.IO.File]::Delete($tempPath)
}

$pools = Get-HodlmmPools
$dogPools = @($pools | Where-Object { $_.pool_name -match "DOG" -or $_.pool_symbol -match "DOG" -or $_.token_x -match "DOG" -or $_.token_y -match "DOG" })
$recommendedTrainingPools = @(
    $pools | Where-Object { $_.pool_symbol -eq "sBTC-USDCx" -and [decimal]$_.bin_step -eq 1 }
    $pools | Where-Object { $_.pool_symbol -eq "STX-USDCx" -and @([decimal]$_.bin_step) -contains 1 }
    $pools | Where-Object { $_.pool_symbol -eq "STX-USDCx" -and @([decimal]$_.bin_step) -contains 4 }
    $pools | Where-Object { $_.pool_symbol -eq "aeUSDC-USDCx" -and [decimal]$_.bin_step -eq 1 }
) | Where-Object { $_ -ne $null }

$normalizedDogPools = @($dogPools | Select-Object `
    pool_id,
    pool_name,
    pool_symbol,
    bin_step,
    @{ Name = "active"; Expression = { Convert-ToLogicalBoolean $_.active } },
    @{ Name = "pool_status"; Expression = { Convert-ToLogicalBoolean $_.pool_status } },
    pool_token)

$normalizedTrainingPools = @($recommendedTrainingPools | Select-Object `
    pool_id,
    pool_name,
    pool_symbol,
    bin_step,
    @{ Name = "active"; Expression = { Convert-ToLogicalBoolean $_.active } },
    @{ Name = "pool_status"; Expression = { Convert-ToLogicalBoolean $_.pool_status } },
    pool_token)

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    hodlmmDogPoolAvailable = (@($dogPools).Count -gt 0)
    dogPoolCount = @($dogPools).Count
    dogPools = $normalizedDogPools
    recommendedTrainingPools = $normalizedTrainingPools
    snapshotSource = $poolsUrl
}

Save-Snapshot -Snapshot $result

if ($Plain) {
    Write-Host "checked_at_utc: $($result.checkedAtUtc)"
    Write-Host "hodlmm_dog_pool_available: $($result.hodlmmDogPoolAvailable)"
    Write-Host "dog_pool_count: $($result.dogPoolCount)"
    Write-Host "recommended_training_pools:"
    foreach ($pool in $result.recommendedTrainingPools) {
        Write-Host " - $($pool.pool_symbol) | bin_step=$($pool.bin_step) | active=$($pool.active) | status=$($pool.pool_status)"
    }
    exit 0
}

$result | ConvertTo-Json -Depth 10
