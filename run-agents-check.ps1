$ErrorActionPreference = "Stop"
Set-Location "C:\dev\local-ai-agent"

if (-not (Test-Path ".\.env.ps1")) {
    Write-Host "Arquivo .env.ps1 nao encontrado."
    exit 1
}

. .\.env.ps1

Write-Host ""
Write-Host "1) Validando auth Deribit..."
npm.cmd run deribit:validate-auth

Write-Host ""
Write-Host "2) Checando Deribit..."
npm.cmd run deribit:check

Write-Host ""
Write-Host "3) Rodando heartbeat AIBTC..."
npm.cmd run aibtc:heartbeat

Write-Host ""
Write-Host "4) Rodando DOG-MM em dry-run..."
npm.cmd run dog-mm:bitflow-swap

Write-Host ""
Write-Host "== Concluido =="