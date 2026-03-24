param (
    [string]$Timezone = "E. South America Standard Time"
)

$logPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-log.jsonl"
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

if (-not $resolvedLogPath) {
    Write-Host "[warn] nenhum log local do DOG MM encontrado"
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
    [pscustomobject]@{
        eventType = $null
        loggedAt = $null
        heartbeatWindow = [pscustomobject]@{
            source = "no_events"
            lastCheckInUtc = $null
            nextCheckInUtc = [datetime]::UtcNow.ToString("o")
            nextCheckInLocal = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow, $Timezone).ToString("yyyy-MM-dd HH:mm:ss")
            waitSeconds = 0
            readyNow = $true
        }
    } | ConvertTo-Json -Depth 6
    exit 0
}

$event = $events | Select-Object -Last 1
$details = $event.details
$referenceIso = $null

if ($details.timestampIso) {
    $referenceIso = $details.timestampIso
} elseif ($details.loggedAtUtc) {
    $referenceIso = $details.loggedAtUtc
} else {
    $referenceIso = $event.loggedAt
}

$window = New-HeartbeatWindowFromLast ([datetime]::Parse($referenceIso))

[pscustomobject]@{
    eventType = $event.type
    loggedAt = $event.loggedAt
    heartbeatWindow = $window
} | ConvertTo-Json -Depth 6
