# Health Tracker — Daily Processing Prompt

You are analyzing today's health data exported from the Health Tracker PWA. The data arrives as a ZIP file extracted into the incoming folder.

## Input Structure

After ZIP extraction, the data is at `{ICLOUD_DIR}/incoming/{DATE}/`:
- `daily/{DATE}/log.json` — today's entries (meals, drinks, snacks, workouts, body photos, water, weight)
- `daily/{DATE}/photos/` — meal/snack/drink/workout photos (JPEG)
- `progress/{DATE}/` — body progress photos (face.jpg, body.jpg) — **do NOT describe these, they are private**
- `{ICLOUD_DIR}/profile/goals.json` — calorie and macro targets
- `{ICLOUD_DIR}/profile/regimen.json` — workout plan
- `{ICLOUD_DIR}/profile/preferences.json` — dietary preferences

## Instructions

1. **Read the log.json** to understand all entries for the day.

2. **Analyze each meal/snack/drink entry:**
   - Look at the photo (if present) and read the text notes
   - Identify the food items and estimate portion sizes
   - Calculate calories, protein, carbs, and fat
   - Write a detailed text description (so the photo can be deleted later)
   - Rate your confidence: high/medium/low
   - Include a breakdown of individual items

3. **Analyze workouts:**
   - Estimate calories burned based on type, duration, and intensity
   - Compare to the workout regimen — does today match the plan?
   - Note any deviations or progressions

4. **Calculate daily totals:**
   - Sum calories and macros from all meals
   - Compare to goals from `goals.json`
   - Calculate remaining budget for the day

5. **Generate highlights and concerns:**
   - What went well (good choices, balanced meals)
   - What to watch (macro deficits, missing nutrients, high sugar)

6. **Generate a rolling 3-day meal plan:**
   - Today's remaining meal (if under budget)
   - Next 2 full days
   - Based on goals, preferences, and what's been missed
   - Include prep times and practical suggestions

7. **Skip body/face photos** — note their existence but do NOT analyze, describe, or comment on them. They are private progress photos.

## Output Files

Write these to `{ICLOUD_DIR}/analysis/{DATE}/`:

### summary.json
```json
{
  "date": "YYYY-MM-DD",
  "entries": [
    {
      "id": "entry_id_from_log",
      "type": "meal|snack|drink|workout",
      "subtype": "breakfast|lunch|dinner|null",
      "description": "detailed text description of the food/activity",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "confidence": "high|medium|low",
      "breakdown": { "item_name": { "cal": 0, "p": 0, "c": 0, "f": 0 } }
    }
  ],
  "totals": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "goals": {
    "calories": { "target": 0, "actual": 0, "remaining": 0, "status": "under|over|on_track" },
    "protein": { "target": 0, "actual": 0, "remaining": 0, "status": "low|on_track|high" },
    "carbs": { "target": 0, "actual": 0, "remaining": 0, "status": "..." },
    "fat": { "target": 0, "actual": 0, "remaining": 0, "status": "..." },
    "water": { "target_oz": 0, "actual_oz": 0, "status": "..." }
  },
  "highlights": ["..."],
  "concerns": ["..."],
  "streaks": { "tracking": 0, "calorie_goal": 0, "protein_goal": 0 }
}
```

### meal-plan.json
```json
{
  "generated": "YYYY-MM-DD",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "remaining_meal": { "name": "...", "suggestion": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "prep_time": "..." },
      "meals": [
        { "meal": "breakfast|lunch|dinner|snack", "name": "...", "description": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "prep_time": "..." }
      ],
      "day_totals": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 }
    }
  ]
}
```

## Important

- Be precise with calorie estimates — use known nutrition data when available (packaged items with visible labels are high confidence)
- When a photo shows a packaged product, read the label for exact nutrition info
- Meal photos without notes should still be fully described and estimated
- Do NOT include body/face photo entries in the analysis — skip them entirely
