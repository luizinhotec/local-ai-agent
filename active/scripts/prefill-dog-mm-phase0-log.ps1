param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$status = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-status.ps1") | ConvertFrom-Json
$preflight = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-dog-mm-phase0-preflight.ps1") | ConvertFrom-Json

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-log-entry.prefilled.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$lines = @(
    "# DOG MM Agent - Phase 0 Shadow Training Log Entry",
    "",
    "## Header",
    "",
    "- date_local: PREENCHER",
    "- date_utc: PREENCHER",
    '- phase: `0`',
    '- venue: `Bitflow HODLMM/DLMM`',
    "",
    "## Training Context",
    "",
    "- training_pool: $($preflight.selectedPool)",
    "- training_asset_pair: sBTC-USDCx",
    "- why_this_pool: primary HODLMM training venue with bin_step 1 and transferable MM behavior for DOG prep",
    "- expected_transferable_learning_for_dog: recenter discipline, fee friction reading, inventory behavior",
    "",
    "## Setup",
    "",
    "- wallet_confirmed: $($status.wallet.validated)",
    "- capital_allocated_usd: 20",
    "- capital_reserved_for_dog_phase1_usd: 80",
    "- range_hypothesis: moderate range, not max narrow",
    "- recenter_hypothesis: one recenter max, only after material drift or utility loss",
    "",
    "## Execution",
    "",
    "- tx_hash_open: PREENCHER",
    "- opened_at_local: PREENCHER",
    "- opened_at_utc: PREENCHER",
    "- observed_bin_or_range_context: bin_step=1",
    "",
    "## Monitoring",
    "",
    "- first_observation_window: 24h",
    "- stayed_in_range: PREENCHER",
    "- range_breach_detected: PREENCHER",
    "- recenter_needed: PREENCHER",
    "- friction_observed: PREENCHER",
    "",
    "## Close",
    "",
    "- tx_hash_close: PREENCHER",
    "- closed_at_local: PREENCHER",
    "- closed_at_utc: PREENCHER",
    "- reason_for_close: PREENCHER",
    "",
    "## Learning",
    "",
    "- what_was_validated: PREENCHER",
    "- what_failed: PREENCHER",
    "- what_changes_for_dog: PREENCHER",
    "- reusable_rule_for_hodlmm_dog: PREENCHER",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 0 prefilled log exported to: $resolvedOutputPath"
