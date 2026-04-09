# Processing Setup

The processing pipeline runs on your computer every 30 minutes. It downloads new health data from the relay, runs Claude Code to analyze photos and generate recommendations, and uploads results back to the relay so your phone can sync them.

---

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and authenticated (`claude --version` should work)
- A cloud relay URL and sync key — see [relay-setup.md](relay-setup.md)

---

## Environment Variables

Set these as persistent environment variables (user-level, not system-level):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HEALTH_SYNC_URL` | Yes | — | Relay URL, e.g. `https://health-sync.example.workers.dev` |
| `HEALTH_SYNC_KEY` | Yes | — | Your UUID sync key |
| `HEALTH_BACKUP_DIR` | No | `~/health-data-backup` | Local backup destination |

The data directory is automatically derived as `<repo>/coach` — no environment variable needed.

**Windows (PowerShell, run once):**

```powershell
[System.Environment]::SetEnvironmentVariable("HEALTH_SYNC_URL", "https://your-worker.workers.dev", "User")
[System.Environment]::SetEnvironmentVariable("HEALTH_SYNC_KEY", "your-uuid-here", "User")
```

**Mac/Linux (add to `~/.zshrc` or `~/.bashrc`):**

```bash
export HEALTH_SYNC_URL="https://your-worker.workers.dev"
export HEALTH_SYNC_KEY="your-uuid-here"
```

---

## Profile Setup

The processor uses a profile to personalize analysis. The coach folder (your CWD when running `coach`) is the data directory. Copy the templates and fill them in:

```bash
# Mac/Linux — run from your coach data folder (e.g. ~/coach)
mkdir -p profile
cp /path/to/health-tracker/processing/templates/*.json profile/
cp /path/to/health-tracker/processing/profiles/example-bio.txt profile/bio.txt
```

```powershell
# Windows — run from your coach data folder (e.g. %USERPROFILE%\coach)
New-Item -ItemType Directory -Force profile
Copy-Item health-tracker\processing\templates\*.json profile\
Copy-Item health-tracker\processing\profiles\example-bio.txt profile\bio.txt
```

Edit `bio.txt` with your personal details (age, height, weight, dietary restrictions, goals). Edit the JSON files to set your calorie targets, workout regimen, and preferences.

---

## Windows Setup

**Test manually first:**

```powershell
cd processing
.\process-day.bat
```

Check the `logs\` folder in your coach data directory for output. If it shows "No pending data on cloud relay", setup is working.

**Automate with Task Scheduler (run once, elevated PowerShell):**

```powershell
cd processing
powershell -ExecutionPolicy Bypass -File setup-task.ps1
```

This registers a `CoachWatcher` task that runs every 30 minutes. Verify it in Task Scheduler (`taskschd.msc`).

---

## Mac/Linux Setup

**Test manually first:**

```bash
cd processing
bash process-day.sh
```

Check the `logs/` folder in your coach data directory for output.

**Automate with cron:**

```bash
cd processing
bash setup-cron.sh
```

This adds a cron job running `watcher.sh` every 30 minutes. Verify with `crontab -l`.

---

## Checking Logs

Logs are written per day to `logs/YYYY-MM-DD.log` inside your coach data folder (CWD).

```bash
# Mac/Linux — tail today's log (run from your coach data folder)
tail -f "logs/$(date +%Y-%m-%d).log"
```

```powershell
# Windows — view today's log (run from your coach data folder)
Get-Content "logs\$(Get-Date -Format yyyy-MM-dd).log" -Wait
```

---

## Troubleshooting

**"HEALTH_SYNC_URL not set"** — environment variables aren't loaded. On Windows, open a new terminal after setting them. On Mac/Linux, `source ~/.zshrc` or open a new shell.

**"No pending data on cloud relay"** — normal if no new data has been uploaded from your phone. Log something in the app and tap Sync, then run processing again.

**Claude Code exits with error** — check the log file. Common causes: Claude isn't authenticated (`claude login`), or the prompt file is missing (`processing/process-day-prompt.md`).

**Analysis not appearing on phone** — open the app, go to Settings → Cloud Sync → Check for Results.

---

## Manual Processing with Claude Code

You can also process a day manually using the `/process-day` Claude skill:

```bash
cd /path/to/health-tracker
claude
# Then type: /process-day
# Or for a specific date: /process-day 2026-03-15
```

The skill reads `processing/process-day-prompt.md` for all processing rules. It handles downloading from the relay, analyzing photos, estimating calories, generating meal plans and workout regimen, and uploading results back.

---

## What Gets Synced

The phone uploads a ZIP for each day containing:

- `daily/{date}/log.json` — all entries (meals, workouts, water, weight, supplements, vices)
- `daily/{date}/photos/` — meal photos for AI analysis
- `progress/{date}/` — body progress photos (face, body, arms, etc.)
- `profile/goals.json` — calorie/macro/water targets
- `profile/pwa-profile.json` — full profile (goals, supplements, body photo types)

The processor outputs a single `analysis/{date}.json` that syncs back to the phone with:
- Calorie/macro estimates for each meal
- Daily totals vs goals
- Highlights and forward-looking tips
- 3-day meal plan
- Workout regimen with weekly review
- Coach responses to user messages
