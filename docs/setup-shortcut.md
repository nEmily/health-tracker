# iOS Shortcut for Sleep Data

This shortcut runs automatically each morning to pull sleep data from Apple Health and save it to iCloud Drive for Claude to process.

## Create the Shortcut

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Name it: **Health Tracker Sleep**

## Add Actions

### Step 1: Get today's date
- Add **Date** action → Current Date
- Add **Format Date** → Custom: `yyyy-MM-dd`
- Save to variable: `today`

### Step 2: Find sleep data
- Add **Find Health Samples**
  - Type: **Sleep Analysis**
  - Start Date: is in the last **1 day**
  - Sort by: **Start Date** (Oldest First)

### Step 3: Build JSON
- Add **Text** action with this template:

```
{
  "date": "[today]",
  "bedtime": "[Start Date of first Health Sample]",
  "waketime": "[End Date of last Health Sample]",
  "duration_hours": [calculated],
  "source": "apple_health",
  "exportedAt": "[Current Date]"
}
```

For the duration, add a **Calculate** action:
- (End Date of last sample) - (Start Date of first sample)
- Convert to hours

### Step 4: Save to iCloud Drive
- Add **Save File** action
  - File: the Text output from Step 3
  - Destination: iCloud Drive → HealthTracker → sleep
  - File name: `[today].json`
  - Ask Where to Save: **OFF**

## Set Up Automation

1. Go to **Automation** tab in Shortcuts
2. Tap **+** → **Personal Automation**
3. Choose **Time of Day** → e.g., **8:00 AM** every day
4. Add action: **Run Shortcut** → select "Health Tracker Sleep"
5. Turn OFF **Ask Before Running**

## Verify

After the first morning run, check:
- Files app → iCloud Drive → HealthTracker → sleep
- You should see a `YYYY-MM-DD.json` file with your sleep data

## Troubleshooting

- **No sleep data**: Make sure you're wearing Apple Watch to bed or using a sleep tracking app that writes to Apple Health
- **Permission denied**: Go to Settings → Health → Data Access → Shortcuts and enable Sleep access
- **File not saving**: Make sure the HealthTracker/sleep folder exists in iCloud Drive
