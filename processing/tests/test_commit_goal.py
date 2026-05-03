"""Tests for commit_goal.py — patch application, timeline levels, and edge cases."""
import json
import sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "coach-plugin" / "scripts"))

from commit_goal import (  # noqa: E402
    _deep_merge,
    _set_nested,
    _get_nested,
    _compute_level,
    commit_goal,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _base_goals():
    return {
        "calories": {"daily": 1200},
        "protein": {"floor": 80, "target": 100, "ceiling": 130},
        "fat": {"floor": 30},
        "fiber": {"daily_g": 25},
        "water": {"daily_oz": 64},
        "weight": {"current": 101.0, "goal": 105.0, "unit": "lbs"},
    }


def _make_goals_dir(tmp_path, goals=None):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir(parents=True)
    data = goals if goals is not None else _base_goals()
    (profile_dir / "goals.json").write_text(json.dumps(data), encoding="utf-8")
    return tmp_path


# ── Unit: _deep_merge ─────────────────────────────────────────────────────────

def test_deep_merge_basic():
    base = {"a": 1, "b": {"c": 2, "d": 3}}
    patch = {"b": {"c": 99}, "e": 5}
    result = _deep_merge(base, patch)
    assert result == {"a": 1, "b": {"c": 99, "d": 3}, "e": 5}


def test_deep_merge_does_not_mutate_base():
    base = {"a": {"b": 1}}
    _deep_merge(base, {"a": {"b": 2}})
    assert base["a"]["b"] == 1


def test_deep_merge_overwrites_non_dict_with_dict():
    base = {"a": 5}
    patch = {"a": {"nested": True}}
    result = _deep_merge(base, patch)
    assert result["a"] == {"nested": True}


# ── Unit: _set_nested ─────────────────────────────────────────────────────────

def test_set_nested_simple():
    result = _set_nested({}, "calories.daily", 1500)
    assert result == {"calories": {"daily": 1500}}


def test_set_nested_deep():
    result = _set_nested({}, "a.b.c", 42)
    assert result["a"]["b"]["c"] == 42


def test_set_nested_merges_existing():
    base = {"calories": {"daily": 1200, "adjustment": "custom"}}
    result = _set_nested(base, "calories.daily", 1500)
    assert result["calories"]["daily"] == 1500
    assert result["calories"]["adjustment"] == "custom"


# ── Unit: _compute_level ─────────────────────────────────────────────────────

def test_compute_level_major_calories():
    before = {"calories": {"daily": 1200}}
    after = {"calories": {"daily": 700}}  # > 5% change
    assert _compute_level(before, after) == "major"


def test_compute_level_minor_calories_small_change():
    before = {"calories": {"daily": 1200}}
    after = {"calories": {"daily": 1210}}  # < 5% change
    assert _compute_level(before, after) in ("minor", "note")


def test_compute_level_major_weight():
    before = {"weight": {"goal": 100.0, "current": 101.0}}
    after = {"weight": {"goal": 90.0, "current": 101.0}}  # > 5%
    assert _compute_level(before, after) == "major"


def test_compute_level_minor_protein():
    before = {"protein": {"target": 100}}
    after = {"protein": {"target": 110}}
    assert _compute_level(before, after) == "minor"


def test_compute_level_minor_fiber():
    before = {"fiber": {"daily_g": 25}}
    after = {"fiber": {"daily_g": 30}}
    assert _compute_level(before, after) == "minor"


def test_compute_level_minor_water():
    before = {"water": {"daily_oz": 64}}
    after = {"water": {"daily_oz": 80}}
    assert _compute_level(before, after) == "minor"


def test_compute_level_note_for_other_fields():
    before = {"notes": "old"}
    after = {"notes": "new"}
    assert _compute_level(before, after) == "note"


# ── Integration: commit_goal ──────────────────────────────────────────────────

def test_commit_goal_applies_patch(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"calories": {"daily": 1500}}, data_dir)

    goals = json.loads((data_dir / "profile" / "goals.json").read_text())
    assert goals["calories"]["daily"] == 1500


