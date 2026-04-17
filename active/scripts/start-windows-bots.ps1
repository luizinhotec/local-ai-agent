param(
    [switch]$ForceRestart,
    [switch]$DeribitExecute,
    [switch]$OrionDryRun
)

$scriptsRoot = $PSScriptRoot

Write-Host "Starting Windows bot set..."

Write-Host ""
Write-Host "1) Helper server"
& (Join-Path $scriptsRoot 'start-aibtc-register-helper.ps1') -ForceRestart:$ForceRestart

Write-Host ""
Write-Host "2) Orion"
& (Join-Path $scriptsRoot 'start-orion.ps1') -ForceRestart:$ForceRestart -DryRun:$OrionDryRun

Write-Host ""
Write-Host "3) Speedy Indra"
& (Join-Path $scriptsRoot 'start-speedy-indra.ps1') -ForceRestart:$ForceRestart

Write-Host ""
Write-Host "4) Deribit"
& (Join-Path $scriptsRoot 'start-deribit-bot.ps1') -ForceRestart:$ForceRestart -Execute:$DeribitExecute

Write-Host ""
Write-Host "5) DOG-MM lp-reposition"
& (Join-Path $scriptsRoot 'start-dog-mm-lp-reposition.ps1') -ForceRestart:$ForceRestart

Write-Host ""
Write-Host "Windows bot start sequence completed."
