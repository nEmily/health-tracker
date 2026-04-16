# Coach SDK — Data Contract Reference

> **Auto-generated from source code. Do not hand-edit.**
> Regenerate with: `node coach-plugin/generate-sdk.js`

This is the data contract for Coach. It describes every file the coach reads or writes, every entry type, and the canonical analysis JSON format. Use it to understand what data exists and how to interpret it before creating entries, updating profile files, or explaining scoring to users.

---

## Key Rules

- **Always over-count calories** when estimating — better to over-count than under-count.
- **Never hand-edit analysis JSONs** — they are written by processing. Use corrections files for overrides.
- **Never delete photos or user data** — photos are permanent; corrections are ground truth.
- **No em dashes or smart quotes in JSON output** — use plain hyphens and straight quotes.
- **Day boundary is 4am, not midnight** — entries before 4am belong to the previous calendar day.

---

## File Ownership

| File | Writer | Reader | When to Read |
|------|--------|--------|-------------|
| `analysis/YYYY-MM-DD.json` | Processing | Coach, PWA | When discussing a specific day |
| `profile/goals.json` | Coach, Setup | Processing, PWA | When discussing targets |
| `profile/regimen.json` | Coach, Setup | Processing, PWA | When discussing workouts |
| `profile/preferences.json` | Coach, Setup | Processing | When discussing diet preferences |
| `profile/bio.txt` | Setup | Processing, Coach | When discussing user stats |
| `profile/timeline.json` | Coach | Coach | When understanding plan history |
| `weekly-summary.md` | Processing | Coach | Every returning-user session |
| `conversations.md` | Processing | Coach | Every returning-user session |

---

## Entry Types

| Type | Subtypes | Key Fields | Photo? |
|------|----------|-----------|--------|
| `meal` | breakfast, lunch, dinner, snack | notes, photo, timestamp | Yes |
| `workout` | strength, cardio, bands, flexibility | duration_minutes, fitness_checked, fitness_sets | Optional |
| `water` | — | (logged via dailySummary.water_oz) | No |
| `weight` | — | (logged via dailySummary.weight) | No |
| `bodyPhoto` | face, body, arms, abs, custom | photo, subtype | Yes |
| `custom` | beer, wine, cocktail, shot | quantity, calories_est | No |
| `period` | — | (toggle in dailySummary) | No |

---

## Coach Operations → File Writes

| Coach Operation | What to Write | Format |
|----------------|---------------|--------|
| Update calorie target | `profile/goals.json` | `{ "calories": { "daily": N }, ... }` |
| Update protein target | `profile/goals.json` | `{ "macros": { "protein": { "grams": N } } }` |
| Update workout schedule | `profile/regimen.json` | `{ "weeklySchedule": [...], "bonusStrength": [...] }` |
| Update food preferences | `profile/preferences.json` | `{ "dietary": { "restrictions": [], "favorites": [] } }` |
| Record plan change | Append to `profile/timeline.json` | `{ "date", "timestamp", "level", "type", "summary", "reason", "source" }` |
| Respond to inbox message | Via processing only (not direct write) | — |

---

## IndexedDB Schema

Database: `health-tracker` (v4)

| Store | Key Path | Indexes |
|-------|----------|---------|
| `entries` | `id` | date, type, date_type |
| `photos` | `id` | entryId, date, category, syncStatus |
| `dailySummary` | `date` | — |
| `analysis` | `date` | — |
| `profile` | `key` | — |
| `mealPlan` | `generatedDate` | — |
| `analysisHistory` | `id` | date, importedAt |
| `skincare` | `date` | — |
| `challenges` | `id` | status, startDate |
| `challengeProgress` | `id` | challengeId, date |

---

## Scoring System

Scores are computed client-side by `score.js`. Two variants are calculated per day: **moderate** and **hardcore** (same logic, different calorie/protein targets).

### Score Categories

