param(
  [string]$ArchivePath = "",
  [switch]$UseLatest,
  [switch]$SkipPreBackup
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$stateDir = Join-Path $root "active\state"
$backupsDir = Join-Path $stateDir "backups"
$latestBackupMetaPath = Join-Path $stateDir "aibtc-local-state-backup-latest.json"
$backupScript = Join-Path $PSScriptRoot "backup-aibtc-local-state.ps1"
$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$repairScript = Join-Path $PSScriptRoot "repair-aibtc-local-state.ps1"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"

function Resolve-RestoreArchivePath {
  param(
    [string]$RequestedPath,
    [switch]$PreferLatest
  )

  if ($RequestedPath) {
    if (-not (Test-Path $RequestedPath)) {
      throw "ArchivePath nao encontrado: $RequestedPath"
    }
    return (Resolve-Path $RequestedPath).Path
  }

  if ($PreferLatest -or -not $RequestedPath) {
    if (Test-Path $latestBackupMetaPath) {
      $latest = Get-Content $latestBackupMetaPath -Raw | ConvertFrom-Json
      if ($latest.archivePath -and (Test-Path $latest.archivePath)) {
        return (Resolve-Path $latest.archivePath).Path
      }
    }

    $latestArchive = Get-ChildItem -Path $backupsDir -File -Filter "*.zip" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($latestArchive) {
      return $latestArchive.FullName
    }
  }

  throw "Nenhum backup local encontrado para restauracao."
}

Write-Host "Restauracao local do estado AIBTC" -ForegroundColor Cyan

$resolvedArchivePath = Resolve-RestoreArchivePath -RequestedPath $ArchivePath -PreferLatest:$UseLatest

if (-not $SkipPreBackup) {
  Write-Host "Gerando backup preventivo antes da restauracao..." -ForegroundColor Yellow
  powershell -ExecutionPolicy Bypass -File $backupScript | Out-Host
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("aibtc-restore-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
  Expand-Archive -Path $resolvedArchivePath -DestinationPath $tempDir -Force

  $items = Get-ChildItem -Path $tempDir -Force
  if (-not $items) {
    throw "O backup expandido nao contem itens restauraveis."
  }

  foreach ($item in $items) {
    $destination = Join-Path $stateDir $item.Name
    if (Test-Path $destination) {
      Remove-Item -Path $destination -Recurse -Force
    }
    Move-Item -Path $item.FullName -Destination $destination -Force
  }
} finally {
  if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

powershell -ExecutionPolicy Bypass -File $helperScript -ForceRestart | Out-Host
powershell -ExecutionPolicy Bypass -File $repairScript | Out-Host

$eventDetails = @{
  result = @{
    status = 200
    ok = $true
  }
  restore = @{
    archivePath = $resolvedArchivePath
    archiveName = [System.IO.Path]::GetFileName($resolvedArchivePath)
  }
} | ConvertTo-Json -Depth 8 -Compress

& $writeEventScript -Type "local_state_restore" -DetailsJson $eventDetails | Out-Host

Write-Host "Restauracao concluida:" -ForegroundColor Green
Write-Host $resolvedArchivePath
