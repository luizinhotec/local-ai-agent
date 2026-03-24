param(
    [string]$OutputPath,
    [decimal]$StxBalance = -1,
    [long]$SbtcBalanceSats = -1,
    [decimal]$UsdcxBalance = -1
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-action-sheet.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm-hodlmm-status.json"
$poolSnapshotPath = Join-Path $PSScriptRoot "..\state\dog-mm-phase1-pool-status.json"

if (-not (Test-Path $statusPath)) {
    throw "Snapshot do HODLMM nao encontrado."
}

if (-not (Test-Path $poolSnapshotPath)) {
    throw "Snapshot da pool DOG nao encontrado."
}

$hodlmm = Get-Content $statusPath -Raw | ConvertFrom-Json
$phase1 = Get-Content $poolSnapshotPath -Raw | ConvertFrom-Json
$trainingPool = @(
    $hodlmm.recommendedTrainingPools |
        Where-Object { $_.pool_symbol -eq "sBTC-USDCx" -and [decimal]$_.bin_step -eq 1 } |
        Select-Object -First 1
)

if (-not $trainingPool) {
    throw "Pool sBTC-USDCx bin_step 1 nao encontrada no snapshot atual."
}

$setupStatusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
if (($StxBalance -lt 0 -or $SbtcBalanceSats -lt 0 -or $UsdcxBalance -lt 0) -and (Test-Path $setupStatusPath)) {
    $setupStatus = Get-Content $setupStatusPath -Raw | ConvertFrom-Json
    $balancesUrl = "https://api.hiro.so/extended/v1/address/$($setupStatus.wallet.stxAddress)/balances"
    $balances = (Invoke-WebRequest -UseBasicParsing -Uri $balancesUrl -TimeoutSec 30).Content | ConvertFrom-Json

    if ($StxBalance -lt 0) {
        $StxBalance = [math]::Round(([decimal]$balances.stx.balance / 1000000), 6)
    }

    if ($SbtcBalanceSats -lt 0) {
        $sbtcContract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"
        $SbtcBalanceSats = if ($balances.fungible_tokens.PSObject.Properties.Name -contains $sbtcContract) {
            [int64]$balances.fungible_tokens.$sbtcContract.balance
        } else {
            0
        }
    }

    if ($UsdcxBalance -lt 0) {
        $usdcxContract = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx"
        $usdcxRaw = if ($balances.fungible_tokens.PSObject.Properties.Name -contains $usdcxContract) {
            [decimal]$balances.fungible_tokens.$usdcxContract.balance
        } else {
            0
        }
        $UsdcxBalance = [math]::Round(($usdcxRaw / 1000000), 6)
    }
}

$sbtcPriceUsd = [decimal]$phase1.tokens.sBTC.priceUsd
$targetUsd = [decimal]20
$cycleTargetSats = [math]::Ceiling(($targetUsd / $sbtcPriceUsd) * 100000000)
$cycleReserveSats = [math]::Max(0, ($SbtcBalanceSats - $cycleTargetSats))
$swapTargetSats = [math]::Floor($cycleTargetSats / 2)
$keepTargetSats = $cycleTargetSats - $swapTargetSats
$approxUsdcxFromSwap = [math]::Round((($swapTargetSats / 100000000) * $sbtcPriceUsd), 2)
$inventoryAlreadyStaged = ($UsdcxBalance -gt 0)

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# DOG MM Phase 0 Action Sheet")
$lines.Add("")
$lines.Add("Generated at UTC: $([datetime]::UtcNow.ToString('o'))")
$lines.Add("")
$lines.Add("## Live Context")
$lines.Add("")
$lines.Add("- wallet_stx: $StxBalance")
$lines.Add("- wallet_sbtc_sats: $SbtcBalanceSats")
$lines.Add("- wallet_usdcx: $UsdcxBalance")
$lines.Add("- training_pool: sBTC-USDCx")
$lines.Add("- bin_step: 1")
$lines.Add("- pool_active: $($trainingPool.active)")
$lines.Add("- pool_status: $($trainingPool.pool_status)")
$lines.Add("- hodlmm_dog_pool_available: $($hodlmm.hodlmmDogPoolAvailable)")
$lines.Add("- sbtc_price_usd_used: $sbtcPriceUsd")
$lines.Add("")
$lines.Add("## First-Cycle Capital")
$lines.Add("")
$lines.Add("- target_cycle_usd: 20")
$lines.Add("- target_cycle_sats: $cycleTargetSats")
$lines.Add("- reserve_sbtc_outside_cycle_sats: $cycleReserveSats")
$lines.Add("")

if ($inventoryAlreadyStaged) {
    $lines.Add("## Current Inventory State")
    $lines.Add("")
    $lines.Add("- inventory_already_staged: true")
    $lines.Add("- staged_sbtc_sats_for_lp: $SbtcBalanceSats")
    $lines.Add("- staged_usdcx_for_lp: $UsdcxBalance")
    $lines.Add("- rationale: swap leg already completed onchain; the remaining action is LP add only")
    $lines.Add("")
} else {
    $lines.Add("## Recommended Inventory Setup")
    $lines.Add("")
    $lines.Add("- keep_in_sbtc_for_lp_sats: $keepTargetSats")
    $lines.Add("- swap_from_sbtc_to_usdcx_sats: $swapTargetSats")
    $lines.Add("- approx_usdcx_to_obtain: $approxUsdcxFromSwap")
    $lines.Add("- rationale: start roughly delta-neutral for training and preserve a small sBTC reserve outside the first cycle")
    $lines.Add("")
}

$lines.Add("## Manual Steps Now")
$lines.Add("")

if ($inventoryAlreadyStaged) {
    $lines.Add("1. Open Bitflow and select the HODLMM/DLMM pool sBTC-USDCx with bin_step = 1.")
    $lines.Add("2. Do not perform another inventory swap before the LP add.")
    $lines.Add("3. Use the currently staged inventory: $SbtcBalanceSats sats of sBTC and $UsdcxBalance USDCx.")
    $lines.Add("4. Add liquidity with a moderate range bias, not the narrowest possible configuration.")
    $lines.Add("5. Copy the LP add tx hash immediately after submission.")
    $lines.Add("6. Record phase 0 open only after the LP add tx exists.")
    $lines.Add("7. Do not recenter before 12h unless there is a real risk event.")
} else {
    $lines.Add("1. Open Bitflow and select the HODLMM/DLMM pool sBTC-USDCx with bin_step = 1.")
    $lines.Add("2. Keep roughly $cycleReserveSats sats of sBTC out of the first cycle as idle reserve.")
    $lines.Add("3. Use the first-cycle budget of $cycleTargetSats sats total, not the full wallet balance.")
    $lines.Add("4. Swap roughly $swapTargetSats sats of sBTC into about $approxUsdcxFromSwap USDCx if the UI requires two-sided inventory for the LP entry.")
    $lines.Add("5. Add liquidity with a moderate range bias, not the narrowest possible configuration.")
    $lines.Add("6. Record the open transaction hash immediately in the phase 0 log.")
    $lines.Add("7. Do not recenter before 12h unless there is a real risk event.")
}

$lines.Add("")
$lines.Add("## Guardrails")
$lines.Add("")
$lines.Add("- phase0_first_cycle_capital_usd: 20")
$lines.Add("- no_second_recenter: true")
$lines.Add("- if_second_recenter_seems_needed: close_the_cycle_and_record_failure")
$lines.Add("- do_not_touch_phase1_capital_path: true")
$lines.Add("")

$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 0 action sheet exported to: $resolvedOutputPath"
