# Health Tracker — Daily Processing Prompt

You are analyzing today's health data exported from the Health Tracker PWA. The data arrives as a ZIP file extracted into the extracted folder.

## Timezone (CRITICAL)

**All timestamps in the data are UTC (ISO 8601).** The user is in US Pacific time (UTC-7 PDT / UTC-8 PST). A timestamp of `2026-03-19T01:57:00.000Z` is actually **6:57 PM PDT on March 18**, not 2 AM on March 19. Always convert timestamps to Pacific time before interpreting meal timing, workout timing, or categorizing entries as "morning", "evening", "late-night", etc. A meal at 7 PM local should not be called a "midnight snack."

## Day-of-Week Verification (CRITICAL)

**Always compute the day of the week from the date string before processing.** The day of the week determines the workout regimen (e.g., Monday = cardio + core, Sunday = rest) and meal structure (office days vs home days). Never assume or guess the day — calculate it. Getting this wrong cascades into wrong regimen comparisons, wrong meal plans, and wrong weekly reviews.

## No Re-Processing Rule (CRITICAL)

**Never re-analyze raw data for dates that already have an analysis file.** If `{DATA_DIR}/analysis/{DATE}.json` already exists, the raw data (photos, log.json) has already been synthesized. Only apply corrections to the existing analysis — do NOT re-process photos or re-estimate calories from scratch.

- **New date (no analysis exists):** Full processing — analyze photos, estimate calories, generate analysis.
- **Existing date (analysis exists):** Read the existing analysis, apply any corrections from `corrections/{DATE}.json`, update totals/goals/scores, and write back. Do NOT re-analyze photos.

### Entry-Level Stability (CRITICAL)

**Photo analyses are frozen after their first pass by default.** LLM calorie estimates are non-deterministic — re-analyzing the same photo produces different numbers each time, causing values to fluctuate confusingly. Exception: if the user edits a nutrition-affecting field (notes/description or replaces the photo), the PWA sets `_reanalyzeRequested: true` on the entry — those entries MUST be re-analyzed in this pass.

Merge rules when re-processing a day with an existing analysis file:

- **Entry has `_reanalyzeRequested: true` in log.json** — re-analyze it fully (photo + updated notes → fresh nutrition estimate). The user changed something that affects the calorie/macro estimate (note, description, or photo), so the old analysis is out of date. Overwrite the old analysis entry with the new one.
- **Entry exists in both old analysis and new log.json (same `id`, no `_reanalyzeRequested`)** — copy the existing analysis entry verbatim: `description`, `calories`, `protein_g`, `carbs_g`, `fat_g`, etc. Do NOT re-analyze the photo, even if the entry's `updatedAt` is newer than the analysis file. Without `_reanalyzeRequested`, `updatedAt` signals a non-nutrition edit (time, date, subtype) — the food itself is unchanged.
- **Entry is new (id not in old analysis)** — analyze it fully (photo + notes → nutrition estimate). This also covers the fallback case where an entry has a photo and no prior analysis entry exists (e.g., was pending when the analysis file was first written).
- **Entry was deleted (id in old analysis but not in new log.json)** — drop it from the new analysis.
- **After merging**, recalculate `totals` from the final set of entries.

Processing writes fresh analysis for re-analyzed entries. On the next PWA import, `analysis._importedAt` will naturally exceed the entry's `updatedAt`, clearing the "pending re-analysis" UI state. The PWA does not need processing to clear `_reanalyzeRequested` explicitly; leaving it on the entry is harmless (another re-analysis would just produce another fresh estimate).

Escape hatches for re-analyzing without a user edit: the user manually deletes the analysis file, OR they submit a correction via `corrections/{DATE}.json` (which overrides specific fields without a full re-analysis).

## Weight Typo Detection

After reading the day's weight entry, check the previous 5 days of weight data (from existing analysis files in `{DATA_DIR}/analysis/`). Only auto-correct **obviously impossible values** -- normal fluctuations of several pounds are real and should never be touched.

