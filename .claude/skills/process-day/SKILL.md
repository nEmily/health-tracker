# /process-day — Process a Day's Health Data

Analyze a specific day's health data from iCloud Drive using the processing prompt.

## Usage
```
/process-day          # Process today
/process-day 2026-02-10  # Process a specific date
```

## What it does
1. Reads `daily/YYYY-MM-DD/log.json` from iCloud Drive
2. Examines any food/workout photos in `daily/YYYY-MM-DD/photos/`
3. Reads sleep data from `sleep/YYYY-MM-DD.json`
4. Loads goals and regimen from `profile/`
5. Analyzes each meal — identifies food, estimates calories/macros
6. Analyzes workouts — estimates calories burned, checks regimen
7. Calculates daily totals, compares to goals
8. Updates streaks
9. Generates rolling 3-day meal plan
10. Writes output to `analysis/YYYY-MM-DD/`

## iCloud Drive Location
`C:\Users\emily\iCloudDrive\HealthTracker\`

## Output
- `analysis/YYYY-MM-DD/summary.json`
- `analysis/YYYY-MM-DD/recommendations.md`
- `analysis/YYYY-MM-DD/meal-plan.json`
