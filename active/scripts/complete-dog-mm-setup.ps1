param(
    [switch]$IncludeBackup,
    [switch]$OpenControlCenter
)

$ErrorActionPreference = "Stop"

$validateJsonScript = Join-Path $PSScriptRoot "validate-dog-mm-json-inputs.ps1"
$inputReadinessScript = Join-Path $PSScriptRoot "test-dog-mm-input-readiness.ps1"
$walletApplyScript = Join-Path $PSScriptRoot "apply-dog-mm-wallet-public-input.ps1"
$fundingApplyScript = Join-Path $PSScriptRoot "apply-dog-mm-funding-input.ps1"
$refreshScript = Join-Path $PSScriptRoot "refresh-dog-mm-control-center.ps1"
$remediationScript = Join-Path $PSScriptRoot "show-dog-mm-remediation-plan.ps1"
$openScript = Join-Path $PSScriptRoot "open-dog-mm-control-center.ps1"

Write-Host "DOG MM complete setup"
Write-Host ""

$jsonValidation = powershell -ExecutionPolicy Bypass -File $validateJsonScript | ConvertFrom-Json
if (-not [bool]$jsonValidation.walletInput.jsonValid) {
    throw "Wallet input JSON invalido. Rode validate-dog-mm-json-inputs.ps1 -Plain."
}

if (-not [bool]$jsonValidation.fundingInput.jsonValid) {
    throw "Funding input JSON invalido. Rode validate-dog-mm-json-inputs.ps1 -Plain."
}

$inputs = powershell -ExecutionPolicy Bypass -File $inputReadinessScript | ConvertFrom-Json
if (-not [bool]$inputs.walletInput.ready) {
    $plan = powershell -ExecutionPolicy Bypass -File $remediationScript -Plain
    throw "Wallet input ainda nao esta pronto. Preencha dog-mm-wallet-public-input.json com enderecos reais antes do setup completo."
}

if (-not [bool]$inputs.fundingInput.ready) {
    throw "Funding input ainda nao esta pronto. Preencha dog-mm-funding-input.json antes do setup completo."
}

powershell -ExecutionPolicy Bypass -File $walletApplyScript
Write-Host "ok: wallet validation applied"

powershell -ExecutionPolicy Bypass -File $fundingApplyScript
Write-Host "ok: funding applied"

$refreshArgs = @()
if ($IncludeBackup) {
    $refreshArgs += "-IncludeBackup"
}

powershell -ExecutionPolicy Bypass -File $refreshScript @refreshArgs
Write-Host "ok: control center refreshed"

if ($OpenControlCenter) {
    powershell -ExecutionPolicy Bypass -File $openScript | Out-Null
    Write-Host "ok: control center opened"
}

Write-Host ""
Write-Host "DOG MM complete setup finished."
