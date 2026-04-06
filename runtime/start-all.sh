#!/usr/bin/env bash
# runtime/start-all.sh — start all bots in background (Linux)
export PATH="/home/luiz/.nvm/versions/node/v20.20.2/bin:$PATH"
export NVM_DIR="/home/luiz/.nvm"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p logs state/speedy-indra workspace/deribit/state active/state/dog-mm runtime/orion/state

echo "[start-all] iniciando speedy-indra..."
nohup node runtime/speedy-indra/agent-loop.cjs --live > logs/speedy-indra.log 2>&1 &
echo $! > state/speedy-indra/speedy-indra.pid
echo "[start-all] speedy-indra PID $(cat state/speedy-indra/speedy-indra.pid)"

echo "[start-all] iniciando helper aibtc..."
nohup python3 active/tools/register_helper_server.py > logs/helper.log 2>&1 &
echo $! > state/helper.pid
echo "[start-all] helper PID $(cat state/helper.pid)"

echo "[start-all] iniciando deribit..."
nohup bash runtime/deribit-start.sh --execute > logs/deribit.log 2>&1 &
echo $! > workspace/deribit/state/deribit.pid
echo "[start-all] deribit PID $(cat workspace/deribit/state/deribit.pid)"

echo "[start-all] iniciando dog-mm..."
nohup bash runtime/dog-mm-start.sh > logs/dog-mm.log 2>&1 &
echo $! > active/state/dog-mm/dog-mm.pid
echo "[start-all] dog-mm PID $(cat active/state/dog-mm/dog-mm.pid)"

echo "[start-all] iniciando orion..."
nohup node runtime/orion/orion.cjs > logs/orion.log 2>&1 &
echo $! > runtime/orion/state/orion.pid
echo "[start-all] orion PID $(cat runtime/orion/state/orion.pid)"

echo "[start-all] todos os bots iniciados"
echo ""
echo "PIDs:"
echo "  speedy-indra : $(cat state/speedy-indra/speedy-indra.pid)"
echo "  helper       : $(cat state/helper.pid)"
echo "  deribit      : $(cat workspace/deribit/state/deribit.pid)"
echo "  dog-mm       : $(cat active/state/dog-mm/dog-mm.pid)"
echo "  orion        : $(cat runtime/orion/state/orion.pid)"
echo ""
echo "Logs em: $ROOT/logs/"
