param(
  [switch]$Execute
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$stateDir = Join-Path $repoRoot 'workspace\deribit\state'
$logPath = Join-Path $stateDir 'deribit-bot-loop.log'
$errorLogPath = Join-Path $stateDir 'deribit-bot-loop.err.log'
$envPath = Join-Path $repoRoot 'workspace\deribit\config\deribit.env.example.ps1'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (Test-Path $envPath) {
  . $envPath
}

if (-not $env:DERIBIT_CLIENT_ID -or -not $env:DERIBIT_CLIENT_SECRET) {
  throw 'missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET'
}

$nodeArgs = @('workspace/deribit/runtime/deribit-bot-loop.cjs')
if ($Execute) {
  $nodeArgs += '--execute'
}

try {
  & node @nodeArgs *>> $logPath
}
catch {
  $_ | Out-File -FilePath $errorLogPath -Append
  throw
}
