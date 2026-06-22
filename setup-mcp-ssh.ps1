# ===========================================================================
# Setup MCP SSH para Claude Code no Windows (PowerShell)
# Execute como usuário normal (não precisa de Administrator)
# ===========================================================================

$VPS_HOST = "185.135.137.113"
$VPS_USER = "root"
$VPS_PORT = "22"
$VPS_DEFAULT_DIR = "/root"
$CLAUDE_SETTINGS = "$env:USERPROFILE\.claude\settings.json"

Write-Host "=== Configuração do MCP SSH para VPS structa.one ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "VPS: $VPS_HOST (root)"
Write-Host ""

# Pede a senha de forma segura (sem mostrar no terminal)
$SecurePassword = Read-Host "Digite a senha SSH da VPS" -AsSecureString
$VPS_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
)

if ([string]::IsNullOrEmpty($VPS_PASSWORD)) {
    Write-Host "Senha não pode ser vazia. Abortando." -ForegroundColor Red
    exit 1
}

# Garante que o diretório .claude existe
$ClaudeDir = "$env:USERPROFILE\.claude"
if (-not (Test-Path $ClaudeDir)) {
    New-Item -ItemType Directory -Path $ClaudeDir | Out-Null
    Write-Host "Diretório $ClaudeDir criado." -ForegroundColor Green
}

# Lê o settings atual ou cria do zero
if (Test-Path $CLAUDE_SETTINGS) {
    Write-Host "Settings encontrado: $CLAUDE_SETTINGS" -ForegroundColor Yellow
    $backup = "${CLAUDE_SETTINGS}.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Copy-Item $CLAUDE_SETTINGS $backup
    Write-Host "Backup criado: $backup" -ForegroundColor Yellow
    $settings = Get-Content $CLAUDE_SETTINGS -Raw | ConvertFrom-Json
} else {
    $settings = [PSCustomObject]@{}
}

# Garante que mcpServers existe
if (-not ($settings | Get-Member -Name "mcpServers" -MemberType NoteProperty)) {
    $settings | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value ([PSCustomObject]@{})
}

# Cria a config do servidor SSH
$sshServer = [PSCustomObject]@{
    command = "npx"
    args    = @("-y", "mcp-ssh-manager")
    env     = [PSCustomObject]@{
        MCP_SSH_HOST        = $VPS_HOST
        MCP_SSH_USER        = $VPS_USER
        MCP_SSH_PASSWORD    = $VPS_PASSWORD
        MCP_SSH_PORT        = $VPS_PORT
        MCP_SSH_DEFAULT_DIR = $VPS_DEFAULT_DIR
    }
}

# Adiciona ou sobrescreve o servidor vps-structa
if ($settings.mcpServers | Get-Member -Name "vps-structa" -MemberType NoteProperty) {
    $settings.mcpServers."vps-structa" = $sshServer
} else {
    $settings.mcpServers | Add-Member -MemberType NoteProperty -Name "vps-structa" -Value $sshServer
}

# Salva o arquivo JSON
$settings | ConvertTo-Json -Depth 10 | Set-Content $CLAUDE_SETTINGS -Encoding UTF8

Write-Host ""
Write-Host "✅ MCP SSH configurado com sucesso!" -ForegroundColor Green
Write-Host ""
Write-Host "Arquivo atualizado: $CLAUDE_SETTINGS" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== Próximos passos ===" -ForegroundColor Cyan
Write-Host "1. Feche e reabra o Claude Code (desktop ou terminal)"
Write-Host "2. O MCP 'vps-structa' estará disponível automaticamente"
Write-Host "3. Claude poderá acessar sua VPS 185.135.137.113 via SSH"
Write-Host ""
