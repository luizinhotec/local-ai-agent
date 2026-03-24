param(
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$opsStatusUrl = "http://127.0.0.1:$Port/api/ops-status"

try {
  $response = Invoke-WebRequest -UseBasicParsing $opsStatusUrl -TimeoutSec 10
  $opsStatus = $response.Content | ConvertFrom-Json
} catch {
  Write-Host "[warn] nao foi possivel consultar o estado consolidado local"
  exit 0
}

$alerts = @($opsStatus.alerts)
if (-not $alerts.Count) {
  Write-Host "alertas: nenhum"
  exit 0
}

Write-Host "alertas: $($alerts.Count)"
foreach ($alert in $alerts) {
  Write-Host "- [$($alert.level)] $($alert.summary)"
}
