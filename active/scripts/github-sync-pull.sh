#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/github-sync.log"
STATE_DIR="$REPO_ROOT/active/state"
LAST_UPDATE_FILE="$STATE_DIR/last-update.json"

mkdir -p "$LOG_DIR"
mkdir -p "$STATE_DIR"

log() {
    local ts
    ts="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    local line="[$ts] $1"
    echo "$line"
    echo "$line" >> "$LOG_FILE"
}

cd "$REPO_ROOT"

log "github-sync-pull: START"

git fetch origin 2>&1 | while IFS= read -r line; do log "fetch: $line"; done

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

log "local  HEAD: $LOCAL_HEAD"
log "remote HEAD: $REMOTE_HEAD"

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
    log "already up to date — skipping pull"
    log "github-sync-pull: END"
    exit 0
fi

log "changes detected — pulling origin main"

git pull origin main 2>&1 | while IFS= read -r line; do log "pull: $line"; done

NEW_HEAD="$(git rev-parse HEAD)"
log "new HEAD: $NEW_HEAD"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
cat > "$LAST_UPDATE_FILE" <<EOF
{
  "updatedAtUtc": "$TIMESTAMP",
  "previousHead": "$LOCAL_HEAD",
  "newHead": "$NEW_HEAD",
  "source": "github-sync-pull"
}
EOF

log "last-update.json written: $TIMESTAMP"
log "github-sync-pull: END"
