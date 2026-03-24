param(
    [Parameter(Mandatory = $true)]
    [string]$WalletName,
    [Parameter(Mandatory = $true)]
    [string]$StxAddress,
    [Parameter(Mandatory = $true)]
    [string]$BtcAddress,
    [Parameter(Mandatory = $true)]
    [string]$TaprootAddress,
    [switch]$MarkValidated
)

$ErrorActionPreference = "Stop"

function Test-StxAddress {
    param([string]$Value)
    return $Value -match '^(SP|ST)[A-Z0-9]{38,}$'
}

function Test-BitcoinAddress {
    param([string]$Value)
    return $Value -match '^(bc1|tb1|[13mn2])[a-zA-Z0-9]{20,}$'
}

function Test-TaprootAddress {
    param([string]$Value)
    return $Value -match '^(bc1p|tb1p)[a-z0-9]{20,}$'
}

if (-not (Test-StxAddress $StxAddress)) {
    throw "Endereco STX invalido."
}

if (-not (Test-BitcoinAddress $BtcAddress)) {
    throw "Endereco BTC invalido."
}

if (-not (Test-TaprootAddress $TaprootAddress)) {
    throw "Endereco Taproot invalido."
}

$setStatusScript = Join-Path $PSScriptRoot "set-dog-mm-status.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"

powershell -ExecutionPolicy Bypass -File $setStatusScript `
    -Stage $(if ($MarkValidated) { "wallet_validated" } else { "wallet_created" }) `
    -WalletCreated 1 `
    -WalletValidated $(if ($MarkValidated) { 1 } else { 0 }) `
    -WalletName $WalletName `
    -WalletStxAddress $StxAddress `
    -WalletBtcAddress $BtcAddress `
    -WalletTaprootAddress $TaprootAddress | Out-Null

powershell -ExecutionPolicy Bypass -File $writeEventScript -Type wallet_addresses_registered | Out-Null

Write-Host "DOG MM wallet public addresses registered."
