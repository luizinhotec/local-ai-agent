param (
    [int]$Limit = 20,
    [string]$Type = "",
    [switch]$Plain,
    [string]$Timezone = "E. South America Standard Time"
)

$logPath = Join-Path $PSScriptRoot "..\state\aibtc-ops-log.jsonl"
$backupMetaPath = Join-Path $PSScriptRoot "..\state\aibtc-local-state-backup-latest.json"
$resolvedLogPath = Resolve-Path $logPath -ErrorAction SilentlyContinue

if (-not $resolvedLogPath) {
    Write-Host "[warn] nenhum log local encontrado em $logPath"
    exit 0
}

$events = Get-Content $resolvedLogPath |
    Where-Object { $_.Trim() -ne "" } |
    ForEach-Object {
        try {
            $_ | ConvertFrom-Json
        } catch {
            $null
        }
    } |
    Where-Object { $_ -ne $null }

if ($Type) {
    $events = $events | Where-Object { $_.type -eq $Type }
}

$totalEvents = @($events).Count
$allEvents = @($events)
$events = @($allEvents | Select-Object -Last $Limit)

if (-not $events) {
    Write-Host "[warn] nenhum evento encontrado"
    exit 0
}

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

function Get-EventSummary {
    param (
        [object]$Event
    )

    $loggedAtLocal = Convert-ToLocalString $Event.loggedAt
    $details = $Event.details
    switch ($Event.type) {
        "heartbeat_success" {
            $timestamp = $details.timestampIso
            $local = Convert-ToLocalString $timestamp
            if (-not $local) {
                $local = $loggedAtLocal
            }
            return "heartbeat ok em $local"
        }
        "heartbeat_attempt" {
            $status = $details.postResult.status
            return "heartbeat tentativa com status $status em $loggedAtLocal"
        }
        "viral_claim_success" {
            return "claim viral ok em $loggedAtLocal"
        }
        "viral_claim_attempt" {
            $status = $details.result.status
            return "claim viral tentativa com status $status em $loggedAtLocal"
        }
        "registry_check" {
            $status = $details.result.status
            return "consulta registry com status $status em $loggedAtLocal"
        }
        "ops_report_export" {
            return "exportacao de relatorio em $loggedAtLocal"
        }
        "local_state_repair" {
            $status = $details.result.status
            return "reconstrucao local com status $status em $loggedAtLocal"
        }
        "local_state_prune" {
            $status = $details.result.status
            return "retencao local com status $status em $loggedAtLocal"
        }
        "local_state_backup" {
            return "backup local em $loggedAtLocal"
        }
        "local_state_restore" {
            return "restauracao local em $loggedAtLocal"
        }
        "daily_check_run" {
            $status = $details.result.status
            return "daily check com status $status em $loggedAtLocal"
        }
        "integrity_audit_run" {
            $summary = $details.audit.summary
            if (-not $summary) {
                $summary = "auditoria de integridade"
            }
            return "$summary em $loggedAtLocal"
        }
        "maintenance_cycle_run" {
            return "ciclo de manutencao em $loggedAtLocal"
        }
        default {
            return "$($Event.type) em $loggedAtLocal"
        }
    }
}

function Get-LatestBackupMetadata {
    if (-not (Test-Path $backupMetaPath)) {
        return $null
    }

    try {
        return Get-Content $backupMetaPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

if ($Plain) {
    $latest = $events | Select-Object -Last 1
    Write-Host "total eventos: $totalEvents"
    Write-Host "ultimo evento: $(Get-EventSummary $latest)"

    $latestHeartbeat = $allEvents | Where-Object { $_.type -eq "heartbeat_success" } | Select-Object -Last 1
    if ($latestHeartbeat) {
        Write-Host "ultimo heartbeat ok: $(Get-EventSummary $latestHeartbeat)"
    } else {
        Write-Host "ultimo heartbeat ok: nenhum"
    }

    $latestMaintenance = $allEvents | Where-Object { $_.type -in @("local_state_repair", "local_state_prune", "local_state_restore") } | Select-Object -Last 1
    if ($latestMaintenance) {
        Write-Host "ultima manutencao: $(Get-EventSummary $latestMaintenance)"
    } else {
        Write-Host "ultima manutencao: nenhuma"
    }

    $latestBackup = $allEvents | Where-Object { $_.type -eq "local_state_backup" } | Select-Object -Last 1
    if ($latestBackup) {
        Write-Host "ultimo backup: $(Get-EventSummary $latestBackup)"
    } else {
        $latestBackupMeta = Get-LatestBackupMetadata
        if ($latestBackupMeta) {
            $backupLocal = Convert-ToLocalString $latestBackupMeta.checkedAtUtc
            $backupName = $latestBackupMeta.archiveName
            if ($backupName) {
                Write-Host "ultimo backup: backup local em $backupLocal ($backupName)"
            } else {
                Write-Host "ultimo backup: backup local em $backupLocal"
            }
        } else {
            Write-Host "ultimo backup: nenhum"
        }
    }

    $latestReportExport = $allEvents | Where-Object { $_.type -eq "ops_report_export" } | Select-Object -Last 1
    if ($latestReportExport) {
        Write-Host "ultima exportacao de relatorio: $(Get-EventSummary $latestReportExport)"
    } else {
        Write-Host "ultima exportacao de relatorio: nenhuma"
    }

    $latestDailyCheck = $allEvents | Where-Object { $_.type -eq "daily_check_run" } | Select-Object -Last 1
    if ($latestDailyCheck) {
        Write-Host "ultimo daily check: $(Get-EventSummary $latestDailyCheck)"
    } else {
        Write-Host "ultimo daily check: nenhum"
    }

    $latestMaintenanceCycle = $allEvents | Where-Object { $_.type -eq "maintenance_cycle_run" } | Select-Object -Last 1
    if ($latestMaintenanceCycle) {
        Write-Host "ultimo ciclo manutencao: $(Get-EventSummary $latestMaintenanceCycle)"
    } else {
        Write-Host "ultimo ciclo manutencao: nenhum"
    }

    $latestIntegrityAudit = $allEvents | Where-Object { $_.type -eq "integrity_audit_run" } | Select-Object -Last 1
    if ($latestIntegrityAudit) {
        Write-Host "ultima auditoria: $(Get-EventSummary $latestIntegrityAudit)"
    } else {
        Write-Host "ultima auditoria: nenhuma"
    }
    exit 0
}

$events | ConvertTo-Json -Depth 8
