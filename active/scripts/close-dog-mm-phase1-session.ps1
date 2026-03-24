param()

$ErrorActionPreference = "Stop"

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$summaryScript = Join-Path $PSScriptRoot "export-dog-mm-phase1-session-pack.ps1"

$null = powershell -ExecutionPolicy Bypass -File $summaryScript
powershell -ExecutionPolicy Bypass -File $eventScript -Type "phase1_session_closed" | Out-Null

Write-Host "DOG MM phase 1 session closed."
