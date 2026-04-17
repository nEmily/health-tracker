# /validate — Health Tracker

End-to-end verification that the PWA works correctly. Six phases: static checks, Playwright regression tests, AI visual QA (screenshots), interactive dogfood loop, Chrome extension live QA, and chaos testing.

## Quick Run

```bash
cd C:\Users\emily\projects\health-tracker

# Phase 1: Static checks (fast, no browser)
for f in pwa/scripts/*.js pwa/sw.js; do node --check "$f" 2>&1; done
node coach-plugin/generate-sdk.js && git diff --exit-code coach-plugin/coach-sdk.md || echo "FAIL: coach-sdk.md is stale — run node coach-plugin/generate-sdk.js and commit the result"
diff -u processing/process-day-prompt.md coach-plugin/scripts/process-day-prompt.md > /dev/null && echo "prompt drift: OK" || echo "FAIL: processing/process-day-prompt.md and coach-plugin/scripts/process-day-prompt.md have diverged — sync them"
diff -u processing/plan-prompt.md coach-plugin/scripts/plan-prompt.md > /dev/null && echo "plan-prompt drift: OK" || echo "FAIL: processing/plan-prompt.md and coach-plugin/scripts/plan-prompt.md have diverged — sync them"
for f in processing/process-day.bat processing/process-day.sh coach-plugin/scripts/process-day.bat coach-plugin/scripts/process-day.sh; do claude_calls=$(grep -c 'claude -p' "$f"); model_flags=$(grep -c -- '--model' "$f"); [ "$claude_calls" = "$model_flags" ] || echo "FAIL: $f has $claude_calls claude -p call(s) but $model_flags --model flag(s) — missing pin risks silent Opus upgrade"; done; echo "model pin check done"

# Phase 2: Playwright tests (server starts automatically, no manual setup)
node test-fixtures/run-tests.js --screenshots

# Phase 2.5: AI Visual QA (read screenshots, evaluate visually — see below)
# No command — Claude Code reads .claude/test-screenshots/ PNGs and evaluates them

# Phase 2 + Phase 3: Full validation including interactive dogfood
node test-fixtures/run-tests.js --screenshots --dogfood

# Phase 3.5: Chrome Extension Live QA (requires --chrome flag)
# Launch: claude --chrome
# Then interactively browse http://localhost:8080 using Chrome MCP tools

# Phase 4: Chaos testing (random user actions, invariant checks)
node test-fixtures/chaos.js --rounds 50 --screenshots
```

## Phase 1 — Static Checks

1. **JS syntax**: `node --check` on all scripts and sw.js
2. **File integrity**: Verify all files referenced in index.html, manifest.json, and sw.js exist
3. **Manifest validation**: start_url resolves correctly, scope is consistent, paths use `/health-tracker/`
4. **Service worker**: sw.js cache list references existing files
5. **Coach SDK freshness**: Regenerate the SDK and verify it matches the committed file:
   ```bash
   node coach-plugin/generate-sdk.js
   git diff --exit-code coach-plugin/coach-sdk.md
   ```
   If it differs: FAIL — "coach-sdk.md is stale — run `node coach-plugin/generate-sdk.js` and commit the result"
6. **Plugin agent reference**: Verify `settings.json` agent value uses the fully qualified `plugin-name:agent-name` format (e.g., `coach:coach`, not just `coach`). The plugin system registers agents as `plugin:agent` — a bare name silently fails to activate.
7. **Processing prompt drift**: `processing/process-day-prompt.md` and `coach-plugin/scripts/process-day-prompt.md` must be byte-identical. The plugin ships a mirror copy for standalone installs; drift between the two means downstream users (including Michael) are running a stale prompt. Fix: copy `processing/process-day-prompt.md` over the plugin version, or vice versa depending on which is canonical for the change. Same check applies to `plan-prompt.md`.
8. **Cron model pin**: every `claude -p` call in `processing/*.{bat,sh}` and `coach-plugin/scripts/*.{bat,sh}` must include `--model sonnet` (or equivalent). Missing flag means the scheduled task falls back to the CLI default, which can silently upgrade to Opus on plan changes — blows up token costs.

## Phase 2 — Playwright Regression Tests

The test runner (`test-fixtures/run-tests.js`) does:

1. **Loads app** in headless Chromium, captures console errors
2. **Injects fake data** — 5 days of entries, analyses, goals, regimen, meal plan (from `test-fixtures/data.js`)
3. **Tests every screen**:
   - Today: score ring, entry list, quick actions, coach input, + Add Entry
   - Plan: meal plan rendering (not empty state)
   - Progress: timeline, sparkline, calendar heatmap, averages, streaks, fitness goals
   - Profile: daily targets, goal setup modal, cloud sync, backup, storage, danger button
