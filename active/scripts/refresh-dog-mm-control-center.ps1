param(
    [switch]$IncludeBackup
)

$ErrorActionPreference = "Stop"

$scripts = [ordered]@{
    hodlmm = Join-Path $PSScriptRoot "check-dog-mm-hodlmm-status.ps1"
    phase1Pool = Join-Path $PSScriptRoot "check-dog-mm-phase1-pool.ps1"
    phase0Brief = Join-Path $PSScriptRoot "export-dog-mm-phase0-execution-brief.ps1"
    phase1Brief = Join-Path $PSScriptRoot "export-dog-mm-phase1-execution-brief.ps1"
    opsBundle = Join-Path $PSScriptRoot "export-dog-mm-ops-bundle.ps1"
    morningBrief = Join-Path $PSScriptRoot "export-dog-mm-morning-brief.ps1"
    dashboard = Join-Path $PSScriptRoot "export-dog-mm-ops-dashboard.ps1"
    blockers = Join-Path $PSScriptRoot "export-dog-mm-blockers-report.ps1"
    doctor = Join-Path $PSScriptRoot "export-dog-mm-doctor-report.ps1"
    readinessMatrix = Join-Path $PSScriptRoot "export-dog-mm-readiness-matrix.ps1"
    nextStep = Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1"
    backup = Join-Path $PSScriptRoot "backup-dog-mm-local-state.ps1"
}

Write-Host "DOG MM control center refresh"
Write-Host ""

powershell -ExecutionPolicy Bypass -File $scripts.hodlmm | Out-Null
Write-Host "ok: hodlmm snapshot"

powershell -ExecutionPolicy Bypass -File $scripts.phase1Pool | Out-Null
Write-Host "ok: phase1 pool snapshot"

powershell -ExecutionPolicy Bypass -File $scripts.phase0Brief | Out-Null
Write-Host "ok: phase0 brief"

powershell -ExecutionPolicy Bypass -File $scripts.phase1Brief | Out-Null
Write-Host "ok: phase1 brief"

powershell -ExecutionPolicy Bypass -File $scripts.opsBundle | Out-Null
Write-Host "ok: ops bundle"

powershell -ExecutionPolicy Bypass -File $scripts.morningBrief | Out-Null
Write-Host "ok: morning brief"

powershell -ExecutionPolicy Bypass -File $scripts.dashboard | Out-Null
Write-Host "ok: dashboard"

powershell -ExecutionPolicy Bypass -File $scripts.blockers | Out-Null
Write-Host "ok: blockers report"

powershell -ExecutionPolicy Bypass -File $scripts.doctor | Out-Null
Write-Host "ok: doctor report"

powershell -ExecutionPolicy Bypass -File $scripts.readinessMatrix | Out-Null
Write-Host "ok: readiness matrix"

if ($IncludeBackup) {
    powershell -ExecutionPolicy Bypass -File $scripts.backup | Out-Null
    Write-Host "ok: backup"
}

Write-Host ""
Write-Host "Current next step:"
powershell -ExecutionPolicy Bypass -File $scripts.nextStep -Plain
