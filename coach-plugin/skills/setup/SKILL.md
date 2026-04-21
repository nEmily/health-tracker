# /setup -- Set Up Coach for a New User

One-command setup that creates the Coach project folder, installs the terminal alias, configures cloud sync, sets up automated processing, and runs an interactive onboarding conversation to set personalized goals.

## Usage

```
/setup                # Full guided setup (new user)
/setup reset          # Re-run onboarding (existing user)
```

## What It Creates

Everything lives in the current directory (the user should `mkdir coach && cd coach` first).

**IMPORTANT:** The coach folder must NOT be inside `~/.claude/` or any `.claude/` directory. Analysis files are written frequently during processing, and Claude treats `.claude/` as its own config space -- it will prompt for permission on every write. Use a top-level directory like `~/coach`. If the current directory is inside `.claude/`, warn the user and suggest they move it.

Structure:

```
./
├── CLAUDE.md          — Coach brain (loads personality + data on every session)
├── USER.md            — This user's stats, goals, challenges (written during onboarding)
├── conversations.md   — Chat history from the app (built by processing)
├── profile/           — goals.json, preferences.json, regimen.json, identity.md, skincare.json, current-stats.json (computed)
├── analysis/          — Daily analysis JSONs (populated by processing)
├── logs/              — Processing logs
├── processing/        — Watcher + process-day scripts, conversation builder
└── .claude/           — Skills, memory
```

## How to Communicate During Setup

**Explain each step in plain language before doing it.** Give the user a chance to say yes or skip. Don't dump technical details unless they ask — but be ready to explain if they're curious.

Example flow:
- "I'll set up some folders to keep your data organized."
- "I'm going to create a private sync key so your phone and this computer can talk to each other securely. Your data stays between them."
- "I can add a shortcut so you just type `coach` from any terminal to start a session — would you like that?"
- "I can also set up automatic processing so I check your food photos every 30 minutes and send analysis back to your phone. Sound good?"

If the user says no to something, skip it and move on. They can always set it up later.

## Steps

### 1. Create the folder structure

```bash
mkdir -p .claude/skills .claude/memory profile analysis logs processing
```

If the directory already has data (profile/, analysis/), this is a re-setup — skip creation.

**Write `.claude/settings.json` FIRST** — before any other file operations. This grants Coach permission to read/write files and run setup commands without per-action prompts. The user will be asked to approve this one file, and everything after that flows without interruption.
```json
{
  "permissions": {
    "allow": [
      "Read(.)",
      "Edit(.)",
      "Write(.)",
      "Bash(mkdir -p *)",
      "Bash(cp *processing*)",
      "Bash(uuidgen*)",
      "Bash(python3 -c \"import uuid*)",
      "Bash(crontab *)",
      "Bash(curl -s*health-sync*)"
    ]
  }
}
```

### 2. Write CLAUDE.md

Copy from the plugin:
- Source: `${CLAUDE_PLUGIN_ROOT}/CLAUDE.md`

The CLAUDE.md defines HOW Coach operates — data location, session behavior, and what files to read. The coach personality is inlined in the agent prompt (`agents/coach.md`) and does not require a separate SOUL.md file. Read CLAUDE.md to understand Coach's operating rules before proceeding.

### 3. Install the `coach` alias

Detect the user's shell and add the alias. The alias should cd to the coach folder (current directory) and start Claude.

**PowerShell (Windows):**
```powershell
$coachDir = (Get-Location).Path
if (-not (Test-Path (Split-Path $PROFILE))) { New-Item -ItemType Directory -Path (Split-Path $PROFILE) -Force | Out-Null }
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE | Out-Null }
if (-not (Get-Content $PROFILE -ErrorAction SilentlyContinue | Select-String 'function coach')) {
    Add-Content $PROFILE "`nfunction coach { Set-Location '$coachDir'; claude }"
}
```

**Mac/Linux (write to BOTH .bashrc and .zshrc):**
```bash
COACH_DIR="$(pwd)"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if ! grep -q 'alias coach=' "$rc" 2>/dev/null; then
        echo "alias coach=\"cd '$COACH_DIR' && claude\"" >> "$rc"
    fi
done
```

Tell the user: "Open a new terminal and type `coach` to start a session."

### 4. Configure cloud sync

The relay URL is shared (all users use the same Cloudflare Worker). The user only needs a sync key.

**Relay URL constant** (used in all commands below):
```
RELAY_URL = https://health-sync.emilyn-90a.workers.dev
```
Note: all users share this relay. Data is isolated by sync key.

**Generate a sync key yourself** — the user should NOT have to do this. Coach generates the UUID via Bash and shows it to the user:
```bash
# Bash (fallback chain: uuidgen → python3 → openssl)
key=$(uuidgen 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || openssl rand -hex 16 | sed 's/\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)/\1-\2-\3-\4-/')
if [ -z "$key" ]; then echo "ERROR: Could not generate UUID. Install uuidgen or python3."; exit 1; fi
echo "$key"
```

**Set environment variables** (sync credentials only — data dir is derived from repo location):

PowerShell (Windows):
```powershell
[System.Environment]::SetEnvironmentVariable("HEALTH_SYNC_URL", "https://health-sync.emilyn-90a.workers.dev", "User")
[System.Environment]::SetEnvironmentVariable("HEALTH_SYNC_KEY", "$key", "User")
```

Mac/Linux — write to BOTH .bashrc and .zshrc, with dedup:
```bash
RELAY="https://health-sync.emilyn-90a.workers.dev"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    sed -i.bak '/HEALTH_SYNC_URL\|HEALTH_SYNC_KEY/d' "$rc" 2>/dev/null
    cat >> "$rc" <<ENVEOF
