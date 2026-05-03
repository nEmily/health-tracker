"""
compute_totals.py — Sum macro totals across non-workout entries.

NO LLM calls. Pure Python.
"""

from __future__ import annotations
from typing import Any


_MACRO_FIELDS = ("calories", "protein", "carbs", "fat", "fiber", "solubleFiber", "insolubleFiber")


def compute(entries: list[dict[str, Any]]) -> dict[str, float]:
    """Sum macro fields across all non-workout entries.

    Workout entries (type == 'workout' or 'exercise') are excluded.
    Missing fields default to 0.

    Returns a dict with keys: calories, protein, carbs, fat, fiber,
    solubleFiber, insolubleFiber.
    """
    totals: dict[str, float] = {field: 0.0 for field in _MACRO_FIELDS}

    for entry in entries:
        entry_type = (entry.get("type") or "").lower()
        if entry_type in ("workout", "exercise", "fitness"):
            continue
        for field in _MACRO_FIELDS:
            value = entry.get(field, 0)
            if isinstance(value, bool):
                continue
            if isinstance(value, str):
                try:
                    value = float(value)
                except ValueError:
                    continue
            if isinstance(value, (int, float)):
                totals[field] += value

    # Round to 1 decimal place for clean output
    return {k: round(v, 1) for k, v in totals.items()}