4. **Tests interactions**:
   - Water picker modal open/close
   - Supplement modal open/close
   - Goal setup modal (labels, pre-filled values)
   - Entry tap-to-edit modal
   - Date navigation between fixture days
5. **Verifies scoring**:
   - Full day scores higher than minimal day
   - Vice day gets penalty
   - Rest day shows "Rest" chip
   - Score numbers are valid (0-100)
6. **Verifies entry types**: Food, Workout, Supplement labels render correctly
7. **Multi-viewport**: 320px, 390px, 768px — no horizontal overflow, nav visible
8. **Verifies analysis status**: Entry cards show inline calories when analysis IDs match, "Pending analysis" when unmatched
9. **Console errors**: Flags any JS errors (ignoring favicon/SW noise)

Pass `--screenshots` to save screenshots to `.claude/test-screenshots/validate/`.

## Phase 3 — Interactive Dogfood Loop

Pass `--dogfood` to run the full interactive E2E flow after Phase 2. This tests the app like a real user — pressing every button, filling fields, uploading photos, and screenshotting every state change.

The dogfood runner (`test-fixtures/dogfood.js`) does:

1. **Fresh start** — clears all IndexedDB data, verifies empty/welcome state
2. **Onboarding** — sets goals (1200 cal, 105g protein, 64oz water), verifies they persist
3. **Log food** — opens + Add Entry -> Food, enters notes "Test chicken salad", saves, verifies entry appears
4. **Log water** — opens water picker, selects amount, verifies total updates
5. **Log weight** — opens weight entry, enters 145, saves
6. **Log dailies** — opens dailies modal, checks for empty state or items
7. **Edit entry** — taps entry, unlocks, changes notes, saves, verifies updated text
8. **Delete entry** — taps entry, unlocks, deletes, verifies count decreases
9. **Navigate dates** — taps prev/next arrows, verifies date changes
10. **Plan tab** — navigates, screenshots empty state or content
11. **Progress tab** — navigates, verifies calendar renders
12. **Profile tab** — verifies Daily Targets, Cloud Sync card, Sync Now, storage info
13. **Goal setup modal** — edits goals to 1500, verifies card updates, restores to 1200
14. **Cloud Sync setup** — opens sync setup modal, verifies URL/Key fields
15. **Water picker detailed** — tries multiple water amounts, verifies totals accumulate
16. **Photo upload** — uses file chooser interception to upload a canvas-generated test image
17. **Multi-viewport** — runs on 320px and 390px viewports, checks overflow and touch targets on every tab

Screenshots saved to `.claude/test-screenshots/dogfood/` with sequential numbering (e.g. `dogfood-01-fresh-start.png`).

Can also run standalone: `node test-fixtures/dogfood.js`

## Test Data

`test-fixtures/data.js` builds 5 days of fixture data (dates are relative to today):

| Day | Offset | Content | Expected Score |
|-----|--------|---------|---------------|
| 1 | -4 | Full: 3 meals, workout, supplements, water met | High |
| 2 | -3 | Partial: 2 meals, missed workout | Medium |
| 3 | -2 | Rest day, 3 meals, water met | High |
| 4 | -1 | Minimal: 1 drink | Low |
| 5 | 0 | Vices: 2 meals + 3 drinks | Penalized |

Plus: goals (1200/1000 cal), weekly regimen, meal plan, fitness goals, streaks.

## When to Run

- After any code changes to scripts, HTML, or CSS
- **Before pushing — never push without running tests first.** CSS layout changes (overflow, position, height) can silently break scrolling or hide content. The scroll behavior test catches these.
- After dependency or data model changes
- When adding new entry types or UI components
- Use `--dogfood` for comprehensive E2E verification before releases or major refactors

## Updating Fixtures

When adding new features, update `test-fixtures/data.js` to include test cases for the new feature, and add assertions in `test-fixtures/run-tests.js`. The fixtures should grow as the app grows.

**If all new tests pass on the first run, there is a gap.** Tests that never fail are not testing hard enough -- they may be checking the wrong thing, using stale selectors, or missing the actual failure mode. When a new batch of tests passes 100% immediately, write more tests targeting edge cases, error paths, and adversarial inputs until at least one fails. Then fix the code or the test. A test suite that only confirms things work is not catching bugs.

**Critical:** Analysis entries in fixtures MUST have `id` fields matching their corresponding IndexedDB entry IDs. Without matching IDs, analysis-status features (inline calories, pending/stale indicators) won't render — they'll silently fail with no errors. Always visually verify screenshots after changes to entry rendering.

## Phase 2.5 — AI Visual QA

After Playwright tests pass (Phase 2), run AI-powered visual evaluation on the screenshots. This catches layout, theme, and UX issues that DOM assertions miss.

### How it works

