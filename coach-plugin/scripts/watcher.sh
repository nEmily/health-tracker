#!/usr/bin/env bash
# Health Tracker Watcher (Mac/Linux) — polls relay for pending data, runs processing if found.
# Runs every 30 min via cron. Quiet hours: midnight-8am.
#
# Environment variables:
#   HEALTH_SYNC_URL  — cloud relay URL (required)
#   HEALTH_SYNC_KEY  — cloud relay key (required)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOUR=$(date +%H); HOUR=${HOUR#0}
if [ "$HOUR" -ge 0 ] && [ "$HOUR" -lt 8 ]; then
    echo "[watcher] Quiet hours (12am-8am). Exiting."
    exit 0
fi

# Data dir: auto-detect based on script location
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -d "$PARENT_DIR/profile" ]; then
    DATA_DIR="$PARENT_DIR"
elif [ -d "$(dirname "$PARENT_DIR")/coach/profile" ]; then
    DATA_DIR="$(dirname "$PARENT_DIR")/coach"
else
    echo "[watcher] ERROR: Cannot find coach data directory."
    exit 1
fi
LOCK_FILE="$DATA_DIR/processing.lock"

# Lock file check with stale detection (>60 min)
if [ -f "$LOCK_FILE" ]; then
    FILE_MTIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || stat -c %Y "$LOCK_FILE" 2>/dev/null || date +%s)
    LOCK_AGE=$(( $(date +%s) - FILE_MTIME ))
    if [ "$LOCK_AGE" -lt 3600 ]; then
        LOCK_MIN=$(( LOCK_AGE / 60 ))
        echo "[watcher] Processing already in progress (lock file age: ${LOCK_MIN} min). Exiting."
        exit 0
    fi
    echo "[watcher] Removing stale lock file (age: $(( LOCK_AGE / 60 )) min)."
    rm -f "$LOCK_FILE"
fi

# Sync config: per-datadir sync-config.json is the ONLY source of truth.
# User-level env vars are intentionally NOT supported -- they cause cross-user
# contamination when multiple coach folders share one machine.
unset HEALTH_SYNC_URL HEALTH_SYNC_KEY
CONFIG_PATH="$DATA_DIR/sync-config.json"
if [ ! -f "$CONFIG_PATH" ]; then
    echo "[watcher] No sync config at $CONFIG_PATH. Exiting."
    exit 0
fi
HEALTH_SYNC_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_PATH','utf8')).url || '')" 2>/dev/null || python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('url',''))" 2>/dev/null)
HEALTH_SYNC_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_PATH','utf8')).key || '')" 2>/dev/null || python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('key',''))" 2>/dev/null)
if [ -z "$HEALTH_SYNC_URL" ] || [ -z "$HEALTH_SYNC_KEY" ]; then
    echo "[watcher] sync-config.json missing url or key. Exiting."
    exit 0
fi
echo "[watcher] Using sync config from $CONFIG_PATH"
export HEALTH_SYNC_URL HEALTH_SYNC_KEY

PENDING_URL="$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/pending"

RESP=$(curl -s --max-time 10 "$PENDING_URL" 2>/dev/null || echo '{}')
PENDING=$(echo "$RESP" | jq -r '.pending[]? // empty' 2>/dev/null | tr '\n' ' ' | xargs)

if [ -z "$PENDING" ]; then
    echo "[watcher] No pending data. Exiting."
    exit 0
fi

echo "[watcher] Pending dates: $PENDING. Launching processing..."

PROCESS_SCRIPT="$SCRIPT_DIR/process-day.sh"
CLAUDECODE="" bash "$PROCESS_SCRIPT"
echo "[watcher] Processing finished."

# Backlog check — catch up stale historical dates (cap 5 per tick)
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
CHECK_BACKLOG="$REPO_ROOT/tools/check-backlog.py"
REPROCESS_BACKLOG="$REPO_ROOT/tools/reprocess-backlog.py"
if [ -f "$CHECK_BACKLOG" ]; then
    STALE_COUNT=$(python3 "$CHECK_BACKLOG" --data-dir "$DATA_DIR" --quiet 2>/dev/null || echo 0)
    if [ "$STALE_COUNT" -gt 0 ] 2>/dev/null; then
        echo "[watcher] Backlog: $STALE_COUNT stale date(s). Reprocessing up to 5..."
        python3 "$REPROCESS_BACKLOG" --data-dir "$DATA_DIR" --limit 5 2>&1 || \
            echo "[watcher] Backlog reprocess failed (non-fatal)."
    fi
fi
