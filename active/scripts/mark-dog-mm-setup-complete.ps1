param()

$ErrorActionPreference = "Stop"

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$refreshScript = Join-Path $PSScriptRoot "refresh-dog-mm-control-center.ps1"

powershell -ExecutionPolicy Bypass -File $eventScript -Type "setup_completed" | Out-Null
powershell -ExecutionPolicy Bypass -File $eventScript -Type "phase0_ready" | Out-Null
powershell -ExecutionPolicy Bypass -File $eventScript -Type "phase1_ready" | Out-Null
powershell -ExecutionPolicy Bypass -File $refreshScript | Out-Null

Write-Host "DOG MM setup marked as complete."
