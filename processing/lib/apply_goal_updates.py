"""
apply_goal_updates.py — Apply phone-side goal-update deltas to canonical goals.json.

Reads extract_dir/profile/goal-updates.json (if present), applies deltas
in chronological order to data_dir/profile/goals.json, and appends
timeline.json entries for each non-trivial change.

Narrow-to-rich field mapping:
  delta.calories    -> goals.calories.daily  AND  goals.calories (back-compat scalar)
  delta.protein     -> goals.macros.protein.target (floor/ceiling unchanged)
  delta.fiber       -> goals.fiber.daily_g
  delta.water_oz    -> goals.water.daily_oz

Atomic write via temp file + rename.
NO LLM calls. Pure Python / stdlib.
"""

from __future__ import annotations
import json
import os
import time
from pathlib import Path


_NARROW_MAP = {
    # narrow_key: list of (json_path_as_tuple,)
    # For calories: set the rich-shape path. Only set back-compat scalar when
    # the current value is already a scalar (not a dict) — prevents overwriting rich shape.
    "calories": [
        ("calories", "daily"),    # rich shape
    ],
    "protein": [
        ("macros", "protein", "target"),
    ],
    "fiber": [
        ("fiber", "daily_g"),
    ],
    "water_oz": [
        ("water", "daily_oz"),
    ],
}


def apply_goal_updates(data_dir: Path, extract_dir: Path) -> int:
    """Apply goal-update deltas from the phone to the canonical goals.json.

    Returns the number of deltas applied (0 if no update file or no changes).
    """
    updates_path = extract_dir / "profile" / "goal-updates.json"
    if not updates_path.exists():
        return 0

    with open(updates_path, encoding="utf-8") as f:
        updates_data = json.load(f)

    # Accept list at top level OR wrapped in {updates: [...]}
    if isinstance(updates_data, list):
        updates_list = updates_data
    elif isinstance(updates_data, dict):
        updates_list = updates_data.get("updates") or []
    else:
        return 0

    if not updates_list:
        return 0

    # Sort chronologically
    updates_list = sorted(updates_list, key=lambda u: u.get("timestamp", 0))

    goals_path = data_dir / "profile" / "goals.json"
    if goals_path.exists():
        with open(goals_path, encoding="utf-8") as f:
            goals = json.load(f)
    else:
        goals = {}

    timeline_path = data_dir / "profile" / "timeline.json"
    timeline: list = []
    if timeline_path.exists():
        with open(timeline_path, encoding="utf-8") as f:
            existing = json.load(f)
            if isinstance(existing, list):
                timeline = existing

    applied = 0

    for update in updates_list:
        if not isinstance(update, dict):
            continue

        if "timestamp" not in update:
            print(f"[apply_goal_updates] WARNING: skipping update without timestamp: {update}", flush=True)
            continue

        changed_fields: list[str] = []

        for narrow_key, paths in _NARROW_MAP.items():
            if narrow_key not in update:
                continue

            new_value = update[narrow_key]
            if new_value is None:
                continue

            for path in paths:
                old_value = _get_nested(goals, path)
                # Skip if value is already a dict (rich shape) and we're comparing to a scalar
                if isinstance(old_value, dict):
                    continue
                if old_value == new_value:
                    continue
                _set_nested(goals, path, new_value)
                changed_fields.append(narrow_key)

            # Also set back-compat scalar only if existing top-level calories is already scalar
            if narrow_key == "calories":
                existing_cal = goals.get("calories")
                if isinstance(existing_cal, (int, float)) and existing_cal != new_value:
                    goals["calories"] = new_value
                    if narrow_key not in changed_fields:
                        changed_fields.append(narrow_key)

        # Also handle arbitrary nested paths passed directly
        # (e.g. {"path": "fiber.daily_g", "value": 30})
        if "path" in update and "value" in update:
            path_str = update["path"]
            path_tuple = tuple(path_str.split("."))
            new_value = update["value"]
            old_value = _get_nested(goals, path_tuple)
            if old_value != new_value:
                _set_nested(goals, path_tuple, new_value)
                changed_fields.append(path_str)

        if not changed_fields:
            continue

        applied += 1

        # Append timeline entry
        ts = update.get("timestamp") or int(time.time() * 1000)
        summary_parts = ", ".join(f"{k}={update.get(k)}" for k in changed_fields)
        timeline.append({
            "type": "goal_update",
            "timestamp": ts,
            "source": update.get("source", "phone"),
            "summary": f"Goal update from phone: {summary_parts}",
            "fields": changed_fields,
        })

    if applied == 0:
        return 0

    # Atomic write: goals.json
    _atomic_write(goals_path, goals)

    # Atomic write: timeline.json
    _atomic_write(timeline_path, timeline)

    return applied


def _get_nested(obj: dict, path: tuple) -> object:
    """Get a nested value by path tuple. Returns None if missing."""
    current = obj
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _set_nested(obj: dict, path: tuple, value: object) -> None:
    """Set a nested value by path tuple, creating intermediate dicts as needed."""
    current = obj
    for key in path[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[path[-1]] = value


def _atomic_write(path: Path, data: object) -> None:
    """Write JSON atomically (temp file + rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise
