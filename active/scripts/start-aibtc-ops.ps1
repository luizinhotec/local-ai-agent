param (
    [int]$Port = 8765,
    [switch]$OpenBrowser,
    [switch]$Watch,
    [switch]$WatchHeartbeat,
    [switch]$MaintenanceCycle
)

$dashboardUrl = "http://127.0.0.1:$Port/aibtc-ops-dashboard.html"
$opsStatusUrl = "http://127.0.0.1:$Port/api/ops-status"

Write-Host "Bootstrap operacional AIBTC"
Write-Host ""

& (Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1") -Port $Port

try {
    Invoke-WebRequest -UseBasicParsing $opsStatusUrl -TimeoutSec 10 | Out-Null
} catch {
    Write-Host ""
    Write-Host "[warn] nao foi possivel aquecer o estado consolidado da operacao: $($_.Exception.Message)"
}

if ($OpenBrowser) {
    Write-Host ""
    Write-Host "Abrindo dashboard no navegador..."
    Start-Process $dashboardUrl
}

Write-Host ""
Write-Host "Status consolidado atual:"
& (Join-Path $PSScriptRoot "show-aibtc-ops-status.ps1") -Plain

Write-Host ""
Write-Host "Dashboard:"
Write-Host $dashboardUrl

if ($Watch) {
    Write-Host ""
    Write-Host "Iniciando monitor continuo do terminal..."
    & (Join-Path $PSScriptRoot "watch-aibtc-ops.ps1")
}

if ($WatchHeartbeat) {
    Write-Host ""
    Write-Host "Iniciando monitor da janela do heartbeat..."
    & (Join-Path $PSScriptRoot "watch-aibtc-heartbeat-ready.ps1") -Port $Port
}

if ($MaintenanceCycle) {
    Write-Host ""
    Write-Host "Executando ciclo completo de manutencao..."
    & (Join-Path $PSScriptRoot "run-aibtc-maintenance-cycle.ps1")
}
