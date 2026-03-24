param(
  [string]$OutputDir = "active/state/reports"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$resolvedOutputDir = Join-Path $root $OutputDir
$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"
$opsStatusUrl = "http://127.0.0.1:8765/api/ops-status"
$timestamp = Get-Date
$stamp = $timestamp.ToString("yyyyMMdd-HHmmss")

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

powershell -ExecutionPolicy Bypass -File $helperScript | Out-Host

$opsStatus = Invoke-RestMethod -Uri $opsStatusUrl -TimeoutSec 30

$jsonPath = Join-Path $resolvedOutputDir "aibtc-ops-report-$stamp.json"
$mdPath = Join-Path $resolvedOutputDir "aibtc-ops-report-$stamp.md"
$latestJsonPath = Join-Path $resolvedOutputDir "aibtc-ops-report-latest.json"
$latestMdPath = Join-Path $resolvedOutputDir "aibtc-ops-report-latest.md"

$opsStatus | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding utf8
$opsStatus | ConvertTo-Json -Depth 8 | Set-Content -Path $latestJsonPath -Encoding utf8

$lastHeartbeat = $opsStatus.heartbeat.latestSuccess.timestampIso
$lastHeartbeatLocal = if ($lastHeartbeat) { ([DateTime]$lastHeartbeat).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } else { "nenhum" }
$nextCheck = $opsStatus.heartbeat.nextCheckInUtc
$nextCheckLocal = if ($nextCheck) { ([DateTime]$nextCheck).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } else { "desconhecida" }
$latestEvent = if ($opsStatus.latestEvent.type) { $opsStatus.latestEvent.type } else { "nenhum" }
$alerts = @($opsStatus.alerts)
$alertsText = if ($alerts.Count -gt 0) {
  @($alerts | ForEach-Object { "- [$($_.level)] $($_.summary)" }) -join "`r`n"
} else {
  "- nenhum alerta ativo"
}
$recentEvents = @($opsStatus.recentEvents | ForEach-Object {
  "- $($_.type) em $($_.loggedAt)"
}) -join "`r`n"

$md = @"
# AIBTC Ops Report

- gerado em: $($timestamp.ToString("yyyy-MM-dd HH:mm:ss"))
- heartbeat pronto agora: $($opsStatus.heartbeat.readyNow)
- ultimo heartbeat ok: $lastHeartbeatLocal
- proxima janela heartbeat: $nextCheckLocal
- diagnostico heartbeat: $($opsStatus.heartbeat.diagnostics.summary)
- registry: $($opsStatus.registry.summary)
- fonte registry: $($opsStatus.registry.source)
- relatorio: $($opsStatus.report.summary)
- manutencao: $($opsStatus.maintenance.summary)
- ciclo manutencao: $($opsStatus.maintenanceCycle.summary)
- backup: $($opsStatus.backup.summary)
- daily check: $($opsStatus.dailyCheck.summary)
- auditoria: $($opsStatus.integrityAudit.summary)
- proxima acao recomendada: $($opsStatus.primaryAction.summary)
- ultimo evento local: $latestEvent

## Alertas
$alertsText

## Eventos Recentes
$recentEvents
"@

$md | Set-Content -Path $mdPath -Encoding utf8
$md | Set-Content -Path $latestMdPath -Encoding utf8

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
  latestReport = $opsStatus
} | ConvertTo-Json -Depth 8 -Compress

& $writeEventScript -Type "ops_report_export" -DetailsJson $eventDetails | Out-Host

Write-Host "Relatorio exportado:" -ForegroundColor Green
Write-Host $jsonPath
Write-Host $mdPath
Write-Host $latestJsonPath
Write-Host $latestMdPath
