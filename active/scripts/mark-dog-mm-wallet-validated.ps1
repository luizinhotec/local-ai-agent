param(
    [Parameter(Mandatory = $true)]
    [string]$WalletName,
    [Parameter(Mandatory = $true)]
    [string]$StxAddress,
    [Parameter(Mandatory = $true)]
    [string]$BtcAddress,
    [Parameter(Mandatory = $true)]
    [string]$TaprootAddress
)

$ErrorActionPreference = "Stop"

$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$setAddressesScript = Join-Path $PSScriptRoot "set-dog-mm-wallet-addresses.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$exportProfileScript = Join-Path $PSScriptRoot "export-dog-mm-agent-profile.ps1"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json

if (-not [bool]$status.wallet.created) {
    throw "Nao e permitido validar enderecos antes da criacao da wallet."
}

powershell -ExecutionPolicy Bypass -File $setAddressesScript `
    -WalletName $WalletName `
    -StxAddress $StxAddress `
    -BtcAddress $BtcAddress `
    -TaprootAddress $TaprootAddress `
    -MarkValidated | Out-Null

powershell -ExecutionPolicy Bypass -File $writeEventScript -Type wallet_validated | Out-Null
powershell -ExecutionPolicy Bypass -File $exportProfileScript | Out-Null

Write-Host "DOG MM wallet marked as validated."
Write-Host "wallet_name: $WalletName"
Write-Host "wallet_stx: $StxAddress"
Write-Host "wallet_btc: $BtcAddress"
Write-Host "wallet_taproot: $TaprootAddress"
