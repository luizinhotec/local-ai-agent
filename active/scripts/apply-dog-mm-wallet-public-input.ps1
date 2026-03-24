param(
    [string]$InputPath
)

$ErrorActionPreference = "Stop"

$defaultInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-wallet-public-input.json"
$templateInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-wallet-public-input.template.json"
$resolvedInputPath = if ($InputPath) { $InputPath } else { $defaultInputPath }

if (-not (Test-Path $resolvedInputPath)) {
    if (Test-Path $templateInputPath) {
        throw "Arquivo de input nao encontrado em '$resolvedInputPath'. Copie o template '$templateInputPath' para 'dog-mm-wallet-public-input.json' e preencha os enderecos publicos."
    }

    throw "Arquivo de input DOG MM nao encontrado."
}

$input = Get-Content $resolvedInputPath -Raw | ConvertFrom-Json

function Test-PlaceholderValue {
    param([string]$Value)

    if ($null -eq $Value) {
        return $true
    }

    $text = $Value.Trim().ToUpperInvariant()
    return ($text -eq "" -or $text -eq "PREENCHER" -or $text -like "PREENCHER*")
}

if (-not $input.walletName) {
    throw "walletName ausente no input."
}

if (-not $input.stxAddress) {
    throw "stxAddress ausente no input."
}

if (-not $input.btcAddress) {
    throw "btcAddress ausente no input."
}

if (-not $input.taprootAddress) {
    throw "taprootAddress ausente no input."
}

if (Test-PlaceholderValue $input.stxAddress) {
    throw "stxAddress ainda esta com placeholder no input."
}

if (Test-PlaceholderValue $input.btcAddress) {
    throw "btcAddress ainda esta com placeholder no input."
}

if (Test-PlaceholderValue $input.taprootAddress) {
    throw "taprootAddress ainda esta com placeholder no input."
}

$markValidatedScript = Join-Path $PSScriptRoot "mark-dog-mm-wallet-validated.ps1"
$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"
$showStatusScript = Join-Path $PSScriptRoot "show-dog-mm-status.ps1"

powershell -ExecutionPolicy Bypass -File $markValidatedScript `
    -WalletName $input.walletName `
    -StxAddress $input.stxAddress `
    -BtcAddress $input.btcAddress `
    -TaprootAddress $input.taprootAddress

Write-Host ""
Write-Host "DOG MM readiness after wallet validation:"
powershell -ExecutionPolicy Bypass -File $readinessScript -Plain

Write-Host ""
Write-Host "DOG MM status after wallet validation:"
powershell -ExecutionPolicy Bypass -File $showStatusScript -Plain
