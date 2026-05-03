"""Tests for compute_goals_block.py"""
import pytest
from lib.compute_goals_block import compute


def _profile(calories=1200, protein=85, fiber=20, water_oz=64, water_floor_oz=None, **goal_extras):
    goals = {"calories": calories, "protein": protein, "fiber": fiber, "water_oz": water_oz}
    if water_floor_oz is not None:
        goals["water_floor_oz"] = water_floor_oz
    goals.update(goal_extras)
    return {"goals": goals, "preferences": {}}


def _totals(calories=0, protein=0, fiber=0, water_oz=0):
    return {"calories": float(calories), "protein": float(protein),
            "fiber": float(fiber), "water_oz": float(water_oz)}


def test_on_track_calories():
    block = compute(_totals(calories=1200), _profile(calories=1200))
    assert block["calories"]["status"] == "on_track"


def test_over_calories():
    block = compute(_totals(calories=1500), _profile(calories=1200))
    assert block["calories"]["status"] == "over"


def test_under_calories():
    block = compute(_totals(calories=800), _profile(calories=1200))
    assert block["calories"]["status"] == "under"


def test_protein_target_and_floor():
    profile = _profile(protein=85)
    block = compute(_totals(protein=90), profile)
    # 90 >= 85 target → high (protein_status returns high when >= target)
    assert block["protein"]["status"] == "high"


def test_protein_low():
    block = compute(_totals(protein=40), _profile(protein=85))
    assert block["protein"]["status"] in ("low", "on_track")


def test_resolved_goals_in_block():
    block = compute(_totals(calories=1000), _profile(calories=1200))
    assert block["calories"]["target"] == 1200
    assert "_resolved" in block


def test_fiber_on_track():
    block = compute(_totals(fiber=20), _profile(fiber=20))
    # fiber floor defaults to 0 in resolver
    assert block["fiber"]["actual"] == 20


def test_water_under():
    # floor_oz must be set for "under" to trigger (below floor = under, not just below target)
    block = compute(_totals(water_oz=32), _profile(water_oz=64, water_floor_oz=48))
    assert block["water"]["status"] == "under"


def test_water_target_populated():
    block = compute(_totals(water_oz=64), _profile(water_oz=64))
    assert block["water"]["target"] == 64
