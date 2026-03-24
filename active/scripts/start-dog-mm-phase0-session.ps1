param()

$ErrorActionPreference = "Stop"

$sessionPackScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-session-pack.ps1"
$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$summaryPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-session-summary.md"

$null = powershell -ExecutionPolicy Bypass -File $sessionPackScript
powershell -ExecutionPolicy Bypass -File $eventScript -Type "phase0_session_started" | Out-Null

Write-Host "DOG MM phase 0 session started."
Write-Host "summary: $summaryPath"
