#!/usr/bin/env bash
# runtime/dog-mm-start.sh — Linux startup script for DOG-MM safe loop
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT"

# ── load .env files ────────────────────────────────────────────────────────────
load_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == *=* ]]; then
      local key="${line%%=*}"
      local val="${line#*=}"
      val="${val#\'}" ; val="${val%\'}"
      val="${val#\"}" ; val="${val%\"}"
      [[ -z "${!key+x}" ]] && export "$key=$val"
    fi
  done < "$file"
}

load_env "$ROOT/.env"
load_env "$ROOT/.env.local"

# ── ensure directories ────────────────────────────────────────────────────────
mkdir -p "$ROOT/active/state/dog-mm"
mkdir -p "$ROOT/logs"

LOCK_FILE="$ROOT/active/state/dog-mm/dog-mm-cycle.lock"
LOG_FILE="$ROOT/active/state/dog-mm/dog-mm-safe-loop.log"

INTERVAL=300   # seconds between cycles

log() {
  local ts
  ts="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

# ── build args from env vars ──────────────────────────────────────────────────
build_args() {
  local args=()

  [[ -n "${DOG_MM_WALLET_NAME:-}"                      ]] && args+=(--wallet-name "$DOG_MM_WALLET_NAME")
  [[ -n "${DOG_MM_WALLET_ID:-}"                        ]] && args+=(--wallet-id "$DOG_MM_WALLET_ID")
  [[ -n "${DOG_MM_EXPECTED_ADDRESS:-}"                 ]] && args+=(--expected-address "$DOG_MM_EXPECTED_ADDRESS")
  [[ -n "${DOG_MM_AMOUNT_IN:-}"                        ]] && args+=(--amount-in "$DOG_MM_AMOUNT_IN")
  [[ -n "${DOG_MM_AMM_STRATEGY:-}"                     ]] && args+=(--amm-strategy "$DOG_MM_AMM_STRATEGY")
  [[ -n "${DOG_MM_PREFERRED_AMM:-}"                    ]] && args+=(--preferred-amm "$DOG_MM_PREFERRED_AMM")
  [[ -n "${DOG_MM_SLIPPAGE_TOLERANCE:-}"               ]] && args+=(--slippage-tolerance "$DOG_MM_SLIPPAGE_TOLERANCE")
  [[ -n "${DOG_MM_INPUT_TOKEN:-}"                      ]] && args+=(--input-token "$DOG_MM_INPUT_TOKEN")
  [[ -n "${DOG_MM_OUTPUT_TOKEN:-}"                     ]] && args+=(--output-token "$DOG_MM_OUTPUT_TOKEN")
  [[ -n "${DOG_MM_INPUT_TOKEN_DECIMALS:-}"             ]] && args+=(--input-token-decimals "$DOG_MM_INPUT_TOKEN_DECIMALS")
  [[ -n "${DOG_MM_OUTPUT_TOKEN_DECIMALS:-}"            ]] && args+=(--output-token-decimals "$DOG_MM_OUTPUT_TOKEN_DECIMALS")
  [[ -n "${DOG_MM_INPUT_TOKEN_USD:-}"                  ]] && args+=(--input-token-usd "$DOG_MM_INPUT_TOKEN_USD")
  [[ -n "${DOG_MM_OUTPUT_TOKEN_USD:-}"                 ]] && args+=(--output-token-usd "$DOG_MM_OUTPUT_TOKEN_USD")
  [[ -n "${DOG_MM_STX_USD:-}"                          ]] && args+=(--stx-usd "$DOG_MM_STX_USD")
  [[ -n "${DOG_MM_SAFE_MAX_AMOUNT_IN:-}"               ]] && args+=(--max-amount-in "$DOG_MM_SAFE_MAX_AMOUNT_IN")
  [[ -n "${DOG_MM_SAFE_MAX_SLIPPAGE_TOLERANCE:-}"      ]] && args+=(--max-slippage-tolerance "$DOG_MM_SAFE_MAX_SLIPPAGE_TOLERANCE")
  [[ -n "${DOG_MM_SAFE_MAX_FEE:-}"                     ]] && args+=(--max-fee "$DOG_MM_SAFE_MAX_FEE")
  [[ -n "${DOG_MM_SAFE_MAX_ROUTE_HOPS:-}"              ]] && args+=(--max-route-hops "$DOG_MM_SAFE_MAX_ROUTE_HOPS")
  [[ -n "${DOG_MM_SAFE_MIN_OUTPUT_RATIO:-}"            ]] && args+=(--min-output-ratio "$DOG_MM_SAFE_MIN_OUTPUT_RATIO")
  [[ -n "${DOG_MM_SAFE_MAX_FEE_PER_BYTE:-}"            ]] && args+=(--max-fee-per-byte "$DOG_MM_SAFE_MAX_FEE_PER_BYTE")
  [[ -n "${DOG_MM_PROFIT_ENFORCEMENT:-}"               ]] && args+=(--profit-enforcement "$DOG_MM_PROFIT_ENFORCEMENT")
  [[ -n "${DOG_MM_MIN_NET_PROFIT_USD:-}"               ]] && args+=(--min-net-profit-usd "$DOG_MM_MIN_NET_PROFIT_USD")
  [[ -n "${DOG_MM_MIN_WORST_CASE_NET_PROFIT_USD:-}"    ]] && args+=(--min-worst-case-net-profit-usd "$DOG_MM_MIN_WORST_CASE_NET_PROFIT_USD")
  [[ -n "${DOG_MM_MIN_NET_PROFIT_BPS:-}"               ]] && args+=(--min-net-profit-bps "$DOG_MM_MIN_NET_PROFIT_BPS")
  [[ -n "${DOG_MM_MAX_FEE_AS_PERCENT_OF_GROSS_PROFIT:-}" ]] && args+=(--max-fee-as-percent-of-gross-profit "$DOG_MM_MAX_FEE_AS_PERCENT_OF_GROSS_PROFIT")

  echo "${args[@]+"${args[@]}"}"
}

# ── cleanup lock on exit ──────────────────────────────────────────────────────
cleanup() {
  [[ -f "$LOCK_FILE" ]] && rm -f "$LOCK_FILE"
  log "dog-mm-start: stopped"
}
trap cleanup EXIT INT TERM

# ── main loop ─────────────────────────────────────────────────────────────────
log "dog-mm-start: loop started (interval=${INTERVAL}s)"

cycle=0
while true; do
  cycle=$(( cycle + 1 ))
  log "--- cycle $cycle ---"

  if [[ -f "$LOCK_FILE" ]]; then
    log "skip: lock_active ($LOCK_FILE exists)"
  else
    # create lock
    echo "$$" > "$LOCK_FILE"

    # build CLI args from env vars
    read -ra CMD_ARGS <<< "$(build_args)"

    log "running: npm run dog-mm:safe -- ${CMD_ARGS[*]+"${CMD_ARGS[*]}"}"
    set +e
    npm run dog-mm:safe -- "${CMD_ARGS[@]+"${CMD_ARGS[@]}"}" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    set -e

    # remove lock
    rm -f "$LOCK_FILE"

    log "cycle $cycle done (exit=$EXIT_CODE)"
  fi

  log "sleeping ${INTERVAL}s..."
  sleep "$INTERVAL"
done
