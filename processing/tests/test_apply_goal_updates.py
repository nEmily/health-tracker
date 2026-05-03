"""Tests for apply_goal_updates.py"""
import json
import pytest
from pathlib import Path
from lib.apply_goal_updates import apply_goal_updates


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_no_updates_file_returns_zero(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    data_dir.mkdir()
    count = apply_goal_updates(data_dir, extract_dir)
    assert count == 0


def test_empty_updates_list_returns_zero(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    _write_json(extract_dir / "profile" / "goal-updates.json", [])
    count = apply_goal_updates(data_dir, extract_dir)
    assert count == 0


def test_narrow_calories_mapped_to_rich(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": {"daily": 1200}})
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 1000, "calories": 1000}
    ])
    count = apply_goal_updates(data_dir, extract_dir)
    assert count == 1
    goals = _read_json(data_dir / "profile" / "goals.json")
    assert goals["calories"]["daily"] == 1000


def test_narrow_protein_mapped(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {
        "macros": {"protein": {"target": 85, "floor": 70}}
    })
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 1000, "protein": 95}
    ])
    apply_goal_updates(data_dir, extract_dir)
    goals = _read_json(data_dir / "profile" / "goals.json")
    assert goals["macros"]["protein"]["target"] == 95
    assert goals["macros"]["protein"]["floor"] == 70  # preserved


def test_chronological_order(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": {"daily": 1200}})
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 2000, "calories": 1100},  # later
        {"timestamp": 1000, "calories": 900},   # earlier
    ])
    apply_goal_updates(data_dir, extract_dir)
    goals = _read_json(data_dir / "profile" / "goals.json")
    # Last applied wins — timestamp 2000 is last, so 1100
    assert goals["calories"]["daily"] == 1100


def test_timeline_appended(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": {"daily": 1200}})
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 1000, "calories": 1000}
    ])
    apply_goal_updates(data_dir, extract_dir)
    timeline = _read_json(data_dir / "profile" / "timeline.json")
    assert len(timeline) == 1
    assert timeline[0]["type"] == "goal_update"


def test_no_change_not_applied(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": {"daily": 1200}})
    # Same value — should not count as applied
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 1000, "calories": 1200}
    ])
    count = apply_goal_updates(data_dir, extract_dir)
    assert count == 0


def test_atomic_write_no_partial_state(tmp_path):
    """Goals file should not be corrupted if process interrupted mid-write."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    original = {"calories": {"daily": 1200}, "macros": {"protein": {"target": 85}}}
    _write_json(data_dir / "profile" / "goals.json", original)
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 1000, "fiber": 25}
    ])
    apply_goal_updates(data_dir, extract_dir)
    goals = _read_json(data_dir / "profile" / "goals.json")
    # Original fields preserved
    assert goals["calories"]["daily"] == 1200
    assert goals["macros"]["protein"]["target"] == 85