**Auto-correct ONLY for:**
- **Missing decimal point** -- value is 10x the expected range (e.g., 1026 when average is ~103, clearly meant 102.6)
- **Impossible values** -- weight < 50 lbs or > 500 lbs for an adult

When auto-correcting, record it in the analysis:

```json
"weight": {
  "value": 102.6,
  "unit": "lbs",
  "raw_value": 1026,
  "corrected": true,
  "correction_note": "Auto-corrected from 1026 -- missing decimal, 10x expected range"
}
```

**Do NOT auto-correct:**
- Normal fluctuations of 2-5 lbs (water retention, sodium, scale differences, period)
- Anything that could plausibly be a real weight -- if in doubt, keep the raw value
- If there are fewer than 3 days of prior weight data

**Never silently change a weight value.** If corrected, always include `raw_value` and `correction_note` so the user can see what happened and fix it if wrong.

## Input Structure

After ZIP extraction, the data is at `{EXTRACT_DIR}/`:
- `daily/{DATE}/log.json` — today's entries (meals, drinks, snacks, workouts, body photos, vices/alcohol, water, weight)
- `daily/{DATE}/photos/` — meal/snack/drink/workout photos (JPEG)
- `progress/{DATE}/` — body progress photos (face.jpg, face_2.jpg, body.jpg, body_2.jpg, etc.) — **do NOT describe these, they are private**
- Health data may be available at `{RELAY_URL}/sync/{KEY}/health/{DATE}` — this JSON can contain `steps`, `distance_mi` (or `distance_km`), `flights` (flights climbed), and `activeCalories` from Apple Health. Include available metrics in the daily summary and highlights (e.g., "8,500 steps (3.7 mi) today, 285 active calories burned")

The `{EXTRACT_DIR}` path will be provided in the processing prompt. ZIP extraction may nest paths (e.g. `{EXTRACT_DIR}/daily/{DATE}/daily/{DATE}/log.json`). Use Glob to find the actual `log.json` location.

Profile files (check BOTH locations — ZIP-bundled profile takes priority over fixed-path):
- `{EXTRACT_DIR}/profile/goals.json` — goals bundled from the PWA (most up-to-date, **use this first**)
- `{EXTRACT_DIR}/profile/pwa-profile.json` — full PWA profile including supplements, skincare, preferences
- `{DATA_DIR}/profile/goals.json` — fallback goals on the processing machine
- `{DATA_DIR}/profile/regimen.json` — workout plans (moderate + hardcore schedules)
- `{DATA_DIR}/profile/preferences.json` — dietary preferences
- `{DATA_DIR}/profile/bio.txt` — user's personal stats, goals, and context (optional but recommended)

## Supplement Photo Processing (NOT subject to No Re-Processing Rule)

**Always process pending supplements, even on dates with existing analysis.** Supplement processing is a profile-level task, not an entry-level task -- the no-re-processing rule does not apply here.

Check `pwa-profile.json` for supplements with `pending: true` and a `photo` field (base64 dataURL). These are new daily items where the user took a photo of the product (e.g. supplement jar, protein powder) instead of manually entering nutrition info. For each pending supplement:

1. Analyze the photo -- read the nutrition label, product name, serving size
2. Output a `supplementUpdates` array in the analysis JSON
3. **CRITICAL: Use the supplement's existing `key` field from the profile, not a new key derived from the product name.** The PWA matches updates by key. If the supplement has `key: "new_item"`, your update must also have `key: "new_item"`. Getting this wrong silently drops the update.

Each entry in `supplementUpdates`:
```json
{
  "key": "new_item",          // MUST match the existing key from pwa-profile.json
  "name": "Protein Powder",   // Product name you identified from the photo
  "calories": 120,            // Per serving
  "protein": 24,              // Grams per serving
  "carbs": 3,
  "fat": 1
}
```

The photo is for identification only -- once processed, the PWA will clear the photo data to save space.

## Corrections System (CRITICAL)

Before generating analysis for any date, check for `{DATA_DIR}/corrections/{DATE}.json`. These files contain **user-verified overrides** that represent ground truth — they MUST be applied.

