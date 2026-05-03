#!/usr/bin/env bash
# Health Tracker - Periodic Processing (Mac/Linux)
# Runs Claude Code to analyze health data.
# Downloads pending ZIPs from cloud relay.
#
# IMPORTANT: Never deletes raw data. Archives instead.
# IMPORTANT: Never re-processes dates that already have analysis.
#
# Environment variables:
#   HEALTH_BACKUP_DIR — path to backup dir (default: ~/health-data-backup)
#   HEALTH_SYNC_URL   — cloud relay URL (required)
#   HEALTH_SYNC_KEY   — cloud relay key (required)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Data dir: auto-detect based on script location
# If deployed to <data>/processing/ (normal users), parent has profile/
# If in repo at <repo>/processing/ (dev), parent/coach has profile/
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -d "$PARENT_DIR/profile" ]; then
    DATA_DIR="$PARENT_DIR"
    REPO_DIR="$PARENT_DIR"
elif [ -d "$PARENT_DIR/coach/profile" ]; then
    DATA_DIR="$PARENT_DIR/coach"
    REPO_DIR="$PARENT_DIR"
else
    echo "[ERROR] Cannot find coach data directory."
    exit 1
fi
BACKUP_DIR="${HEALTH_BACKUP_DIR:-$HOME/health-data-backup}"
LOCK_FILE="$DATA_DIR/processing.lock"

TODAY=$(date +%Y-%m-%d)

# --- Lock file to prevent concurrent processing ---
if [ -f "$LOCK_FILE" ]; then
    FILE_MTIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || stat -c %Y "$LOCK_FILE" 2>/dev/null || date +%s)
    LOCK_AGE=$(( $(date +%s) - FILE_MTIME ))
    if [ "$LOCK_AGE" -lt 3600 ]; then
        echo "[$TODAY] Another processing run is in progress - lock file exists. Aborting."
        exit 0
    fi
    echo "[$TODAY] Removing stale lock file (age: ${LOCK_AGE}s)."
    rm -f "$LOCK_FILE"
fi
echo "$TODAY $(date +%H:%M:%S)" > "$LOCK_FILE"

echo "[$TODAY] Starting processing run..."

# --- Create required directories ---
mkdir -p "$DATA_DIR/logs"
mkdir -p "$DATA_DIR/archive"
mkdir -p "$BACKUP_DIR/raw"
mkdir -p "$BACKUP_DIR/analysis"
mkdir -p "$BACKUP_DIR/corrections"

EXTRACT_DIR="$DATA_DIR/incoming/extracted"
mkdir -p "$EXTRACT_DIR"

ZIP_COUNT=0
NEW_DATES=()

# --- Sync config: ALWAYS load from sync-config.json in DATA_DIR.
#     Ignore any inherited env vars -- they cause cross-user contamination
#     when multiple coach folders share a machine.
unset HEALTH_SYNC_URL HEALTH_SYNC_KEY
if [ ! -f "$DATA_DIR/sync-config.json" ]; then
    echo "[$TODAY] No sync-config.json at $DATA_DIR. Cannot sync."
    rm -f "$LOCK_FILE"
    exit 1
fi
HEALTH_SYNC_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DATA_DIR/sync-config.json','utf8')).url || '')" 2>/dev/null || python3 -c "import json; print(json.load(open('$DATA_DIR/sync-config.json')).get('url',''))" 2>/dev/null)
HEALTH_SYNC_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DATA_DIR/sync-config.json','utf8')).key || '')" 2>/dev/null || python3 -c "import json; print(json.load(open('$DATA_DIR/sync-config.json')).get('key',''))" 2>/dev/null)
if [ -z "$HEALTH_SYNC_URL" ] || [ -z "$HEALTH_SYNC_KEY" ]; then
    echo "[$TODAY] sync-config.json missing url or key. Cannot sync."
    rm -f "$LOCK_FILE"
    exit 1
fi

echo "[$TODAY] Checking cloud relay for pending data..."

# Get list of pending dates
PENDING_JSON=$(curl -s "$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/pending" || echo '{}')
RELAY_DATES=$(echo "$PENDING_JSON" | jq -r '.pending[]? // empty' 2>/dev/null | tr '\n' ' ' | xargs)
# Capture gen map for race condition detection on /done
GEN_JSON=$(echo "$PENDING_JSON" | jq -c '.gen // {}' 2>/dev/null || echo '{}')

