param(
  [switch]$Execute,
  [switch]$ForceRestart
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workspaceRoot = Join-Path $repoRoot 'workspace\deribit'
$stateDir = Join-Path $workspaceRoot 'state'
$logPath = Join-Path $stateDir 'deribit-bot-loop.log'
$errorLogPath = Join-Path $stateDir 'deribit-bot-loop.err.log'
$pidPath = Join-Path $stateDir 'deribit-bot-loop.pid'
$envPath = Join-Path $workspaceRoot 'config\deribit.env.example.ps1'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$scriptPath = Join-Path $workspaceRoot 'runtime\deribit-bot-loop.cjs'

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (Test-Path $envPath) {
  . $envPath
}

if (-not (Test-Path $nodePath)) {
  throw "node.exe not found at $nodePath"
}

if (-not (Test-Path $scriptPath)) {
  throw "bot loop script not found at $scriptPath"
}

if (-not $env:DERIBIT_CLIENT_ID -or -not $env:DERIBIT_CLIENT_SECRET) {
  throw 'missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET'
}

if ((Test-Path $pidPath) -and -not $ForceRestart) {
  $existingPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Write-Output "Deribit bot already running with PID $existingPid"
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

Remove-Item $logPath -Force -ErrorAction SilentlyContinue
Remove-Item $errorLogPath -Force -ErrorAction SilentlyContinue

$argumentList = @($scriptPath)
if ($Execute) {
  $argumentList += '--execute'
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
  throw "Deribit bot exited immediately with code $($process.ExitCode). $errorTail"
}

Set-Content -Path $pidPath -Value $process.Id

Write-Output "Started Deribit bot PID $($process.Id)"
Write-Output "Log: $logPath"
Write-Output "Error Log: $errorLogPath"
