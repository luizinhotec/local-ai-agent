param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$address = "SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF"
$poolId = "dlmm_2"
$openTxId = "016846ea5517449a33f42c59e0f3a4851142214d2d011b263c97056aaffc2bf8"
$swapTxId = "82b3e4f470f538ff48dfd41cb8db3c9a52c692f49e4bf6a558c3e7ef3fbe7d1e"

function Invoke-JsonGet {
    param([string]$Uri)

    $lastError = $null
    foreach ($attempt in 1..3) {
        try {
            return Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec 20
        } catch {
            $lastError = $_
            Start-Sleep -Seconds (2 * $attempt)
        }
    }

    throw $lastError
}

$liquidity = Invoke-JsonGet -Uri "https://bff.bitflowapis.finance/api/app/v1/users/${address}/liquidity/${poolId}?fresh=true"
$bins = Invoke-JsonGet -Uri "https://bff.bitflowapis.finance/api/app/v1/users/${address}/positions/${poolId}/bins?fresh=true"
$tx = Invoke-JsonGet -Uri "https://api.hiro.so/extended/v1/tx/0x$openTxId"

$primaryBin = @($bins.bins | Sort-Object { [int]$_.bin_id } | Select-Object -First 1)[0]
$liquidityTokenX = if ($liquidity.totalLiquidity.tokenX) { [decimal]$liquidity.totalLiquidity.tokenX.amount } else { [decimal]0 }
$liquidityTokenY = if ($liquidity.totalLiquidity.tokenY) { [decimal]$liquidity.totalLiquidity.tokenY.amount } else { [decimal]0 }

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    phase = 0
    pool = "sBTC-USDCx"
    poolId = $poolId
    binStep = 1
    swapTxId = $swapTxId
    openTxId = $openTxId
    openTxStatus = $tx.tx_status
    openBlockHeight = $tx.block_height
    unsignedBinId = if ($primaryBin) { [int]$primaryBin.bin_id } else { $null }
    lpTokenAmount = if ($primaryBin) { [string]$primaryBin.userLiquidity } else { $null }
    coversActiveBin = if ($liquidity.priceRange) { [bool]$liquidity.priceRange.coversActiveBin } else { $false }
    priceRange = [pscustomobject]@{
        min = if ($liquidity.priceRange) { [string]$liquidity.priceRange.min } else { $null }
        max = if ($liquidity.priceRange) { [string]$liquidity.priceRange.max } else { $null }
    }
    liquidity = [pscustomobject]@{
        tokenXAmount = [string]$liquidityTokenX
        tokenYAmount = [string]$liquidityTokenY
        totalValueUsd = [string]([decimal]::Round([decimal]$liquidity.totalValueUsd, 8))
        totalValueBtc = [string]$liquidity.totalValueBtc
    }
    earned = [pscustomobject]@{
        usd = [string]$liquidity.userEarningsUsd
        btc = [string]$liquidity.userEarningsBtc
    }
    nextAction = "record_phase0_checkpoint_when_observation_is_meaningful"
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "phase: 0"
    Write-Host "pool: $($result.pool)"
    Write-Host "open_txid: $($result.openTxId)"
    Write-Host "open_tx_status: $($result.openTxStatus)"
    Write-Host "open_block_height: $($result.openBlockHeight)"
    Write-Host "unsigned_bin_id: $($result.unsignedBinId)"
    Write-Host "lp_token_amount: $($result.lpTokenAmount)"
    Write-Host "covers_active_bin: $($result.coversActiveBin)"
    Write-Host "liquidity_token_x_amount: $($result.liquidity.tokenXAmount)"
    Write-Host "liquidity_token_y_amount: $($result.liquidity.tokenYAmount)"
    Write-Host "total_value_usd: $($result.liquidity.totalValueUsd)"
    Write-Host "next_action: $($result.nextAction)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
