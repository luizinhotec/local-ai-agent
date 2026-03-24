param(
  [switch]$OpenDashboard,
  [switch]$Prune
)

$ErrorActionPreference = "Stop"

$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$statusScript = Join-Path $PSScriptRoot "show-aibtc-ops-status.ps1"
$dailyCheckScript = Join-Path $PSScriptRoot "run-aibtc-daily-check.ps1"
$backupScript = Join-Path $PSScriptRoot "backup-aibtc-local-state.ps1"
$integrityAuditScript = Join-Path $PSScriptRoot "run-aibtc-integrity-audit.ps1"
$exportReportScript = Join-Path $PSScriptRoot "export-aibtc-ops-report.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"
$opsStatusUrl = "http://127.0.0.1:8765/api/ops-status"

function Get-OpsStatus {
  try {
    return Invoke-RestMethod -Uri $opsStatusUrl -TimeoutSec 30
  } catch {
    return $null
  }
}

Write-Host "AIBTC Maintenance Cycle" -ForegroundColor Cyan
Write-Host ""

powershell -ExecutionPolicy Bypass -File $helperScript | Out-Host

$initialStatus = Get-OpsStatus
$ranBackup = $false

if ($initialStatus -and (($initialStatus.backup.latest -eq $null) -or $initialStatus.backup.stale)) {
  Write-Host ""
  Write-Host "Gerando backup preventivo antes do ciclo..." -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File $backupScript | Out-Host
  $ranBackup = $true
}

Write-Host ""
Write-Host "Executando daily check..." -ForegroundColor Cyan
$dailyArgs = @("-ExecutionPolicy", "Bypass", "-File", $dailyCheckScript)
if ($OpenDashboard) {
  $dailyArgs += "-OpenDashboard"
}
if ($Prune) {
  $dailyArgs += "-Prune"
}
powershell @dailyArgs | Out-Host

Write-Host ""
Write-Host "Executando auditoria de integridade final..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File $integrityAuditScript | Out-Host

Write-Host ""
$finalStatus = Get-OpsStatus
$finalOk = [bool]$finalStatus -and -not @($finalStatus.alerts).Count

$eventDetails = @{
  result = @{
    status = 200
    ok = $finalOk
  }
  backupTriggered = $ranBackup
  openDashboard = [bool]$OpenDashboard
  prune = [bool]$Prune
  finalPrimaryAction = if ($finalStatus.primaryAction) { $finalStatus.primaryAction.summary } else { $null }
  finalAlerts = @($finalStatus.alerts | ForEach-Object { $_.summary })
} | ConvertTo-Json -Depth 8 -Compress

& $writeEventScript -Type "maintenance_cycle_run" -DetailsJson $eventDetails | Out-Host

Write-Host ""
Write-Host "Exportando relatorio final do ciclo..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File $exportReportScript | Out-Host

Write-Host ""
Write-Host "Resumo final do ciclo:" -ForegroundColor Green
powershell -ExecutionPolicy Bypass -File $statusScript -Plain | Out-Host
