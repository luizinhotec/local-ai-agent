param(
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$sourceDir = Join-Path $PSScriptRoot "..\state\dog-mm"
$resolvedOutputDir = if ($OutputDir) {
    $OutputDir
} else {
    Join-Path $PSScriptRoot "..\state\backups\dog-mm"
}

if (-not (Test-Path $sourceDir)) {
    throw "Diretorio de estado do DOG MM nao encontrado."
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destinationDir = Join-Path $resolvedOutputDir "dog-mm-$timestamp"
New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null

Copy-Item -Path (Join-Path $sourceDir "*") -Destination $destinationDir -Recurse -Force

$manifest = [pscustomobject]@{
    createdAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    sourceDir = (Resolve-Path $sourceDir).Path
    destinationDir = (Resolve-Path $destinationDir).Path
}

$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $destinationDir "backup-manifest.json") -Encoding UTF8

Write-Host "DOG MM local state backup created at: $destinationDir"