Playwright already saves screenshots to `.claude/test-screenshots/validate/` during Phase 2. In this phase, Claude Code reads the screenshots directly (multimodal) and evaluates them against the criteria below. No API key needed — Claude Code is the evaluator.

### Process

1. **Read key screenshots** — use the Read tool on these PNG files (Claude Code can see images):

   **Core screens (always check):**
   - `audit-today-diet.png`, `audit-today-fitness.png`, `audit-today-skin.png` — all 3 Today panels
   - `audit-coach.png` — Coach tab
   - `audit-progress-insights.png`, `audit-progress-trends.png`, `audit-progress-skin.png` — Progress tabs
   - `audit-settings.png`, `audit-settings-bottom.png` — Settings
   - `challenges-progress.png`, `challenges-320px.png` — Challenges tab at both viewports

   **Modals and interactions:**
   - `final-water.png` — water picker modal
   - `final-edit-modal.png` — entry edit modal
   - `review-13-goal-setup.png` — goal setup modal
   - `review-15-more-sheet.png` — more actions sheet

   **Narrow viewport (320px):**
   - `visual-qa-320.png`, `visual-qa-settings-320.png`, `visual-qa-coach-320.png`, `visual-qa-progress-320.png`

   **If dogfood screenshots exist** (`.claude/test-screenshots/dogfood/`):
   - `dogfood-01-fresh-start.png` — empty/welcome state
   - Any `dogfood-*-viewport-*.png` — multi-viewport checks

2. **Evaluate each screenshot** against these criteria:

   | Category | What to check | Fail examples |
   |----------|--------------|---------------|
   | **Layout** | Centering, spacing, overflow, alignment | Content cut off, elements overlapping, asymmetric padding |
   | **Theme** | All elements match dark theme, cool tones | White/unstyled elements, warm colors, default browser styling |
   | **Touch targets** | Minimum 44px on mobile | Tiny buttons, cramped links, overlapping tap areas |
   | **Text** | Readability, contrast, no truncation | Text running off-screen, illegible contrast, ellipsis where it shouldn't be |
   | **Empty states** | Graceful placeholders | "undefined", "NaN", "?g", "[object Object]", blank where content expected |
   | **Modals** | Consistent styling | Missing close button, no backdrop, inconsistent border radius |
   | **Visual artifacts** | Stray dots, misaligned elements, rendering glitches | Orphan elements, half-rendered components |

3. **Report findings** as PASS, WARN, or FAIL:
   - **PASS** — no visual issues found
   - **WARN** — minor cosmetic issues (slightly off spacing, minor inconsistency) — note them but don't block
   - **FAIL** — broken layout, invisible text, missing content, theme violations — must fix before shipping

### Tips for effective visual QA

- Compare 320px screenshots against wider ones — layout should adapt, not break
- Look for elements that "disappear" at narrow viewports (hidden by overflow)
- Check that modals don't extend past the viewport on mobile
- Verify scroll indicators exist when content overflows vertically
- Dark theme: watch for white flashes, unstyled inputs, default select dropdowns

## Phase 3.5 — Chrome Extension Live QA

Uses the Claude Chrome extension (MCP tools) to interactively browse the running app in a real browser and evaluate it like a user would. This catches issues that headless Playwright misses — real rendering, real touch behavior, real scroll physics.

**Requires:** Claude Code launched with `--chrome` flag (enables Chrome MCP tools). The Chrome extension must be installed and connected.

### Setup

```bash
# Start local server in background
cd C:\Users\emily\projects\health-tracker && python -m http.server 8080 -d pwa &

# Launch Claude Code with Chrome extension
claude --chrome
```

### Process

Use these MCP tools to walk through the app:

1. **Navigate** to `http://localhost:8080` using `mcp__claude-in-chrome__navigate`
2. **Screenshot** each screen using `mcp__claude-in-chrome__computer` (action: screenshot)
3. **Interact** — tap buttons, open modals, swipe panels, scroll — using `mcp__claude-in-chrome__computer` (action: click/type/scroll)
4. **Run JS checks** using `mcp__claude-in-chrome__javascript_tool` for DOM assertions

### Walkthrough checklist

Walk through these flows in order, screenshotting and evaluating at each step:

**Today tab:**
- [ ] Load app — score ring renders, date shows correctly
- [ ] Swipe between Diet / Fitness / Skin panels
- [ ] Tap Food quick action — form opens, type a meal, save
- [ ] Tap Water — picker opens, select amount, verify total updates
- [ ] Tap an entry — edit modal opens, content editable
- [ ] Navigate to previous day and back

**Coach tab:**
- [ ] Inbox renders (or empty state)
- [ ] Skincare section shows routine or onboarding wizard
- [ ] If onboarding: walk through all 5 steps (welcome, concerns, product photo, face photo, completion)

