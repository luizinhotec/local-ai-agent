$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pidPath = Join-Path $repoRoot 'workspace\deribit\state\deribit-bot-loop.pid'
$orphanNodes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like '*workspace/deribit/runtime/deribit-bot-loop.cjs*'
}

if (-not (Test-Path $pidPath)) {
  if ($orphanNodes) {
    foreach ($node in $orphanNodes) {
      Stop-Process -Id $node.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Output "Stopped orphan Deribit bot PID $($node.ProcessId)"
    }
    exit 0
  }
  Write-Output 'Deribit bot is not running'
  exit 0
}

$pidValue = Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pidValue) {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'Deribit bot PID file was empty'
  exit 0
}

$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $pidValue -Force
  Write-Output "Stopped Deribit bot PID $pidValue"
} else {
  Write-Output "No running process found for PID $pidValue"
}

foreach ($node in $orphanNodes) {
  if ($node.ProcessId -ne [int]$pidValue) {
    Stop-Process -Id $node.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped orphan Deribit bot PID $($node.ProcessId)"
  }
}

Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
