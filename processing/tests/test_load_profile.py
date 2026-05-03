"""Tests for load_profile.py"""
import json
import pytest
from pathlib import Path
from lib.load_profile import load_profile


def _write_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_minimal_narrow_shape(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {
        "calories": 1200, "protein": 85, "fiber": 20, "water_oz": 64
    })
    profile = load_profile(data_dir, extract_dir)
    assert profile["goals"]["calories"] == 1200
    assert profile["goals"]["protein"] == 85


def test_rich_shape_resolved(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {
        "calories": {"daily": 1000},
        "macros": {"protein": {"target": 90, "floor": 70}},
    })
    profile = load_profile(data_dir, extract_dir)
    assert profile["goals"]["calories"] == 1000
    assert profile["goals"]["protein"] == 90
    assert profile["goals"]["protein_floor"] == 70


def test_missing_goals_raises(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    with pytest.raises(FileNotFoundError):
        load_profile(data_dir, extract_dir)


def test_preferences_loaded(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    _write_json(data_dir / "profile" / "preferences.json", {"favorites": ["salmon"]})
    profile = load_profile(data_dir, extract_dir)
    assert profile["preferences"]["favorites"] == ["salmon"]


def test_missing_optional_files_ok(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    profile = load_profile(data_dir, extract_dir)
    assert profile["regimen"] is None
    assert profile["identity"] is None
    assert profile["currentStats"] is None


def test_phone_pwa_profile_supplements(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    _write_json(extract_dir / "profile" / "pwa-profile.json", {
        "supplements": {"ironTablet": True},
        "bodyPhotoTypes": ["front", "side"],
    })
    profile = load_profile(data_dir, extract_dir)
    assert profile["supplements"]["ironTablet"] is True
    assert "front" in profile["bodyPhotoTypes"]


def test_preferences_data_dir_wins_conflict(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    _write_json(data_dir / "profile" / "preferences.json", {"coachTone": "strict"})
    _write_json(extract_dir / "profile" / "pwa-profile.json", {
        "preferences": {"coachTone": "gentle"}
    })
    profile = load_profile(data_dir, extract_dir)
    assert profile["preferences"]["coachTone"] == "strict"


def test_ownership_annotations(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    profile = load_profile(data_dir, extract_dir)
    assert "_ownership" in profile
    assert "goals" in profile["_ownership"]


def test_bio_txt_not_read(tmp_path):
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    _write_json(data_dir / "profile" / "goals.json", {"calories": 1200})
    # Write a deprecated bio.txt — should be silently ignored
    bio_path = data_dir / "profile" / "bio.txt"
    bio_path.parent.mkdir(parents=True, exist_ok=True)
    bio_path.write_text("stale bio data")
    profile = load_profile(data_dir, extract_dir)
    assert "bio" not in profile
    assert "bio_txt" not in profile
