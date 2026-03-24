param (
    [switch]$Plain
)

$poolsUrl = "https://bff.bitflowapis.finance/api/quotes/v1/pools"

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

$pools = Get-HodlmmPools
$trainingPools = @(
    $pools | Where-Object { $_.pool_symbol -eq "sBTC-USDCx" }
    $pools | Where-Object { $_.pool_symbol -eq "STX-USDCx" }
    $pools | Where-Object { $_.pool_symbol -eq "STX-sBTC" }
    $pools | Where-Object { $_.pool_symbol -eq "aeUSDC-USDCx" }
) | Where-Object { $_ -ne $null } |
    Sort-Object pool_symbol, @{ Expression = { [decimal]$_.bin_step } }

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    pools = @($trainingPools | Select-Object pool_id,pool_name,pool_symbol,bin_step,active,pool_status,pool_token)
    source = $poolsUrl
}

if ($Plain) {
    Write-Host "checked_at_utc: $($result.checkedAtUtc)"
    foreach ($pool in $result.pools) {
        Write-Host "$($pool.pool_symbol) | bin_step=$($pool.bin_step) | active=$($pool.active) | status=$($pool.pool_status)"
    }
    exit 0
}

$result | ConvertTo-Json -Depth 10
