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

# --- Detect first run of today (checked before Phase 1) ---
PHASE2_FIRST_RUN=0
if [ ! -f "$DATA_DIR/analysis/$TODAY.json" ]; then
    PHASE2_FIRST_RUN=1
fi

ZIP_COUNT=0
NEW_DATES=()

# --- Check env vars ---
if [ -z "${HEALTH_SYNC_URL:-}" ]; then
    echo "[$TODAY] HEALTH_SYNC_URL not set. Cannot sync."
    rm -f "$LOCK_FILE"
    exit 1
fi
if [ -z "${HEALTH_SYNC_KEY:-}" ]; then
    echo "[$TODAY] HEALTH_SYNC_KEY not set. Cannot sync."
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

# Re-check PHASE2_FIRST_RUN — relay may have deleted today's analysis
if [ ! -f "$DATA_DIR/analysis/$TODAY.json" ]; then
    PHASE2_FIRST_RUN=1
fi

if [ "$ZIP_COUNT" -eq 0 ]; then
    echo "[$TODAY] No new data to process. Skipping Phase 1, checking Phase 2 triggers..."
    # Skip Phase 1 but continue to Phase 2 and upload
    SKIP_PHASE1=1
else
    SKIP_PHASE1=0
fi

if [ "$SKIP_PHASE1" = "0" ]; then
echo "[$TODAY] Processing $ZIP_COUNT new days of data..."

# --- Run Claude Code to process extracted data ---
echo "[$TODAY] Running Claude Code analysis..."
CLAUDECODE="" claude -p "Process the health data that has been extracted to $EXTRACT_DIR. Today is $TODAY. The data root is $DATA_DIR. Follow the instructions in $REPO_DIR/processing/process-day-prompt.md. There may be data from multiple days - process each day found." \
    --dangerously-skip-permissions \
    >> "$DATA_DIR/logs/$TODAY.log" 2>&1 || echo "[$TODAY] WARNING: Claude Code exited with an error. Check log: $DATA_DIR/logs/$TODAY.log"

echo "[$TODAY] Claude Code analysis complete."

# --- Backup analysis and corrections ---
echo "[$TODAY] Backing up analysis and corrections..."
cp "$DATA_DIR/analysis/"*.json "$BACKUP_DIR/analysis/" 2>/dev/null || true
cp "$DATA_DIR/corrections/"*.json "$BACKUP_DIR/corrections/" 2>/dev/null || true

fi  # end SKIP_PHASE1

# --- Phase 2: Conditional plan generation ---
RUN_PHASE2=0

# Trigger 1: First run of today
if [ "$PHASE2_FIRST_RUN" = "1" ]; then
    RUN_PHASE2=1
    echo "[$TODAY] Phase 2 trigger: first run of the day."
fi

# Trigger 2: Goals/preferences hash changed
GOALS_HASH_PATH="$DATA_DIR/profile/goals.json"
PREFS_HASH_PATH="$DATA_DIR/profile/preferences.json"
[ -f "$EXTRACT_DIR/profile/goals.json" ] && GOALS_HASH_PATH="$EXTRACT_DIR/profile/goals.json"
[ -f "$EXTRACT_DIR/profile/preferences.json" ] && PREFS_HASH_PATH="$EXTRACT_DIR/profile/preferences.json"

CURRENT_HASH=$(cat "$GOALS_HASH_PATH" "$PREFS_HASH_PATH" 2>/dev/null | (sha256sum 2>/dev/null || shasum -a 256 2>/dev/null) | cut -d' ' -f1)
STORED_HASH=""
[ -f "$DATA_DIR/last-plan-hash.txt" ] && STORED_HASH=$(tr -d '[:space:]' < "$DATA_DIR/last-plan-hash.txt")

if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
    [ "$RUN_PHASE2" = "0" ] && echo "[$TODAY] Phase 2 trigger: goals/preferences changed."
    RUN_PHASE2=1
fi

# Trigger 3: User requested plan update or plan stale due to intake/workout deviation
if [ -f "$DATA_DIR/analysis/$TODAY.json" ]; then
    PLAN_TRIGGER=$(jq -r 'if (._planRequested == true or ._planStale == true) then "yes" else "no" end' "$DATA_DIR/analysis/$TODAY.json" 2>/dev/null || echo "no")
    if [ "$PLAN_TRIGGER" = "yes" ]; then
        [ "$RUN_PHASE2" = "0" ] && echo "[$TODAY] Phase 2 trigger: plan requested or stale."
        RUN_PHASE2=1
    fi
fi

# Trigger 4: Last plan generation was >12 hours ago or missing
PLAN_TOO_OLD=1
if [ -f "$DATA_DIR/last-plan-generation.txt" ]; then
    LAST_PLAN=$(tr -d '[:space:]' < "$DATA_DIR/last-plan-generation.txt")
    # Try GNU date first, then macOS date
    LAST_EPOCH=$(date -d "$LAST_PLAN" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$LAST_PLAN" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    AGE_HOURS=$(( (NOW_EPOCH - LAST_EPOCH) / 3600 ))
    [ "$AGE_HOURS" -lt 12 ] && PLAN_TOO_OLD=0
fi
if [ "$PLAN_TOO_OLD" = "1" ]; then
    [ "$RUN_PHASE2" = "0" ] && echo "[$TODAY] Phase 2 trigger: plan older than 12 hours or missing."
    RUN_PHASE2=1
fi

if [ "$RUN_PHASE2" = "1" ]; then
    # Guard: Phase 1 must have produced an analysis file
    if [ -f "$DATA_DIR/analysis/$TODAY.json" ]; then
        echo "[$TODAY] Running Phase 2: plan generation..."
        CLAUDECODE="" claude -p "Generate the meal plan and workout regimen for $TODAY. The data root is $DATA_DIR. The extracted data is at $EXTRACT_DIR. Follow the instructions in $REPO_DIR/processing/plan-prompt.md." \
            --dangerously-skip-permissions \
            >> "$DATA_DIR/logs/$TODAY.log" 2>&1 \
            && {
                date +"%Y-%m-%dT%H:%M:%S" > "$DATA_DIR/last-plan-generation.txt"
                echo "$CURRENT_HASH" > "$DATA_DIR/last-plan-hash.txt"
                echo "[$TODAY] Phase 2 complete - plan generation done."
            } \
            || echo "[$TODAY] WARNING: Phase 2 exited with an error. Plan may be incomplete."
    else
        echo "[$TODAY] Phase 2 skipped - no analysis file for today."
    fi
else
    echo "[$TODAY] Phase 2 skipped - plan is current."
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
