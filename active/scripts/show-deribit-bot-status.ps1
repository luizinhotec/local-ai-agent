$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stateDir = Join-Path $repoRoot 'workspace\deribit\state'
$pidPath = Join-Path $stateDir 'deribit-bot-loop.pid'
$logPath = Join-Path $stateDir 'deribit-bot-loop.log'
$errorLogPath = Join-Path $stateDir 'deribit-bot-loop.err.log'
$botStatePath = Join-Path $stateDir 'deribit-bot-state.json'
$orphanNodes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like '*workspace/deribit/runtime/deribit-bot-loop.cjs*'
}

if (Test-Path $pidPath) {
  $pidValue = Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pidValue) {
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process) {
      Write-Output "running_pid: $pidValue"
    } else {
      Write-Output "running_pid: stale ($pidValue)"
    }
  } else {
    Write-Output 'running_pid: stale (empty pid file)'
  }
} else {
  Write-Output 'running_pid: none'
}

if ($orphanNodes) {
  Write-Output 'orphan_bot_processes:'
  $orphanNodes | Select-Object ProcessId, CommandLine | Format-Table -AutoSize
} else {
  Write-Output 'orphan_bot_processes: none'
}

if (Test-Path $botStatePath) {
  Write-Output 'bot_state:'
  Get-Content $botStatePath
} else {
  Write-Output 'bot_state: missing'
}

if (Test-Path $logPath) {
  Write-Output 'log_tail:'
  Get-Content $logPath -Tail 20
} else {
  Write-Output 'log_tail: missing'
}

if (Test-Path $errorLogPath) {
  Write-Output 'error_log_tail:'
  Get-Content $errorLogPath -Tail 20
} else {
  Write-Output 'error_log_tail: missing'
}