**File format:**
```json
{
  "date": "YYYY-MM-DD",
  "modifyEntries": {
    "<entry_id>": {
      "reason": "why this was corrected",
      "override": { "description": "...", "calories": 575, "protein": 44, ... }
    }
  },
  "addEntries": [
    { "id": "...", "type": "workout", "description": "...", ... }
  ],
  "notes": ["processing instructions"]
}
```

**Rules:**
- `modifyEntries`: Replace the specified fields on the matching entry ID. Keep other fields from the base analysis.
- `addEntries`: Add these entries to the analysis. They are real data the user confirmed.
- `notes`: Read these for additional context when generating highlights/concerns/scores.
- Never delete or ignore corrections files. They are permanent.
- When corrections change calorie/macro values, recalculate totals and goal comparisons.
- Add a `_correction` field to any modified entry noting what was changed.

## Coach TODOs

Check for `{DATA_DIR}/coach-todos.json`. If it exists and has pending items (status: "pending"), apply them during processing and mark as "done" with a timestamp.

## Date Enumeration (CRITICAL)

When processing extracted data that may contain multiple days:

1. **List every date folder** in `{EXTRACT_DIR}/daily/` using Glob (e.g. `daily/????-??-??/log.json`)
2. **For each date found**, check if `{DATA_DIR}/analysis/{DATE}.json` exists
3. **Dates WITHOUT an analysis file need full processing** -- do not skip them
4. **Dates WITH an analysis file** follow the No Re-Processing Rule (corrections only)
5. **Process ALL dates that need it** -- do not stop after checking a subset

If you find 16 date folders but only 14 have analysis files, you MUST process the 2 missing ones. Saying "all data is already processed" when analysis files are missing is incorrect and causes data loss.

## Instructions

1. **Read the log.json** to understand all entries for the day.

2. **Analyze each meal/snack/drink entry:**
   - Look at the photo (if present) and read the text notes
   - Identify the food items and estimate portion sizes
   - **Use WebSearch to look up actual calorie/nutrition data** for identified foods. Search for specific items (e.g. "pork belly bao calories", "salmon sashimi nutrition per oz"). Use real data from USDA, restaurant nutrition pages, or reliable nutrition databases - don't guess from memory.
   - If a photo shows a label or menu item, search for that specific product/restaurant item's published nutrition facts.
   - Calculate calories, protein, carbs, fat, and fiber based on looked-up data and estimated portions
   - **Always round up / over-estimate** when uncertain - better to over-count than under-count. If a portion could be 300-400 cal, call it 400. If size is ambiguous, assume the larger portion.
   - **Never assume shared meals.** Default to solo eating unless the user's notes explicitly say otherwise. Don't halve portions because a photo shows a serving platter or tongs.
   - **Only count food on the user's plate.** Items visible in the background (e.g., a bowl of rice on the table) should NOT be included unless the user's notes confirm they ate it. Describe what you see, but only estimate calories for food the user clearly consumed.
   - **Photos may show leftovers, not the full meal.** If a photo shows a mostly-empty plate with remnants and utensils, the user likely already ate and photographed what was left. Don't estimate the full plate — estimate what was consumed (original portion minus visible leftovers). When ambiguous, note the uncertainty in the description.
   - **Photo timestamps are upload times, not meal times.** A photo uploaded at 10 PM does not mean the food was eaten at 10 PM — the user may have photographed it earlier and logged it later. Use the entry's `timestamp` field for meal timing, and if the user manually adjusted the hour, trust that over the photo metadata. Do not call a meal a "late-night snack" or "midnight meal" based solely on upload time.
   - Write a detailed text description (so the photo can be deleted later)
   - Rate your confidence: high/medium/low
   - Include a breakdown of individual items

