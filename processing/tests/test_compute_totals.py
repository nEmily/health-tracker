"""Tests for compute_totals.py"""
import pytest
from lib.compute_totals import compute


def _food(cal, protein=0, carbs=0, fat=0, fiber=0, **kwargs):
    return {"type": "food", "calories": cal, "protein": protein,
            "carbs": carbs, "fat": fat, "fiber": fiber, **kwargs}


def _workout(**kwargs):
    return {"type": "workout", "calories": 0, "protein": 0, **kwargs}


def test_single_entry():
    entries = [_food(400, protein=30, carbs=40, fat=10, fiber=5)]
    totals = compute(entries)
    assert totals["calories"] == 400
    assert totals["protein"] == 30
    assert totals["fiber"] == 5


def test_multiple_entries_sum():
    entries = [
        _food(400, protein=30),
        _food(300, protein=25),
    ]
    totals = compute(entries)
    assert totals["calories"] == 700
    assert totals["protein"] == 55


def test_workout_entries_excluded():
    entries = [
        _food(400, protein=30),
        _workout(),
    ]
    totals = compute(entries)
    assert totals["calories"] == 400
    assert totals["protein"] == 30


def test_exercise_type_excluded():
    entries = [
        _food(500, protein=40),
        {"type": "exercise", "calories": 0, "protein": 0},
    ]
    totals = compute(entries)
    assert totals["calories"] == 500


def test_missing_fields_default_to_zero():
    entries = [{"type": "food", "calories": 200}]
    totals = compute(entries)
    assert totals["protein"] == 0
    assert totals["fiber"] == 0
    assert totals["carbs"] == 0


def test_empty_entries():
    totals = compute([])
    assert totals["calories"] == 0
    assert totals["protein"] == 0


def test_sol_insol_fiber_included():
    entries = [_food(300, fiber=8, solubleFiber=2.0, insolubleFiber=6.0)]
    totals = compute(entries)
    assert totals["solubleFiber"] == 2.0
    assert totals["insolubleFiber"] == 6.0


def test_rounds_to_one_decimal():
    entries = [
        _food(333, protein=10),
        _food(333, protein=10),
        _food(334, protein=10),
    ]
    totals = compute(entries)
    assert isinstance(totals["calories"], float)
    assert totals["calories"] == 1000.0
