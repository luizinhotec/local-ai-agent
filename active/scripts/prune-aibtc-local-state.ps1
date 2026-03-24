param(
  [int]$KeepReports = 20,
  [int]$KeepLogLines = 500
)

$ErrorActionPreference = "Stop"

$stateDir = Join-Path $PSScriptRoot "..\state"
$reportsDir = Join-Path $stateDir "reports"
$logPath = Join-Path $stateDir "aibtc-ops-log.jsonl"
$repairScript = Join-Path $PSScriptRoot "repair-aibtc-local-state.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"

$removedReports = 0
$logPruned = $false

Write-Host "Prune local state AIBTC" -ForegroundColor Cyan

if (Test-Path $reportsDir) {
  $files = Get-ChildItem -Path $reportsDir -File | Sort-Object LastWriteTime -Descending
  $toRemove = $files | Select-Object -Skip $KeepReports
  foreach ($file in $toRemove) {
    Remove-Item -Path $file.FullName -Force
  }
  $removedReports = $toRemove.Count
  Write-Host "Relatorios mantidos: $([Math]::Min($files.Count, $KeepReports))"
  Write-Host "Relatorios removidos: $removedReports"
}

if (Test-Path $logPath) {
  $lines = Get-Content -Path $logPath
  if ($lines.Count -gt $KeepLogLines) {
    $lines | Select-Object -Last $KeepLogLines | Set-Content -Path $logPath -Encoding utf8
    $logPruned = $true
    Write-Host "Log reduzido para $KeepLogLines linhas."
    powershell -ExecutionPolicy Bypass -File $repairScript | Out-Host
  } else {
    Write-Host "Log nao precisou de prune."
  }
}

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
  reportsRemoved = $removedReports
  logPruned = $logPruned
  keepReports = $KeepReports
  keepLogLines = $KeepLogLines
} | ConvertTo-Json -Depth 6 -Compress

& $writeEventScript -Type "local_state_prune" -DetailsJson $eventDetails | Out-Host
