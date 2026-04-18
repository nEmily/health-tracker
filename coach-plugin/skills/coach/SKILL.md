# /coach -- 1:1 Health Coach Session

Start a live coaching session. This is the real-time version of the async inbox.

## Usage

```
/coach              # Start a coaching session
/coach check-in     # Quick daily check-in
/coach meal-plan    # Discuss and update meal plan
/coach regimen      # Discuss and update workout regimen
/coach goals        # Review and adjust goals
/coach skincare     # Review skincare routine
```

## How It Works

The coach agent handles persona, context loading, and session behavior automatically (see `agents/coach.md`). This skill just provides argument-specific entry points.

## Steps

1. **Load context.** Read these files silently from CWD (don't dump them back):
   - `USER.md` -- who this person is
   - `conversations.md` -- async chat history
   - `weekly-summary.md` -- compact weekly overview
   - `profile/goals.json`, `profile/preferences.json`
   - `profile/timeline.json` -- plan evolution

2. **Read coach-rules.md** from the plugin root (`${CLAUDE_PLUGIN_ROOT}/coach-rules.md`). This is the source of truth for data rules, workout rules, and tone.

3. **Load on demand** -- don't pre-read everything:
   - `analysis/YYYY-MM-DD.json` -- when discussing a specific day
   - `profile/regimen.json` -- when discussing workouts
   - `profile/skincare.json` -- when discussing skincare
   - `coach-sdk.md` -- when creating entries or explaining scoring
   - `app-guide.md` -- when helping navigate the app

4. **After making changes** to any profile file, append to `profile/timeline.json`.

5. **Committing a meal plan** (when the `meal-plan` argument is used, or the user asks to save the plan): write the plan into `analysis/YYYY-MM-DD.json` under the `mealPlan` key — NOT to a sibling file like `analysis/YYYY-MM-DD/meal-plan.json`. The PWA only reads `mealPlan` from the top-level analysis JSON. Match the Phase 2 processing schema (`meals[]` with `ingredients[]` and totals). After writing, delete the `.uploaded` marker so the watcher re-uploads on the next cycle. See `agents/coach.md` for the full schema.

## Arguments

- `check-in` -- "How's today going?" Review what they've logged so far
- `meal-plan` -- Focus on meal planning: what to eat today/this week
- `regimen` -- Review workouts, adjust exercises, discuss progression
- `goals` -- Review goal progress, discuss whether targets need adjusting
- `skincare` -- Review skincare adherence, adjust products or rotation
- (no argument) -- Open-ended coaching conversation
