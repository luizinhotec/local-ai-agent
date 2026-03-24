param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-operator-handoff.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$nextStep = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1") | ConvertFrom-Json
$queuePath = "C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-execution-queue.md"
$dashboardPath = "C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-ops-dashboard.html"
$phase0Pack = "C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-session-summary.md"
$phase1Pack = "C:\dev\local-ai-agent\active\state\dog-mm\phase1-session\dog-mm-phase1-session-summary.md"

$lines = @(
    "# DOG MM Operator Handoff",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Immediate Context",
    "",
    "- next_action: $($nextStep.nextAction)",
    "- recommended_order: phase0_first",
    "",
    "## Open First",
    "",
    "- dashboard: $dashboardPath",
    "- execution_queue: $queuePath",
    "- phase0_session_pack: $phase0Pack",
    "- phase1_session_pack: $phase1Pack",
    "",
    "## Discipline",
    "",
    "- do not mix with Speedy Indra",
    "- do not switch to principal wallet",
    "- phase 0 remains the first recommended live session",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM operator handoff exported to: $resolvedOutputPath"
