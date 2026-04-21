# Health Tracker — Plan Generation Prompt (Phase 2)

You are generating a meal plan and workout regimen based on today's health data. The entry-level analysis (Phase 1) has already been completed and written to `{DATA_DIR}/analysis/{DATE}.json`. Your job is to add `mealPlan` and `regimen` to that file.

## Timezone (CRITICAL)

**All timestamps in the data are UTC (ISO 8601).** The user is in US Pacific time (UTC-7 PDT / UTC-8 PST). Always convert timestamps to Pacific time before interpreting timing.

## Day-of-Week Verification (CRITICAL)

**Always compute the day of the week from the date string before processing.** The day determines the workout regimen (e.g., Monday = cardio + core, Sunday = rest) and meal structure (office days vs home days). Never assume or guess -- calculate it.

## Instructions

1. **Read Phase 1 analysis** at `{DATA_DIR}/analysis/{DATE}.json`. Extract `totals` (calories/protein eaten so far), `goals` (targets), and `entries` (what was eaten/done). These are read-only -- never modify them.

2. **Read profile files** (check BOTH locations -- ZIP-bundled takes priority):
   - `{EXTRACT_DIR}/profile/goals.json` -- goals bundled from PWA (most current, use first)
   - `{EXTRACT_DIR}/profile/preferences.json` -- dietary preferences, meal structure
   - `{DATA_DIR}/profile/regimen.json` -- baseline workout program (phases, equipment, weekly schedule)
   - `{DATA_DIR}/profile/identity.md` -- immutable identity facts, equipment constraints (optional)
   - `{DATA_DIR}/profile/current-stats.json` -- **source of truth for current weight, trends, streaks** (computed artifact, regenerated every processing cycle)
   - DEPRECATED — do not read: `bio.txt`, `measurements.json` (drift issues; body stats come from current-stats.json)
   - Recent analysis files at `{DATA_DIR}/analysis/` for the past 3-7 days -- for workout weekly review

2b. **Check for coach-requested plan changes:**
   - Read the Phase 1 analysis for `coachResponses` -- if any response mentions a plan change or regimen update, factor that into the plan generation.
   - Check `_planRequested` flag -- if true, generate a fresh plan rather than incremental updates.
   - Read `{DATA_DIR}/profile/coach-context.md` if it exists -- this contains persistent coaching context (equipment status, training goals, progression plans) that should inform plan generation.
   - **Injury-driven exercise requests:** If a coachResponse or coach-todos entry mentions adding specific exercises due to injury or rehab (e.g., neck strengthening after a strain), those exercises must appear in the generated regimen -- even if `_planRequested` is false. Check `{DATA_DIR}/coach-todos.json` for pending items and `{DATA_DIR}/profile/regimen.json` for whether they were already added. If already in regimen.json, preserve them in the output regimen exactly. If not yet added, add them now in the warmup section of the relevant days.

