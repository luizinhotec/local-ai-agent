param (
    [int]$IntervalSeconds = 15,
    [switch]$Once
)

if ($IntervalSeconds -lt 5) {
    Write-Error "Use um intervalo de pelo menos 5 segundos."
    exit 1
}

$statusScript = Join-Path $PSScriptRoot "run-dog-mm-heartbeat-local.ps1"

while ($true) {
    Clear-Host
    Write-Host "DOG MM Heartbeat Watch"
    Write-Host "intervalo: $IntervalSeconds segundos"
    Write-Host ""

    try {
        $status = powershell -ExecutionPolicy Bypass -File $statusScript -StatusOnly | ConvertFrom-Json
        $heartbeat = $status.heartbeat

        if ($heartbeat.latestLoggedAt) {
            Write-Host "ultimo heartbeat: $($heartbeat.latestLoggedAt)"
        } else {
            Write-Host "ultimo heartbeat: nenhum"
        }

        if ($heartbeat.readyNow) {
            Write-Host "[ok] heartbeat do DOG MM liberado agora"
        } else {
            Write-Host "[wait] heartbeat do DOG MM aguardando"
            Write-Host "proxima janela local: $($heartbeat.nextCheckInLocal)"
            Write-Host "segundos restantes: $($heartbeat.waitSeconds)"
        }
    } catch {
        Write-Host "[warn] falha ao consultar heartbeat do DOG MM"
    }

    if ($Once) {
        break
    }

    Write-Host ""
    Write-Host "Atualizando novamente em $IntervalSeconds segundos. Pressione Ctrl+C para sair."
    Start-Sleep -Seconds $IntervalSeconds
}
