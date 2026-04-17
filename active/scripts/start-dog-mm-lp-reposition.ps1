param(
    [switch]$ForceRestart
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stateDir = Join-Path $repoRoot 'active\state\dog-mm'
$logPath = Join-Path $stateDir 'lp-reposition-loop.log'
$errorLogPath = Join-Path $stateDir 'lp-reposition-loop.err.log'
$pidPath = Join-Path $stateDir 'lp-reposition.pid'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$scriptPath = Join-Path $repoRoot 'active\tools\bitflow-runtime\dog-mm-lp-reposition-loop.cjs'

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

Import-EnvFile (Join-Path $repoRoot '.env')
Import-EnvFile (Join-Path $repoRoot '.env.local')

if (-not (Test-Path $nodePath)) {
    throw "node.exe not found at $nodePath"
}

if (-not (Test-Path $scriptPath)) {
    throw "DOG-MM lp-reposition script not found at $scriptPath"
}

if ((Test-Path $pidPath) -and -not $ForceRestart) {
    $existingPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($existingPid) {
        $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            Write-Output "DOG-MM lp-reposition already running with PID $existingPid"
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

$process = Start-Process -FilePath $nodePath `
    -ArgumentList @($scriptPath) `
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
    throw "DOG-MM lp-reposition exited immediately with code $($process.ExitCode). $errorTail"
}

Set-Content -Path $pidPath -Value $process.Id

Write-Output "Started DOG-MM lp-reposition PID $($process.Id)"
Write-Output "Log: $logPath"
Write-Output "Error Log: $errorLogPath"
