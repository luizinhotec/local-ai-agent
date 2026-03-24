param(
  [switch]$OpenDashboard,
  [switch]$Prune,
  [switch]$SkipIntegrityAudit
)

$ErrorActionPreference = "Stop"

$startOpsScript = Join-Path $PSScriptRoot "start-aibtc-ops.ps1"
$registryWatchScript = Join-Path $PSScriptRoot "watch-aibtc-mainnet-registry.ps1"
$exportReportScript = Join-Path $PSScriptRoot "export-aibtc-ops-report.ps1"
$integrityAuditScript = Join-Path $PSScriptRoot "run-aibtc-integrity-audit.ps1"
$pruneScript = Join-Path $PSScriptRoot "prune-aibtc-local-state.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"

Write-Host "AIBTC Daily Check" -ForegroundColor Cyan
Write-Host ""

$startArgs = @("-ExecutionPolicy", "Bypass", "-File", $startOpsScript)
if ($OpenDashboard) {
  $startArgs += "-OpenBrowser"
}

powershell @startArgs | Out-Host

Write-Host ""
Write-Host "Atualizando snapshot do registry..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File $registryWatchScript -IntervalSeconds 30 -Iterations 1 | Out-Host

Write-Host ""
Write-Host "Exportando relatorio operacional..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File $exportReportScript | Out-Host

if (-not $SkipIntegrityAudit) {
  Write-Host ""
  Write-Host "Executando auditoria de integridade..." -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File $integrityAuditScript | Out-Host
}

if ($Prune) {
  Write-Host ""
  Write-Host "Aplicando retencao local..." -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File $pruneScript | Out-Host
}

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
  openDashboard = [bool]$OpenDashboard
  prune = [bool]$Prune
  integrityAudit = -not [bool]$SkipIntegrityAudit
} | ConvertTo-Json -Depth 6 -Compress

& $writeEventScript -Type "daily_check_run" -DetailsJson $eventDetails | Out-Host
