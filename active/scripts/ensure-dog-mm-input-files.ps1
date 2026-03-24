param()

$ErrorActionPreference = "Stop"

$stateDir = Join-Path $PSScriptRoot "..\state\dog-mm"
$walletTemplate = Join-Path $stateDir "dog-mm-wallet-public-input.template.json"
$walletInput = Join-Path $stateDir "dog-mm-wallet-public-input.json"
$fundingTemplate = Join-Path $stateDir "dog-mm-funding-input.template.json"
$fundingInput = Join-Path $stateDir "dog-mm-funding-input.json"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if ((Test-Path $walletTemplate) -and -not (Test-Path $walletInput)) {
    Copy-Item $walletTemplate $walletInput -Force
    Write-Host "created: $walletInput"
} else {
    Write-Host "ok: $walletInput"
}

if ((Test-Path $fundingTemplate) -and -not (Test-Path $fundingInput)) {
    Copy-Item $fundingTemplate $fundingInput -Force
    Write-Host "created: $fundingInput"
} else {
    Write-Host "ok: $fundingInput"
}
