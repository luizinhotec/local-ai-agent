param()

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$stateDir = Join-Path $root "active\state"
$reportsDir = Join-Path $stateDir "reports"
$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"
$opsStatusUrl = "http://127.0.0.1:8765/api/ops-status"
$reportPath = Join-Path $reportsDir "aibtc-ops-report-latest.json"
$backupMetaPath = Join-Path $stateDir "aibtc-local-state-backup-latest.json"
$registrySnapshotPath = Join-Path $stateDir "aibtc-mainnet-registry-status.json"
$opsLogPath = Join-Path $stateDir "aibtc-ops-log.jsonl"
$auditLatestPath = Join-Path $stateDir "aibtc-integrity-audit-latest.json"

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return $null
  }
  try {
    return Get-Content -Path $Path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Add-Finding {
  param(
    [System.Collections.Generic.List[object]]$List,
    [string]$Level,
    [string]$Code,
    [string]$Summary
  )
  $List.Add([pscustomobject]@{
    level = $Level
    code = $Code
    summary = $Summary
  })
}

Write-Host "Auditoria de integridade AIBTC" -ForegroundColor Cyan

powershell -ExecutionPolicy Bypass -File $helperScript | Out-Host

$opsStatus = Invoke-RestMethod -Uri $opsStatusUrl -TimeoutSec 30
$latestReport = Read-JsonFile -Path $reportPath
$backupMeta = Read-JsonFile -Path $backupMetaPath
$registrySnapshot = Read-JsonFile -Path $registrySnapshotPath

$heartbeatEvents = @()
if (Test-Path $opsLogPath) {
  $heartbeatEvents = Get-Content $opsLogPath |
    Where-Object { $_.Trim() -ne "" } |
    ForEach-Object {
      try { $_ | ConvertFrom-Json } catch { $null }
    } |
    Where-Object { $_ -and $_.type -eq "heartbeat_success" }
}

$findings = New-Object 'System.Collections.Generic.List[object]'

if (-not $opsStatus.heartbeat.latestSuccess) {
  Add-Finding -List $findings -Level "warn" -Code "heartbeat_missing_in_status" -Summary "ops-status nao possui heartbeat_success consolidado"
}

if (-not $heartbeatEvents -or @($heartbeatEvents).Count -eq 0) {
  Add-Finding -List $findings -Level "warn" -Code "heartbeat_missing_in_log" -Summary "log local nao possui heartbeat_success"
}

if (-not $latestReport) {
  Add-Finding -List $findings -Level "warn" -Code "report_missing" -Summary "relatorio local latest nao encontrado"
}

if (-not $backupMeta) {
  Add-Finding -List $findings -Level "warn" -Code "backup_metadata_missing" -Summary "metadata do ultimo backup nao encontrada"
}

if (-not $registrySnapshot) {
  Add-Finding -List $findings -Level "warn" -Code "registry_snapshot_missing" -Summary "snapshot do registry nao encontrado"
}

if ($opsStatus.heartbeat.latestSuccess -and $latestReport.heartbeat.latestSuccess) {
  $opsHeartbeat = $opsStatus.heartbeat.latestSuccess.timestampIso
  if (-not $opsHeartbeat) { $opsHeartbeat = $opsStatus.heartbeat.latestSuccess.loggedAt }
  $reportHeartbeat = $latestReport.heartbeat.latestSuccess.timestampIso
  if (-not $reportHeartbeat) { $reportHeartbeat = $latestReport.heartbeat.latestSuccess.loggedAt }
  if ($opsHeartbeat -ne $reportHeartbeat) {
    Add-Finding -List $findings -Level "warn" -Code "heartbeat_mismatch_report" -Summary "heartbeat do relatorio difere do heartbeat consolidado"
  }
}

if ($backupMeta -and $opsStatus.backup.summary -match "nenhum backup") {
  Add-Finding -List $findings -Level "warn" -Code "backup_not_reflected_in_status" -Summary "ops-status nao refletiu o backup persistido"
}

if ($latestReport -and $backupMeta -and $latestReport.backup.summary -match "nenhum backup") {
  Add-Finding -List $findings -Level "warn" -Code "backup_not_reflected_in_report" -Summary "relatorio latest nao refletiu o backup persistido"
}

$auditSummary = if ($findings.Count -eq 0) {
  "estado local coerente"
} else {
  "estado local com divergencias"
}

$auditSnapshot = New-Object psobject
$auditSnapshot | Add-Member NoteProperty heartbeatInStatus ([bool]$opsStatus.heartbeat.latestSuccess)
$auditSnapshot | Add-Member NoteProperty heartbeatInLog ((@($heartbeatEvents).Count -gt 0))
$auditSnapshot | Add-Member NoteProperty reportAvailable ([bool]$latestReport)
$auditSnapshot | Add-Member NoteProperty backupMetadataAvailable ([bool]$backupMeta)
$auditSnapshot | Add-Member NoteProperty registrySnapshotAvailable ([bool]$registrySnapshot)

$auditFindings = @()
foreach ($finding in $findings) {
  $auditFindings += $finding
}

$audit = New-Object psobject
$audit | Add-Member NoteProperty checkedAtUtc ([datetime]::UtcNow.ToString("o"))
$audit | Add-Member NoteProperty ok ($findings.Count -eq 0)
$audit | Add-Member NoteProperty summary $auditSummary
$audit | Add-Member NoteProperty findings $auditFindings
$audit | Add-Member NoteProperty snapshot $auditSnapshot

$audit | ConvertTo-Json -Depth 8 | Set-Content -Path $auditLatestPath -Encoding utf8

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
  audit = $audit
} | ConvertTo-Json -Depth 8 -Compress

& $writeEventScript -Type "integrity_audit_run" -DetailsJson $eventDetails | Out-Host

Write-Host "Auditoria concluida:" -ForegroundColor Green
Write-Host $audit.summary
if ($findings.Count -gt 0) {
  $findings | ForEach-Object { Write-Host "- [$($_.level)] $($_.summary)" -ForegroundColor Yellow }
}
