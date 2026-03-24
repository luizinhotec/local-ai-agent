param(
    [string]$AmountIn = "13479",
    [string]$InputToken = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    [string]$OutputToken = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
    [string]$AmmStrategy = "best",
    [string]$PreferredAmm = "",
    [decimal]$SlippageTolerance = 3,
    [string]$SwapParametersType = "simple",
    [string]$WalletName = "dog-mm-mainnet",
    [string]$WalletId = "",
    [string]$ExpectedAddress = "SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF",
    [string]$WalletPassword = "",
    [switch]$Broadcast,
    [switch]$JsonOnly
)

$ErrorActionPreference = "Stop"

$executor = Join-Path $PSScriptRoot "..\tools\bitflow-runtime\dog-mm-bitflow-swap-executor.cjs"
$executor = [System.IO.Path]::GetFullPath($executor)

if (!(Test-Path $executor)) {
    throw "Bitflow executor not found: $executor"
}

$stateFile = "C:\dev\local-ai-agent\active\state\dog-mm\bitflow-last-swap-plan.json"
$summaryFile = "C:\dev\local-ai-agent\active\state\dog-mm\bitflow-last-swap-plan.md"

$arguments = @(
    $executor,
    "--amount-in", $AmountIn,
    "--input-token", $InputToken,
    "--output-token", $OutputToken,
    "--amm-strategy", $AmmStrategy,
    "--slippage-tolerance", $SlippageTolerance.ToString([System.Globalization.CultureInfo]::InvariantCulture),
    "--swap-parameters-type", $SwapParametersType,
    "--wallet-name", $WalletName,
    "--expected-address", $ExpectedAddress,
    "--state-file", $stateFile,
    "--summary-file", $summaryFile
)

if ($PreferredAmm) {
    $arguments += @("--preferred-amm", $PreferredAmm)
}

if ($WalletId) {
    $arguments += @("--wallet-id", $WalletId)
}

if ($WalletPassword) {
    $arguments += @("--wallet-password", $WalletPassword)
}

if ($Broadcast) {
    $arguments += "--broadcast"
}

if ($JsonOnly) {
    $arguments += "--json-only"
}

& node @arguments
