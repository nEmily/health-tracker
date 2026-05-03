# /process-day -- Process a Day's Health Data

Run the full processing pipeline: download from relay, analyze food/workouts, generate plans, upload results back. Shows progress at each step.

## Usage
```
/process-day          # Process today
/process-day 2026-02-10  # Process a specific date
```

## Pipeline

Execute these steps in order. Print a progress line before each step so the user can follow along.

### Step 0: Setup

Determine the date to process (argument or today). Set up paths:
- `DATA_DIR` = current working directory (the coach data folder)
- `CLAUDE_PLUGIN_ROOT` = the coach-plugin directory (set by Claude Code when the plugin is active)
- `EXTRACT_DIR` = `$DATA_DIR/incoming/extracted`
- `BACKUP_DIR` = `$HEALTH_BACKUP_DIR` (default: `~/health-data-backup`)

Create directories if missing: `$DATA_DIR/logs`, `$DATA_DIR/archive`, `$DATA_DIR/analysis`, `$BACKUP_DIR/raw`, `$BACKUP_DIR/analysis`, `$BACKUP_DIR/corrections`, `$EXTRACT_DIR`.

Print: `Processing {DATE}...`

### Step 1: Lock check

Check if `$DATA_DIR/processing.lock` exists.

- If it exists and is **less than 60 minutes old**: another run (likely the watcher) is active. Print: `Skipping -- the watcher is currently processing. Try again in a few minutes.` and **stop here**.
- If it exists and is **older than 60 minutes**: it's stale. Remove it and continue.
- If it doesn't exist: continue.

Create the lock file (write the current date and time into it).

**Important:** Always clean up the lock file at the end, whether processing succeeds or fails. Use a try/finally approach -- if any step errors, still remove the lock before stopping.

Print: `Lock acquired`

### Step 2: Download from relay

Requires `$HEALTH_SYNC_URL` and `$HEALTH_SYNC_KEY` environment variables. If either is missing, print a warning and skip to Step 3 (check local data).

Fetch `$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/pending` to get the list of pending dates.

For each pending date:
1. Download the ZIP: `$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/day/{DATE}`
2. If an analysis file already exists for that date, **keep it** -- Phase 1 will merge the new data into it, preserving calorie/macro estimates for entries whose photos have already been analyzed. Never delete an existing analysis file just because the relay has new data.
3. Back up the raw ZIP to `$BACKUP_DIR/raw/`
4. Extract the ZIP into `$EXTRACT_DIR`
5. Back up the extracted data to `$BACKUP_DIR/raw/{DATE}/`
6. Move the ZIP to `$DATA_DIR/archive/`

Print: `Downloaded {N} day(s) from relay: {dates}` or `No pending data on relay`

### Step 3: Check for unprocessed local data

If nothing was downloaded, check if `$EXTRACT_DIR/daily/` has any date folders without corresponding analysis files. If yes, those need processing. If no new downloads AND no unprocessed local data, skip to Step 5 (Phase 2 check).

### Step 4: Run orchestrator

Run the Python orchestrator for the date being processed:

```bash
python "$REPO_DIR/processing/process_day.py" \
    --date "$DATE" \
    --data-dir "$DATA_DIR" \
    --extract-dir "$EXTRACT_DIR" \
    --backup-dir "$BACKUP_DIR"
```

Where `$REPO_DIR` is the health-tracker repo root (the parent of `processing/`). The orchestrator handles all analysis: entry-level food analysis, totals, goals, highlights, meal plan generation, and regimen updates.

Key output:
- Writes analysis JSON to `$DATA_DIR/analysis/{DATE}.json`

After the orchestrator completes, back up: copy analysis files to `$BACKUP_DIR/analysis/`.

Print: `Processing complete for {DATE}`

### Step 5: Upload check

The orchestrator writes the analysis file. Proceed to Step 6 (upload).

### Step 6: Upload results to relay

For each analysis file that is new or modified (no `.uploaded` marker, or analysis is newer than the marker):
1. POST the JSON to `$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/day/{DATE}/done`
2. On success, write an `.uploaded` marker file next to the analysis

Print: `Uploaded {N} analysis file(s)` or `All results already synced`

### Step 7: Cleanup

- Remove extracted data (`$EXTRACT_DIR`)
- Remove the lock file
- Clean up `.uploaded` markers older than 30 days

Print: `Done! Results will appear on your phone shortly.`

## Key rules (see prompts for full details)
- **Never re-analyze a photo that has already been analyzed.** When relay has new data for a date with existing analysis, merge: preserve existing entry analyses by `id`, analyze only new entries, drop entries whose `id` no longer exists in log.json. To force a full re-analysis, manually delete the analysis file first.
- **Never delete raw data** -- archive instead
- **Corrections are ground truth** -- `corrections/{DATE}.json` overrides AI estimates
- **`fitness_checked`/`fitness_notes` in log.json = workout happened**
- **Goal targets come from `profile/goals.json`** -- never hardcode
- **Never hand-edit analysis JSONs.** Update profile files and reprocess instead.
- **No em dashes or smart quotes in JSON output** -- causes garbled text on the phone
