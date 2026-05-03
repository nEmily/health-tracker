"""
compute_streaks.py — Compute consecutive-day goal streaks from analysis history.

Walks data_dir/analysis/*.json in descending date order, counting consecutive
days that hit:
  - tracking:  any entries logged that day
  - calories:  within 150 kcal of goal (on_track or under)
  - protein:   at or above floor

NO LLM calls. Pure Python / stdlib.
"""

from __future__ import annotations
import json
import re
from pathlib import Path
from lib import goals_resolver


def compute(data_dir: Path, date: str, totals: dict) -> dict:
    """Compute streaks.

    Args:
        data_dir: User's coach data directory.
        date:     Today's date (YYYY-MM-DD) — used as the start of the streak check.
        totals:   Today's computed totals (from compute_totals.compute()).

    Returns dict with keys:
        tracking  — consecutive days with any entries logged
        calories  — consecutive days within calorie goal
        protein   — consecutive days at/above protein floor
    """
    analysis_dir = data_dir / "analysis"
    if not analysis_dir.exists():
        return _zero_streaks()

    # Collect and sort all analysis files descending
    files = sorted(
        [f for f in analysis_dir.glob("*.json") if _is_date_file(f.stem)],
        key=lambda f: f.stem,
        reverse=True,
    )

    tracking_streak = 0
    calories_streak = 0
    protein_streak  = 0

    # Check today first using passed-in totals
    # Then walk history
    today_checked = False

    for f in files:
        file_date = f.stem

        if file_date > date:
            # Future file — skip
            continue

        if file_date == date:
            # Use today's totals (not yet written)
            day_totals = totals
            day_goals = None  # will load from file's pwaProfile if present
            day_entries_count = 1  # we know there are entries if we got here
        else:
            try:
                with open(f, encoding="utf-8") as fh:
                    analysis = json.load(fh)
            except (json.JSONDecodeError, OSError):
                break  # gap in history — stop streak

            day_totals = analysis.get("totals") or {}
            day_goals = analysis.get("pwaProfile", {}).get("goals") or {}
            entries = analysis.get("entries") or []
            day_entries_count = len(entries)

        resolved = goals_resolver.resolve(day_goals or {})

        # Tracking: any entries
        has_tracking = day_entries_count > 0

        # Calories: on_track (within ±150) or under
        cal_status = goals_resolver.calories_status(
            day_totals.get("calories", 0), resolved
        )
        has_calories = cal_status in ("on_track", "under")

        # Protein: at or above floor
        protein_floor = resolved.get("protein_floor") or 0
        has_protein = day_totals.get("protein", 0) >= protein_floor

        if has_tracking:
            tracking_streak += 1
        else:
            if file_date != date:
                tracking_streak = 0
            break  # gap breaks streak for all

        if has_calories:
            calories_streak += 1
        else:
            calories_streak = 0  # reset but continue checking tracking

        if has_protein:
            protein_streak += 1
        else:
            protein_streak = 0

        today_checked = True

    if not today_checked:
        # Today's file may not exist yet — seed from today's totals
        pass

    return {
        "tracking": tracking_streak,
        "calories": calories_streak,
        "protein":  protein_streak,
    }


def _is_date_file(stem: str) -> bool:
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}$', stem))


def _zero_streaks() -> dict:
    return {"tracking": 0, "calories": 0, "protein": 0}
