"""
commit_goal.py — Atomically apply goal patches to profile/goals.json.

Usage:
    python commit_goal.py --field path.to.field --value VALUE [--field ...] [--data-dir PATH]
    python commit_goal.py --patch-file PATH [--data-dir PATH]

--value is parsed as JSON if possible, otherwise treated as a string.

Timeline event levels:
  major  — calories.daily or weight.goal/current changed by >5%
  minor  — protein, fiber, or water fields changed
  note   — everything else
"""

import argparse
import copy
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


# ── Deep merge ──────────────────────────────────────────────────────────────

def _deep_merge(base: dict, patch: dict) -> dict:
    """Return a new dict merging patch into base (patch wins on conflicts)."""
    result = copy.deepcopy(base)
    for key, val in patch.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = copy.deepcopy(val)
    return result


# ── Field path helpers ───────────────────────────────────────────────────────

def _set_nested(obj: dict, path: str, value) -> dict:
    """Return a copy of obj with path.to.field set to value (deep merge style)."""
    keys = path.split(".")
    patch = {}
    cursor = patch
    for i, key in enumerate(keys):
        if i == len(keys) - 1:
            cursor[key] = value
        else:
            cursor[key] = {}
            cursor = cursor[key]
    return _deep_merge(obj, patch)


def _get_nested(obj: dict, path: str):
    """Return the value at path.to.field, or None if missing."""
    keys = path.split(".")
    cursor = obj
    for key in keys:
        if not isinstance(cursor, dict) or key not in cursor:
            return None
        cursor = cursor[key]
    return cursor


# ── Timeline level computation ───────────────────────────────────────────────

_MINOR_PATHS = {"protein", "fiber", "water"}


def _compute_level(before: dict, after: dict) -> str:
    """Determine timeline event level based on what changed."""
    def pct_change(old, new):
        if old is None or new is None:
            return 0.0
        try:
            old_f = float(old)
            if old_f == 0:
                return 0.0
            return abs(float(new) - old_f) / abs(old_f)
        except (TypeError, ValueError):
            return 0.0

    # Major: calories.daily changed by >5%
    old_cal = _get_nested(before, "calories.daily")
    new_cal = _get_nested(after, "calories.daily")
    if old_cal != new_cal and pct_change(old_cal, new_cal) > 0.05:
        return "major"

    # Major: weight.goal or weight.current changed by >5%
    for wpath in ("weight.goal", "weight.current"):
        old_w = _get_nested(before, wpath)
        new_w = _get_nested(after, wpath)
        if old_w != new_w and pct_change(old_w, new_w) > 0.05:
            return "major"

    # Minor: any top-level key that matches minor-path set changed
    for key in _MINOR_PATHS:
        if _get_nested(before, key) != _get_nested(after, key):
            return "minor"

    return "note"


# ── Diff helper ──────────────────────────────────────────────────────────────

def _diff_lines(before: dict, after: dict) -> list[str]:
    """Return simple before/after diff lines for changed top-level keys."""
    lines = []
    all_keys = sorted(set(before.keys()) | set(after.keys()))
    for key in all_keys:
        old_val = before.get(key)
        new_val = after.get(key)
        if old_val != new_val:
            lines.append(f"  - {key}: {json.dumps(old_val)}")
            lines.append(f"  + {key}: {json.dumps(new_val)}")
    return lines


# ── Atomic write ─────────────────────────────────────────────────────────────

def _atomic_write(path: Path, data: dict):
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


# ── Timeline ──────────────────────────────────────────────────────────────────

def _append_timeline(data_dir: Path, level: str, changed_fields: list[str]):
    # Convention: profile/timeline.json (parallel to goals.json/preferences.json).
    # Older code wrote to data_dir/timeline.json which doesn't match production
    # layout — production has only one timeline file under profile/.
    timeline_path = data_dir / "profile" / "timeline.json"
    events = []
    if timeline_path.exists():
        try:
            events = json.loads(timeline_path.read_text(encoding="utf-8"))
            if not isinstance(events, list):
                events = []
        except (json.JSONDecodeError, OSError):
            events = []

    events.append({
        "type": "goal_update",
        "level": level,
        "fields": changed_fields,
        "source": "commit-goal",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    _atomic_write(timeline_path, events)


# ── Main ──────────────────────────────────────────────────────────────────────

def _parse_value(raw: str):
    """Parse a CLI value as JSON if possible, else return as string."""
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw


def commit_goal(patch: dict, data_dir: Path):
    goals_path = data_dir / "profile" / "goals.json"
    if not goals_path.exists():
        print(f"ERROR: goals.json not found at {goals_path}", file=sys.stderr)
        sys.exit(1)

    try:
        before = json.loads(goals_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR: could not parse {goals_path}: {e}", file=sys.stderr)
        sys.exit(1)

    after = _deep_merge(before, patch)

    changed_fields = [k for k in set(list(before.keys()) + list(after.keys()))
                      if before.get(k) != after.get(k)]

    level = _compute_level(before, after)
    _atomic_write(goals_path, after)
    _append_timeline(data_dir, level, changed_fields)

    diff = _diff_lines(before, after)
    if diff:
        print("Goals updated:")
        for line in diff:
            print(line)
    else:
        print("No changes (patch was identical to current goals).")
    print(f"Timeline event: level={level}, fields={changed_fields}")


def main():
    parser = argparse.ArgumentParser(description="Apply patches to profile/goals.json")
    parser.add_argument("--field", action="append", dest="fields", metavar="PATH",
                        help="Dotted field path (repeatable, used with --value)")
    parser.add_argument("--value", action="append", dest="values", metavar="VALUE",
                        help="Value for the preceding --field (JSON or string)")
    parser.add_argument("--patch-file", dest="patch_file",
                        help="Path to a JSON patch object")
    parser.add_argument("--data-dir", dest="data_dir", default=".",
                        help="Coach data directory (default: cwd)")
    args = parser.parse_args()

    has_fields = bool(args.fields)
    has_patch = bool(args.patch_file)

    if not has_fields and not has_patch:
        parser.error("Provide --field/--value pairs or --patch-file")
    if has_fields and has_patch:
        parser.error("--field and --patch-file are mutually exclusive")

    if has_fields:
        if not args.values or len(args.fields) != len(args.values):
            parser.error("Each --field must be followed by exactly one --value")
        patch: dict = {}
        for field_path, raw_val in zip(args.fields, args.values):
            patch = _set_nested(patch, field_path, _parse_value(raw_val))
    else:
        pf = Path(args.patch_file)
        if not pf.exists():
            print(f"ERROR: patch file not found: {pf}", file=sys.stderr)
            sys.exit(1)
        try:
            patch = json.loads(pf.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"ERROR: patch file JSON parse error: {e}", file=sys.stderr)
            sys.exit(1)

    commit_goal(patch, Path(args.data_dir))


if __name__ == "__main__":
    main()
