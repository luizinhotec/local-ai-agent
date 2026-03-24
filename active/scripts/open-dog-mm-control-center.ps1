param()

$ErrorActionPreference = "Stop"

$dashboardPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-dashboard.html"
$morningBriefPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-morning-brief.md"
$bundlePath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-bundle.md"

if (-not (Test-Path $dashboardPath)) {
    throw "Dashboard DOG MM nao encontrado. Rode refresh-dog-mm-control-center.ps1 primeiro."
}

Start-Process $dashboardPath

if (Test-Path $morningBriefPath) {
    Start-Process $morningBriefPath
}

if (Test-Path $bundlePath) {
    Start-Process $bundlePath
}

Write-Host "DOG MM control center opened."