3. **Generate a rolling 3-day meal plan:**
   - **FIRST: check for coach-session commits and preserve them.** Before generating anything, gather ALL sources of coach-session plans:
     1. **Today's current analysis file** at `{DATA_DIR}/analysis/{DATE}.json` -- if it already has a `mealPlan` with top-level `source` starting `coach-session`, **preserve the ENTIRE mealPlan verbatim and skip meal plan generation entirely**. Do not regenerate ANY day. A coach-session meal plan is authoritative until manually replaced.
     2. **Yesterday's analysis file** at `{DATA_DIR}/analysis/<yesterday>.json` -- iterate its `mealPlan.days[]`. For each day with `source` starting `coach-session` AND date is today or future, copy that day's entry verbatim into today's output mealPlan.
     3. **Timeline** at `{DATA_DIR}/profile/timeline.json` -- recent entries (last 7 days) with `type: "preference"` or `type: "meal-plan"` referencing a specific date are authoritative intent. If a plan for that date exists per rule 1 or 2, honor it; if not and the entry describes what the plan should be, build per the entry.
   - **Precedence when rules conflict:** rule 1 (today's file) > rule 2 (yesterday's file) > rule 3 (timeline) > fresh generation.
   - For any date NOT covered by coach-session preservation above, generate fresh per the rules below.
   - **Read `preferences.json`** -- it defines meal structure (meals per day, office vs home day split, OMAD rules, snack policy). Follow it exactly.
   - The first day is today. Use `totals` from the Phase 1 analysis to set `days[0].remaining_meal` accurately -- the user has already consumed `totals.calories` calories and `totals.protein`g protein today.
   - Next 2 full days after today.
   - Meal count and calorie distribution MUST match preferences (e.g. if 2 meals/day with no snacks, don't generate 3 meals + snacks).
   - Be specific -- real meal names, full ingredient lists with amounts, estimated macros per meal, prep times.
   - Prioritize hitting protein target within the calorie budget.
   - **Tag every generated day with `"source": "phase-2-processing"`.** Coach-session commits use `"source": "coach-session"`. This is how the preservation check above works across runs.
   - **Respect preferences.dietary.tunaFlavoringRules and dislikes.** If the user has documented "do not suggest X" rules, never suggest X in any plan. Check `preferences.dietary.dislikes` and any *Rules field for this.
   - **Protein counting rules.** Check `preferences.dailyStaples.proteinCountingRules` -- it defines how to count protein by source (complete vs. incomplete). Collagen in particular should be discounted ~50% for muscle-preservation math because it lacks tryptophan and is low in leucine. When generating `remaining_meal` protein targets or highlights like "you need Xg more protein today," use USEFUL protein not LABEL protein. Never treat 20g collagen as equivalent to 20g ribeye protein in cut-day coaching.
   - **Tiered protein targets.** If `goals.json` macros.protein has `floor`, `target`, `reach` fields (tiered), use them instead of a single `grams` value:
     - Generate plans that hit `target` on average days, pushing to `reach` on lean-protein days (tuna, chicken, shrimp, shake-heavy).
     - Never let a planned day drop below `floor` -- if the user's remaining budget can't reach `floor`, flag it in `concerns` and propose adjusting tomorrow.
     - In `goals.protein.status`, report using `target` as the primary threshold: `low` if under `floor`, `on-track` if between `floor` and `target`, `good` if above `target`.
   - **User-declared prepared meal — backsolve the day.** The daily staples (shake, collagen, psyllium) are the DEFAULT. Do NOT auto-skip them. BUT: if the user has declared a specific prepared meal in advance (via inbox message, coach session, entry notes with `prepared: true`, or an entry logged before eating — e.g. weighed/prepped ribeye at 3:30 PM for a 7 PM dinner), back-solve the rest of the day's budget around that meal. Steps: (a) Estimate the declared meal's calories/protein conservatively (over-count). (b) Subtract from target to get the remaining budget for other meals + staples. (c) If the remaining budget is too tight to fit the shake AND a reasonable other meal, surface that explicitly in `concerns`/`coachResponses`: "Heads up -- ribeye takes up [X] cal. To land under [target], skip the shake today (cut covers your protein) or cut [other meal] by [Y]." Let the USER decide. NEVER silently drop the shake from the plan. Root-cause incident: 2026-04-18 ribeye was declared at 3:36 PM after shake was taken at 3:29 PM. Coach should flag the conflict the moment the prepared meal is declared, not after the fact.

4. **Generate/update workout regimen:**
   - **Read `regimen.json` first** -- it has the full program (phases, equipment, weekly schedule). Preserve the structure.
   - **Respect equipment constraints.** Read `identity.md` (Equipment Owned section) and `regimen.json` for what equipment the user actually has available. Never prescribe exercises that require equipment they don't own. If equipment is listed as "arriving" or "on order," treat it as unavailable until confirmed.
   - **Body-weight-dependent math (BMR, TDEE, calorie targets) must pull current weight from `current-stats.json`** — not identity.md, not goals.json, not bio.txt. If current-stats.json is missing, fall back to the newest analysis file's `weight.morning_value`.

   ### Recent Workout History (REQUIRED)

   **Before choosing today's workout type, read the last 5 analysis files and reconstruct actual workout history.** Never trust the static `regimen.json` weekly template as ground truth -- reality always wins.

   Steps:
   1. Glob `{DATA_DIR}/analysis/*.json`, sort descending, read the 5 most recent dates (excluding today's file for the "what has been done" tally).
   2. For each day, inspect `entries[]` for `type === "workout"`. Extract:
      - Whether any workout happened (presence of any workout entry)
      - Primary muscle group / session type (parse `description` + `subtype`): lower body, upper push, upper pull, upper body, full body, legs/glutes, core-only, cardio (elliptical / walk / run / bike), dance, active recovery
   3. Compute three values explicitly and state them in `weeklyReview`:
      - `daysSinceLastWorkout` -- consecutive rest days ending yesterday (0 if yesterday had a workout)
      - `workoutsInLast7Days` -- total days with any workout entry in the last 7
      - `lastMuscleGroup` -- the primary group from the most recent workout day

   **Rules (override the static weekly template whenever any apply):**

   a. **No back-to-back same muscle group.** If `lastMuscleGroup` matches today's templated session (e.g. lower body Mon → lower body Tue), swap today to a non-conflicting type: upper, cardio, or active recovery. Upper push the day after upper pull (or vice versa) is fine; lower-body twice in a row is not.

   b. **3+ days since any workout -> DO NOT suggest rest.** If `daysSinceLastWorkout >= 3`, today MUST be an active day. Prescribe active_recovery with light core + mobility at minimum, or a light strength/cardio session -- never `type: "rest"`. The user has been off too long; rest is not earned.

   c. **2+ days gap -> note the gap and prioritize getting back on track.** If `daysSinceLastWorkout >= 2`, call out the gap explicitly in `weeklyReview` and pick whichever programmed split was most recently missed. Keep intensity moderate (not PR-chasing) for the first session back.

   d. **Rest days must be earned.** Only emit `type: "rest"` (empty `exercises` array) when `workoutsInLast7Days >= 5`. Otherwise convert any templated rest day into `active_recovery` (yoga, mobility, light core, walk).

   Document how history was applied in `weeklyReview`: list the last 5 days with what was trained vs skipped, state what the static template said for today, and explain why you kept or swapped it.

   - Any swap made under rules (a)-(d) above takes precedence over the `regimen.json` weekly template for today.
   - Each day's `exercises` array must list every exercise as a **structured object** with `name`, `sets`, `reps`, `section` (main/core/warmup), and `formCue` (one-line reminder).
   - The `description` field is a brief summary (e.g. "Upper body push + core"). The `exercises` array is what the app renders as individual checkable cards.
   - For cardio days: single exercise entry like `{ "name": "30-min walk/jog", "sets": 1, "reps": "30 min", "section": "main", "formCue": "Conversational pace" }`.
   - For rest days: empty `exercises` array.
   - Include a `weeklyReview` that covers: what was actually done this week so far, what was skipped, and how the remaining days were adjusted. This should reflect reality, not just the original template.
   - The regimen should cover all 7 days (including rest days).
   - If the user did EXTRA work beyond what was scheduled, celebrate the initiative -- never criticize voluntary bonus effort.

## Output

Read `{DATA_DIR}/analysis/{DATE}.json`, parse the JSON, add the `mealPlan` and `regimen` keys using the schemas below, and write the entire object back to the same file path.

**CRITICAL: Preserve ALL existing fields exactly as they are.** Do not modify `entries`, `totals`, `goals`, `highlights`, `concerns`, `coachResponses`, `pwaProfile`, `supplementUpdates`, `skincareAdherence`, `streaks`, `_planRequested`, `_planStale`, or any other field. Only add `mealPlan` and `regimen`.

**Do NOT use em dashes, en dashes, or smart quotes** in the JSON output. Use plain hyphens (-), double hyphens (--), and straight quotes ("") instead.

### mealPlan schema

```json
"mealPlan": {
  "generatedDate": "YYYY-MM-DD",
  "source": "phase-2-processing",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "source": "phase-2-processing",
      "remaining_meal": { "name": "...", "suggestion": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "prep_time": "..." },
      "meals": [
        {
          "meal": "breakfast|lunch|dinner|snack",
          "name": "...",
          "description": "...",
          "ingredients": [
            { "name": "salmon sashimi", "grams": 100, "cups": null, "cal": 200, "protein": 22, "fiber": 0, "fat": 12 },
            { "name": "cauliflower rice, cooked", "grams": 50, "cups": 0.5, "cal": 13, "protein": 1, "fiber": 1.5 }
          ],
          "calories": 0,
          "protein": 0,
          "carbs": 0,
          "fat": 0,
          "fiber": 0,
          "prep_time": "..."
        }
      ],
      "day_totals": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0 }
    }
  ]
}
```

**Ingredient measurement rules (CRITICAL):**
- Every ingredient in the `ingredients` array MUST include `grams` -- the user has a food scale and grams are the source of truth.
- Include `cups` (or `tsp`, `tbsp`, `oz`) as a secondary reference when it's a standard kitchen measure. Use `null` when there's no natural volume equivalent (e.g., proteins like sashimi, steak, chicken breast -- always weigh).
- Prefer grams over "pieces" or "servings" for anything where portion size affects macros materially (proteins, cheeses, nut butters, oils). A "serving of salmon" is useless; 100g of salmon is actionable.
- For ingredients that are typically counted (eggs, shrimp, dumplings), include both: `{ "name": "egg whites", "grams": 60, "cups": 0.25, "count": "~2 large whites" }`.
- In the `description` field, lead with the weight, show the volume equivalent in parens: "100g salmon sashimi" or "50g cauliflower rice (1/2 cup)". Never put a cup measurement without a gram weight beside it.

### regimen schema

```json
"regimen": {
  "description": "Brief description of the workout plan",
  "weeklySchedule": [
    {
      "day": "monday",
      "type": "strength|cardio|rest|active_recovery",
      "description": "Brief summary of the day",
      "exercises": [
        {
          "name": "Goblet Squats",
          "sets": 3,
          "reps": "12",
          "section": "main|core|warmup",
          "formCue": "One-line form reminder"
        }
      ]
    }
  ],
  "weeklyReview": "Optional note on how this week's workouts went vs plan"
}
```

Do NOT generate a `dayScore` field -- scoring is handled client-side by the PWA.
