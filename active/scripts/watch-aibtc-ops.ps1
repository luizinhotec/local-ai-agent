param (
    [int]$IntervalSeconds = 30,
    [int]$Iterations = 0
)

if ($IntervalSeconds -lt 5) {
    Write-Error "Use um intervalo de pelo menos 5 segundos."
    exit 1
}

$statusScript = Join-Path $PSScriptRoot "show-aibtc-ops-status.ps1"
$logScript = Join-Path $PSScriptRoot "show-aibtc-ops-log.ps1"
$reportScript = Join-Path $PSScriptRoot "show-aibtc-ops-report.ps1"
$alertsScript = Join-Path $PSScriptRoot "show-aibtc-ops-alerts.ps1"

function Write-Separator {
    Write-Host ""
    Write-Host ("=" * 72)
}

$count = 0
while ($true) {
    $count += 1
    Clear-Host
    Write-Host "AIBTC Ops Watch"
    Write-Host "Iteracao: $count"
    Write-Host "Intervalo: $IntervalSeconds segundos"
    Write-Separator

    & $statusScript -Plain

    Write-Separator
    & $reportScript -Plain

    Write-Separator
    & $alertsScript

    Write-Separator
    & $logScript -Plain

    if ($Iterations -gt 0 -and $count -ge $Iterations) {
        break
    }

    Write-Separator
    Write-Host "Atualizando novamente em $IntervalSeconds segundos. Pressione Ctrl+C para sair."
    Start-Sleep -Seconds $IntervalSeconds
}
