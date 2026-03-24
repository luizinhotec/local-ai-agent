param (
    [int]$IntervalSeconds = 15,
    [switch]$Once,
    [int]$Port = 8765
)

if ($IntervalSeconds -lt 5) {
    Write-Error "Use um intervalo de pelo menos 5 segundos."
    exit 1
}

$opsStatusUrl = "http://127.0.0.1:$Port/api/ops-status"
$timezone = "E. South America Standard Time"

function Convert-ToLocalString {
    param (
        [string]$TimestampIso
    )

    if (-not $TimestampIso) {
        return $null
    }

    try {
        $utc = [datetime]::Parse($TimestampIso).ToUniversalTime()
        return [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($utc, $timezone).ToString("yyyy-MM-dd HH:mm:ss")
    } catch {
        return $null
    }
}

function Get-OpsStatus {
    try {
        $response = Invoke-WebRequest -UseBasicParsing $opsStatusUrl -TimeoutSec 10
        return $response.Content | ConvertFrom-Json
    } catch {
        return $null
    }
}

$announcedReady = $false
while ($true) {
    Clear-Host
    Write-Host "AIBTC Heartbeat Watch"
    Write-Host "intervalo: $IntervalSeconds segundos"
    Write-Host ""

    $status = Get-OpsStatus
    if ($null -eq $status) {
        Write-Host "[warn] nao foi possivel consultar /api/ops-status"
    } else {
        $heartbeat = $status.heartbeat
        $latestSuccessIso = $heartbeat.latestSuccess.timestampIso
        $latestSuccessLocal = Convert-ToLocalString $latestSuccessIso
        $nextCheckInLocal = Convert-ToLocalString $heartbeat.nextCheckInUtc

        if ($latestSuccessLocal) {
            Write-Host "ultimo heartbeat ok: $latestSuccessLocal"
        } else {
            Write-Host "ultimo heartbeat ok: nenhum"
        }

        if ($heartbeat.readyNow) {
            Write-Host "[ok] heartbeat liberado agora"
            if (-not $announcedReady) {
                [console]::Beep(1200, 250)
                $announcedReady = $true
            }
        } else {
            Write-Host "[wait] heartbeat aguardando"
            Write-Host "proxima janela local: $nextCheckInLocal"
            Write-Host "segundos restantes: $($heartbeat.waitSeconds)"
            $announcedReady = $false
        }

        if ($heartbeat.diagnostics.summary) {
            Write-Host "diagnostico: $($heartbeat.diagnostics.summary)"
        }
    }

    if ($Once) {
        break
    }

    Write-Host ""
    Write-Host "Atualizando novamente em $IntervalSeconds segundos. Pressione Ctrl+C para sair."
    Start-Sleep -Seconds $IntervalSeconds
}
