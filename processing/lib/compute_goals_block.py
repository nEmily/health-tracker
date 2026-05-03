"""
compute_goals_block.py — Build the goals status block from totals + profile.

Uses goals_resolver for status computation. NO LLM calls. Pure Python.
"""

from __future__ import annotations
from lib import goals_resolver


def compute(totals: dict, profile: dict) -> dict:
    """Build goals status block.

    Args:
        totals:  Output of compute_totals.compute()
        profile: Output of load_profile.load_profile()

    Returns dict with status fields per macro plus resolved goal targets.
    """
    raw_goals = profile.get("goals") or {}
    resolved = goals_resolver.resolve(raw_goals)

    cal_actual   = totals.get("calories", 0)
    protein_actual = totals.get("protein", 0)
    fiber_actual = totals.get("fiber", 0)
    water_actual = totals.get("water_oz", 0)

    cal_status     = goals_resolver.calories_status(cal_actual, resolved)
    protein_status = goals_resolver.protein_status(protein_actual, resolved)
    fiber_status   = goals_resolver.fiber_status(fiber_actual, resolved)
    water_status   = goals_resolver.water_status(water_actual, resolved)

    return {
        "calories": {
            "actual": cal_actual,
            "target": resolved["calories"],
            "status": cal_status,
        },
        "protein": {
            "actual": protein_actual,
            "target": resolved["protein"],
            "floor": resolved.get("protein_floor"),
            "ceiling": resolved.get("protein_ceiling"),
            "status": protein_status,
        },
        "fiber": {
            "actual": fiber_actual,
            "target": resolved["fiber"],
            "floor": resolved.get("fiber_floor_g"),
            "ceiling": resolved.get("fiber_ceiling_g"),
            "status": fiber_status,
            "trackSplit": resolved.get("fiber_track_split", False),
        },
        "water": {
            "actual": water_actual,
            "target": resolved["water_oz"],
            "floor": resolved.get("water_floor_oz"),
            "status": water_status,
        },
        "_resolved": resolved,
    }