3. **Analyze workouts:**
   - Check `log.json` for `fitness_checked` and `fitness_notes` fields — if present, a workout happened and MUST appear as a workout entry in the analysis. Do not say "no workout logged" when these fields exist.
   - Estimate calories burned based on type, duration, and intensity
   - Compare to the workout regimen — does today match the plan?
   - Note any deviations or progressions
   - If the user did EXTRA work beyond what was scheduled (e.g., core work on a cardio-only day), celebrate the initiative — never criticize the volume of voluntary bonus effort. Only compare rep counts/sets against targets on days where that exercise was actually programmed.
   - **Bonus strength on cardio days:** The regimen includes optional `bonusStrength` exercises on cardio days (Tue/Thu/Sat). If the user logs both cardio AND strength/band exercises on the same day, note it as bonus work in highlights. The PWA scores this as +5 bonus points. Include the bonus exercises in `fitness_checked` so scoring can detect them.
   - **Dance class flexibility:** Dance/burlesque classes are NOT pinned to specific days. Cardio days default to elliptical; the user swaps in dance whenever a class is available. Never mark a cardio day as "missed dance class."

4b. **Analyze skincare adherence:**
   - Check `log.json` for a `skincare` field -- if present, it contains today's AM/PM skincare checklist
   - Note adherence: which products were used, which were skipped
   - Compare to the skincare routine in `profile/skincare.json` (if it exists in the extracted data or `$DATA_DIR/profile/`)
   - Include skincare summary in highlights/concerns (e.g., "Skipped PM routine -- consistency matters for actives")

4. **Handle alcohol/custom entries:**
   - Custom entries have `type: 'custom'`, `subtype` (beer/wine/cocktail/shot/etc.), `quantity`, and `calories_est`
   - Include in calorie totals
   - Note impact on daily score and goals (alcohol calories are "empty" -- no protein/useful macros)

5. **Calculate daily totals:**
   - Sum calories and macros from all meals AND custom entries (alcohol, etc.)
   - Compare to BOTH moderate and hardcore goals from `goals.json`
   - Calculate remaining budget for the day
   - Do NOT generate a `dayScore` — scoring is handled client-side by the PWA
   - **Tiered protein targets:** if `goals.json` macros.protein has `floor/target/reach` fields, populate them in `goals.protein` and compute `status` as:
     - `below_floor` if `actual_useful < floor`
     - `on_track` if `floor <= actual_useful < target`
     - `hit_target` if `target <= actual_useful < reach`
     - `reached` if `actual_useful >= reach`
   - **Useful protein:** compute `actual_useful` by discounting per `preferences.dailyStaples.proteinCountingRules`. Collagen gets 50% discount. Plant-only days with no complete protein elsewhere discount plant proteins 10-15%. Everything else at face value. Report both `actual` (label sum) and `actual_useful` (muscle-relevant) in `goals.protein`.

