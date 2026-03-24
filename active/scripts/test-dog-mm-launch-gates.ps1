param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$bundleScript = Join-Path $PSScriptRoot "export-dog-mm-ops-bundle.ps1"
$bundlePath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-bundle.json"

$null = powershell -ExecutionPolicy Bypass -File $bundleScript
$bundle = Get-Content $bundlePath -Raw | ConvertFrom-Json

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    globalNextAction = $bundle.nextAction
    gates = [pscustomobject]@{
        walletReady = ([bool]$bundle.status.wallet.created -and [bool]$bundle.status.wallet.validated -and [bool]$bundle.status.wallet.funded)
        phase0Ready = [bool]$bundle.phase0.preflight.readiness.phase0LaunchReady
        phase1Ready = [bool]$bundle.phase1.preflight.readiness.phase1LaunchReady
    }
    blockers = [pscustomobject]@{
        wallet = if (-not [bool]$bundle.status.wallet.validated) { "validate_wallet_addresses" } elseif (-not [bool]$bundle.status.wallet.funded) { "fund_wallet" } else { "" }
        phase0 = if (-not [bool]$bundle.phase0.preflight.readiness.phase0LaunchReady) { $bundle.phase0.preflight.readiness.nextAction } else { "" }
        phase1 = if (-not [bool]$bundle.phase1.preflight.readiness.phase1LaunchReady) { $bundle.phase1.preflight.readiness.nextAction } else { "" }
    }
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "global_next_action: $($result.globalNextAction)"
    Write-Host "wallet_ready: $($result.gates.walletReady)"
    Write-Host "phase0_ready: $($result.gates.phase0Ready)"
    Write-Host "phase1_ready: $($result.gates.phase1Ready)"
    Write-Host "wallet_blocker: $($result.blockers.wallet)"
    Write-Host "phase0_blocker: $($result.blockers.phase0)"
    Write-Host "phase1_blocker: $($result.blockers.phase1)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
