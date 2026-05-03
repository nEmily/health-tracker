"""Tests for fiber_split.py"""
import pytest
from lib.fiber_split import estimate_split_inplace


def _entry(description, fiber, **kwargs):
    return {"id": "e1", "type": "food", "description": description, "fiber": fiber, **kwargs}


def test_psyllium():
    entries = [_entry("psyllium husk supplement", 5)]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == pytest.approx(5 * 0.70, abs=0.1)
    assert entries[0]["insolubleFiber"] == pytest.approx(5 * 0.30, abs=0.1)


def test_chia():
    entries = [_entry("chia seeds pudding", 8)]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == pytest.approx(8 * 0.15, abs=0.1)
    assert entries[0]["insolubleFiber"] == pytest.approx(8 * 0.85, abs=0.1)


def test_oats():
    entries = [_entry("plain oatmeal no toppings", 4)]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == pytest.approx(4 * 0.50, abs=0.15)


def test_edamame_pods():
    entries = [_entry("edamame pods (shelled)", 6)]
    estimate_split_inplace(entries)
    # "pods" pattern should match
    assert entries[0]["solubleFiber"] == pytest.approx(6 * 0.10, abs=0.15)


def test_edamame_inner():
    entries = [_entry("edamame inner beans", 4)]
    estimate_split_inplace(entries)
    # inner edamame pattern (no "pods" keyword)
    assert entries[0]["solubleFiber"] == pytest.approx(4 * 0.35, abs=0.15)


def test_broccoli():
    entries = [_entry("steamed broccoli", 3)]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == pytest.approx(3 * 0.30, abs=0.1)


def test_unknown_fallback():
    entries = [_entry("mystery food", 10)]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == pytest.approx(10 * 0.25, abs=0.1)
    assert entries[0]["insolubleFiber"] == pytest.approx(10 * 0.75, abs=0.1)


def test_zero_fiber_skipped():
    entries = [_entry("water", 0)]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == 0.0
    assert entries[0]["insolubleFiber"] == 0.0


def test_mixed_ingredients_average():
    # Description mentions both oats (0.5) and chia (0.15) — should average
    entries = [_entry("overnight oats with chia seeds", 10)]
    estimate_split_inplace(entries)
    # avg sol: (0.5 + 0.15) / 2 = 0.325
    assert entries[0]["solubleFiber"] == pytest.approx(10 * 0.325, abs=0.5)


def test_workout_entries_still_get_zeros():
    entries = [{"id": "w1", "type": "workout", "description": "running", "fiber": 0}]
    estimate_split_inplace(entries)
    assert entries[0]["solubleFiber"] == 0.0
    assert entries[0]["insolubleFiber"] == 0.0
