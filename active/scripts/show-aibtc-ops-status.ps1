param (
    [switch]$Plain,
    [string]$Timezone = "E. South America Standard Time",
    [int]$Port = 8765
)

$logPath = Join-Path $PSScriptRoot "..\state\aibtc-ops-log.jsonl"
$registryUrl = "https://stx402.com/agent/registry"
$registrySnapshotPath = Join-Path $PSScriptRoot "..\state\aibtc-mainnet-registry-status.json"
$opsSummaryPath = Join-Path $PSScriptRoot "..\state\aibtc-ops-summary.json"
$opsStatusUrl = "http://127.0.0.1:$Port/api/ops-status"

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

function Get-LocalEvents {
    if (-not (Test-Path $logPath)) {
        return @()
    }

    return Get-Content $logPath |
        Where-Object { $_.Trim() -ne "" } |
        ForEach-Object {
            try {
                $_ | ConvertFrom-Json
            } catch {
                $null
            }
        } |
        Where-Object { $_ -ne $null }
}

function Get-OpsSummary {
    if (-not (Test-Path $opsSummaryPath)) {
        return $null
    }

    try {
        return Get-Content $opsSummaryPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-OpsStatusFromHelper {
    try {
        $response = Invoke-WebRequest -UseBasicParsing $opsStatusUrl -TimeoutSec 10
        return $response.Content | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Build-StatusFromHelper {
    param(
        [object]$HelperStatus
    )

    if (-not $HelperStatus) {
        return $null
    }

    $latestHeartbeatSuccess = $HelperStatus.heartbeat.latestSuccess.timestampIso
    if (-not $latestHeartbeatSuccess) {
        $latestHeartbeatSuccess = $HelperStatus.heartbeat.latestSuccess.loggedAt
    }

    return [pscustomobject]@{
        checkedAtUtc = $HelperStatus.checkedAtUtc
        checkedAtLocal = Convert-ToLocalString $HelperStatus.checkedAtUtc
        summary = [pscustomobject]@{
            heartbeat = if ($HelperStatus.heartbeat.stale) {
                "heartbeat liberado agora (estado antigo)"
            } elseif ($HelperStatus.heartbeat.readyNow) {
                "heartbeat liberado agora"
            } else {
                "heartbeat aguardando"
            }
            registry = if ($HelperStatus.registry.stale) {
                "$($HelperStatus.registry.summary) [snapshot antigo]"
            } else {
                $HelperStatus.registry.summary
            }
            latestLocalEvent = if ($HelperStatus.latestEvent) { $HelperStatus.latestEvent.type } else { "nenhum" }
            latestHeartbeatSuccess = if ($latestHeartbeatSuccess) { Convert-ToLocalString $latestHeartbeatSuccess } else { "nenhum" }
            latestHeartbeatDiagnostic = if ($HelperStatus.heartbeat.diagnostics.summary) { $HelperStatus.heartbeat.diagnostics.summary } else { "nenhum" }
            report = if ($HelperStatus.report.summary) { $HelperStatus.report.summary } else { "nenhum" }
            maintenance = if ($HelperStatus.maintenance.summary) { $HelperStatus.maintenance.summary } else { "nenhum" }
            maintenanceCycle = if ($HelperStatus.maintenanceCycle.summary) { $HelperStatus.maintenanceCycle.summary } else { "nenhum" }
            backup = if ($HelperStatus.backup.summary) { $HelperStatus.backup.summary } else { "nenhum" }
            dailyCheck = if ($HelperStatus.dailyCheck.summary) { $HelperStatus.dailyCheck.summary } else { "nenhum" }
            integrityAudit = if ($HelperStatus.integrityAudit.summary) { $HelperStatus.integrityAudit.summary } else { "nenhum" }
            position = if ($HelperStatus.position.summary) { $HelperStatus.position.summary } else { "nenhum" }
            alerts = if ($HelperStatus.alerts -and @($HelperStatus.alerts).Count -gt 0) { (@($HelperStatus.alerts) | ForEach-Object { $_.summary }) -join " | " } else { "nenhum" }
            primaryAction = if ($HelperStatus.primaryAction.summary) { $HelperStatus.primaryAction.summary } else { "nenhum" }
        }
        registry = [pscustomobject]@{
            summary = $HelperStatus.registry.summary
            statusCode = $HelperStatus.registry.statusCode
            source = $HelperStatus.registry.source
            checkedAtLocal = if ($HelperStatus.registry.checkedAtUtc) { Convert-ToLocalString $HelperStatus.registry.checkedAtUtc } else { $null }
            stale = $HelperStatus.registry.stale
            snapshotAgeMinutes = $HelperStatus.registry.snapshotAgeMinutes
        }
    }
}

function Get-HeartbeatSummary {
    param (
        [object[]]$Events
    )

    $heartbeatEvent = $Events |
        Where-Object { $_.type -in @("heartbeat_success", "heartbeat_attempt") } |
        Select-Object -Last 1

    if (-not $heartbeatEvent) {
        return [pscustomobject]@{
            summary = "sem heartbeat local ainda"
            event = $null
            window = $null
            latestSuccessEvent = $null
        }
    }

    $details = $heartbeatEvent.details
    $timestampIso = $details.timestampIso
    $nextCheckInAt = $details.postResult.body.nextCheckInAt
    $lastCheckInAt = $details.postResult.body.lastCheckInAt

    $nextUtc = $null
    if ($timestampIso) {
        $nextUtc = ([datetime]::Parse($timestampIso).ToUniversalTime()).AddMinutes(5)
    } elseif ($nextCheckInAt) {
        $nextUtc = [datetime]::Parse($nextCheckInAt).ToUniversalTime()
    } elseif ($lastCheckInAt) {
        $nextUtc = ([datetime]::Parse($lastCheckInAt).ToUniversalTime()).AddMinutes(5)
    }

    $window = $null
    if ($nextUtc) {
        $waitSeconds = [math]::Ceiling(([timespan]($nextUtc - [datetime]::UtcNow)).TotalSeconds)
        if ($waitSeconds -lt 0) {
            $waitSeconds = 0
        }
        $window = [pscustomobject]@{
            nextCheckInUtc = $nextUtc.ToString("o")
            nextCheckInLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($nextUtc, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
            waitSeconds = $waitSeconds
            readyNow = ($waitSeconds -eq 0)
        }
    }

    $summary = if ($window) {
        if ($window.readyNow) {
            "heartbeat liberado agora"
        } else {
            "heartbeat aguardando ate $($window.nextCheckInLocal)"
        }
    } else {
        "heartbeat local encontrado, sem janela inferida"
    }

    $latestSuccess = $Events |
        Where-Object { $_.type -eq "heartbeat_success" } |
        Select-Object -Last 1

    return [pscustomobject]@{
        summary = $summary
        event = $heartbeatEvent
        window = $window
        latestSuccessEvent = $latestSuccess
    }
}

function Get-RegistrySummary {
    if (Test-Path $registrySnapshotPath) {
        try {
            $snapshot = Get-Content $registrySnapshotPath -Raw | ConvertFrom-Json
            return [pscustomobject]@{
                ok = [bool]$snapshot.ok
                summary = if ($snapshot.mainnetPublished) { "registry mainnet publicado" } else { "registry ainda indisponivel" }
                statusCode = $snapshot.statusCode
                checkedAtUtc = $snapshot.checkedAtUtc
                source = "snapshot"
            }
        } catch {
        }
    }

    try {
        $response = Invoke-WebRequest -UseBasicParsing $registryUrl -TimeoutSec 30
        $body = $response.Content | ConvertFrom-Json
        $available = $null -ne $body.networks.mainnet
        $summary = if ($available) { "registry mainnet publicado" } else { "registry ainda indisponivel" }

        return [pscustomobject]@{
            ok = $true
            summary = $summary
            statusCode = $response.StatusCode
            checkedAtUtc = [datetime]::UtcNow.ToString("o")
            source = "live"
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            summary = "falha ao consultar registry"
            statusCode = $null
            error = $_.Exception.Message
            checkedAtUtc = $null
            source = "live"
        }
    }
}

$helperStatus = Get-OpsStatusFromHelper
$result = Build-StatusFromHelper -HelperStatus $helperStatus

if (-not $result) {
    $events = Get-LocalEvents
    $opsSummary = Get-OpsSummary
    $heartbeat = Get-HeartbeatSummary -Events $events
    $registry = Get-RegistrySummary
    $latestEvent = $events | Select-Object -Last 1
    $latestHeartbeatSuccessAt = $null

    if ($heartbeat.latestSuccessEvent) {
        $latestHeartbeatSuccessAt = $heartbeat.latestSuccessEvent.details.timestampIso
        if (-not $latestHeartbeatSuccessAt) {
            $latestHeartbeatSuccessAt = $heartbeat.latestSuccessEvent.loggedAt
        }
    }

    $heartbeatDiagnosticSummary = $null
    if ($opsSummary -and $opsSummary.heartbeatDiagnostics) {
        $heartbeatDiagnosticSummary = $opsSummary.heartbeatDiagnostics.summary
    }

    $result = [pscustomobject]@{
        checkedAtUtc = [datetime]::UtcNow.ToString("o")
        checkedAtLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
        summary = [pscustomobject]@{
            heartbeat = $heartbeat.summary
            registry = $registry.summary
            latestLocalEvent = if ($latestEvent) { $latestEvent.type } else { "nenhum" }
            latestHeartbeatSuccess = if ($latestHeartbeatSuccessAt) { Convert-ToLocalString $latestHeartbeatSuccessAt } else { "nenhum" }
            latestHeartbeatDiagnostic = if ($heartbeatDiagnosticSummary) { $heartbeatDiagnosticSummary } else { "nenhum" }
            report = "nenhum"
            maintenance = "nenhum"
            maintenanceCycle = "nenhum"
            backup = "nenhum"
            dailyCheck = "nenhum"
            integrityAudit = "nenhum"
            position = "nenhum"
            alerts = "nenhum"
            primaryAction = "seguir com operacao normal"
        }
        registry = [pscustomobject]@{
            summary = $registry.summary
            statusCode = $registry.statusCode
            source = $registry.source
            checkedAtLocal = if ($registry.checkedAtUtc) { Convert-ToLocalString $registry.checkedAtUtc } else { $null }
        }
    }
}

if ($Plain) {
    Write-Host "checagem local: $($result.checkedAtLocal)"
    Write-Host "heartbeat: $($result.summary.heartbeat)"
    Write-Host "ultimo heartbeat ok: $($result.summary.latestHeartbeatSuccess)"
    Write-Host "diagnostico heartbeat: $($result.summary.latestHeartbeatDiagnostic)"
    Write-Host "relatorio: $($result.summary.report)"
    Write-Host "manutencao: $($result.summary.maintenance)"
    Write-Host "ciclo manutencao: $($result.summary.maintenanceCycle)"
    Write-Host "backup: $($result.summary.backup)"
    Write-Host "daily check: $($result.summary.dailyCheck)"
    if ($result.summary.integrityAudit) {
        Write-Host "auditoria: $($result.summary.integrityAudit)"
    }
    Write-Host "posicao: $($result.summary.position)"
    Write-Host "alertas: $($result.summary.alerts)"
    Write-Host "proxima acao: $($result.summary.primaryAction)"
    Write-Host "registry: $($result.summary.registry)"
    if ($result.registry.checkedAtLocal) {
        Write-Host "registry snapshot/live em: $($result.registry.checkedAtLocal) [$($result.registry.source)]"
    }
    Write-Host "ultimo evento local: $($result.summary.latestLocalEvent)"
    exit 0
}

$result | ConvertTo-Json -Depth 8
