param (
    [string]$Timezone = "E. South America Standard Time"
)

$logPath = Join-Path $PSScriptRoot "..\state\aibtc-ops-log.jsonl"
$resolvedLogPath = Resolve-Path $logPath -ErrorAction SilentlyContinue

function New-HeartbeatWindowFromLast {
    param (
        [datetime]$LastCheckIn
    )

    $next = $LastCheckIn.ToUniversalTime().AddMinutes(5)
    $now = [datetime]::UtcNow
    $wait = $next - $now
    if ($wait.TotalSeconds -lt 0) {
        $wait = [timespan]::Zero
    }

    [pscustomobject]@{
        source = "last_checkin"
        lastCheckInUtc = $LastCheckIn.ToUniversalTime().ToString("o")
        nextCheckInUtc = $next.ToString("o")
        nextCheckInLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($next, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
        waitSeconds = [math]::Ceiling($wait.TotalSeconds)
        readyNow = ($wait.TotalSeconds -le 0)
    }
}

function New-HeartbeatWindowFromNext {
    param (
        [datetime]$NextCheckIn
    )

    $next = $NextCheckIn.ToUniversalTime()
    $now = [datetime]::UtcNow
    $wait = $next - $now
    if ($wait.TotalSeconds -lt 0) {
        $wait = [timespan]::Zero
    }

    [pscustomobject]@{
        source = "next_checkin"
        lastCheckInUtc = $null
        nextCheckInUtc = $next.ToString("o")
        nextCheckInLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($next, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
        waitSeconds = [math]::Ceiling($wait.TotalSeconds)
        readyNow = ($wait.TotalSeconds -le 0)
    }
}

if (-not $resolvedLogPath) {
    Write-Host "[warn] nenhum log local encontrado"
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
    Where-Object { $_ -ne $null } |
    Where-Object { $_.type -in @("heartbeat_success", "heartbeat_attempt") }

if (-not $events) {
    Write-Host "[warn] nenhum evento de heartbeat encontrado"
    exit 0
}

$event = $events | Select-Object -Last 1
$details = $event.details
$window = $null

if ($details.timestampIso) {
    $window = New-HeartbeatWindowFromLast ([datetime]::Parse($details.timestampIso))
} elseif ($details.postResult.body.nextCheckInAt) {
    $window = New-HeartbeatWindowFromNext ([datetime]::Parse($details.postResult.body.nextCheckInAt))
} elseif ($details.postResult.body.lastCheckInAt) {
    $window = New-HeartbeatWindowFromLast ([datetime]::Parse($details.postResult.body.lastCheckInAt))
}

if (-not $window) {
    Write-Host "[warn] nao foi possivel inferir a janela do proximo heartbeat"
    $event | ConvertTo-Json -Depth 8
    exit 0
}

[pscustomobject]@{
    eventType = $event.type
    loggedAt = $event.loggedAt
    heartbeatWindow = $window
} | ConvertTo-Json -Depth 6
