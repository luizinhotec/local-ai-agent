param(
  [string]$OutputDir = "active/state/backups"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$stateDir = Join-Path $root "active\state"
$resolvedOutputDir = Join-Path $root $OutputDir
$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"
$opsStatusUrl = "http://127.0.0.1:8765/api/ops-status"
$timestamp = Get-Date
$stamp = $timestamp.ToString("yyyyMMdd-HHmmss")
$zipPath = Join-Path $resolvedOutputDir "aibtc-local-state-backup-$stamp.zip"
$latestMetaPath = Join-Path $stateDir "aibtc-local-state-backup-latest.json"

Write-Host "Backup local do estado AIBTC" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

powershell -ExecutionPolicy Bypass -File $helperScript | Out-Host

$opsStatus = $null
try {
  $opsStatus = Invoke-RestMethod -Uri $opsStatusUrl -TimeoutSec 30
} catch {
}

$itemsToBackup = Get-ChildItem -Path $stateDir -Force | Where-Object {
  $_.FullName -ne $resolvedOutputDir
}

if (-not $itemsToBackup) {
  throw "Nenhum item encontrado para backup em $stateDir"
}

if (Test-Path $zipPath) {
  Remove-Item -Path $zipPath -Force
}

Compress-Archive -Path ($itemsToBackup.FullName) -DestinationPath $zipPath -CompressionLevel Optimal -Force

$metadata = [ordered]@{
  checkedAtUtc = [datetime]::UtcNow.ToString("o")
  archivePath = $zipPath
  archiveName = [System.IO.Path]::GetFileName($zipPath)
  itemCount = @($itemsToBackup).Count
  stateDir = $stateDir
  opsStatus = $opsStatus
}

$metadata | ConvertTo-Json -Depth 8 | Set-Content -Path $latestMetaPath -Encoding utf8

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
  backup = @{
    archivePath = $zipPath
    archiveName = [System.IO.Path]::GetFileName($zipPath)
    itemCount = @($itemsToBackup).Count
  }
} | ConvertTo-Json -Depth 8 -Compress

& $writeEventScript -Type "local_state_backup" -DetailsJson $eventDetails | Out-Host

Write-Host "Backup criado:" -ForegroundColor Green
Write-Host $zipPath
