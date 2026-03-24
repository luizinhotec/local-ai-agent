param (
    [int]$IntervalSeconds = 60,
    [int]$AmountSats = 3000,
    [bool]$AutoSafeActions = $true,
    [switch]$DryRun
)

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $root ".env"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "standard-loop.log"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $parts = $line -split '=', 2
        if ($parts.Length -ne 2) { return }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($key) -and -not $env:$key) {
            Set-Item -Path "Env:$key" -Value $value
        }
    }
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$args = @(
    "runtime/speedy-indra/agent-standard-loop.cjs",
    "--interval-seconds=$IntervalSeconds",
    "--amount-sats=$AmountSats",
    "--auto-safe-actions=$($AutoSafeActions.ToString().ToLower())"
)

if ($DryRun) {
    $args += "--dry-run"
}

Write-Host "Starting Speedy Indra standard loop..."
Write-Host "Log file: $logFile"

& node @args 2>&1 | Tee-Object -FilePath $logFile -Append
