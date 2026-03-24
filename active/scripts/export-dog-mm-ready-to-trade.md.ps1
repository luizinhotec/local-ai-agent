param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ready-to-trade.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$status = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-status.ps1") | ConvertFrom-Json
$next = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1") | ConvertFrom-Json
$phase0 = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-dog-mm-phase0-preflight.ps1") | ConvertFrom-Json
$phase1 = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-dog-mm-phase1-preflight.ps1") | ConvertFrom-Json

$lines = @(
    "# DOG MM Ready To Trade",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Global",
    "",
    "- stage: $($status.stage)",
    "- next_action: $($next.nextAction)",
    "- wallet_validated: $($status.wallet.validated)",
    "- wallet_funded: $($status.wallet.funded)",
    "",
    "## Phase 0",
    "",
    "- pool: $($phase0.selectedPool)",
    "- launch_ready: $($phase0.readiness.phase0LaunchReady)",
    "- next_action: $($phase0.readiness.nextAction)",
    "- recommended_initial_capital_usd: 20",
    "",
    "## Phase 1",
    "",
    "- pool: $($phase1.selectedPool)",
    "- launch_ready: $($phase1.readiness.phase1LaunchReady)",
    "- next_action: $($phase1.readiness.nextAction)",
    "- suggested_first_trade_usd: 50",
    "",
    "## Recommendation",
    "",
    "- execute phase 0 first",
    "- only then decide whether to proceed to phase 1",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM ready-to-trade summary exported to: $resolvedOutputPath"
