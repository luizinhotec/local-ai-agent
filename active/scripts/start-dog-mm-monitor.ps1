param()

$ErrorActionPreference = "Continue"

$repoRoot    = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path
$logDir      = Join-Path $repoRoot "logs"
$logFile     = Join-Path $logDir "dog-mm-monitor.log"
$monitorScript = Join-Path $PSScriptRoot "dog-mm-route-monitor.ps1"
$intervalSeconds = 3600

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-MonitorLog {
    param([string]$Line)
    $ts = [datetime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC")
    $entry = "[$ts] $Line"
    Write-Host $entry
    Add-Content -Path $logFile -Value $entry
}

if (-not (Test-Path $monitorScript)) {
    Write-MonitorLog "ERROR: monitor script not found: $monitorScript"
    exit 1
}

Write-MonitorLog "start-dog-mm-monitor: START (interval=${intervalSeconds}s)"

$cycle = 0
while ($true) {
    $cycle++
    Write-MonitorLog "--- cycle $cycle ---"
    powershell -NoProfile -ExecutionPolicy Bypass -File $monitorScript
    Write-MonitorLog "cycle $cycle done - sleeping ${intervalSeconds}s"
    Start-Sleep -Seconds $intervalSeconds
}
