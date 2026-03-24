param(
  [switch]$Plain,
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$opsStatusUrl = "http://127.0.0.1:$Port/api/ops-status"
$configPath = Join-Path $PSScriptRoot "..\config\speedy-indra-position-monitor.json"

try {
  $response = Invoke-WebRequest -UseBasicParsing $opsStatusUrl -TimeoutSec 10
  $opsStatus = $response.Content | ConvertFrom-Json
} catch {
  Write-Host "[warn] nao foi possivel consultar o monitor de posicao local"
  exit 0
}

$position = $opsStatus.position
if (-not $position) {
  Write-Host "[warn] monitor de posicao indisponivel no estado consolidado"
  exit 0
}

$localConfig = $null
if (Test-Path $configPath) {
  try {
    $localConfig = Get-Content -Path $configPath -Raw | ConvertFrom-Json
  } catch {
    $localConfig = $null
  }
}

$activeProtocol = if ($position.activeProtocol) {
  $position.activeProtocol
} elseif ($localConfig.lastConfirmedPosition.activeProtocol) {
  $localConfig.lastConfirmedPosition.activeProtocol
} else {
  $localConfig.baseline.activeProtocol
}

$baselineProtocol = if ($position.positionBaseline.activeProtocol) {
  $position.positionBaseline.activeProtocol
} else {
  $localConfig.baseline.activeProtocol
}

$confirmationProtocol = if ($position.positionConfirmation.activeProtocol) {
  $position.positionConfirmation.activeProtocol
} else {
  $localConfig.lastConfirmedPosition.activeProtocol
}

if ($Plain) {
  Write-Host "monitor posicao: $(if ($position.enabled) { 'ativo' } else { 'inativo' })"
  if ($activeProtocol) {
    Write-Host "protocolo ativo: $activeProtocol"
  }
  Write-Host "resumo: $($position.summary)"
  Write-Host "modo: $($position.mode)"
  if ($position.policy) {
    Write-Host "objetivo: $($position.policy.objective)"
    Write-Host "execucao: $($position.policy.executionMode)"
    Write-Host "cadencia revisao horas: $($position.policy.reviewCadenceHours)"
    Write-Host "ganho minimo x fee: $($position.policy.minExpectedGainToFeeRatio)"
    Write-Host "aprovacao humana: $($position.policy.approvalRequired)"
  }
  if ($position.positionBaseline) {
    if ($baselineProtocol) {
      Write-Host "baseline protocolo: $baselineProtocol"
    }
    Write-Host "baseline shares: $($position.positionBaseline.suppliedShares)"
    Write-Host "reserva minima sbtc: $($position.positionBaseline.sbtcReserveMinSats)"
    Write-Host "reserva minima stx: $($position.positionBaseline.stxReserveMinMicroStx)"
  }
  if ($position.liveBalances) {
    Write-Host "sbtc livre: $($position.liveBalances.sbtcSats)"
    Write-Host "stx livre: $($position.liveBalances.stxMicroStx)"
    if ($position.liveBalances.checkedAtUtc) {
      Write-Host "saldos consultados em: $($position.liveBalances.checkedAtUtc)"
    }
  }
  if ($position.positionConfirmation) {
    if ($confirmationProtocol) {
      Write-Host "confirmacao protocolo: $confirmationProtocol"
    }
    Write-Host "confirmacao shares: $($position.positionConfirmation.suppliedShares)"
    Write-Host "confirmacao borrowed: $($position.positionConfirmation.borrowed)"
    Write-Host "confirmacao health factor: $($position.positionConfirmation.healthFactor)"
    Write-Host "confirmacao antiga: $($position.positionConfirmation.stale)"
    if ($position.positionConfirmation.checkedAtUtc) {
      Write-Host "confirmacao em: $($position.positionConfirmation.checkedAtUtc)"
    }
  }
  exit 0
}

$position | ConvertTo-Json -Depth 8
