param (
    [int]$IntervalSeconds = 300,
    [int]$Iterations = 0
)

if ($IntervalSeconds -lt 30) {
    Write-Error "Use um intervalo de pelo menos 30 segundos."
    exit 1
}

$scriptPath = Join-Path $PSScriptRoot "check-dog-mm-hodlmm-status.ps1"
$count = 0

while ($true) {
    $count += 1
    if ($count -gt 1) {
        Write-Host ""
    }

    Write-Host "DOG MM HODLMM Watch"
    Write-Host "iteracao: $count"
    powershell -ExecutionPolicy Bypass -File $scriptPath -Plain

    if ($Iterations -gt 0 -and $count -ge $Iterations) {
        break
    }

    Start-Sleep -Seconds $IntervalSeconds
}
