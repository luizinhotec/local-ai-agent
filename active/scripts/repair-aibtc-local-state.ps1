param(
  [switch]$ShowStatus
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$statusScript = Join-Path $PSScriptRoot "show-aibtc-ops-status.ps1"
$rebuildUrl = "http://127.0.0.1:8765/api/rebuild-ops-summary"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"

Write-Host "Reparando estado local AIBTC..." -ForegroundColor Cyan

powershell -ExecutionPolicy Bypass -File $helperScript | Out-Host

$rebuildResponse = Invoke-RestMethod -Method Post -Uri $rebuildUrl -TimeoutSec 30
if (-not $rebuildResponse.success) {
  throw "Falha ao reconstruir o resumo local."
}

Write-Host "Resumo local reconstruido com sucesso." -ForegroundColor Green

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
} | ConvertTo-Json -Depth 6 -Compress

& $writeEventScript -Type "local_state_repair" -DetailsJson $eventDetails | Out-Host

if ($ShowStatus) {
  Write-Host ""
  Write-Host "Status consolidado apos reparo:" -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File $statusScript -Plain | Out-Host
}
