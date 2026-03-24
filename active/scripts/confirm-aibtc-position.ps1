param(
  [string]$Protocol,
  [int]$SuppliedShares = 0,
  [int]$Borrowed = 0,
  [string]$HealthFactor = "100000000",
  [Nullable[int]]$DeployedSbtcSats,
  [Nullable[int]]$LiquidSbtcSats,
  [Nullable[int]]$HbtcUnits,
  [string]$EntryTxid,
  [string]$CheckedAtUtc,
  [switch]$PassThru
)

$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "..\config\speedy-indra-position-monitor.json"
$writeEventScript = Join-Path $PSScriptRoot "write-aibtc-local-event.ps1"

if (-not (Test-Path $configPath)) {
  throw "arquivo de configuracao do monitor de posicao nao encontrado: $configPath"
}

$config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
$baseline = $config.baseline
$current = $config.lastConfirmedPosition

if (-not $Protocol) {
  $Protocol = if ($baseline.activeProtocol) { $baseline.activeProtocol } elseif ($current.activeProtocol) { $current.activeProtocol } else { "Zest" }
}

if (-not $CheckedAtUtc) {
  $CheckedAtUtc = [datetime]::UtcNow.ToString("o")
}

$updatedConfirmation = [ordered]@{
  checkedAtUtc = $CheckedAtUtc
  suppliedShares = $SuppliedShares
  borrowed = $Borrowed
  healthFactor = $HealthFactor
  activeProtocol = $Protocol
}

if ($PSBoundParameters.ContainsKey("DeployedSbtcSats")) {
  $updatedConfirmation.deployedSbtcSats = $DeployedSbtcSats
} elseif ($current.deployedSbtcSats -ne $null) {
  $updatedConfirmation.deployedSbtcSats = [int]$current.deployedSbtcSats
} elseif ($baseline.deployedSbtcSats -ne $null) {
  $updatedConfirmation.deployedSbtcSats = [int]$baseline.deployedSbtcSats
}

if ($PSBoundParameters.ContainsKey("LiquidSbtcSats")) {
  $updatedConfirmation.liquidSbtcSats = $LiquidSbtcSats
} elseif ($current.liquidSbtcSats -ne $null) {
  $updatedConfirmation.liquidSbtcSats = [int]$current.liquidSbtcSats
} elseif ($baseline.liquidSbtcReserveSats -ne $null) {
  $updatedConfirmation.liquidSbtcSats = [int]$baseline.liquidSbtcReserveSats
}

if ($PSBoundParameters.ContainsKey("HbtcUnits")) {
  $updatedConfirmation.hbtcUnits = $HbtcUnits
} elseif ($current.hbtcUnits -ne $null) {
  $updatedConfirmation.hbtcUnits = [int]$current.hbtcUnits
} elseif ($baseline.receivedHbtcUnits -ne $null) {
  $updatedConfirmation.hbtcUnits = [int]$baseline.receivedHbtcUnits
}

if ($EntryTxid) {
  $updatedConfirmation.entryTxid = $EntryTxid
} elseif ($current.entryTxid) {
  $updatedConfirmation.entryTxid = $current.entryTxid
} elseif ($baseline.entryTxid) {
  $updatedConfirmation.entryTxid = $baseline.entryTxid
}

$config.lastConfirmedPosition = [pscustomobject]$updatedConfirmation

$json = $config | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

$eventDetails = @{
  protocol = $Protocol
  confirmation = $updatedConfirmation
  result = @{
    status = 200
    ok = $true
  }
} | ConvertTo-Json -Depth 8 -Compress

& $writeEventScript -Type "position_confirmation_refresh" -DetailsJson $eventDetails | Out-Host

Write-Host "Confirmacao de posicao atualizada." -ForegroundColor Green
Write-Host "protocolo: $Protocol"
Write-Host "checkedAtUtc: $CheckedAtUtc"
Write-Host "suppliedShares: $SuppliedShares"
Write-Host "borrowed: $Borrowed"
Write-Host "healthFactor: $HealthFactor"
if ($updatedConfirmation.Contains("deployedSbtcSats")) {
  Write-Host "deployedSbtcSats: $($updatedConfirmation.deployedSbtcSats)"
}
if ($updatedConfirmation.Contains("liquidSbtcSats")) {
  Write-Host "liquidSbtcSats: $($updatedConfirmation.liquidSbtcSats)"
}
if ($updatedConfirmation.Contains("hbtcUnits")) {
  Write-Host "hbtcUnits: $($updatedConfirmation.hbtcUnits)"
}
if ($updatedConfirmation.Contains("entryTxid")) {
  Write-Host "entryTxid: $($updatedConfirmation.entryTxid)"
}

if ($PassThru) {
  [pscustomobject]$updatedConfirmation | ConvertTo-Json -Depth 8
}
