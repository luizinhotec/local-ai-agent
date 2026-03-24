param(
    [int]$IntervalSeconds = 300,
    [int]$Iterations = 0
)

$ErrorActionPreference = "Stop"

if ($IntervalSeconds -lt 30) {
    throw "Use um intervalo de pelo menos 30 segundos."
}

$refreshScript = Join-Path $PSScriptRoot "refresh-dog-mm-control-center.ps1"
$nextStepScript = Join-Path $PSScriptRoot "show-dog-mm-next-step.ps1"
$count = 0

while ($true) {
    $count += 1
    if ($count -gt 1) {
        Write-Host ""
    }

    Write-Host "DOG MM Control Center Watch"
    Write-Host "iteracao: $count"
    powershell -ExecutionPolicy Bypass -File $refreshScript | Out-Null
    powershell -ExecutionPolicy Bypass -File $nextStepScript -Plain

    if ($Iterations -gt 0 -and $count -ge $Iterations) {
        break
    }

    Start-Sleep -Seconds $IntervalSeconds
}
