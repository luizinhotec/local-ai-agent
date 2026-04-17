param (
    [int]$IntervalSeconds = 60,
    [int]$AmountSats = 3000,
    [bool]$AutoSafeActions = $true,
    [switch]$DryRun,
    [switch]$ForceRestart
)

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stateDir = Join-Path $root "state\speedy-indra"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "standard-loop.log"
$errorLogFile = Join-Path $logDir "standard-loop.err.log"
$pidFile = Join-Path $stateDir "speedy-indra.pid"
$nodePath = 'C:\Program Files\nodejs\node.exe'

function Import-EnvFile {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) { return }

    Get-Content $FilePath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $parts = $line -split '=', 2
        if ($parts.Length -ne 2) { return }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($key) -and -not (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue)) {
            Set-Item -Path "Env:$key" -Value $value
        }
    }
}

Import-EnvFile (Join-Path $root ".env")
Import-EnvFile (Join-Path $root ".env.local")

if (-not (Test-Path $nodePath)) {
    throw "node.exe not found at $nodePath"
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if ((Test-Path $pidFile) -and -not $ForceRestart) {
    $existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($existingPid) {
        $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            Write-Output "Speedy Indra already running with PID $existingPid"
            exit 0
        }
    }
}

if ($ForceRestart -and (Test-Path $pidFile)) {
    $existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($existingPid) {
        Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$args = @(
    "runtime/speedy-indra/agent-standard-loop.cjs",
    "--interval-seconds=$IntervalSeconds",
    "--amount-sats=$AmountSats",
    "--auto-safe-actions=$($AutoSafeActions.ToString().ToLower())"
)

if ($DryRun) {
    $args += "--dry-run"
}

Remove-Item $errorLogFile -Force -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $nodePath `
    -ArgumentList $args `
    -WorkingDirectory $root `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errorLogFile

Start-Sleep -Seconds 2
$process.Refresh()
if ($process.HasExited) {
    $errorTail = ''
    if (Test-Path $errorLogFile) {
        $errorTail = (Get-Content $errorLogFile -Tail 20) -join [Environment]::NewLine
    }
    throw "Speedy Indra exited immediately with code $($process.ExitCode). $errorTail"
}

Set-Content -Path $pidFile -Value $process.Id

Write-Host "Started Speedy Indra PID $($process.Id)"
Write-Host "Log file: $logFile"
Write-Host "Error log: $errorLogFile"
