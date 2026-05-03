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
# If deployed to <data>/processing/ (normal users), parent has profile/
# If in repo at <repo>/processing/ (dev), parent/coach has profile/
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -d "$PARENT_DIR/profile" ]; then
    DATA_DIR="$PARENT_DIR"
elif [ -d "$PARENT_DIR/coach/profile" ]; then
    DATA_DIR="$PARENT_DIR/coach"
else
    echo "[watcher] ERROR: Cannot find coach data directory."
    exit 1
fi
LOCK_FILE="$DATA_DIR/processing.lock"
RATE_LIMIT_FILE="$DATA_DIR/.rate-limit-until"
TODAY=$(date +%Y-%m-%d)

# Rate-limit skip check — runs BEFORE lock acquisition and network calls.
# Corrupt/unparseable file => treat as not rate-limited and remove.
if [ -f "$RATE_LIMIT_FILE" ]; then
    RL_UNTIL_STR=$(tr -d '[:space:]' < "$RATE_LIMIT_FILE" 2>/dev/null || echo '')
    if [ -n "$RL_UNTIL_STR" ]; then
        RL_UNTIL_EPOCH=$(date -d "$RL_UNTIL_STR" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$RL_UNTIL_STR" +%s 2>/dev/null || echo 0)
        NOW_EPOCH=$(date +%s)
        if [ "$RL_UNTIL_EPOCH" -gt 0 ] && [ "$NOW_EPOCH" -lt "$RL_UNTIL_EPOCH" ]; then
            echo "[watcher] Rate limit active until $RL_UNTIL_STR. Skipping."
            exit 0
        fi
    fi
    rm -f "$RATE_LIMIT_FILE"
    echo "[watcher] Rate limit window has passed (or file unparseable). Resuming."
fi

# Post-processing: scan the processing log for rate-limit messages and, if
# found, write $RATE_LIMIT_FILE and send a Discord alert. Never fails the
# watcher due to notification issues.
check_rate_limit() {
    local proc_log="$DATA_DIR/logs/$TODAY.log"
    local start_offset="${1:-0}"
    [ -f "$proc_log" ] || return 0
    local tail_out
    # Read only bytes produced during this run so we don't match older entries.
    tail_out=$(tail -c +$((start_offset + 1)) "$proc_log" 2>/dev/null || echo '')
    if ! echo "$tail_out" | grep -qiE 'hit your limit|out of extra usage'; then
        return 0
    fi

    local reset_match raw_hour ampm hour24 now_hour reset_ymd reset_epoch iso display
    reset_match=$(echo "$tail_out" | grep -oiE 'resets[[:space:]]+[0-9]{1,2}(am|pm)' | head -n 1 || true)
    if [ -n "$reset_match" ]; then
        raw_hour=$(echo "$reset_match" | grep -oE '[0-9]{1,2}')
        ampm=$(echo "$reset_match" | grep -oiE '(am|pm)' | tr '[:upper:]' '[:lower:]')
        # 12am=0, 1am-11am=1-11, 12pm=12, 1pm-11pm=13-23
        if [ "$ampm" = "am" ]; then
            if [ "$raw_hour" = "12" ]; then hour24=0; else hour24=$raw_hour; fi
        else
            if [ "$raw_hour" = "12" ]; then hour24=12; else hour24=$(( 10#$raw_hour + 12 )); fi
        fi
        now_hour=$(date +%H); now_hour=${now_hour#0}
        # Strip leading zero so arithmetic treats it as decimal
        : "${now_hour:=0}"
        if [ "$hour24" -le "$now_hour" ]; then
            reset_ymd=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "tomorrow" +%Y-%m-%d 2>/dev/null || echo "$TODAY")
        else
            reset_ymd="$TODAY"
        fi
        iso=$(printf "%sT%02d:00:00" "$reset_ymd" "$hour24")
    else
        # Defensive fallback: no reset clause, assume 3 hours
        iso=$(date -d "+3 hours" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v+3H +%Y-%m-%dT%H:%M:%S 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)
    fi

    echo "$iso" > "$RATE_LIMIT_FILE"
    echo "[watcher] Rate limit detected. Pausing until $iso."

    local webhook_file="$HOME/.claude/discord-webhook.txt"
    if [ ! -f "$webhook_file" ]; then
        echo "[watcher] Discord webhook file not found at $webhook_file. Skipping notification."
        return 0
    fi
    display=$(echo "$iso" | sed -E 's/.*T([0-9]{2}):([0-9]{2}).*/\1:\2/')
    local webhook_url
    webhook_url=$(tr -d '[:space:]' < "$webhook_file")
    local desc="Claude Code hit the usage limit. Next run will resume after ${display}. No analysis was produced this cycle."
    local payload
    payload=$(cat <<EOF
{"username":"worker: health-tracker","embeds":[{"title":"Coach processing paused — rate limit","description":"$(echo "$desc" | sed 's/"/\\"/g')","color":15105570,"footer":{"text":"from: watcher"}}]}
EOF
)
    curl -s -X POST -H "Content-Type: application/json" --data "$payload" "$webhook_url" >/dev/null 2>&1 || \
        echo "[watcher] Discord send failed (non-fatal)."
}

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

PROC_LOG_PATH="$DATA_DIR/logs/$TODAY.log"
LOG_OFFSET_BEFORE=$([ -f "$PROC_LOG_PATH" ] && wc -c < "$PROC_LOG_PATH" | tr -d ' ' || echo 0)

PROCESS_SCRIPT="$SCRIPT_DIR/process-day.sh"
CLAUDECODE="" bash "$PROCESS_SCRIPT" || true
echo "[watcher] Processing finished."

# Scan only the new log content from this run — prior runs today may have logged
# rate-limit strings that would otherwise trigger false positives.
check_rate_limit "$LOG_OFFSET_BEFORE"

# Backlog check — catch up stale historical dates (cap 5 per tick)
CHECK_BACKLOG="$SCRIPT_DIR/../tools/check-backlog.py"
REPROCESS_BACKLOG="$SCRIPT_DIR/../tools/reprocess-backlog.py"
if [ -f "$CHECK_BACKLOG" ]; then
    STALE_COUNT=$(python3 "$CHECK_BACKLOG" --data-dir "$DATA_DIR" --quiet 2>/dev/null || echo 0)
    if [ "$STALE_COUNT" -gt 0 ] 2>/dev/null; then
        echo "[watcher] Backlog: $STALE_COUNT stale date(s). Reprocessing up to 5..."
        python3 "$REPROCESS_BACKLOG" --data-dir "$DATA_DIR" --limit 5 2>&1 || \
            echo "[watcher] Backlog reprocess failed (non-fatal)."
    fi
fi
