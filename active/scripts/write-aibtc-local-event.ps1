param(
  [Parameter(Mandatory = $true)]
  [string]$Type,
  [string]$DetailsJson = "{}",
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"

$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$logEventUrl = "http://127.0.0.1:$Port/api/log-event"

try {
  powershell -ExecutionPolicy Bypass -File $helperScript | Out-Null
} catch {
  Write-Warning "nao foi possivel garantir o helper antes de registrar evento: $($_.Exception.Message)"
}

try {
  $details = if ($DetailsJson) { $DetailsJson | ConvertFrom-Json } else { @{} }
} catch {
  throw "DetailsJson invalido para write-aibtc-local-event.ps1"
}

$payload = @{
  type = $Type
  displayName = "Speedy Indra"
  btcAddress = "bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9"
  stxAddress = "SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT"
  details = $details
}

try {
  Invoke-RestMethod -Method Post -Uri $logEventUrl -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 30 | Out-Null
  Write-Host "Evento local registrado: $Type"
} catch {
  Write-Warning "falha ao registrar evento local '$Type': $($_.Exception.Message)"
}
