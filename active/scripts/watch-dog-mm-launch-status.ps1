param(
    [int]$IntervalSeconds = 300,
    [int]$Iterations = 0
)

$ErrorActionPreference = "Stop"

if ($IntervalSeconds -lt 30) {
    throw "Use um intervalo de pelo menos 30 segundos."
}

$scriptPath = Join-Path $PSScriptRoot "test-dog-mm-launch-gates.ps1"
$count = 0

while ($true) {
    $count += 1
    if ($count -gt 1) {
        Write-Host ""
    }

    Write-Host "DOG MM Launch Watch"
    Write-Host "iteracao: $count"
    powershell -ExecutionPolicy Bypass -File $scriptPath -Plain

    if ($Iterations -gt 0 -and $count -ge $Iterations) {
        break
    }

    Start-Sleep -Seconds $IntervalSeconds
}
