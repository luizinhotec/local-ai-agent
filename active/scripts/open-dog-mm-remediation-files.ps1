param()

$ErrorActionPreference = "Stop"

$planScript = Join-Path $PSScriptRoot "show-dog-mm-remediation-plan.ps1"
$plan = powershell -ExecutionPolicy Bypass -File $planScript | ConvertFrom-Json

$targets = @()

foreach ($step in @($plan.steps)) {
    $path = Join-Path (Get-Location) $step.file
    if (Test-Path $path) {
        $targets += (Resolve-Path $path).Path
    }
}

$targets += @(
    (Resolve-Path (Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-doctor-report.md")).Path
)

$targets = $targets | Select-Object -Unique

foreach ($target in $targets) {
    Start-Process $target
}

Write-Host "DOG MM remediation files opened."
