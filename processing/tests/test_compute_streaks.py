"""Tests for compute_streaks.py"""
import json
import pytest
from pathlib import Path
from lib.compute_streaks import compute


def _write_analysis(analysis_dir: Path, date: str, calories: float, protein: float, entries_count: int = 3):
    analysis_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "date": date,
        "entries": [{"id": f"e{i}", "type": "food"} for i in range(entries_count)],
        "totals": {"calories": calories, "protein": protein},
        "pwaProfile": {"goals": {"calories": 1200, "protein": 85}},
    }
    (analysis_dir / f"{date}.json").write_text(json.dumps(data), encoding="utf-8")


def test_no_analysis_dir_returns_zeros(tmp_path):
    result = compute(tmp_path, "2026-05-01", {"calories": 1200, "protein": 85})
    assert result == {"tracking": 0, "calories": 0, "protein": 0}


def test_single_good_day(tmp_path):
    analysis_dir = tmp_path / "analysis"
    # Write yesterday
    _write_analysis(analysis_dir, "2026-04-30", calories=1150, protein=90)
    today_totals = {"calories": 1200, "protein": 88}
    result = compute(tmp_path, "2026-05-01", today_totals)
    assert result["tracking"] >= 1


def test_streak_breaks_on_gap(tmp_path):
    analysis_dir = tmp_path / "analysis"
    # 2026-04-28 (gap — 2026-04-29 missing)
    _write_analysis(analysis_dir, "2026-04-28", calories=1200, protein=85)
    today_totals = {"calories": 1200, "protein": 85}
    result = compute(tmp_path, "2026-05-01", today_totals)
    # Gap on 04-29 breaks the streak — tracking streak should be 1 at most
    assert result["tracking"] <= 1


def test_consecutive_days_accumulate(tmp_path):
    analysis_dir = tmp_path / "analysis"
    for day in ["2026-04-28", "2026-04-29", "2026-04-30"]:
        _write_analysis(analysis_dir, day, calories=1200, protein=90)
    today_totals = {"calories": 1200, "protein": 90}
    result = compute(tmp_path, "2026-05-01", today_totals)
    assert result["tracking"] >= 3


def test_calories_streak_resets_on_miss(tmp_path):
    analysis_dir = tmp_path / "analysis"
    # 04-30: over by 500 — should reset calorie streak
    _write_analysis(analysis_dir, "2026-04-30", calories=1800, protein=85)
    today_totals = {"calories": 1200, "protein": 85}
    result = compute(tmp_path, "2026-05-01", today_totals)
    assert result["calories"] <= 1


def test_protein_streak_resets_on_miss(tmp_path):
    analysis_dir = tmp_path / "analysis"
    _write_analysis(analysis_dir, "2026-04-30", calories=1200, protein=20)  # low protein
    today_totals = {"calories": 1200, "protein": 90}
    result = compute(tmp_path, "2026-05-01", today_totals)
    # protein streak resets
    assert result["protein"] <= 1


def test_returns_dict_with_all_keys(tmp_path):
    result = compute(tmp_path, "2026-05-01", {"calories": 1200, "protein": 85})
    assert "tracking" in result
    assert "calories" in result
    assert "protein" in result
