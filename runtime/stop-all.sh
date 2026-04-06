#!/usr/bin/env bash
# runtime/stop-all.sh — gracefully stop all bots (Linux)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GRACEFUL_WAIT=5   # seconds to wait after SIGTERM before SIGKILL

# Map: display_name -> pid_file
declare -A BOTS=(
  ["speedy-indra"]="state/speedy-indra/speedy-indra.pid"
  ["deribit"]="workspace/deribit/state/deribit.pid"
  ["dog-mm"]="active/state/dog-mm/dog-mm.pid"
  ["orion"]="runtime/orion/state/orion.pid"
)

stop_bot() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "[stop-all] $name: no pid file ($pid_file) — skipping"
    return
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"

  if [[ -z "$pid" ]]; then
    echo "[stop-all] $name: pid file empty — removing"
    rm -f "$pid_file"
    return
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[stop-all] $name: PID $pid not running — removing pid file"
    rm -f "$pid_file"
    return
  fi

  echo "[stop-all] $name: sending SIGTERM to PID $pid..."
  kill -TERM "$pid" 2>/dev/null || true

  # Wait up to GRACEFUL_WAIT seconds for clean exit
  local waited=0
  while kill -0 "$pid" 2>/dev/null && (( waited < GRACEFUL_WAIT )); do
    sleep 1
    (( waited++ ))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "[stop-all] $name: still alive after ${GRACEFUL_WAIT}s — sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
  else
    echo "[stop-all] $name: stopped cleanly"
  fi

  rm -f "$pid_file"
}

echo "[stop-all] parando todos os bots..."

# Stop in reverse order (orion first — supervisor, then workers)
stop_bot "orion"        "${BOTS["orion"]}"
stop_bot "dog-mm"       "${BOTS["dog-mm"]}"
stop_bot "deribit"      "${BOTS["deribit"]}"
stop_bot "speedy-indra" "${BOTS["speedy-indra"]}"

if [ -f state/helper.pid ]; then
  PID=$(cat state/helper.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "[stop-all] helper: sending SIGTERM to PID $PID..."
    kill -TERM "$PID"
    sleep 2
    kill -0 "$PID" 2>/dev/null && kill -KILL "$PID"
    echo "[stop-all] helper: stopped"
  else
    echo "[stop-all] helper: PID $PID not running — removing pid file"
  fi
  rm -f state/helper.pid
fi

# Also clean up any stale lock files
LOCK_FILE="$ROOT/active/state/dog-mm/dog-mm-cycle.lock"
if [[ -f "$LOCK_FILE" ]]; then
  echo "[stop-all] removing stale lock: $LOCK_FILE"
  rm -f "$LOCK_FILE"
fi

echo "[stop-all] concluido"