if [ -n "$RELAY_DATES" ]; then
    echo "[$TODAY] Cloud relay has pending dates: $RELAY_DATES"

    for DATE in $RELAY_DATES; do
        if [ -f "$DATA_DIR/analysis/$DATE.json" ]; then
            echo "[$TODAY] $DATE already has analysis - uploading result and marking done"
            GEN_VAL=$(echo "$GEN_JSON" | jq -r --arg d "$DATE" '.[$d] // empty' 2>/dev/null || echo '')
            GEN_PARAM=$([ -n "$GEN_VAL" ] && echo "?gen=$GEN_VAL" || echo "")
            curl -s -X POST \
                -H "Content-Type: application/json; charset=utf-8" \
                --data-binary "@$DATA_DIR/analysis/$DATE.json" \
                "$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/day/$DATE/done${GEN_PARAM}"
            echo
        else
            echo "[$TODAY] Downloading $DATE from relay..."
            if curl -sf -o "$EXTRACT_DIR/health-$DATE.zip" "$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/day/$DATE"; then
                ZIP_COUNT=$(( ZIP_COUNT + 1 ))
                NEW_DATES+=("$DATE")
                # Backup raw ZIP before processing
                cp "$EXTRACT_DIR/health-$DATE.zip" "$BACKUP_DIR/raw/"
                # Extract ZIP
                unzip -o "$EXTRACT_DIR/health-$DATE.zip" -d "$EXTRACT_DIR" >/dev/null
                # Backup extracted data by date
                mkdir -p "$BACKUP_DIR/raw/$DATE"
                cp -r "$EXTRACT_DIR/." "$BACKUP_DIR/raw/$DATE/" 2>/dev/null || true
                # Archive ZIP
                mv "$EXTRACT_DIR/health-$DATE.zip" "$DATA_DIR/archive/" 2>/dev/null || true
            else
                echo "[$TODAY] WARNING: Failed to download $DATE"
            fi
        fi
    done
else
    echo "[$TODAY] No pending data on cloud relay."
fi

if [ "$ZIP_COUNT" -eq 0 ]; then
    echo "[$TODAY] No new data to process. Checking for pending uploads..."
else
    echo "[$TODAY] Processing $ZIP_COUNT new days of data..."

    # --- Phase 1: Run orchestrator ---
    for DATE in "${NEW_DATES[@]+"${NEW_DATES[@]}"}"; do
        echo "[$TODAY] Orchestrator: processing $DATE"
        python "$REPO_DIR/processing/process_day.py" \
            --date "$DATE" \
            --data-dir "$DATA_DIR" \
            --extract-dir "$EXTRACT_DIR" \
            --backup-dir "$BACKUP_DIR" \
            >> "$DATA_DIR/logs/$TODAY.log" 2>&1 \
            || echo "[$TODAY] WARNING: orchestrator failed for $DATE. Check log: $DATA_DIR/logs/$TODAY.log"
    done
    echo "[$TODAY] Orchestrator complete."

    # --- Backup analysis and corrections ---
    echo "[$TODAY] Backing up analysis and corrections..."
    cp "$DATA_DIR/analysis/"*.json "$BACKUP_DIR/analysis/" 2>/dev/null || true
    cp "$DATA_DIR/corrections/"*.json "$BACKUP_DIR/corrections/" 2>/dev/null || true
fi

# --- Upload results back to cloud relay ---
echo "[$TODAY] Uploading analysis results to cloud relay..."
for DATE in "${NEW_DATES[@]+"${NEW_DATES[@]}"}"; do
    if [ -f "$DATA_DIR/analysis/$DATE.json" ]; then
        echo "[$TODAY] Uploading analysis for $DATE..."
        GEN_VAL=$(echo "$GEN_JSON" | jq -r --arg d "$DATE" '.[$d] // empty' 2>/dev/null || echo '')
        GEN_PARAM=$([ -n "$GEN_VAL" ] && echo "?gen=$GEN_VAL" || echo "")
        if curl -s -X POST \
            -H "Content-Type: application/json; charset=utf-8" \
            --data-binary "@$DATA_DIR/analysis/$DATE.json" \
            "$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/day/$DATE/done${GEN_PARAM}"; then
            echo "[$TODAY] Uploaded results for $DATE"
        else
            echo "[$TODAY] WARNING: Failed to upload results for $DATE"
        fi
    else
        echo "[$TODAY] WARNING: No analysis produced for $DATE - NOT marking as done."
    fi
done

# --- Clean up extracted data ---
rm -rf "$EXTRACT_DIR"

# --- Remove lock file ---
rm -f "$LOCK_FILE"

echo "[$TODAY] Processing run complete."
