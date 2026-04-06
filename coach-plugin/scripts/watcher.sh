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

if [ -z "${HEALTH_SYNC_URL:-}" ] || [ -z "${HEALTH_SYNC_KEY:-}" ]; then
    echo "[watcher] HEALTH_SYNC_URL or HEALTH_SYNC_KEY not set. Exiting."
    exit 0
fi

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
