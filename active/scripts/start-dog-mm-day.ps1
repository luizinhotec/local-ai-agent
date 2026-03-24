param(
    [switch]$IncludeBackup
)

$ErrorActionPreference = "Stop"

$ensureInputsScript = Join-Path $PSScriptRoot "ensure-dog-mm-input-files.ps1"
$refreshScript = Join-Path $PSScriptRoot "refresh-dog-mm-control-center.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"

Write-Host "DOG MM day start"
Write-Host ""

powershell -ExecutionPolicy Bypass -File $ensureInputsScript
Write-Host "ok: input files"

powershell -ExecutionPolicy Bypass -File $refreshScript @(
    if ($IncludeBackup) { "-IncludeBackup" }
)

powershell -ExecutionPolicy Bypass -File $writeEventScript -Type "day_started" | Out-Null
Write-Host ""
Write-Host "ok: day_started event"
