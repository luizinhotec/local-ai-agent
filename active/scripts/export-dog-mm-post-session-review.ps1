param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-post-session-review.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$status = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-status.ps1") | ConvertFrom-Json
$nextStep = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1") | ConvertFrom-Json

$lines = @(
    "# DOG MM Post-Session Review",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Status",
    "",
    "- stage: $($status.stage)",
    "- next_action: $($nextStep.nextAction)",
    "- wallet_validated: $($status.wallet.validated)",
    "- wallet_funded: $($status.wallet.funded)",
    "- phase0_first_cycle_executed: $($status.phase0.firstCycleExecuted)",
    "- phase1_first_trade_executed: $($status.phase1.firstManualTradeExecuted)",
    "",
    "## Operator Review Checklist",
    "",
    "- phase0 log filled if training cycle was run",
    "- phase1 log filled if live DOG cycle was run",
    "- friction observations captured",
    "- inventory observations captured",
    "- next rebalance decision recorded",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM post-session review exported to: $resolvedOutputPath"
