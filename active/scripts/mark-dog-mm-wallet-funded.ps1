param(
    [string]$Stage = "wallet_funded",
    [string]$FundingAmountUsd = "100",
    [string]$FundingNote = "experimental_funding"
)

$ErrorActionPreference = "Stop"

$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$setStatusScript = Join-Path $PSScriptRoot "set-dog-mm-status.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json

if (-not [bool]$status.wallet.created) {
    throw "Nao e permitido marcar funding antes da criacao da wallet."
}

if (-not [bool]$status.wallet.validated) {
    throw "Nao e permitido marcar funding antes da validacao dos enderecos publicos."
}

powershell -ExecutionPolicy Bypass -File $setStatusScript -Stage $Stage -WalletFunded 1 | Out-Null
powershell -ExecutionPolicy Bypass -File $writeEventScript -Type wallet_funded | Out-Null
powershell -ExecutionPolicy Bypass -File $writeEventScript -Type funding_registered | Out-Null

Write-Host "DOG MM wallet marked as funded."
Write-Host "funding_amount_usd: $FundingAmountUsd"
Write-Host "funding_note: $FundingNote"
