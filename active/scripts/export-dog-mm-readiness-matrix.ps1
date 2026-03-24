param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-readiness-matrix.csv"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$nextStep = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1") | ConvertFrom-Json
$inputs = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-dog-mm-input-readiness.ps1") | ConvertFrom-Json
$jsonInputs = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-dog-mm-json-inputs.ps1") | ConvertFrom-Json
$gates = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-dog-mm-launch-gates.ps1") | ConvertFrom-Json

$rows = @(
    [pscustomobject]@{ category = "global"; item = "next_action"; status = $nextStep.nextAction; note = $nextStep.stage }
    [pscustomobject]@{ category = "wallet"; item = "wallet_json_valid"; status = $jsonInputs.walletInput.jsonValid; note = ([string]::Join('|', @($jsonInputs.walletInput.missingProperties))) }
    [pscustomobject]@{ category = "wallet"; item = "wallet_input_ready"; status = $inputs.walletInput.ready; note = "public addresses must be real values" }
    [pscustomobject]@{ category = "wallet"; item = "wallet_gate_ready"; status = $gates.gates.walletReady; note = $gates.blockers.wallet }
    [pscustomobject]@{ category = "funding"; item = "funding_json_valid"; status = $jsonInputs.fundingInput.jsonValid; note = ([string]::Join('|', @($jsonInputs.fundingInput.missingProperties))) }
    [pscustomobject]@{ category = "funding"; item = "funding_input_ready"; status = $inputs.fundingInput.ready; note = "amount and note must be filled" }
    [pscustomobject]@{ category = "phase0"; item = "launch_ready"; status = $gates.gates.phase0Ready; note = $gates.blockers.phase0 }
    [pscustomobject]@{ category = "phase1"; item = "launch_ready"; status = $gates.gates.phase1Ready; note = $gates.blockers.phase1 }
)

$rows | Export-Csv -Path $resolvedOutputPath -NoTypeInformation -Encoding UTF8

Write-Host "DOG MM readiness matrix exported to: $resolvedOutputPath"
