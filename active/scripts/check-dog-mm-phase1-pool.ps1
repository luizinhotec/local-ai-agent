param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$poolsUrl = "https://app.bitflow.finance/api/sdk/get-pools-and-earn?timestamp=1"
$tokensUrl = "https://app.bitflow.finance/api/sdk/get-token-data?token=token-sbtc,token-dog&timestamp=1"
$snapshotPath = Join-Path $PSScriptRoot "..\state\dog-mm-phase1-pool-status.json"

function Get-JsonResponse {
    param([string]$Url)

    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 30
    return $response.Content | ConvertFrom-Json
}

$poolsResponse = Get-JsonResponse -Url $poolsUrl
$tokensResponse = Get-JsonResponse -Url $tokensUrl

$phase1Pool = @($poolsResponse.data | Where-Object { $_.symbol -eq "sBTC-DOG" }) | Select-Object -First 1
$fallbackPool = @($poolsResponse.data | Where-Object { $_.symbol -eq "pBTC-DOG" }) | Select-Object -First 1

if (-not $phase1Pool) {
    throw "Pool sBTC-DOG nao encontrada na API da Bitflow."
}

$sbtcToken = $tokensResponse.data.'token-sbtc'
$dogToken = $tokensResponse.data.'token-dog'
$estimatedEntryFrictionPct = [math]::Round((([decimal]$phase1Pool.xProtocolFee + [decimal]$phase1Pool.xProviderFee) * 100), 4)

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    selectedPool = "sBTC-DOG"
    venue = "Bitflow XYK"
    pool = [pscustomobject]@{
        symbol = $phase1Pool.symbol
        name = $phase1Pool.name
        poolId = $phase1Pool.poolId
        poolContract = $phase1Pool.poolContract
        isPoolCreated = [bool]$phase1Pool.isPoolCreated
        isPoolStatus = [bool]$phase1Pool.isPoolStatus
        isDisplayOn = [bool]$phase1Pool.isDisplayOn
        tvlUsd = [math]::Round([decimal]$phase1Pool.calculatedData.tvl_usd, 2)
        estimatedEntryFrictionPct = $estimatedEntryFrictionPct
        xFeeTotalPct = [math]::Round((([decimal]$phase1Pool.xProtocolFee + [decimal]$phase1Pool.xProviderFee) * 100), 4)
        yFeeTotalPct = [math]::Round((([decimal]$phase1Pool.yProtocolFee + [decimal]$phase1Pool.yProviderFee) * 100), 4)
    }
    tokens = [pscustomobject]@{
        sBTC = [pscustomobject]@{
            priceUsd = $sbtcToken.priceData.last_price
            lastUpdated = $sbtcToken.priceData.last_updated
        }
        DOG = [pscustomobject]@{
            priceUsd = $dogToken.priceData.last_price
            lastUpdated = $dogToken.priceData.last_updated
        }
    }
    comparison = [pscustomobject]@{
        fallbackPoolSymbol = if ($fallbackPool) { $fallbackPool.symbol } else { $null }
        fallbackPoolTvlUsd = if ($fallbackPool) { [math]::Round([decimal]$fallbackPool.calculatedData.tvl_usd, 2) } else { $null }
    }
    snapshotSource = [pscustomobject]@{
        poolsUrl = $poolsUrl
        tokensUrl = $tokensUrl
    }
}

$tempPath = "$snapshotPath.tmp.$PID"
$json = $result | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($tempPath, $json, [System.Text.Encoding]::UTF8)
[System.IO.File]::Copy($tempPath, $snapshotPath, $true)
[System.IO.File]::Delete($tempPath)

if ($Plain) {
    Write-Host "checked_at_utc: $($result.checkedAtUtc)"
    Write-Host "selected_pool: $($result.selectedPool)"
    Write-Host "pool_status: $($result.pool.isPoolStatus)"
    Write-Host "pool_created: $($result.pool.isPoolCreated)"
    Write-Host "pool_display_on: $($result.pool.isDisplayOn)"
    Write-Host "tvl_usd: $($result.pool.tvlUsd)"
    Write-Host "estimated_entry_friction_pct: $($result.pool.estimatedEntryFrictionPct)"
    Write-Host "sbtc_price_usd: $($result.tokens.sBTC.priceUsd)"
    Write-Host "dog_price_usd: $($result.tokens.DOG.priceUsd)"
    Write-Host "fallback_pool_symbol: $($result.comparison.fallbackPoolSymbol)"
    Write-Host "fallback_pool_tvl_usd: $($result.comparison.fallbackPoolTvlUsd)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
