# iCloud for Windows Setup

## 1. Install iCloud for Windows

Download from the Microsoft Store or [apple.com](https://support.apple.com/en-us/HT204283).

Sign in with your Apple ID.

## 2. Enable iCloud Drive

In iCloud settings, check **iCloud Drive**. This creates a local folder that syncs with your iPhone.

Default location: `C:\Users\<username>\iCloudDrive\`

## 3. Create the HealthTracker folder structure

Open a terminal and run:

```bash
mkdir -p ~/iCloudDrive/HealthTracker/{daily,progress,analysis,sleep,profile,processing-logs}
```

## 4. Copy seed profile files

```bash
cp processing/seed/*.json ~/iCloudDrive/HealthTracker/profile/
```

Then edit the files in `~/iCloudDrive/HealthTracker/profile/` to set your personal goals:

- **goals.json** — calorie target, macro targets, water goal, weight goal
- **preferences.json** — dietary restrictions, cooking level, meal plan prefs
- **regimen.json** — your workout plan
- **measurements.json** — body measurements (optional)

## 5. Set up Task Scheduler for nightly processing

1. Open **Task Scheduler** (search in Start menu)
2. Click **Create Basic Task**
3. Name: `Health Tracker Nightly`
4. Trigger: **Daily** at **11:00 PM**
5. Action: **Start a program**
   - Program: `C:\Users\<username>\projects\health-tracker\processing\process-day.bat`
   - Start in: `C:\Users\<username>\projects\health-tracker`
6. Finish

The task runs Claude Code CLI to analyze your daily log and write results to the analysis folder.

## 6. Verify sync

1. On your iPhone, open Files app → iCloud Drive → HealthTracker
2. You should see the folder structure
3. After exporting a day from the PWA, verify the ZIP appears in iCloud Drive
4. After Claude processes, verify `analysis/YYYY-MM-DD/summary.json` appears
