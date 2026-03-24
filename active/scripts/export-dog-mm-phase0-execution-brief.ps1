param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-phase0-execution-brief.md"
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
$phase0PreflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase0-preflight.ps1"
$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json
$readiness = powershell -ExecutionPolicy Bypass -File $readinessScript | ConvertFrom-Json
$preflight = powershell -ExecutionPolicy Bypass -File $phase0PreflightScript | ConvertFrom-Json

$lines = @(
    "# DOG MM Phase 0 Execution Brief",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Track",
    "",
    "- agent: DOG MM Agent",
    "- stage: $($status.stage)",
    "- phase0_pool: $($status.phase0.selectedPool)",
    "- phase0_bin_step: $($status.phase0.binStep)",
    "- phase1_pool: $($status.phase1.selectedPool)",
    "- phase1_asset_base: $($status.phase1.assetBase)",
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
    "- phase0_ready: $($readiness.readiness.phase0Ready)",
    "- phase1_ready: $($readiness.readiness.phase1Ready)",
    "- next_action: $($readiness.nextAction)",
    "",
    "## Phase 0 Preflight",
    "",
    "- phase0_launch_ready: $($preflight.readiness.phase0LaunchReady)",
    "- preflight_next_action: $($preflight.readiness.nextAction)",
    "- selected_pool_listed_in_hodlmm_snapshot: $($preflight.checks.selected_pool_listed_in_hodlmm_snapshot)",
    "- selected_pool_active: $($preflight.checks.selected_pool_active)",
    "- selected_pool_status: $($preflight.checks.selected_pool_status)",
    "- hodlmm_dog_pool_still_absent: $($preflight.checks.hodlmm_dog_pool_still_absent)",
    "",
    "## First Cycle Policy",
    "",
    "- capital_initial_recommended: USD 20",
    "- observation_window: 24h",
    "- recenter_max: 1",
    "- no_recenter_before: 12h unless risk",
    "- if_second_recenter_needed: close_cycle_and_record_failure",
    ""
)

$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
Write-TextFileWithRetry -Path $resolvedOutputPath -Content $content

Write-Host "DOG MM phase 0 execution brief exported to: $resolvedOutputPath"
