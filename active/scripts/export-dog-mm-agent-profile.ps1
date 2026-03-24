param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$templatePath = Join-Path $PSScriptRoot "..\templates\aibtc\dog-mm\dog-mm-agent-profile.suggested.json"
$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-agent-profile.preview.json"

if (-not (Test-Path $templatePath)) {
    throw "Template do profile DOG MM nao encontrado."
}

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao encontrado. Rode initialize-dog-mm-local-state.ps1 primeiro."
}

$template = Get-Content $templatePath -Raw | ConvertFrom-Json
$status = Get-Content $statusPath -Raw | ConvertFrom-Json

$template.operator.stxAddress = $status.wallet.stxAddress
$template.operator.btcAddress = $status.wallet.btcAddress
$template.operator.taprootAddress = $status.wallet.taprootAddress

$resolvedOutput = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$template | ConvertTo-Json -Depth 10 | Set-Content -Path $resolvedOutput -Encoding UTF8

Write-Host "DOG MM agent profile preview exported to: $resolvedOutput"
