param()

$ErrorActionPreference = "Stop"

$sessionPackScript = Join-Path $PSScriptRoot "export-dog-mm-phase1-session-pack.ps1"
$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$summaryPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase1-session\dog-mm-phase1-session-summary.md"

$null = powershell -ExecutionPolicy Bypass -File $sessionPackScript
powershell -ExecutionPolicy Bypass -File $eventScript -Type "phase1_session_started" | Out-Null

Write-Host "DOG MM phase 1 session started."
Write-Host "summary: $summaryPath"
