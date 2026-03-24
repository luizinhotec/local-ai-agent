param(
  [Parameter(Mandatory = $true)]
  [string]$WalletPassword,

  [string]$XAmount = '19021',
  [string]$YAmount = '9890354',
  [string]$ActiveBinOffset = '0',
  [string]$MinDlp = '1',
  [string]$MaxXLiquidityFee = '1000',
  [string]$MaxYLiquidityFee = '100000',
  [string]$ExpectedBinId = '',
  [string]$MaxDeviation = '2',
  [string]$Fee = '50000',
  [switch]$NoTolerance,
  [switch]$Broadcast
)

$scriptPath = Join-Path $PSScriptRoot '..\tools\bitflow-runtime\dog-mm-bitflow-lp-add-executor.cjs'
$resolvedScriptPath = [System.IO.Path]::GetFullPath($scriptPath)

$arguments = @(
  $resolvedScriptPath
  '--wallet-password', $WalletPassword
  '--x-amount', $XAmount
  '--y-amount', $YAmount
  '--active-bin-offset', $ActiveBinOffset
  '--min-dlp', $MinDlp
  '--max-x-liquidity-fee', $MaxXLiquidityFee
  '--max-y-liquidity-fee', $MaxYLiquidityFee
  '--fee', $Fee
)

if ($ExpectedBinId) {
  $arguments += @('--expected-bin-id', $ExpectedBinId)
}

if ($MaxDeviation) {
  $arguments += @('--max-deviation', $MaxDeviation)
}

if ($NoTolerance) {
  $arguments += '--no-tolerance'
}

if ($Broadcast) {
  $arguments += '--broadcast'
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  throw "DOG MM Bitflow LP add invocation failed with exit code $LASTEXITCODE."
}
