param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$stateDir = Join-Path $PSScriptRoot "..\state\dog-mm"
$statusPath = Join-Path $stateDir "dog-mm-setup-status.json"
$logPath = Join-Path $stateDir "dog-mm-ops-log.jsonl"
$hodlmmSnapshotPath = Join-Path $PSScriptRoot "..\state\dog-mm-hodlmm-status.json"
$phase0LiveScript = Join-Path $PSScriptRoot "get-dog-mm-phase0-live-status.ps1"
$heartbeatWindowScript = Join-Path $PSScriptRoot "get-next-dog-mm-heartbeat-window.ps1"

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return $null
    }

    try {
        return Get-Content $Path -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-LatestEvent {
    if (-not (Test-Path $logPath)) {
        return $null
    }

    $events = Get-Content $logPath |
        Where-Object { $_.Trim() -ne "" } |
        ForEach-Object {
            try {
                $_ | ConvertFrom-Json
            } catch {
                $null
            }
        } |
        Where-Object { $_ -ne $null }

    return $events | Select-Object -Last 1
}

$status = Read-JsonFile -Path $statusPath
$hodlmm = Read-JsonFile -Path $hodlmmSnapshotPath
$latestEvent = Get-LatestEvent
$phase0Live = $null
$heartbeatWindow = $null
try {
    $phase0Live = powershell -ExecutionPolicy Bypass -File $phase0LiveScript | ConvertFrom-Json
} catch {
    $phase0Live = $null
}
try {
    $heartbeatWindow = powershell -ExecutionPolicy Bypass -File $heartbeatWindowScript | ConvertFrom-Json
} catch {
    $heartbeatWindow = $null
}

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    stage = if ($status) { $status.stage } else { "not_initialized" }
    wallet = if ($status) { $status.wallet } else { $null }
    phase0 = if ($status) { $status.phase0 } else { $null }
    phase0Live = $phase0Live
    phase1 = if ($status) { $status.phase1 } else { $null }
    heartbeat = if ($heartbeatWindow) {
        [pscustomobject]@{
            latestEventType = $heartbeatWindow.eventType
            latestLoggedAt = $heartbeatWindow.loggedAt
            nextCheckInUtc = $heartbeatWindow.heartbeatWindow.nextCheckInUtc
            nextCheckInLocal = $heartbeatWindow.heartbeatWindow.nextCheckInLocal
            waitSeconds = $heartbeatWindow.heartbeatWindow.waitSeconds
            readyNow = $heartbeatWindow.heartbeatWindow.readyNow
        }
    } else { $null }
    hodlmm = [pscustomobject]@{
        dogPoolAvailable = if ($hodlmm) { $hodlmm.hodlmmDogPoolAvailable } else { $null }
        dogPoolCount = if ($hodlmm) { $hodlmm.dogPoolCount } else { $null }
        checkedAtUtc = if ($hodlmm) { $hodlmm.checkedAtUtc } else { $null }
    }
    latestEvent = $latestEvent
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "stage: $($result.stage)"
    if ($result.wallet) {
        Write-Host "wallet_name: $($result.wallet.name)"
        Write-Host "wallet_created: $($result.wallet.created)"
        Write-Host "wallet_validated: $($result.wallet.validated)"
        Write-Host "wallet_funded: $($result.wallet.funded)"
        if ($result.wallet.stxAddress) {
            Write-Host "wallet_stx: $($result.wallet.stxAddress)"
        }
        if ($result.wallet.btcAddress) {
            Write-Host "wallet_btc: $($result.wallet.btcAddress)"
        }
        if ($result.wallet.taprootAddress) {
            Write-Host "wallet_taproot: $($result.wallet.taprootAddress)"
        }
    }
    if ($result.phase0) {
        Write-Host "phase0_pool: $($result.phase0.selectedPool)"
        Write-Host "phase0_bin_step: $($result.phase0.binStep)"
        Write-Host "phase0_first_cycle_executed: $($result.phase0.firstCycleExecuted)"
    }
    if ($result.phase0Live) {
        Write-Host "phase0_open_tx_status: $($result.phase0Live.openTxStatus)"
        Write-Host "phase0_unsigned_bin_id: $($result.phase0Live.unsignedBinId)"
        Write-Host "phase0_covers_active_bin: $($result.phase0Live.coversActiveBin)"
        Write-Host "phase0_live_value_usd: $($result.phase0Live.liquidity.totalValueUsd)"
    }
    if ($result.heartbeat) {
        Write-Host "heartbeat_ready_now: $($result.heartbeat.readyNow)"
        Write-Host "heartbeat_next_check_local: $($result.heartbeat.nextCheckInLocal)"
        Write-Host "heartbeat_wait_seconds: $($result.heartbeat.waitSeconds)"
    }
    if ($result.phase1) {
        Write-Host "phase1_pool: $($result.phase1.selectedPool)"
        Write-Host "phase1_asset_base: $($result.phase1.assetBase)"
        Write-Host "phase1_first_trade_executed: $($result.phase1.firstManualTradeExecuted)"
    }
    Write-Host "hodlmm_dog_pool_available: $($result.hodlmm.dogPoolAvailable)"
    Write-Host "hodlmm_dog_pool_count: $($result.hodlmm.dogPoolCount)"
    if ($latestEvent) {
        Write-Host "latest_event: $($latestEvent.type)"
    } else {
        Write-Host "latest_event: none"
    }
    exit 0
}

$result | ConvertTo-Json -Depth 10
