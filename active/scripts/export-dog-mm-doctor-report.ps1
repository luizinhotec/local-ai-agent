param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-doctor-report.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$nextStepScript = Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1"
$inputsScript = Join-Path $PSScriptRoot "test-dog-mm-input-readiness.ps1"
$gatesScript = Join-Path $PSScriptRoot "test-dog-mm-launch-gates.ps1"
$planScript = Join-Path $PSScriptRoot "show-dog-mm-remediation-plan.ps1"

$nextStep = powershell -ExecutionPolicy Bypass -File $nextStepScript | ConvertFrom-Json
$inputs = powershell -ExecutionPolicy Bypass -File $inputsScript | ConvertFrom-Json
$gates = powershell -ExecutionPolicy Bypass -File $gatesScript | ConvertFrom-Json
$plan = powershell -ExecutionPolicy Bypass -File $planScript | ConvertFrom-Json

$lines = @(
    "# DOG MM Doctor Report",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Summary",
    "",
    "- next_action: $($nextStep.nextAction)",
    "- wallet_ready: $($gates.gates.walletReady)",
    "- phase0_ready: $($gates.gates.phase0Ready)",
    "- phase1_ready: $($gates.gates.phase1Ready)",
    "",
    "## Inputs",
    "",
    "- wallet_input_ready: $($inputs.walletInput.ready)",
    "- wallet_name_present: $($inputs.walletInput.walletNamePresent)",
    "- stx_address_ready: $($inputs.walletInput.stxAddressReady)",
    "- btc_address_ready: $($inputs.walletInput.btcAddressReady)",
    "- taproot_address_ready: $($inputs.walletInput.taprootAddressReady)",
    "- funding_input_ready: $($inputs.fundingInput.ready)",
    "- funding_amount_ready: $($inputs.fundingInput.fundingAmountReady)",
    "- funding_note_ready: $($inputs.fundingInput.fundingNoteReady)",
    "",
    "## Blockers",
    "",
    "- wallet_blocker: $($gates.blockers.wallet)",
    "- phase0_blocker: $($gates.blockers.phase0)",
    "- phase1_blocker: $($gates.blockers.phase1)",
    "",
    "## Remediation Plan",
    ""
)

foreach ($step in @($plan.steps)) {
    $lines += "- [$($step.order)] $($step.action)"
    $lines += "  file: $($step.file)"
    $lines += "  command: $($step.command)"
}

$lines += ""
$lines += "## Reference Files"
$lines += ""
$lines += "- wallet_input: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-wallet-public-input.json"
$lines += "- funding_input: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-funding-input.json"
$lines += "- blockers_report: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-blockers-report.md"
$lines += "- morning_brief: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-morning-brief.md"
$lines += "- dashboard: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-ops-dashboard.html"
$lines += ""

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM doctor report exported to: $resolvedOutputPath"
