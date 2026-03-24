param(
    [string]$InputPath
)

$ErrorActionPreference = "Stop"

$defaultInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-funding-input.json"
$templateInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-funding-input.template.json"
$resolvedInputPath = if ($InputPath) { $InputPath } else { $defaultInputPath }

if (-not (Test-Path $resolvedInputPath)) {
    if (Test-Path $templateInputPath) {
        throw "Arquivo de funding nao encontrado em '$resolvedInputPath'. Copie o template '$templateInputPath' para 'dog-mm-funding-input.json' e preencha os dados do funding."
    }

    throw "Arquivo de funding do DOG MM nao encontrado."
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

if (-not $input.fundingAmountUsd) {
    throw "fundingAmountUsd ausente no input."
}

if (-not $input.fundingNote) {
    throw "fundingNote ausente no input."
}

if (Test-PlaceholderValue $input.fundingAmountUsd) {
    throw "fundingAmountUsd ainda esta com placeholder no input."
}

if (Test-PlaceholderValue $input.fundingNote) {
    throw "fundingNote ainda esta com placeholder no input."
}

$markFundedScript = Join-Path $PSScriptRoot "mark-dog-mm-wallet-funded.ps1"
$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"
$showStatusScript = Join-Path $PSScriptRoot "show-dog-mm-status.ps1"

powershell -ExecutionPolicy Bypass -File $markFundedScript `
    -FundingAmountUsd $input.fundingAmountUsd `
    -FundingNote $input.fundingNote

Write-Host ""
Write-Host "DOG MM readiness after funding:"
powershell -ExecutionPolicy Bypass -File $readinessScript -Plain

Write-Host ""
Write-Host "DOG MM status after funding:"
powershell -ExecutionPolicy Bypass -File $showStatusScript -Plain
