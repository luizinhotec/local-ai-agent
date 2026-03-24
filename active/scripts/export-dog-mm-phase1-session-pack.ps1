param(
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$resolvedOutputDir = if ($OutputDir) {
    $OutputDir
} else {
    Join-Path $PSScriptRoot "..\state\dog-mm\phase1-session"
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
$resolvedOutputDir = (Resolve-Path $resolvedOutputDir).Path

$briefScript = Join-Path $PSScriptRoot "export-dog-mm-phase1-execution-brief.ps1"
$preflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase1-preflight.ps1"
$statusScript = Join-Path $PSScriptRoot "show-dog-mm-status.ps1"
$templatePath = Join-Path $PSScriptRoot "..\templates\aibtc\dog-mm\dog-mm-phase1-log-entry.template.md"

$null = powershell -ExecutionPolicy Bypass -File $briefScript
$preflight = powershell -ExecutionPolicy Bypass -File $preflightScript | ConvertFrom-Json
$status = powershell -ExecutionPolicy Bypass -File $statusScript | ConvertFrom-Json

$logOutputPath = Join-Path $resolvedOutputDir "dog-mm-phase1-log-entry.md"
Copy-Item $templatePath $logOutputPath -Force

$summaryPath = Join-Path $resolvedOutputDir "dog-mm-phase1-session-summary.md"
$lines = @(
    "# DOG MM Phase 1 Session Pack",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Status",
    "",
    "- stage: $($status.stage)",
    "- wallet_name: $($status.wallet.name)",
    "- wallet_validated: $($status.wallet.validated)",
    "- wallet_funded: $($status.wallet.funded)",
    "",
    "## Session Configuration",
    "",
    "- pool: $($preflight.selectedPool)",
    "- asset_base: $($preflight.assetBase)",
    "- launch_ready: $($preflight.readiness.phase1LaunchReady)",
    "- next_action: $($preflight.readiness.nextAction)",
    "- capital_total_authorized_usd: 100",
    "- max_capital_per_operation_usd: 60",
    "- initial_target_opening_usd: 50",
    "",
    "## Files",
    "",
    "- execution_brief: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-phase1-execution-brief.md",
    "- session_log_template: $logOutputPath",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($summaryPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 1 session pack exported to: $resolvedOutputDir"
