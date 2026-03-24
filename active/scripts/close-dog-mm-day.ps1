param(
    [switch]$IncludeBackup
)

$ErrorActionPreference = "Stop"

$refreshScript = Join-Path $PSScriptRoot "refresh-dog-mm-control-center.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"

Write-Host "DOG MM day close"
Write-Host ""

powershell -ExecutionPolicy Bypass -File $refreshScript @(
    if ($IncludeBackup) { "-IncludeBackup" }
)

powershell -ExecutionPolicy Bypass -File $writeEventScript -Type "day_closed" | Out-Null
Write-Host ""
Write-Host "ok: day_closed event"
