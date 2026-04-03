#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/github-sync.log"
RESULTS_GLOB="active/state/dog-mm/results*.json"

mkdir -p "$LOG_DIR"

log() {
    local ts
    ts="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    local line="[$ts] $1"
    echo "$line"
    echo "$line" >> "$LOG_FILE"
}

cd "$REPO_ROOT"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "github-push-results: START ($TIMESTAMP)"

# Stage only results files — never wallet state, secrets or ops logs
git add -- $RESULTS_GLOB 2>&1 | while IFS= read -r line; do log "add: $line"; done || true

STAGED="$(git diff --cached --name-only)"

if [ -z "$STAGED" ]; then
    log "no results files staged — nothing to push"
    log "github-push-results: END"
    exit 0
fi

log "staged:"
echo "$STAGED" | while IFS= read -r f; do log "  $f"; done

COMMIT_MSG="results: dog-mm cycle $TIMESTAMP"

git commit -m "$COMMIT_MSG" 2>&1 | while IFS= read -r line; do log "commit: $line"; done
log "commit OK: $COMMIT_MSG"

git push origin main 2>&1 | while IFS= read -r line; do log "push: $line"; done
log "push OK -> origin main"

log "github-push-results: END"
