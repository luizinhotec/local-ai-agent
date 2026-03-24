param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-blockers-report.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$nextStepScript = Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1"
$gatesScript = Join-Path $PSScriptRoot "test-dog-mm-launch-gates.ps1"
$inputReadinessScript = Join-Path $PSScriptRoot "test-dog-mm-input-readiness.ps1"

$nextStep = powershell -ExecutionPolicy Bypass -File $nextStepScript | ConvertFrom-Json
$gates = powershell -ExecutionPolicy Bypass -File $gatesScript | ConvertFrom-Json
$inputs = powershell -ExecutionPolicy Bypass -File $inputReadinessScript | ConvertFrom-Json

$lines = @(
    "# DOG MM Blockers Report",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Global",
    "",
    "- next_action: $($nextStep.nextAction)",
    "- stage: $($nextStep.stage)",
    "",
    "## Wallet Blockers",
    "",
    "- wallet_ready: $($gates.gates.walletReady)",
    "- wallet_blocker: $($gates.blockers.wallet)",
    "- wallet_input_ready: $($inputs.walletInput.ready)",
    "- stx_address_ready: $($inputs.walletInput.stxAddressReady)",
    "- btc_address_ready: $($inputs.walletInput.btcAddressReady)",
    "- taproot_address_ready: $($inputs.walletInput.taprootAddressReady)",
    "",
    "## Funding Blockers",
    "",
    "- funding_input_ready: $($inputs.fundingInput.ready)",
    "- funding_amount_ready: $($inputs.fundingInput.fundingAmountReady)",
    "- funding_note_ready: $($inputs.fundingInput.fundingNoteReady)",
    "",
    "## Phase Gates",
    "",
    "- phase0_ready: $($gates.gates.phase0Ready)",
    "- phase0_blocker: $($gates.blockers.phase0)",
    "- phase1_ready: $($gates.gates.phase1Ready)",
    "- phase1_blocker: $($gates.blockers.phase1)",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM blockers report exported to: $resolvedOutputPath"