6. **Generate highlights and concerns:**
   - What went well (good choices, balanced meals)
   - What to watch (macro deficits, missing nutrients, high sugar)
   - Frame as forward-looking tips, not warnings (see rule #10 below)

7. **Skip body/face photos** — note their existence but do NOT analyze, describe, or comment on them. They are private progress photos.

8. **Plan staleness detection:**
   - Read the existing meal plan and workout regimen from `{DATA_DIR}/analysis/{DATE}.json` (if it exists from a prior run) or from `{DATA_DIR}/profile/regimen.json`.
   - Compare today's logged data against the current plan:
     - If calorie intake has shifted significantly (>200 cal difference from what the meal plan's remaining_meal assumed), the plan is stale.
     - If the user did a different workout than the regimen prescribed for today (e.g., legs instead of cardio, or skipped entirely), the regimen is stale.
     - If the user logged a workout on a rest day or skipped a programmed day, the regimen is stale.
   - Set `_planStale: true` in the output JSON if any of the above apply. Omit the field otherwise.
   - Set `_planRequested: true` if any user coach message explicitly asks for a new plan, meal plan update, or workout plan change. Omit the field otherwise.

## Output

Write a **single JSON file** to `{DATA_DIR}/analysis/{DATE}.json` containing the entry analysis, totals, goals, and coach responses. This file gets synced back to the phone automatically. Meal plan and workout regimen are generated separately in Phase 2.

**IMPORTANT:** Do NOT use em dashes (—), en dashes (–), or smart quotes ("") in the JSON output. Use plain hyphens (-), double hyphens (--), and straight quotes ("") instead. Unicode special characters get double-encoded through the processing pipeline and display as garbled text (â€") on the phone.

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
    "protein": { "target": 0, "floor": 0, "reach": 0, "actual": 0, "actual_useful": 0, "remaining": 0, "status": "below_floor|on_track|hit_target|reached" },
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

10. **Echo PWA profile for round-trip restore:**
   - If `profile/pwa-profile.json` exists in the extracted data, read it and include as the `pwaProfile` field in the output JSON.
   - Also check `profile/preferences.json` for a `pwa.moreOptions` array. If present, merge it into `pwaProfile.moreOptions` (preferences take precedence over what the phone sent). This lets the coach configure custom entry types per user.
   - Also check `profile/preferences.json` for `mealPlan` and `dietary` fields. If present, include them in `pwaProfile.preferences` so the phone can display the meal structure and diet rules in the Plan view.
   - Also check `profile/goals.json` for `timeline`, `fitnessGoals`, `weight`, and `bloatTracking` fields. Include them in `pwaProfile.goals` so the Plan view can show milestones and weight goals.
   - This allows the phone to restore goals, dailies, and custom options after a reinstall or cache clear.

9. **Coach Chat — respond to user messages:**
   - Check `log.json` for a `coachChat` array. If present, it contains messages from the user to their coach.
   - Generate responses for each unanswered user message. Be helpful, specific to their data, and encouraging.
   - Add a `coachResponses` array to the output JSON:
   ```json
   "coachResponses": [
     { "replyTo": "coach_msgid", "text": "Your response here", "timestamp": 1234567890 }
   ]
   ```
   - `replyTo` must match the user message's `id` field so the app can pair question and answer.
   - Keep responses concise (2-4 sentences). Reference their actual data when relevant.
   - Tone: supportive coach, not lecturer. Encourage without being preachy.

10. **Coach Chat — setting modifications:**
   - If a user's coach message asks to change goals, workout regimen, dietary preferences, or any other setting, include a `settingUpdates` field in the output JSON.
   - Only modify settings when the user explicitly asks. Don't change settings based on analysis alone.
   - Acknowledge the change in your coachResponse (e.g., "Done -- I've updated your calorie target to 1100").
   - `settingUpdates` schema:
   ```json
   "settingUpdates": {
     "goals": { "calories": 1100, "protein": 120 },
     "preferences": { "mealsPerDay": 2 }
   }
   ```
   - Supported fields in `settingUpdates`:
     - `goals` -- partial object merged with existing goals. Keys: `calories`, `protein`, `water_oz`, `hardcore.calories`, `hardcore.protein`, `hardcore.water_oz`
     - `preferences` -- partial object merged with existing preferences
   - For regimen changes (new workout plan), output the full `regimen` field as you normally would in Phase 2 -- the existing import handles it. Just set `_planRequested: true` so Phase 2 generates a fresh plan.
   - For complex requests ("design me an abs-focused program", "I want to switch to OMAD"), set `_planRequested: true` AND include the user's intent in your coachResponse so Phase 2 can read it and generate accordingly.

11. **Concerns should be forward-looking, not alarming:**
    - The analysis may be generated mid-day while the user is still eating/drinking/exercising.
    - Frame concerns as tips for the rest of the day, not warnings about what's missing.
    - Good: "Dinner should target ~50g protein to close the gap"
    - Bad: "Protein at 50g is dangerously low — you've only hit half your target"
    - Don't treat a mid-day snapshot as a final report.

## Important

- **Read ALL profile files** (goals.json, preferences.json) before generating output. Goal targets and meal structure come from these files — never hardcode or assume defaults.
- **Do NOT generate `mealPlan` or `regimen` fields.** These are generated in a separate processing phase. Omit them from the output JSON entirely.
- Be precise with calorie estimates — use known nutrition data when available (packaged items with visible labels are high confidence)
- When a photo shows a packaged product, read the label for exact nutrition info
- Meal photos without notes should still be fully described and estimated
- Do NOT include body/face photo entries in the analysis — skip them entirely
