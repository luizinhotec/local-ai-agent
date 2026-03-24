param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$nextStepScript = Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1"
$inputsScript = Join-Path $PSScriptRoot "test-dog-mm-input-readiness.ps1"
$gatesScript = Join-Path $PSScriptRoot "test-dog-mm-launch-gates.ps1"

$nextStep = powershell -ExecutionPolicy Bypass -File $nextStepScript | ConvertFrom-Json
$inputs = powershell -ExecutionPolicy Bypass -File $inputsScript | ConvertFrom-Json
$gates = powershell -ExecutionPolicy Bypass -File $gatesScript | ConvertFrom-Json

$steps = @()

if (-not $inputs.walletInput.ready) {
    $steps += [pscustomobject]@{
        order = 1
        area = "wallet_input"
        action = "fill_wallet_public_addresses"
        file = "active/state/dog-mm/dog-mm-wallet-public-input.json"
        command = "powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-wallet-public-input.ps1"
    }
}

if ($inputs.walletInput.ready -and -not $gates.gates.walletReady) {
    $steps += [pscustomobject]@{
        order = 2
        area = "wallet_state"
        action = "apply_wallet_validation"
        file = "active/state/dog-mm/dog-mm-wallet-public-input.json"
        command = "powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-wallet-public-input.ps1"
    }
}

if (-not $inputs.fundingInput.ready) {
    $steps += [pscustomobject]@{
        order = 3
        area = "funding_input"
        action = "fill_funding_input"
        file = "active/state/dog-mm/dog-mm-funding-input.json"
        command = "powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-funding-input.ps1"
    }
}

if ($inputs.fundingInput.ready -and $inputs.walletInput.ready -and -not $gates.gates.walletReady) {
    $steps += [pscustomobject]@{
        order = 4
        area = "funding_state"
        action = "apply_wallet_funding"
        file = "active/state/dog-mm/dog-mm-funding-input.json"
        command = "powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-funding-input.ps1"
    }
}

if ($gates.gates.walletReady -and -not $gates.gates.phase0Ready) {
    $steps += [pscustomobject]@{
        order = 5
        area = "phase0"
        action = "review_phase0_preflight"
        file = "active/state/dog-mm/dog-mm-phase0-execution-brief.md"
        command = "powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-phase0-preflight.ps1 -Plain"
    }
}

if ($gates.gates.walletReady -and -not $gates.gates.phase1Ready) {
    $steps += [pscustomobject]@{
        order = 6
        area = "phase1"
        action = "review_phase1_preflight"
        file = "active/state/dog-mm/dog-mm-phase1-execution-brief.md"
        command = "powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-phase1-preflight.ps1 -Plain"
    }
}

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    nextAction = $nextStep.nextAction
    walletReady = [bool]$gates.gates.walletReady
    phase0Ready = [bool]$gates.gates.phase0Ready
    phase1Ready = [bool]$gates.gates.phase1Ready
    steps = $steps
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "next_action: $($result.nextAction)"
    Write-Host "wallet_ready: $($result.walletReady)"
    Write-Host "phase0_ready: $($result.phase0Ready)"
    Write-Host "phase1_ready: $($result.phase1Ready)"
    foreach ($step in $result.steps) {
        Write-Host "step_$($step.order): $($step.action) | file=$($step.file)"
    }
    exit 0
}

$result | ConvertTo-Json -Depth 10
