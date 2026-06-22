#!/bin/bash
# ===========================================================================
# Script de configuração do MCP SSH para acesso à VPS via Claude Code
# Execute este script NO SEU PC EM CASA (onde roda o Claude Code local)
# ===========================================================================

VPS_HOST="185.135.137.113"
VPS_USER="root"
VPS_PORT="22"
VPS_DEFAULT_DIR="/root"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "=== Configuração do MCP SSH para VPS structa.one ==="
echo ""
echo "VPS: $VPS_HOST (root)"
echo ""

# Pede a senha
read -rsp "Digite a senha SSH da VPS: " VPS_PASSWORD
echo ""

if [ -z "$VPS_PASSWORD" ]; then
  echo "Senha não pode ser vazia. Abortando."
  exit 1
fi

# Garante que o diretório .claude existe
mkdir -p "$HOME/.claude"

# Lê o arquivo de settings atual ou cria um novo
if [ -f "$CLAUDE_SETTINGS" ]; then
  echo "Settings atual encontrado em: $CLAUDE_SETTINGS"
  # Faz backup
  cp "$CLAUDE_SETTINGS" "${CLAUDE_SETTINGS}.backup.$(date +%Y%m%d_%H%M%S)"
  echo "Backup criado."
else
  echo "{}" > "$CLAUDE_SETTINGS"
fi

# Usa Python para merge seguro do JSON (evita sobrescrever outras configs)
python3 - <<PYEOF
import json, sys

settings_path = "$CLAUDE_SETTINGS"
vps_password = """$VPS_PASSWORD"""

with open(settings_path, 'r') as f:
    settings = json.load(f)

if 'mcpServers' not in settings:
    settings['mcpServers'] = {}

settings['mcpServers']['vps-structa'] = {
    "command": "npx",
    "args": ["-y", "mcp-ssh-manager"],
    "env": {
        "MCP_SSH_HOST": "$VPS_HOST",
        "MCP_SSH_USER": "$VPS_USER",
        "MCP_SSH_PASSWORD": vps_password,
        "MCP_SSH_PORT": "$VPS_PORT",
        "MCP_SSH_DEFAULT_DIR": "$VPS_DEFAULT_DIR"
    }
}

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)

print("✅ MCP SSH configurado com sucesso!")
PYEOF

echo ""
echo "=== Configuração concluída ==="
echo ""
echo "Para ativar, reinicie o Claude Code."
echo ""
echo "No Claude Code, você verá o MCP 'vps-structa' disponível."
echo "Comandos úteis que Claude poderá executar na VPS:"
echo "  - Listar arquivos: ls /var/www/html"
echo "  - Ver logs: tail -f /var/log/nginx/access.log"
echo "  - Verificar serviços: systemctl status nginx"
echo "  - Encontrar dashboards: find / -name '*.html' 2>/dev/null"
echo ""
