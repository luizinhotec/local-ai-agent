#!/usr/bin/env bash
# runtime/deribit-start.sh — Linux startup script for Deribit bot
export PATH="/home/luiz/.nvm/versions/node/v20.20.2/bin:$PATH"
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT"

# ── load .env files ────────────────────────────────────────────────────────────
load_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  source "$file" 2>/dev/null || true
  set +a
}

load_env "$ROOT/.env"
load_env "$ROOT/.env.local"

# ── deribit credentials ────────────────────────────────────────────────────────
export DERIBIT_CLIENT_ID="${DERIBIT_CLIENT_ID:-StrwdvdI}"
export DERIBIT_CLIENT_SECRET="${DERIBIT_CLIENT_SECRET:-s0YU-n6hkluly24lPiZLY0_tn2PyIxvbGXXtG6wwOL8}"
export DERIBIT_ENVIRONMENT="${DERIBIT_ENVIRONMENT:-testnet}"

# ── ensure state directory exists ────────────────────────────────────────────
mkdir -p "$ROOT/workspace/deribit/state"

LOG_FILE="$ROOT/workspace/deribit/state/deribit-bot-loop.log"

# ── pass --execute and any other flags through ───────────────────────────────
EXTRA_ARGS=("$@")

echo "[deribit-start] $(date -u '+%Y-%m-%d %H:%M:%S UTC') starting deribit-bot-loop.cjs env=$DERIBIT_ENVIRONMENT"

exec node "$ROOT/workspace/deribit/runtime/deribit-bot-loop.cjs" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}" \
  >> "$LOG_FILE" 2>&1
