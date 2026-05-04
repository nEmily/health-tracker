"""Regression tests for _format_weight_block.

Bug 2 (2026-05-04): coach repeated "97 lbs floor" across 7 responses on
2026-05-03 while user actually logged 95.3 lbs that day. Today's weight was
buried in the entries list as '95.3 lbs: 0 cal, 0g protein' and the LLM
anchored on the user's wording instead of today's data.

These tests cover the new _format_weight_block helper that surfaces today's
weight prominently in the synthesis prompt.
"""
from lib.invoke_day_synthesis import _format_weight_block


def test_weight_value_field_used_when_present():
    entries = [
        {"type": "meal", "description": "eggs", "calories": 200},
        {"type": "weight", "weight_value": 95.3, "weight_unit": "lbs"},
    ]
    block = _format_weight_block(entries, profile={})
    assert "95.3 lbs" in block
    assert "anchor advice on this" in block


def test_falls_back_to_parsing_notes_when_value_null():
    """Real production case: weight_value=null but notes='95.3 lbs'."""
    entries = [{"type": "weight", "weight_value": None, "notes": "95.3 lbs"}]
    block = _format_weight_block(entries, profile={})
    assert "95.3" in block


def test_no_weight_today_falls_back_to_current_stats():
    profile = {"currentStats": {"weight": {"current_lbs": 96.5}}}
    block = _format_weight_block([], profile=profile)
    assert "96.5" in block
    assert "No weight logged today" in block


def test_no_weight_anywhere():
    block = _format_weight_block([], profile={})
    assert "No weight data" in block


def test_trend_direction_down():
    profile = {"currentStats": {"weight": {
        "current_lbs": 96.5,
        "trend_7d": {"delta": -1.4},
    }}}
    block = _format_weight_block([], profile=profile)
    assert "down 1.4" in block


def test_trend_direction_up():
    profile = {"currentStats": {"weight": {
        "current_lbs": 100.0,
        "trend_7d": {"delta": 0.8},
    }}}
    block = _format_weight_block([], profile=profile)
    assert "up 0.8" in block


def test_today_weight_takes_precedence_over_current_stats():
    """The whole point: today's logged value beats stale current-stats."""
    entries = [{"type": "weight", "weight_value": 95.3, "weight_unit": "lbs"}]
    profile = {"currentStats": {"weight": {"current_lbs": 96.5}}}
    block = _format_weight_block(entries, profile=profile)
    # Today's value present
    assert "95.3" in block
    # Stale value not labeled as current
    assert "Last reading: 96.5" not in block


def test_malformed_notes_no_crash():
    entries = [{"type": "weight", "weight_value": None, "notes": "ugh forgot"}]
    block = _format_weight_block(entries, profile={})
    # Falls through to "no weight" path
    assert "No weight" in block or block  # just don't crash


def test_none_inputs_no_crash():
    assert _format_weight_block(None, profile=None)
    assert _format_weight_block([], profile=None)
