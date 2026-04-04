param()

$ErrorActionPreference = "Continue"

$repoRoot = "C:\dev\local-ai-agent"
$logDir   = Join-Path $repoRoot "logs"
$logFile  = Join-Path $logDir "supervisor.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-Log {
    param([string]$Line)
    $ts = [datetime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC")
    $entry = "[$ts] $Line"
    Write-Host $entry
    Add-Content -Path $logFile -Value $entry
}

Write-Log "start-supervisor: starting"

# Load main env
$envFile = Join-Path $repoRoot ".env.ps1"
if (Test-Path $envFile) {
    Write-Log "Loading env: $envFile"
    . $envFile
} else {
    Write-Log "WARNING: $envFile not found"
}

# Load Deribit env
$deribitEnvFile = Join-Path $repoRoot "workspace\deribit\config\deribit.env.ps1"
if (Test-Path $deribitEnvFile) {
    Write-Log "Loading env: $deribitEnvFile"
    . $deribitEnvFile
} else {
    Write-Log "WARNING: $deribitEnvFile not found"
}

$supervisorScript = Join-Path $repoRoot "runtime\supervisor\bot-supervisor.cjs"
if (-not (Test-Path $supervisorScript)) {
    Write-Log "ERROR: supervisor script not found: $supervisorScript"
    exit 1
}

Write-Log "Starting bot-supervisor.cjs in background..."

$errLog = Join-Path $logDir "supervisor.err.log"

Write-Log "Launching node bot-supervisor.cjs..."

$proc = Start-Process -FilePath "node" `
    -ArgumentList "`"$supervisorScript`"" `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errLog `
    -NoNewWindow `
    -PassThru

# Write PID to a separate pid file so we don't conflict with node's log
$pidFile = Join-Path $logDir "supervisor.pid"
"$($proc.Id)" | Out-File -FilePath $pidFile -Encoding ascii
