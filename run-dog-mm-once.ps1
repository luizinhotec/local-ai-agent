$ErrorActionPreference = "Stop"

Set-Location "C:\dev\local-ai-agent"

$envFile = "C:\dev\local-ai-agent\.env.ps1"
if (-not (Test-Path $envFile)) {
    throw ".env.ps1 not found: $envFile"
}

. $envFile

$stateDir = "C:\dev\local-ai-agent\active\state\dog-mm"
$logFile = Join-Path $stateDir "dog-mm-safe-loop.log"
$lockFile = Join-Path $stateDir "dog-mm-cycle.lock"
$logDir = Split-Path -Parent $logFile

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$lockStream = $null

function Add-CommandArg {
    param(
        [ref]$Command,
        [string]$EnvName,
        [string]$ArgName
    )

    $value = [Environment]::GetEnvironmentVariable($EnvName)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        $Command.Value += @($ArgName, $value)
    }
}

function Write-LoopLog {
    param([string]$Message)
    Add-Content -Path $logFile -Value $Message
}

try {
    $lockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-LoopLog ""
    Write-LoopLog "===== [$timestamp] SKIP ====="
    Write-LoopLog "skip_reason: lock_active"
    exit 0
}

$command = @("npm.cmd", "run", "dog-mm:safe", "--")

Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_WALLET_NAME" -ArgName "--wallet-name"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_WALLET_ID" -ArgName "--wallet-id"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_EXPECTED_ADDRESS" -ArgName "--expected-address"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_AMOUNT_IN" -ArgName "--amount-in"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_AMM_STRATEGY" -ArgName "--amm-strategy"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_PREFERRED_AMM" -ArgName "--preferred-amm"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SLIPPAGE_TOLERANCE" -ArgName "--slippage-tolerance"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_INPUT_TOKEN" -ArgName "--input-token"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_OUTPUT_TOKEN" -ArgName "--output-token"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_INPUT_TOKEN_DECIMALS" -ArgName "--input-token-decimals"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_OUTPUT_TOKEN_DECIMALS" -ArgName "--output-token-decimals"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_INPUT_TOKEN_USD" -ArgName "--input-token-usd"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_OUTPUT_TOKEN_USD" -ArgName "--output-token-usd"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_STX_USD" -ArgName "--stx-usd"

Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SAFE_MAX_AMOUNT_IN" -ArgName "--max-amount-in"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SAFE_MAX_SLIPPAGE_TOLERANCE" -ArgName "--max-slippage-tolerance"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SAFE_MAX_FEE" -ArgName "--max-fee"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SAFE_MAX_ROUTE_HOPS" -ArgName "--max-route-hops"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SAFE_MIN_OUTPUT_RATIO" -ArgName "--min-output-ratio"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_SAFE_MAX_FEE_PER_BYTE" -ArgName "--max-fee-per-byte"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_PROFIT_ENFORCEMENT" -ArgName "--profit-enforcement"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_MIN_NET_PROFIT_USD" -ArgName "--min-net-profit-usd"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_MIN_WORST_CASE_NET_PROFIT_USD" -ArgName "--min-worst-case-net-profit-usd"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_MIN_NET_PROFIT_BPS" -ArgName "--min-net-profit-bps"
Add-CommandArg -Command ([ref]$command) -EnvName "DOG_MM_MAX_FEE_AS_PERCENT_OF_GROSS_PROFIT" -ArgName "--max-fee-as-percent-of-gross-profit"

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-LoopLog ""
Write-LoopLog "===== [$timestamp] START ====="
Write-LoopLog ("command: " + ($command -join " "))

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"

try {
    & $command[0] $command[1] $command[2] $command[3..($command.Length-1)] 2>&1 | Out-File -Append $logFile
    $exitCode = $LASTEXITCODE
    Write-LoopLog ("exit_code: " + $exitCode)
    exit $exitCode
} catch {
    Write-LoopLog ("runner_error: " + $_.Exception.Message)
    exit 1
} finally {
    $ErrorActionPreference = $previousPreference
    Write-LoopLog "===== [$timestamp] END ====="
    if ($lockStream) {
        $lockStream.Dispose()
    }
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
}
