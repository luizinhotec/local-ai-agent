param(
  [string]$WalletName = "dog-mm-mainnet",
  [string]$XAmount = '19021',
  [string]$YAmount = '9890354',
  [string]$MaxDeviation = '2',
  [string]$Fee = '50000',
  [switch]$Broadcast
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$importPasswordScript = Join-Path $PSScriptRoot "import-managed-wallet-password.ps1"
$invokeLpAddScript = Join-Path $PSScriptRoot "invoke-dog-mm-bitflow-lp-add.ps1"
$repositionScript = Join-Path $repoRoot "active\tools\bitflow-runtime\dog-mm-bitflow-lp-reposition.cjs"
$lpPlanPath = Join-Path $repoRoot "active\state\dog-mm\bitflow-last-lp-add-plan.json"
$lpSummaryPath = Join-Path $repoRoot "active\state\dog-mm\bitflow-last-lp-add-plan.md"
$repositionStatePath = Join-Path $repoRoot "active\state\dog-mm\bitflow-last-lp-reposition.json"

Write-Host "1) Loading managed wallet password for $WalletName..."
& $importPasswordScript -WalletName $WalletName

Write-Host ""
Write-Host "2) Reopening DOG-MM LP at active bin..."
$invokeArgs = @{
  WalletPassword = $env:DOG_MM_WALLET_PASSWORD
  XAmount = $XAmount
  YAmount = $YAmount
  ActiveBinOffset = '0'
  MinDlp = '1'
  MaxXLiquidityFee = '1000'
  MaxYLiquidityFee = '100000'
  MaxDeviation = $MaxDeviation
  Fee = $Fee
}
if ($Broadcast) {
  $invokeArgs.Broadcast = $true
}
& $invokeLpAddScript @invokeArgs

Write-Host ""
Write-Host "3) Validating LP visibility for the reposition loop..."
& node $repositionScript --json-only

Write-Host ""
Write-Host "4) Output files:"
Write-Host "LP plan JSON: $lpPlanPath"
Write-Host "LP plan MD:   $lpSummaryPath"
Write-Host "LP state:     $repositionStatePath"
