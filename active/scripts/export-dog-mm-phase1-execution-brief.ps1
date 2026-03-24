param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-phase1-execution-brief.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }

function Write-TextFileWithRetry {
    param(
        [string]$Path,
        [string]$Content
    )

    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            [System.IO.File]::WriteAllText($Path, $Content, [System.Text.Encoding]::UTF8)
            return
        } catch {
            if ($attempt -eq 5) {
                throw
            }

            Start-Sleep -Milliseconds 250
        }
    }
}

$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$phase1PreflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase1-preflight.ps1"
$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json
$readiness = powershell -ExecutionPolicy Bypass -File $readinessScript | ConvertFrom-Json
$preflight = powershell -ExecutionPolicy Bypass -File $phase1PreflightScript | ConvertFrom-Json

$lines = @(
    "# DOG MM Phase 1 Execution Brief",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Track",
    "",
    "- agent: DOG MM Agent",
    "- stage: $($status.stage)",
    "- phase1_pool: $($status.phase1.selectedPool)",
    "- phase1_asset_base: $($status.phase1.assetBase)",
    "- phase0_pool: $($status.phase0.selectedPool)",
    "",
    "## Wallet",
    "",
    "- wallet_name: $($status.wallet.name)",
    "- wallet_created: $($status.wallet.created)",
    "- wallet_validated: $($status.wallet.validated)",
    "- wallet_funded: $($status.wallet.funded)",
    "",
    "## Readiness",
    "",
    "- phase1_ready: $($readiness.readiness.phase1Ready)",
    "- next_action: $($readiness.nextAction)",
    "",
    "## Phase 1 Preflight",
    "",
    "- phase1_launch_ready: $($preflight.readiness.phase1LaunchReady)",
    "- preflight_next_action: $($preflight.readiness.nextAction)",
    "- hodlmm_dog_pool_available: $($preflight.readiness.hodlmmDogPoolAvailable)",
    "- pool_status: $($preflight.pool.isPoolStatus)",
    "- pool_display_on: $($preflight.pool.isDisplayOn)",
    "- tvl_usd: $($preflight.pool.tvlUsd)",
    "- estimated_entry_friction_pct: $($preflight.pool.estimatedEntryFrictionPct)",
    "",
    "## Market Snapshot",
    "",
    "- sbtc_price_usd: $($preflight.tokens.sBTC.priceUsd)",
    "- sbtc_last_updated: $($preflight.tokens.sBTC.lastUpdated)",
    "- dog_price_usd: $($preflight.tokens.DOG.priceUsd)",
    "- dog_last_updated: $($preflight.tokens.DOG.lastUpdated)",
    "",
    "## Phase 1 Policy",
    "",
    "- venue: Bitflow XYK",
    "- capital_total_authorized: USD 100",
    "- max_capital_per_operation: USD 60",
    "- initial_target_opening: up to USD 50",
    "- reserve_target: at least USD 40",
    "- no_leverage: true",
    "- no_borrowing: true",
    "- one_pool_only: true",
    ""
)

$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
Write-TextFileWithRetry -Path $resolvedOutputPath -Content $content

Write-Host "DOG MM phase 1 execution brief exported to: $resolvedOutputPath"
