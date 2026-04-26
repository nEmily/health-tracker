# Identity

Immutable facts about you. Nothing that drifts — no current weight, no current
PR, no current phase, no current targets. Those live in `goals.json`,
`regimen.json`, and the computed `current-stats.json` (regenerated every
processing cycle from your logged data).

## Physical

- Height:
- Sex:
- Age / DOB year:

## Body Composition Pattern

- Any genetic patterns or lifelong body composition notes (e.g. "stores fat in
  midsection", "ectomorph", "hypothyroid family history")

## Hard Constraints

- Weight floor / ceiling (medical/safety): leave blank if none
- Food allergies:
- Dietary dislikes / no-goes:

## Life / Schedule Context

- Work schedule, commute, family meal constraints
- Anything that structurally shapes when and how you eat or train

## Long-Standing Challenges

- Patterns to watch (not current bugs — long-standing habits)

## Food Culture

- Cuisines you gravitate toward, go-to meals

## Equipment Owned

- List gear you currently own and use (bands, dumbbells, treadmill, etc.)
- Do NOT list equipment "on order" — add it here only once it arrives

---

Copy this file to `HEALTH_DATA_DIR/profile/identity.md` and fill in the sections
that apply. Leave blank what doesn't. Claude reads this during processing to
personalize advice, but your CURRENT weight/stats always come from
`profile/current-stats.json` (computed, not hand-written).
