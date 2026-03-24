param()

$ErrorActionPreference = "Stop"

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$summaryScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-session-pack.ps1"

$null = powershell -ExecutionPolicy Bypass -File $summaryScript
powershell -ExecutionPolicy Bypass -File $eventScript -Type "phase0_session_closed" | Out-Null

Write-Host "DOG MM phase 0 session closed."
