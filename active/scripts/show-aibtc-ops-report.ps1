param(
  [switch]$Plain,
  [int]$Port = 8765,
  [string]$Timezone = "E. South America Standard Time"
)

$reportUrl = "http://127.0.0.1:$Port/api/ops-report-latest"
$fallbackPath = Join-Path $PSScriptRoot "..\state\reports\aibtc-ops-report-latest.json"

function Convert-ToLocalString {
    param (
        [string]$TimestampIso
    )

    if (-not $TimestampIso) {
        return $null
    }

    try {
        $utc = [datetime]::Parse($TimestampIso).ToUniversalTime()
        return [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($utc, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
    } catch {
        return $null
    }
}

function Get-LatestReport {
    try {
        $response = Invoke-WebRequest -UseBasicParsing $reportUrl -TimeoutSec 10
        return $response.Content | ConvertFrom-Json
    } catch {
        if (Test-Path $fallbackPath) {
            try {
                return Get-Content $fallbackPath -Raw | ConvertFrom-Json
            } catch {
                return $null
            }
        }
        return $null
    }
}

$report = Get-LatestReport
if (-not $report) {
    Write-Host "[warn] nenhum relatorio local disponivel"
    exit 0
}

if ($Plain) {
    $lastHeartbeat = $report.heartbeat.latestSuccess.timestampIso
    $lastHeartbeatLocal = if ($lastHeartbeat) { Convert-ToLocalString $lastHeartbeat } else { "nenhum" }
    $checkedAt = if ($report.checkedAtUtc) { Convert-ToLocalString $report.checkedAtUtc } else { "desconhecida" }
    $latestExportAt = if ($report.latestExport.loggedAt) { Convert-ToLocalString $report.latestExport.loggedAt } else { $checkedAt }
    $alerts = @($report.alerts)
    $alertSummaries = @($alerts | ForEach-Object { $_.summary } | Where-Object { $_ })
    $alertsSummary = if ($alertSummaries.Count -gt 0) { $alertSummaries -join " | " } else { "nenhum" }
    Write-Host "relatorio local: disponivel"
    Write-Host "gerado em: $checkedAt"
    Write-Host "ultima exportacao: $latestExportAt"
    Write-Host "ultimo heartbeat ok: $lastHeartbeatLocal"
    Write-Host "diagnostico heartbeat: $($report.heartbeat.diagnostics.summary)"
    Write-Host "registry: $($report.registry.summary)"
    Write-Host "manutencao: $($report.maintenance.summary)"
    if ($report.maintenanceCycle.summary) {
        Write-Host "ciclo manutencao: $($report.maintenanceCycle.summary)"
    }
    Write-Host "backup: $($report.backup.summary)"
    Write-Host "daily check: $($report.dailyCheck.summary)"
    if ($report.integrityAudit.summary) {
        Write-Host "auditoria: $($report.integrityAudit.summary)"
    }
    Write-Host "alertas: $alertsSummary"
    Write-Host "proxima acao: $($report.primaryAction.summary)"
    exit 0
}

$report | ConvertTo-Json -Depth 8
