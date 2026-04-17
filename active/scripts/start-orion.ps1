param(
    [switch]$ForceRestart,
    [switch]$DryRun
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stateDir = Join-Path $repoRoot 'runtime\orion\state'
$logDir = Join-Path $repoRoot 'logs'
$logPath = Join-Path $logDir 'orion.log'
$errorLogPath = Join-Path $logDir 'orion.err.log'
$pidPath = Join-Path $stateDir 'orion.pid'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$scriptPath = Join-Path $repoRoot 'runtime\orion\orion.cjs'

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

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Import-EnvFile (Join-Path $repoRoot '.env')
Import-EnvFile (Join-Path $repoRoot '.env.local')

if (-not (Test-Path $nodePath)) {
    throw "node.exe not found at $nodePath"
}

if (-not (Test-Path $scriptPath)) {
    throw "orion script not found at $scriptPath"
}

if ((Test-Path $pidPath) -and -not $ForceRestart) {
    $existingPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($existingPid) {
        $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            Write-Output "Orion already running with PID $existingPid"
            exit 0
        }
    }
}

if ($ForceRestart -and (Test-Path $pidPath)) {
    $existingPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($existingPid) {
        Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
}

Remove-Item $errorLogPath -Force -ErrorAction SilentlyContinue

$argumentList = @($scriptPath)
if ($DryRun) {
    $argumentList += '--dry-run'
}

$process = Start-Process -FilePath $nodePath `
    -ArgumentList $argumentList `
    -WorkingDirectory $repoRoot `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logPath `
    -RedirectStandardError $errorLogPath

Start-Sleep -Seconds 2
$process.Refresh()
if ($process.HasExited) {
    $errorTail = ''
    if (Test-Path $errorLogPath) {
        $errorTail = (Get-Content $errorLogPath -Tail 20) -join [Environment]::NewLine
    }
    throw "Orion exited immediately with code $($process.ExitCode). $errorTail"
}

Set-Content -Path $pidPath -Value $process.Id

Write-Output "Started Orion PID $($process.Id)"
Write-Output "Log: $logPath"
Write-Output "Error Log: $errorLogPath"
