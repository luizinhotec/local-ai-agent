param(
    [decimal]$StxBalance = -1,
    [long]$SbtcBalanceSats = -1,
    [decimal]$UsdcxBalance = -1
)

$ErrorActionPreference = "Stop"

$refreshScript = Join-Path $PSScriptRoot "refresh-dog-mm-control-center.ps1"
$sessionScript = Join-Path $PSScriptRoot "start-dog-mm-phase0-session.ps1"
$prefillScript = Join-Path $PSScriptRoot "prefill-dog-mm-phase0-log.ps1"
$snapshotScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-pretrade-snapshot.ps1"
$actionSheetScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-action-sheet.ps1"
$monitorScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-monitor-card.ps1"
$readyScript = Join-Path $PSScriptRoot "export-dog-mm-ready-to-trade.md.ps1"

powershell -ExecutionPolicy Bypass -File $refreshScript | Out-Null
powershell -ExecutionPolicy Bypass -File $sessionScript | Out-Null
powershell -ExecutionPolicy Bypass -File $prefillScript | Out-Null
powershell -ExecutionPolicy Bypass -File $snapshotScript -StxBalance $StxBalance -SbtcBalanceSats $SbtcBalanceSats -UsdcxBalance $UsdcxBalance | Out-Null
powershell -ExecutionPolicy Bypass -File $actionSheetScript -StxBalance $StxBalance -SbtcBalanceSats $SbtcBalanceSats -UsdcxBalance $UsdcxBalance | Out-Null
powershell -ExecutionPolicy Bypass -File $monitorScript | Out-Null
powershell -ExecutionPolicy Bypass -File $readyScript | Out-Null

Write-Host "DOG MM phase 0 go-live pack prepared."
Write-Host "Files:"
Write-Host "- C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-pretrade-snapshot.md"
Write-Host "- C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-action-sheet.md"
Write-Host "- C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-monitor-card.md"
Write-Host "- C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-log-entry.prefilled.md"
