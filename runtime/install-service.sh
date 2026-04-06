#!/bin/bash
set -e
REPO="/home/luiz/projetos/local-ai-agent"
sudo cp "$REPO/runtime/local-ai-agent.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable local-ai-agent
sudo systemctl start local-ai-agent
echo "Servico instalado e iniciado"
echo "Para verificar: sudo systemctl status local-ai-agent"
