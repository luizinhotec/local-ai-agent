$ErrorActionPreference = "Continue"

Set-Location "C:\dev\local-ai-agent"

$runner = "C:\dev\local-ai-agent\run-dog-mm-once.ps1"
$intervalSeconds = 300

if (-not (Test-Path $runner)) {
    throw "Runner not found: $runner"
}

while ($true) {
    powershell.exe -ExecutionPolicy Bypass -File $runner
    Start-Sleep -Seconds $intervalSeconds
}
