param(
    [Parameter(Mandatory = $true)]
    [string]$Type,
    [string]$DetailsJson = "{}"
)

$ErrorActionPreference = "Stop"

$stateDir = Join-Path $PSScriptRoot "..\state\dog-mm"
$logPath = Join-Path $stateDir "dog-mm-ops-log.jsonl"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

try {
    $details = if ($DetailsJson) { $DetailsJson | ConvertFrom-Json } else { @{} }
} catch {
    throw "DetailsJson invalido para write-dog-mm-local-event.ps1"
}

$record = [ordered]@{
    loggedAt = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    type = $Type
    details = $details
}

$record | ConvertTo-Json -Compress -Depth 10 | Add-Content -Path $logPath
Write-Host "DOG MM event logged: $Type"
