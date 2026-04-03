param(
    [switch]$ForceBlock,
    [switch]$ForceUnblock,
    [int]$CooldownMinutes = 1440
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$guardFile = Join-Path $root "state\speedy-indra\hermetica-direct-redeem-guard.json"
$registryUrl = "https://stx402.com/agent/registry"

function New-GuardState {
    return [pscustomobject]@{
        blocked = $false
        reason = $null
        sourceOfBlock = $null
        lastDetectedError = $null
        sinceUtc = $null
        blockedAtUtc = $null
        unblockedAtUtc = $null
        cooldownUntilUtc = $null
        checkedAtUtc = [datetime]::UtcNow.ToString("o")
    }
}

function Read-GuardState {
    if (-not (Test-Path $guardFile)) {
        return New-GuardState
    }

    try {
        $state = Get-Content -Path $guardFile -Raw | ConvertFrom-Json
        if (-not $state.sourceOfBlock -and $state.reason) {
            $state.sourceOfBlock = switch ($state.reason) {
                'registry_unavailable' { 'registry_unavailable' }
                'err_not_protocol' { 'err_not_protocol' }
                'missing_protocol_role' { 'missing_protocol_role' }
                'manual_force_block' { 'manual_block' }
                'manual_block' { 'manual_block' }
                Default { 'unknown' }
            }
        }
        if (-not $state.blockedAtUtc -and $state.blocked -and $state.sinceUtc) {
            $state.blockedAtUtc = $state.sinceUtc
        }
        return $state
    } catch {
        return New-GuardState
    }
}

function Write-GuardState {
    param ([pscustomobject]$state)
    $state.checkedAtUtc = [datetime]::UtcNow.ToString("o")
    $json = $state | ConvertTo-Json -Depth 10
    $dir = Split-Path $guardFile
    if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
    Set-Content -Path $guardFile -Value $json -Encoding UTF8
}

function Get-RegistryStatus {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $registryUrl -TimeoutSec 15
        $body = $r.Content | ConvertFrom-Json
        if (-not $body.networks -or -not $body.networks.mainnet) {
            return [pscustomobject]@{ ok = $false; summary = "registry mainnet indisponivel"; statusCode = $r.StatusCode }
        }
        return [pscustomobject]@{ ok = $true; summary = "registry mainnet publicado"; statusCode = $r.StatusCode }
    } catch {
        return [pscustomobject]@{ ok = $false; summary = "falha ao consultar registry"; statusCode = $null; error = $_.Exception.Message }
    }
}

function Inspect-LocalLogsForHermeticaErrors {
    $patterns = @(
        'ERR_NOT_PROTOCOL',
        'missing_protocol_role',
        'not protocol',
        'caller invalid',
        'direct_redeem'
    )
    $files = @()

    # Prioritize any AIBTC log/state content that exists
    $possibleFiles = @(
        Join-Path $root "state\speedy-indra\status.json"
        Join-Path $root "state\speedy-indra\agent-state.json"
    )

    foreach ($path in $possibleFiles) {
        if (Test-Path $path) { $files += $path }
    }

    # search in general state folder as fallback
    $files += Get-ChildItem -Path (Join-Path $root "state") -Recurse -File -Include '*.json','*.jsonl','*.log' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }

    $found = $null
    foreach ($file in $files | Select-Object -Unique) {
        try {
            $text = Get-Content -Path $file -Raw -ErrorAction Stop
        } catch { continue }
        foreach ($pat in $patterns) {
            if ($text -match [regex]::Escape($pat)) {
                $found = $pat
                return $pat
            }
        }
    }

    return $found
}

$guard = Read-GuardState
$registry = Get-RegistryStatus
$errorHint = Inspect-LocalLogsForHermeticaErrors

if ($ForceUnblock) {
    if (-not $registry.ok -or $errorHint) {
        Write-Host "Nao pode desbloquear: ainda sem evidencias positivas (registry ok + aucun erro)."
        Write-Host "registry ok: $($registry.ok), errorHint: $errorHint"
        exit 1
    }

    $guard.blocked = $false
    $guard.reason = 'manual_force_unblock'
    $guard.sourceOfBlock = 'manual_block'
    $guard.lastDetectedError = $null
    $guard.unblockedAtUtc = [datetime]::UtcNow.ToString("o")
    $guard.sinceUtc = [datetime]::UtcNow.ToString("o")
    $guard.cooldownUntilUtc = $null
    Write-GuardState -state $guard
    Write-Host "HERMETICA direct redeem desbloqueado manualmente"
    exit 0
}