**Progress tab:**
- [ ] Insights / Trends / Skin / Challenges sub-tabs all render
- [ ] Challenges: tap "Start a Challenge" — template picker opens with icons/difficulty
- [ ] Select a template — confirmation step shows tasks, duration, dates
- [ ] Enroll — onboarding screen appears, then challenge card with checklist

**Settings tab:**
- [ ] Daily targets card shows values
- [ ] Goal setup modal opens/closes
- [ ] Cloud Sync card present

**Mobile viewport:**
- [ ] Resize browser to ~320px width
- [ ] Verify no horizontal overflow on any tab
- [ ] Verify touch targets are large enough
- [ ] Modals don't overflow viewport

### Evaluation

Report findings using the same PASS/WARN/FAIL criteria as Phase 2.5. Chrome extension QA is the highest-fidelity check — if something looks broken here, it's broken for real users.

### When to run

- Before releases to main
- After major UI changes (new screens, layout overhauls)
- When Phase 2.5 screenshot review flags something ambiguous
- Not needed for every small change — use judgment

## Phase 4 — Chaos Testing

The chaos runner (`test-fixtures/chaos.js`) simulates unpredictable user behavior — random clicks in random order, with invariant checks after every action.

**Actions pool** (weighted random):
- Navigation: tab switches, day arrows, double-taps
- Quick actions: water, dailies, more sheet
- Stat card taps: water, workout, weight
- Modal interactions: open, close, select options
- Fitness: toggle exercise checks, expand info
- **Interrupt scenarios** (high weight): open form → immediately navigate, open modal → switch tabs

**Invariants checked after every action:**
- No horizontal overflow (`body.scrollWidth <= viewport`)
- Max 1 modal overlay (no stacked modals)
- No stale inline forms (tracks which date form was opened on — flags if date changes while form stays visible)
- Exactly 4 visible nav buttons
- Exactly 1 active screen
- No unhandled JS errors

Run: `node test-fixtures/chaos.js --rounds 50 --screenshots`

### Validating Chaos Tests

**When adding new invariants or actions, always verify against a known bug.** A chaos test that passes on both buggy and fixed code is worthless. To verify:
1. Temporarily revert the fix (swap in old file)
2. Run chaos — it MUST catch the bug
3. Restore the fix — chaos MUST pass
4. Only then commit the test

This was learned the hard way: the original stale-form invariant checked "form visible on non-today screen" but the real bug was "form opened on date A, visible on date B" — both on the Today screen. The test passed on buggy code for 50 rounds until the invariant was corrected to track the form's originating date.

## Chaos Testing Checklist

Every `/validate` run should include adversarial inputs -- not just happy-path data. In the health-tracker project, chaos tests caught 43 bugs that 3 rounds of code review plus happy-path tests missed. The root cause: JS comparisons like `null > null === false` let guards silently pass null through without throwing.

When writing or updating tests, cover these categories:

### Null / undefined / empty string
- Pass `null`, `undefined`, and `""` to every public function
- Verify functions return graceful defaults or throw, never silently produce `NaN` or `undefined` in rendered output

### Type confusion
- Pass a string where an array is expected (e.g. `"food"` instead of `["food"]`)
- Pass truthy non-array values (objects, numbers) to array parameters
- Pass `{}` where a populated object with specific fields is expected

### Extreme values
- `99999` calories, `0` water, `-1` weight, `NaN`, `Infinity`
- Empty arrays and objects where populated ones are expected
- Strings that look like numbers (`"42"`, `"0"`, `"NaN"`)

### Boundary conditions
- 4am day boundary (entries at 3:59am vs 4:00am)
- Midnight exactly
- Month-end and year-end transitions (Jan 31 -> Feb 1, Dec 31 -> Jan 1)
- Leap year dates (Feb 29)
- Date strings in wrong formats

### Partial / malformed data
- Analysis JSON missing expected fields
- Entries with null fields where strings are expected
- Goals with partial nesting (e.g. `moderate` exists but `moderate.calories` is missing)
- IndexedDB records with wrong types (number where string expected)

### Concurrent execution
- `Promise.all` on multiple simultaneous saves/loads
- Rapid-fire UI actions (double-tap save, tab switch during async operation)

### Visual chaos
- Render every screen with garbage data injected at 320px viewport
- Verify no `NaN`, `undefined`, `[object Object]`, or blank cards appear
- Check that overflow:hidden does not silently eat content

### Running chaos tests
```bash
node test-fixtures/chaos.js --rounds 50 --screenshots
```

The chaos runner and `test-fixtures/run-tests.js` should both exercise these categories. If `chaos.js` does not exist yet, this is a gap that must be filled before marking validation complete.

## Post-Deploy Smoke Test

After pushing, verify the deployed site loads:
```bash
curl -s -o /dev/null -w "%{http_code}" https://nemily.github.io/health-tracker/
# Should return 200
```
