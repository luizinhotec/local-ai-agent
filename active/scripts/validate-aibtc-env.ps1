Write-Host "Validacao local do ambiente AIBTC"
Write-Host ""

function Test-CommandAvailable {
    param (
        [string]$CommandName
    )

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        Write-Host "[ok] comando encontrado: $CommandName"
        return $true
    }

    Write-Host "[warn] comando nao encontrado: $CommandName"
    return $false
}

function Test-PathExists {
    param (
        [string]$TargetPath
    )

    if (Test-Path $TargetPath) {
        Write-Host "[ok] caminho encontrado: $TargetPath"
        return $true
    }

    Write-Host "[warn] caminho nao encontrado: $TargetPath"
    return $false
}

$null = Test-CommandAvailable "node"
$null = Test-CommandAvailable "npm"
$null = Test-CommandAvailable "npx"
$null = Test-CommandAvailable "git"
$codexPs = Test-CommandAvailable "codex"
$codexCmd = Test-CommandAvailable "codex.cmd"

if (-not $codexPs -and $codexCmd) {
    Write-Host "[info] use codex.cmd no PowerShell se codex.ps1 estiver bloqueado pela ExecutionPolicy"
}

Write-Host ""
Write-Host "Arquivos e pastas esperados no novo fluxo:"

$null = Test-PathExists "active/docs/AIBTC_QUICKSTART.md"
$null = Test-PathExists "active/docs/AIBTC_MCP_INSTALL.md"
$null = Test-PathExists "active/docs/AIBTC_AGENT_IDENTITY_DECISION.md"
$null = Test-PathExists "active/docs/AIBTC_AGENT_IDENTITY_CHECKLIST.md"
$null = Test-PathExists "active/docs/AIBTC_GENESIS_CLAIM_RUNBOOK.md"
$null = Test-PathExists "active/docs/AIBTC_DAILY_OPS_CHECKLIST.md"
$null = Test-PathExists "active/docs/AIBTC_HEARTBEAT_RUNBOOK.md"
$null = Test-PathExists "active/docs/AIBTC_MESSAGE_SIGNING_BRIDGE.md"
$null = Test-PathExists "active/docs/AIBTC_AGENT_PROFILE_PREP.md"
$null = Test-PathExists "active/docs/AIBTC_PLATFORM_REGISTER.md"
$null = Test-PathExists "active/docs/AIBTC_OPS_LOG_RUNBOOK.md"
$null = Test-PathExists "active/docs/AIBTC_REGISTRY_MONITOR.md"
$null = Test-PathExists "active/docs/AIBTC_REGISTER_RUNBOOK.md"
$null = Test-PathExists "active/docs/AIBTC_REGISTRATION_PREP.md"
$null = Test-PathExists "active/docs/AIBTC_SECRETS_AND_CONFIG.md"
$null = Test-PathExists "active/docs/AIBTC_AGENT_OPERATIONS.md"
$null = Test-PathExists "active/docs/WINDOWS_CODEX_AIBTC_SETUP.md"
$null = Test-PathExists "active/templates/aibtc/agent-profile.draft.json"
$null = Test-PathExists "active/templates/aibtc/agent-profile.final-suggested.json"
$null = Test-PathExists "active/templates/aibtc/agent-profile.example.json"
$null = Test-PathExists "active/templates/aibtc/agent-registration-payload.example.json"
$null = Test-PathExists "active/templates/aibtc/platform-register-request.example.json"
$null = Test-PathExists "active/templates/aibtc/platform-register-request.final-suggested.json"
$null = Test-PathExists "active/scripts/check-aibtc-mainnet-registry.ps1"
$null = Test-PathExists "active/scripts/watch-aibtc-mainnet-registry.ps1"
$null = Test-PathExists "active/scripts/show-aibtc-registry-snapshot.ps1"
$null = Test-PathExists "active/scripts/get-next-aibtc-heartbeat-window.ps1"
$null = Test-PathExists "active/scripts/start-aibtc-ops.ps1"
$null = Test-PathExists "active/scripts/watch-aibtc-ops.ps1"
$null = Test-PathExists "active/scripts/watch-aibtc-heartbeat-ready.ps1"
$null = Test-PathExists "active/scripts/repair-aibtc-local-state.ps1"
$null = Test-PathExists "active/scripts/backup-aibtc-local-state.ps1"
$null = Test-PathExists "active/scripts/restore-aibtc-local-state.ps1"
$null = Test-PathExists "active/scripts/run-aibtc-integrity-audit.ps1"
$null = Test-PathExists "active/scripts/run-aibtc-maintenance-cycle.ps1"
$null = Test-PathExists "active/scripts/export-aibtc-ops-report.ps1"
$null = Test-PathExists "active/scripts/run-aibtc-daily-check.ps1"
$null = Test-PathExists "active/scripts/prune-aibtc-local-state.ps1"
$null = Test-PathExists "active/scripts/write-aibtc-local-event.ps1"
$null = Test-PathExists "active/scripts/show-aibtc-ops-status.ps1"
$null = Test-PathExists "active/scripts/show-aibtc-ops-alerts.ps1"
$null = Test-PathExists "active/scripts/show-aibtc-ops-report.ps1"
$null = Test-PathExists "active/scripts/show-aibtc-ops-log.ps1"
$null = Test-PathExists "active/templates/codex/mcp.aibtc.example.toml"
$null = Test-PathExists "active/scripts/start-aibtc-register-helper.ps1"
$null = Test-PathExists "active/tools/aibtc-ops-dashboard.html"
$null = Test-PathExists "active/tools/aibtc-agent-console-snippets.js"
$null = Test-PathExists "active/tools/leather-register-helper.html"
$null = Test-PathExists "active/config/README.md"
$null = Test-PathExists "active/state/README.md"
$null = Test-PathExists "active/SETUP_STATUS.md"
$null = Test-PathExists "$env:USERPROFILE/.codex/config.toml"

Write-Host ""
Write-Host "Checklist recomendado:"
Write-Host "1. ler active/docs/AIBTC_QUICKSTART.md"
Write-Host "2. ler active/docs/AIBTC_MCP_INSTALL.md"
Write-Host "3. revisar active/docs/AIBTC_AGENT_PROFILE_PREP.md"
Write-Host "4. revisar active/docs/AIBTC_AGENT_IDENTITY_DECISION.md"
Write-Host "5. revisar active/docs/AIBTC_AGENT_IDENTITY_CHECKLIST.md"
Write-Host "6. revisar active/docs/AIBTC_GENESIS_CLAIM_RUNBOOK.md"
Write-Host "7. revisar active/docs/AIBTC_HEARTBEAT_RUNBOOK.md"
Write-Host "8. revisar active/docs/AIBTC_MESSAGE_SIGNING_BRIDGE.md"
Write-Host "9. revisar active/docs/AIBTC_PLATFORM_REGISTER.md"
Write-Host "10. revisar active/docs/AIBTC_REGISTER_RUNBOOK.md"
Write-Host "11. revisar active/docs/AIBTC_REGISTRY_MONITOR.md"
Write-Host "12. revisar active/docs/AIBTC_OPS_LOG_RUNBOOK.md"
Write-Host "13. revisar active/docs/AIBTC_REGISTRATION_PREP.md"
Write-Host "14. revisar active/docs/AIBTC_SECRETS_AND_CONFIG.md"
Write-Host "15. preencher active/SETUP_STATUS.md"
