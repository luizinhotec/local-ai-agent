param(
    [string]$OutputPath,
    [decimal]$StxBalanceOverride = -1,
    [long]$SbtcBalanceOverrideSats = -1
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-funding-plan.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$stxAddress = "SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF"
$btcAddress = "bc1qyqdgy5zd4narvjkvdr3pdz55as448k6ahdf8xy"

function Get-Json {
    param([string]$Url)

    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 30
    return $response.Content | ConvertFrom-Json
}

$hiroUrl = "https://api.hiro.so/extended/v1/address/$stxAddress/balances"
$balances = Get-Json -Url $hiroUrl
$null = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check-dog-mm-phase1-pool.ps1")
$pool = Get-Content (Join-Path $PSScriptRoot "..\state\dog-mm-phase1-pool-status.json") -Raw | ConvertFrom-Json

$currentMicroStx = [int64]$balances.stx.balance
$currentStx = [math]::Round(($currentMicroStx / 1000000), 6)
$sbtcContract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"
$currentSats = if ($balances.fungible_tokens.PSObject.Properties.Name -contains $sbtcContract) {
    [int64]$balances.fungible_tokens.$sbtcContract.balance
} else {
    0
}

if ($StxBalanceOverride -ge 0) {
    $currentStx = [math]::Round($StxBalanceOverride, 6)
}

if ($SbtcBalanceOverrideSats -ge 0) {
    $currentSats = [int64]$SbtcBalanceOverrideSats
}

$sbtcPriceUsd = [decimal]$pool.tokens.sBTC.priceUsd
$targetUsd = [decimal]20
$targetSats = [math]::Ceiling(($targetUsd / $sbtcPriceUsd) * 100000000)
$shortfallSats = [math]::Max(0, ($targetSats - $currentSats))

$optionalOperationalMarginSats = 5000
$recommendedTopUpSats = if ($shortfallSats -gt 0) {
    [math]::Max($shortfallSats, $optionalOperationalMarginSats)
} else {
    0
}
$targetOperationalStx = [decimal]3
$recommendedStxTopUpAmount = [math]::Max([decimal]0, ($targetOperationalStx - $currentStx))
$recommendedStxTopUp = "$([math]::Round($recommendedStxTopUpAmount, 6)) STX"
$canStartPhase0Now = ($currentStx -ge 1 -and $shortfallSats -eq 0)
$marginTopUpNote = if ($recommendedTopUpSats -eq 0) {
    "optional only; wallet already clears the bare phase 0 target"
} else {
    "recommended if you want a larger operating margin above the bare phase 0 target"
}

$lines = @(
    "# DOG MM Funding Plan",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Wallet",
    "",
    "- stx_address: $stxAddress",
    "- btc_address: $btcAddress",
    "",
    "## Current Balances",
    "",
    "- stx_balance: $currentStx STX",
    "- sbtc_balance_sats: $currentSats",
    "- sbtc_balance_formatted: $([decimal]$currentSats / 100000000)",
    "",
    "## Phase 0 Target",
    "",
    "- target_usd: 20",
    "- sbtc_price_usd_used: $sbtcPriceUsd",
    "- target_sats_for_20_usd: $targetSats",
    "- shortfall_sats_vs_20_usd: $shortfallSats",
    "",
    "## Recommended Funding Now",
    "",
    "- stx_top_up_recommended: $recommendedStxTopUp",
    "- sbtc_top_up_recommended_sats: $recommendedTopUpSats",
    "- rationale: cover fees in STX and create a small operational margin above the bare 20 USD threshold",
    "- can_start_phase0_now: $canStartPhase0Now",
    "- margin_note: $marginTopUpNote",
    "",
    "## Practical Recommendation",
    "",
    $(if ($canStartPhase0Now) { "- current balances are sufficient to start phase 0" } else { "- do not start with current balances" }),
    "- send at least $recommendedStxTopUp to the DOG MM wallet",
    "- send at least $recommendedTopUpSats sats of sBTC to the DOG MM wallet",
    $(if ($recommendedTopUpSats -eq 0 -and $recommendedStxTopUpAmount -eq 0) { "- no additional funding is required before opening phase 0" } else { "- after funding, recheck balances before opening phase 0" }),
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM funding plan exported to: $resolvedOutputPath"