if ($ForceBlock) {
    $guard.blocked = $true
    $guard.reason = 'manual_force_block'
    $guard.sourceOfBlock = 'manual_block'
    $guard.lastDetectedError = 'manual_force_block'
    $guard.sinceUtc = [datetime]::UtcNow.ToString("o")
    $guard.blockedAtUtc = [datetime]::UtcNow.ToString("o")
    $guard.unblockedAtUtc = $null
    $guard.cooldownUntilUtc = ([datetime]::UtcNow).AddMinutes($CooldownMinutes).ToString("o")
    Write-GuardState -state $guard
    Write-Host "HERMETICA direct redeem bloqueado manualmente até $($guard.cooldownUntilUtc)"
    exit 0
}

$now = [datetime]::UtcNow
$cooldownUntil = if ($guard.cooldownUntilUtc) { [datetime]::Parse($guard.cooldownUntilUtc).ToUniversalTime() } else { $null }

# Nunca desbloquear automaticamente. Apenas ForceUnblock pode desbloquear com evidencias positivas.
if ($guard.blocked) {
    Write-Host "HERMETICA direct redeem permanece BLOQUEADO (motivo: $($guard.reason), fonte: $($guard.sourceOfBlock))"
    Write-Host "blockedAtUtc: $($guard.blockedAtUtc)"
    Write-Host "cooldownUntilUtc: $($guard.cooldownUntilUtc)"
    Write-GuardState -state $guard
    exit 0
}

$needBlock = $false
$blockReason = $null
$detectedError = $null

if (-not $registry.ok) {
    $needBlock = $true
    $blockReason = 'registry_unavailable'
    $detectedError = $registry.error + ' / ' + $registry.summary
}

if (-not $needBlock -and $errorHint) {
    $needBlock = $true
    $detectedError = $errorHint
    if ($errorHint -match 'ERR_NOT_PROTOCOL') {
        $blockReason = 'err_not_protocol'
    } elseif ($errorHint -match 'missing_protocol_role') {
        $blockReason = 'missing_protocol_role'
    } else {
        $blockReason = 'error_hint_detected'
    }
}

if ($needBlock) {
    $guard.blocked = $true
    $guard.reason = $blockReason
    $guard.sourceOfBlock = switch ($blockReason) {
        'registry_unavailable' { 'registry_unavailable' }
        'err_not_protocol' { 'err_not_protocol' }
        'missing_protocol_role' { 'missing_protocol_role' }
        default { 'error_hint' }
    }
    $guard.lastDetectedError = $detectedError
    $guard.sinceUtc = [datetime]::UtcNow.ToString("o")
    $guard.blockedAtUtc = [datetime]::UtcNow.ToString("o")
    $guard.unblockedAtUtc = $null
    $guard.cooldownUntilUtc = ([datetime]::UtcNow).AddMinutes($CooldownMinutes).ToString("o")
    Write-GuardState -state $guard

    Write-Host "HERMETICA_DIRECT_REDEEM_BLOCKED = true"
    Write-Host "reason = $blockReason"
    Write-Host "sourceOfBlock = $($guard.sourceOfBlock)"
    Write-Host "lastDetectedError = $detectedError"
    Write-Host "blockedAtUtc = $($guard.blockedAtUtc)"
    Write-Host "cooldownUntilUtc = $($guard.cooldownUntilUtc)"
    Write-Host "action = USE_FALLBACK (bridge_recovery/manual_bridge_fallback)"
    exit 1
}

$guard.blocked = $false
$guard.reason = 'none'
$guard.sourceOfBlock = 'none'
$guard.lastDetectedError = $null
$guard.sinceUtc = [datetime]::UtcNow.ToString("o")
$guard.unblockedAtUtc = [datetime]::UtcNow.ToString("o")
$guard.cooldownUntilUtc = $null
Write-GuardState -state $guard

Write-Host "HERMETICA_DIRECT_REDEEM_BLOCKED = false"
Write-Host "reason = none"
Write-Host "sourceOfBlock = none"
Write-Host "action = direct_redeem_allowed"
exit 0
