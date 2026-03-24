param(
    [string]$OutputPath,
    [decimal]$StxBalance = -1,
    [long]$SbtcBalanceSats = -1,
    [decimal]$UsdcxBalance = -1
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-pretrade-snapshot.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }

$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$hodlmmStatusPath = Join-Path $PSScriptRoot "..\state\dog-mm-hodlmm-status.json"
$phase0PreflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase0-preflight.ps1"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM Agent nao encontrado."
}

if (-not (Test-Path $hodlmmStatusPath)) {
    throw "Snapshot do HODLMM nao encontrado."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json
$hodlmm = Get-Content $hodlmmStatusPath -Raw | ConvertFrom-Json
$preflight = powershell -ExecutionPolicy Bypass -File $phase0PreflightScript | ConvertFrom-Json
$selectedPool = @($hodlmm.recommendedTrainingPools | Where-Object { $_.pool_symbol -eq "sBTC-USDCx" -and [decimal]$_.bin_step -eq 1 } | Select-Object -First 1)

if ($StxBalance -lt 0 -or $SbtcBalanceSats -lt 0 -or $UsdcxBalance -lt 0) {
    $balancesUrl = "https://api.hiro.so/extended/v1/address/$($status.wallet.stxAddress)/balances"
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

$lines = @(
    "# DOG MM Phase 0 Pretrade Snapshot",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Wallet",
    "",
    "- wallet_name: $($status.wallet.name)",
    "- stx_address: $($status.wallet.stxAddress)",
    "- stx_balance: $StxBalance",
    "- sbtc_balance_sats: $SbtcBalanceSats",
    "- usdcx_balance: $UsdcxBalance",
    "",
    "## Selected Training Venue",
    "",
    "- pool: sBTC-USDCx",
    "- bin_step: 1",
    "- pool_active: $($selectedPool.active)",
    "- pool_status: $($selectedPool.pool_status)",
    "- dog_hodlmm_pool_available: $($hodlmm.hodlmmDogPoolAvailable)",
    "",
    "## Launch Gate",
    "",
    "- phase0_launch_ready: $($preflight.readiness.phase0LaunchReady)",
    "- next_action: $($preflight.readiness.nextAction)",
    "- selected_pool_listed_in_hodlmm_snapshot: $($preflight.checks.selected_pool_listed_in_hodlmm_snapshot)",
    "- selected_pool_active: $($preflight.checks.selected_pool_active)",
    "- hodlmm_dog_pool_still_absent: $($preflight.checks.hodlmm_dog_pool_still_absent)",
    "",
    "## Comment",
    "",
    "- snapshot_intent: freeze the state immediately before the manual open in Bitflow",
    ""
)

$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 0 pretrade snapshot exported to: $resolvedOutputPath"