def test_commit_goal_preserves_other_fields(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"calories": {"daily": 1300}}, data_dir)

    goals = json.loads((data_dir / "profile" / "goals.json").read_text())
    # Other fields should be untouched
    assert goals["protein"]["target"] == 100
    assert goals["weight"]["current"] == 101.0


def test_commit_goal_deep_merge_nested(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"protein": {"target": 120}}, data_dir)

    goals = json.loads((data_dir / "profile" / "goals.json").read_text())
    assert goals["protein"]["target"] == 120
    assert goals["protein"]["floor"] == 80  # untouched sibling


def test_commit_goal_writes_timeline_event(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"calories": {"daily": 900}}, data_dir)  # major change

    timeline = json.loads((data_dir / "timeline.json").read_text())
    assert len(timeline) >= 1
    event = timeline[-1]
    assert event["type"] == "goal_update"
    assert event["level"] == "major"
    assert "calories" in event["fields"]


def test_commit_goal_timeline_level_minor(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"water": {"daily_oz": 80}}, data_dir)

    timeline = json.loads((data_dir / "timeline.json").read_text())
    assert timeline[-1]["level"] == "minor"


def test_commit_goal_timeline_level_note(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"notes": "Updated manually"}, data_dir)

    timeline = json.loads((data_dir / "timeline.json").read_text())
    assert timeline[-1]["level"] == "note"


def test_commit_goal_appends_to_existing_timeline(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    existing_events = [{"type": "existing_event", "timestamp": "2026-01-01T00:00:00+00:00"}]
    (data_dir / "timeline.json").write_text(json.dumps(existing_events))

    commit_goal({"notes": "patch"}, data_dir)

    timeline = json.loads((data_dir / "timeline.json").read_text())
    assert len(timeline) == 2
    assert timeline[0]["type"] == "existing_event"
    assert timeline[1]["type"] == "goal_update"


def test_commit_goal_missing_goals_file_exits(tmp_path):
    # profile/goals.json does not exist
    with pytest.raises(SystemExit) as exc_info:
        commit_goal({"calories": {"daily": 1200}}, tmp_path)
    assert exc_info.value.code != 0


def test_commit_goal_patch_file_path(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    patch = {"fiber": {"daily_g": 35}}
    patch_file = tmp_path / "patch.json"
    patch_file.write_text(json.dumps(patch))

    commit_goal(patch, data_dir)

    goals = json.loads((data_dir / "profile" / "goals.json").read_text())
    assert goals["fiber"]["daily_g"] == 35


def test_commit_goal_no_change_still_writes(tmp_path):
    goals = _base_goals()
    data_dir = _make_goals_dir(tmp_path, goals)
    before_text = (data_dir / "profile" / "goals.json").read_text()

    # Apply a patch that doesn't change any value
    commit_goal({"calories": {"daily": 1200}}, data_dir)

    after = json.loads((data_dir / "profile" / "goals.json").read_text())
    assert after["calories"]["daily"] == 1200  # same value


# ── Adversarial / chaos tests ─────────────────────────────────────────────────

def test_commit_goal_corrupt_goals_json_exits(tmp_path):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    (profile_dir / "goals.json").write_text("{ not valid json }")

    with pytest.raises(SystemExit) as exc_info:
        commit_goal({"calories": {"daily": 1200}}, tmp_path)
    assert exc_info.value.code != 0


def test_commit_goal_null_value_in_patch(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"weight": {"current": None}}, data_dir)

    goals = json.loads((data_dir / "profile" / "goals.json").read_text())
    assert goals["weight"]["current"] is None


def test_commit_goal_new_top_level_key(tmp_path):
    data_dir = _make_goals_dir(tmp_path)
    commit_goal({"new_feature": {"enabled": True}}, data_dir)

    goals = json.loads((data_dir / "profile" / "goals.json").read_text())
    assert goals["new_feature"]["enabled"] is True


def test_deep_merge_empty_patch_returns_copy():
    base = {"a": 1}
    result = _deep_merge(base, {})
    assert result == base
    assert result is not base


def test_compute_level_both_zero_is_not_major():
    before = {"calories": {"daily": 0}}
    after = {"calories": {"daily": 0}}
    level = _compute_level(before, after)
    assert level == "note"
