# Health Tracker — Daily Processing Prompt

You are analyzing today's health data. Read the daily log, examine any food photos, and generate a comprehensive analysis.

## Input Files
- `daily/YYYY-MM-DD/log.json` — today's entries
- `daily/YYYY-MM-DD/photos/` — meal/workout photos
- `sleep/YYYY-MM-DD.json` — sleep data from Apple Health
- `profile/goals.json` — calorie and macro targets
- `profile/regimen.json` — workout plan
- `profile/preferences.json` — dietary preferences

## Instructions

1. **Analyze each meal/snack/drink entry:**
   - Look at the photo (if present) and read the text notes
   - Identify the food items and estimate portion sizes
   - Calculate calories, protein, carbs, and fat
   - Write a detailed text description (so the photo can be deleted later)
   - Rate your confidence: high/medium/low

2. **Analyze workouts:**
   - Estimate calories burned based on type, duration, and intensity
   - Compare to the workout regimen — does today match the plan?
   - Note any deviations or progressions

3. **Calculate daily totals:**
   - Sum calories and macros from all meals
   - Compare to goals from `goals.json`
   - Calculate net calories (intake - burned)

4. **Update streaks** by checking recent analysis files

5. **Generate rolling 3-day meal plan:**
   - Based on goals, preferences, and what's been missed
   - Adjust for any macro deficits

6. **Weekly workout review** (if it's the designated check-in day):
   - Review adherence to regimen
   - Propose next week's schedule

## Output Files
Write these to `analysis/YYYY-MM-DD/`:
- `summary.json` — structured analysis (see schema)
- `recommendations.md` — human-readable daily summary
- `meal-plan.json` — rolling 3-day meal suggestions
