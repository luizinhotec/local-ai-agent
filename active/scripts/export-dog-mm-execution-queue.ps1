param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-execution-queue.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$nextStep = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1") | ConvertFrom-Json

$lines = @(
    "# DOG MM Execution Queue",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Current Gate",
    "",
    "- next_action: $($nextStep.nextAction)",
    "",
    "## Recommended Order",
    "",
    "1. Start phase 0 session",
    "2. Execute first shadow-training cycle in sBTC-USDCx",
    "3. Fill phase 0 log completely",
    "4. Review whether the training heuristic still holds",
    "5. Only then consider deliberate phase 1 execution in sBTC-DOG",
    "",
    "## Commands",
    "",
    "- phase0_start: powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-phase0-session.ps1",
    "- phase1_start: powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-phase1-session.ps1",
    "- phase0_pack: powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase0-session-pack.ps1",
    "- phase1_pack: powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase1-session-pack.ps1",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM execution queue exported to: $resolvedOutputPath"
