"""
commit_plan.py — Atomically commit a validated meal plan into an analysis JSON.

Usage:
    python commit_plan.py --date YYYY-MM-DD --plan-file PATH --source SOURCE [--data-dir PATH]
    python commit_plan.py --date YYYY-MM-DD --plan-stdin   --source SOURCE [--data-dir PATH]

Validation rules:
  - Every meal has: name, ingredients[], calories, protein, fat, fiber, prep_time
  - Every ingredient has: name, grams, cal, protein
  - sum(ingredient.cal) ≈ meal.calories ±2
  - day_totals ≈ sum(all meal calories/protein/fat/fiber) ±2
"""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


# ── Validation ─────────────────────────────────────────────────────────────

REQUIRED_MEAL_FIELDS = {"name", "ingredients", "calories", "protein", "fat", "fiber", "prep_time"}
REQUIRED_INGREDIENT_FIELDS = {"name", "grams", "cal", "protein"}


def _validate_ingredient(ing, meal_name, idx):
    missing = REQUIRED_INGREDIENT_FIELDS - set(ing.keys())
    if missing:
        raise ValueError(
            f"Meal '{meal_name}' ingredient[{idx}] missing fields: {sorted(missing)}"
        )
    if not isinstance(ing["cal"], (int, float)):
        raise ValueError(
            f"Meal '{meal_name}' ingredient[{idx}].cal must be numeric, got {type(ing['cal']).__name__}"
        )


def _validate_meal(meal, meal_idx):
    missing = REQUIRED_MEAL_FIELDS - set(meal.keys())
    if missing:
        raise ValueError(f"Meal[{meal_idx}] '{meal.get('name', '?')}' missing fields: {sorted(missing)}")

    name = meal["name"]
    ings = meal["ingredients"]
    if not isinstance(ings, list):
        raise ValueError(f"Meal '{name}' ingredients must be a list")

    for i, ing in enumerate(ings):
        _validate_ingredient(ing, name, i)

    ing_cal_sum = sum(ing["cal"] for ing in ings)
    if abs(ing_cal_sum - meal["calories"]) > 2:
        raise ValueError(
            f"Meal '{name}': ingredient cal sum {ing_cal_sum:.1f} differs from "
            f"meal.calories {meal['calories']} by more than ±2"
        )


def _validate_day(day, day_idx):
    meals = day.get("meals", [])
    if not isinstance(meals, list):
        raise ValueError(f"days[{day_idx}] 'meals' must be a list")

    for i, meal in enumerate(meals):
        _validate_meal(meal, i)

    totals = day.get("day_totals")
    if totals is None:
        return  # day_totals is optional per day; checked at top level

    for field, key in [("calories", "calories"), ("protein", "protein"),
                       ("fat", "fat"), ("fiber", "fiber")]:
        if key not in totals:
            continue
        expected = sum(m.get(field, 0) for m in meals)
        actual = totals[key]
        if abs(actual - expected) > 2:
            raise ValueError(
                f"days[{day_idx}] day_totals.{key} {actual} differs from "
                f"sum of meals {expected:.1f} by more than ±2"
            )


def validate_plan(plan):
    """Raise ValueError describing the first schema violation found."""
    if not isinstance(plan, dict):
        raise ValueError("Plan must be a JSON object")

    days = plan.get("days")
    if days is None:
        raise ValueError("Plan missing 'days' key")
    if not isinstance(days, list):
        raise ValueError("Plan 'days' must be a list")

    for i, day in enumerate(days):
        _validate_day(day, i)

    # Top-level day_totals (some plans put it here instead of per-day)
    totals = plan.get("day_totals")
    if totals is not None:
        all_meals = [m for d in days for m in d.get("meals", [])]
        for field, key in [("calories", "calories"), ("protein", "protein"),
                           ("fat", "fat"), ("fiber", "fiber")]:
            if key not in totals:
                continue
            expected = sum(m.get(field, 0) for m in all_meals)
            actual = totals[key]
            if abs(actual - expected) > 2:
                raise ValueError(
                    f"Top-level day_totals.{key} {actual} differs from "
                    f"sum of all meals {expected:.1f} by more than ±2"
                )


# ── File I/O ────────────────────────────────────────────────────────────────

def _atomic_write(path: Path, data: dict):
    """Write JSON atomically via a sibling temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ── Timeline ────────────────────────────────────────────────────────────────

def _append_timeline(data_dir: Path, date: str, source: str):
    timeline_path = data_dir / "timeline.json"
    events = []
    if timeline_path.exists():
        try:
            events = json.loads(timeline_path.read_text(encoding="utf-8"))
            if not isinstance(events, list):
                events = []
        except (json.JSONDecodeError, OSError):
            events = []

    events.append({
        "type": "preference",
        "summary": f"Meal plan committed for {date} (coach session)",
        "source": "coach-session",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    _atomic_write(timeline_path, events)


# ── Main ────────────────────────────────────────────────────────────────────

def commit_plan(date: str, plan: dict, source: str, data_dir: Path):
    analysis_path = data_dir / "analysis" / f"{date}.json"
    if not analysis_path.exists():
        print(f"ERROR: analysis/{date}.json not found in {data_dir}", file=sys.stderr)
        sys.exit(1)

    try:
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR: could not parse {analysis_path}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        validate_plan(plan)
    except ValueError as e:
        print(f"ERROR: plan validation failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Set source fields
    plan["source"] = source
    for day in plan.get("days", []):
        day["source"] = source

    analysis["mealPlan"] = plan

    _atomic_write(analysis_path, analysis)

    # Delete .uploaded sentinel so watcher re-uploads
    uploaded_marker = analysis_path.with_suffix(".json.uploaded")
    if uploaded_marker.exists():
        uploaded_marker.unlink()

    _append_timeline(data_dir, date, source)

    meal_count = sum(len(d.get("meals", [])) for d in plan.get("days", []))
    print(
        f"OK: committed meal plan for {date} "
        f"({len(plan.get('days', []))} days, {meal_count} meals, source={source})"
    )


def main():
    parser = argparse.ArgumentParser(description="Commit a meal plan into analysis JSON")
    parser.add_argument("--date", required=True, help="Date in YYYY-MM-DD format")
    parser.add_argument("--plan-file", dest="plan_file", help="Path to plan JSON file")
    parser.add_argument("--plan-stdin", dest="plan_stdin", action="store_true",
                        help="Read plan JSON from stdin")
    parser.add_argument("--source", required=True,
                        help="Source label (e.g. coach-session, coach-session-2026-05-02)")
    parser.add_argument("--data-dir", dest="data_dir", default=".",
                        help="Coach data directory (default: cwd)")
    args = parser.parse_args()

    if not args.plan_file and not args.plan_stdin:
        parser.error("One of --plan-file or --plan-stdin is required")
    if args.plan_file and args.plan_stdin:
        parser.error("--plan-file and --plan-stdin are mutually exclusive")

    if args.plan_stdin:
        raw = sys.stdin.read()
    else:
        plan_path = Path(args.plan_file)
        if not plan_path.exists():
            print(f"ERROR: plan file not found: {plan_path}", file=sys.stderr)
            sys.exit(1)
        raw = plan_path.read_text(encoding="utf-8")

    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: plan JSON parse error: {e}", file=sys.stderr)
        sys.exit(1)

    commit_plan(
        date=args.date,
        plan=plan,
        source=args.source,
        data_dir=Path(args.data_dir),
    )


if __name__ == "__main__":
    main()