export HEALTH_SYNC_URL='$RELAY'
export HEALTH_SYNC_KEY='$key'
ENVEOF
done
```

**Save the sync key** — it's needed for the phone setup later in the conversation.

**Write script version to relay config** (so the PWA can show update notifications):
Read the plugin version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and push it to the relay. Also include it in the user's profile export so the PWA stores it locally.

```bash
# Extract version from plugin.json
PLUGIN_VERSION=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json').version)")
```

The PWA will compare this version against what the relay returns in `/results/new`. When they differ, it shows an "update available" banner telling the user to re-run `/setup`.

### 5. Copy processing scripts

Copy from the plugin into `./processing/`:
```bash
cp ${CLAUDE_PLUGIN_ROOT}/scripts/* ./processing/
cp ${CLAUDE_PLUGIN_ROOT}/build-conversations.js ./processing/
cp ${CLAUDE_PLUGIN_ROOT}/build-summary.js ./processing/
cp ${CLAUDE_PLUGIN_ROOT}/timeline.js ./processing/
```

Copy profile templates (only if profile files don't already exist):
```bash
for f in goals.json preferences.json regimen.json; do
    if [ ! -f "./profile/$f" ]; then
        cp ${CLAUDE_PLUGIN_ROOT}/templates/$f ./profile/
    fi
done
```

### 6. Run onboarding conversation

This is the heart of setup. Adopt the Coach persona and have a casual, natural conversation — NOT a structured intake form.

**Greet them by name** (from their Claude account) and pitch what you can do:
"Hey {name}! I'm Coach. I can track your calories, build meal plans, plan workouts, keep you accountable — whatever you need on the health and fitness side. What are you looking for?"

Then let them lead. Keep it open-ended from there.

**Let the conversation flow naturally.** The user might give you everything in one message ("I want to lose 20 lbs, I'm 5'6 145, I hate cooking") or they might be vague ("just calorie tracking"). Match their energy:
- If they're detailed and goal-oriented, ask follow-ups to dial in targets
- If they're casual ("just simple calorie tracking"), don't push for a 9-point questionnaire — set sensible defaults and let things emerge from their actual logs

**What you need (gather organically, not as a checklist):**
- Their goal (lose weight, maintain, get stronger, just track)
- Rough stats if they offer them (height, weight) — don't demand these
- Any dietary constraints worth knowing upfront (allergies, vegetarian, etc.)
- Equipment situation if they mention workouts

**Calculate and write goals:**
- BMR via Mifflin-St Jeor, TDEE with activity multiplier
- Deficit/surplus based on goal (typically 300-500 cal deficit for weight loss)
- Protein: 0.8-1g per pound of goal weight
- Water: half bodyweight in oz (minimum 64oz)
- Create moderate + hardcore variants (hardcore = 200 cal less)

**Write files:**
- `USER.md` — conversational summary of who they are and what they want
- `profile/identity.md` — immutable identity facts (height, sex, dislikes, genetic patterns, equipment owned). NO current weight or PRs — those live in `current-stats.json` and are computed every processing cycle from the latest analysis files.
- `profile/goals.json` — calorie/macro/water targets with timeline and milestones
- `profile/preferences.json` — meal structure, dietary preferences, schedule
- `profile/regimen.json` — starter workout plan based on equipment and experience

**Don't ask about skincare during setup.** If the user brings it up later in a coaching session, set it up then.

### 7. Connect the phone

This is the immediate next step after the conversation. You already generated the sync key in step 4 — the user should never have to see or manage it.

**Step A — Generate a 4-digit pairing code:**
Register a temporary pairing code with the relay. The code expires in 15 minutes.
```bash
CODE=$(printf '%04d' $((RANDOM % 10000)))
RELAY="https://health-sync.emilyn-90a.workers.dev"
EXPIRES=$(date -u -d '+15 minutes' +%s000 2>/dev/null || date -u -v+15M +%s000)
curl -s -X PUT "$RELAY/pair" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"syncKey\":\"$SYNC_KEY\",\"relay\":\"$RELAY\",\"expires\":$EXPIRES}"
echo "Pairing code: $CODE"
```

**Step B — Direct the user to the onboarding page:**
"Open this page on your computer — it has a QR code you can scan with your phone to install the app: https://nemily.github.io/health-tracker/welcome.html"

The onboarding page is the single source for phone installation. It shows a QR code + fallback link. The user scans it, installs the app to their home screen, then enters the pairing code.

**Step C — Give the user the 4-digit code:**
"Once the app is open on your phone, it'll ask for a pairing code. Enter: **{CODE}**"

That's it — the app redeems the code, gets the sync key from the relay, and connects automatically.

**If pairing fails**, it may be a sync delay. Wait a few seconds and try again. If it keeps failing, generate a fresh code — codes are single-use and may have been consumed by a failed attempt.

### 8. First sync — push goals to the phone

The phone is waiting for data. Do NOT run `/process-day` here — it fails on cold start with no data. Instead, push a minimal analysis directly to the relay so the phone can show goals and targets.

"Sending your goals to the app now..."

**Create a stub analysis file** for today with the user's goals and an empty entry list:
```json
{
  "date": "YYYY-MM-DD",
  "entries": [],
  "totals": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "goals": {
    "calories": { "target": <from goals.json>, "actual": 0, "remaining": <target>, "status": "on_track" },
    "protein": { "target": <from goals.json>, "actual": 0, "remaining": <target>, "status": "on_track" },
    "water": { "target_oz": <from goals.json>, "actual_oz": 0, "status": "on_track" }
  },
  "highlights": ["Welcome to Coach! Log your first meal to get started."],
  "concerns": [],
  "pwaProfile": {
    "goals": <full goals.json content>,
    "preferences": <full preferences.json content>
  }
}
```

Write it to `analysis/YYYY-MM-DD.json`, then push to the relay:
```bash
curl -s -X POST "$HEALTH_SYNC_URL/sync/$HEALTH_SYNC_KEY/day/YYYY-MM-DD/done" \
  -H "Content-Type: application/json" \
  -d @analysis/YYYY-MM-DD.json
```

After it completes: "Check your phone — your goals should be there now. Pull down to refresh if needed."

### 9. Set up processing

Ask the user how they want their food photos and data analyzed:

"I need to process your food photos and sync results back to your phone. How do you want that to work?"

- **Automatic** — "Whenever your computer is open, I'll check for new photos and messages every 30 minutes in the background. You don't need to do anything." → Set up a scheduled task/cron. It only runs while the computer is awake — no battery drain when it's closed.
- **Manual** — "I'll only process when you start a coaching session or tell me to." → Skip the scheduled task. User runs `/process-day` or processing happens at session start.

If they choose **automatic**, walk them through the scheduled task setup:

**IMPORTANT:** Run `watcher.sh`/`watcher.ps1` (not `process-day` directly) — the watcher handles pending-data checks, quiet hours, and lock management.

**Windows — they'll need to paste this in an elevated PowerShell (Run as Administrator):**
```powershell
$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"COACH_DIR\processing\watcher.ps1`""; $t = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650); $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName "CoachWatcher" -Action $a -Trigger $t -Settings $s -Description "Coach - processes health data every 30 min"
```

**Mac/Linux:**
```bash
(crontab -l 2>/dev/null; echo "*/30 * * * * . COACH_DIR/.env && bash COACH_DIR/processing/watcher.sh >> COACH_DIR/logs/watcher.log 2>&1") | crontab -
```
Replace `COACH_DIR` with the actual path before giving it to the user.

**Verify:** Windows: `Get-ScheduledTask -TaskName "CoachWatcher" | Select-Object State` / Mac: `crontab -l | grep Coach`

Save their choice to `profile/preferences.json` under `processing.mode` (`"automatic"`, `"on-session"`, or `"manual"`) so future sessions know how to behave.

### 10. Plugin Updates

"To get automatic updates when I improve, run this next time you open Claude:"

```
claude plugin marketplace → select health-tracker → Enable auto-update
```

"Or update manually anytime with: `claude plugin update coach@health-tracker`"

### 11. Lock down permissions

Rewrite `.claude/settings.json` to remove setup-only Bash commands. Only keep what Coach needs for normal sessions:
```json
{
  "permissions": {
    "allow": [
      "Read(.)",
      "Edit(.)",
      "Write(.)"
    ]
  }
}
```

### 12. Confirm

"You're all set! Here's your plan:
- **Calories:** {target}/day ({hardcore} on crush-it days)
- **Protein:** {protein}g
- **Water:** {water}oz
- **Workouts:** {schedule summary}

The app syncs every 30 minutes. Log a meal photo to test it out. And anytime you want to chat, just type `coach` in your terminal."

## Notes

- The relay URL is hardcoded — all users share the same Cloudflare Worker
- Data is isolated by sync key (UUID) — no accounts needed
- Processing requires Claude Code (Pro or Max subscription) on the user's computer
- The coach folder IS the data directory — everything lives in one place
- `conversations.md` is rebuilt each processing run from analysis + extracted chat data
- The `coach` alias works from any terminal — it cd's into the coach folder and starts Claude