| Category | Max Points | Condition |
|----------|------------|----------|
| Calories | 25 | Within ±150 of target = 25pts; ±300 = 15pts; over +300 = 0pts; under = 10pts |
| Protein | 25 | Proportional to target (actual/target × 25, capped at 25) |
| Workout | 25 | Workout day + did workout = 25pts; rest day = 25pts (full credit); missed = 0pts |
| Water | 10 | Met goal = 10pts; ≥50% of goal = 5pts; under = 0pts |
| Logging consistency | 15 | ≥1 meal logged = 15pts; 0 meals = 0pts |
| Bonus (cardio + strength) | +5 | Cardio day AND also did strength/band work = +5 (can exceed 100) |
| Vices penalty | −10/drink | Each alcoholic drink = −10pts, max −30 |

**Max score:** 105 (100 base + 5 bonus). **Min score:** 0 (clamped).

### Score Descriptors

| Score Range | Label |
|-------------|-------|
| 0–20 | Just getting started |
| 21–40 | Building momentum |
| 41–60 | Solid effort |
| 61–80 | Great day |
| 81–105 | Crushing it |

### Goals Structure

Goals are read from `profile/goals.json`. The score uses:

- `goals.calories` (moderate daily target, default 2000)
- `goals.protein` (moderate daily target, default 100)
- `goals.water_oz` (daily target, default 64)
- `goals.hardcore.calories` (hardcore target, default 1500)
- `goals.hardcore.protein` (hardcore target, default 130)
- `goals.hardcore.water_oz` (hardcore target, default 64)

---

## Analysis JSON Format

Canonical output written to `analysis/YYYY-MM-DD.json` by processing. Do not hand-edit — use `corrections/YYYY-MM-DD.json` for overrides.

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
      "fiber": 0,
      "confidence": "high|medium|low",
      "breakdown": { "item_name": { "cal": 0, "p": 0, "c": 0, "f": 0 } }
    }
  ],
  "totals": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0 },
  "goals": {
    "calories": { "target": 0, "actual": 0, "remaining": 0, "status": "under|over|on_track" },
    "protein": { "target": 0, "actual": 0, "remaining": 0, "status": "low|on_track|high" },
    "carbs": { "target": 0, "actual": 0, "remaining": 0, "status": "..." },
    "fat": { "target": 0, "actual": 0, "remaining": 0, "status": "..." },
    "fiber": { "target": 0, "actual": 0, "remaining": 0, "status": "low|on_track|high" },
    "water": { "target_oz": 0, "actual_oz": 0, "status": "..." }
  },
  "highlights": ["..."],
  "concerns": ["..."],
  "streaks": { "tracking": 0, "calorie_goal": 0, "protein_goal": 0 },
  "skincareAdherence": {
    "am": { "completed": 4, "total": 4, "skipped": [] },
    "pm": { "completed": 2, "total": 3, "skipped": ["retinol"] }
  },

  "coachResponses": [
    { "replyTo": "coach_msgid", "text": "Response to user's question", "timestamp": 0 }
  ],

  "settingUpdates": {
    "goals": { "calories": 1100 },
    "preferences": { "mealsPerDay": 2 }
  },

  "pwaProfile": { /* echo back profile/pwa-profile.json if it exists in the extracted data */ }
}
```

### Field Notes

- `entries` — analyzed entries (meals, workouts, custom). Body/face photos are omitted.
- `totals` — sum of all entry calories/macros including custom (alcohol) entries.
- `goals` — comparison against targets from `profile/goals.json`.
- `highlights` / `concerns` — forward-looking tips, not warnings about what's already done.
- `coachResponses` — replies to inbox messages. `replyTo` must match the user message `id`.
- `settingUpdates` — when the user explicitly requests a goal or preference change.
- `pwaProfile` — echo of `profile/pwa-profile.json` for phone restore after reinstall.
- `supplementUpdates` — nutrition data extracted from supplement label photos.
- `_planStale` — set `true` when logged data diverges from the current plan.
- `_planRequested` — set `true` when the user explicitly asks for a new plan.
- **No `dayScore` field** — scoring is computed client-side by `score.js`, never stored.

---

