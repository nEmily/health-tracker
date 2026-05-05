"""Tests for multi-photo per entry support.

User feedback (2026-05-04): "we should add ability for one meal to have
multiple pics" — different from batch upload (which creates one entry per
photo). Same meal photographed 2-3 ways (dish + label + receipt) should
ALL feed into ONE Haiku analysis, ONE entry.
"""
from pathlib import Path
import sys
sys.path.insert(0, "processing")
from process_day import _find_photos, _find_photo


def _make_photos(tmp_path, date, entry_id, count):
    """Create N JPG files in PWA layout: daily/{date}/photos/{id}.jpg, {id}_2.jpg, ..."""
    photos_dir = tmp_path / "daily" / date / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for n in range(1, count + 1):
        suffix = "" if n == 1 else f"_{n}"
        p = photos_dir / f"{entry_id}{suffix}.jpg"
        p.write_bytes(b"fake jpg data")
        paths.append(p)
    return paths


# ── Single-photo case (back-compat) ──────────────────────────────────────────

def test_find_photos_single(tmp_path):
    _make_photos(tmp_path, "2026-05-04", "meal_abc", 1)
    entry = {"id": "meal_abc", "type": "meal", "date": "2026-05-04", "photo": True}
    result = _find_photos(entry, tmp_path)
    assert len(result) == 1
    assert result[0].name == "meal_abc.jpg"


def test_find_photo_back_compat_returns_first(tmp_path):
    _make_photos(tmp_path, "2026-05-04", "meal_abc", 3)
    entry = {"id": "meal_abc", "type": "meal", "date": "2026-05-04", "photo": True}
    # Old single-Path API still works for legacy callers.
    result = _find_photo(entry, tmp_path)
    assert result is not None
    assert result.name == "meal_abc.jpg"


# ── Multi-photo case (the new feature) ──────────────────────────────────────

def test_find_photos_multiple(tmp_path):
    _make_photos(tmp_path, "2026-05-04", "meal_xyz", 3)
    entry = {"id": "meal_xyz", "type": "meal", "date": "2026-05-04", "photo": True}
    result = _find_photos(entry, tmp_path)
    assert len(result) == 3
    names = [p.name for p in result]
    assert names == ["meal_xyz.jpg", "meal_xyz_2.jpg", "meal_xyz_3.jpg"]


def test_find_photos_stops_at_gap(tmp_path):
    """If user has photos 1 and 3 but no 2 (uncommon, but should not loop)."""
    photos_dir = tmp_path / "daily" / "2026-05-04" / "photos"
    photos_dir.mkdir(parents=True)
    (photos_dir / "meal_x.jpg").write_bytes(b"a")
    (photos_dir / "meal_x_3.jpg").write_bytes(b"b")  # gap — no _2

    entry = {"id": "meal_x", "type": "meal", "date": "2026-05-04", "photo": True}
    result = _find_photos(entry, tmp_path)
    # Stops at first gap; only base photo found
    assert len(result) == 1


def test_find_photos_caps_at_12(tmp_path):
    """No pathological loops — defensive cap."""
    _make_photos(tmp_path, "2026-05-04", "meal_x", 15)
    entry = {"id": "meal_x", "type": "meal", "date": "2026-05-04", "photo": True}
    result = _find_photos(entry, tmp_path)
    assert len(result) == 12, f"expected cap at 12; got {len(result)}"


# ── Edge cases ───────────────────────────────────────────────────────────────

def test_find_photos_no_photo_flag(tmp_path):
    """If entry.photo is False, return empty even if file exists."""
    _make_photos(tmp_path, "2026-05-04", "x", 1)
    entry = {"id": "x", "type": "meal", "date": "2026-05-04", "photo": False}
    assert _find_photos(entry, tmp_path) == []


def test_find_photos_missing_file(tmp_path):
    entry = {"id": "ghost", "type": "meal", "date": "2026-05-04", "photo": True}
    assert _find_photos(entry, tmp_path) == []


def test_find_photos_legacy_layout(tmp_path):
    """Legacy/test fixture layout: photos/ directly under extract_dir
    (no daily/{date}/ wrapper). Should still find them."""
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir()
    (photos_dir / "meal_legacy.jpg").write_bytes(b"a")
    (photos_dir / "meal_legacy_2.jpg").write_bytes(b"b")

    entry = {"id": "meal_legacy", "type": "meal", "date": "2026-05-04", "photo": True}
    result = _find_photos(entry, tmp_path)
    assert len(result) == 2


# ── Analyze() accepts photo_path as list or single Path ──────────────────────

def test_analyze_accepts_list_of_photos():
    """The analyze() entry-point should accept either a single Path or a list."""
    from lib.invoke_entry_analyzer import analyze
    # We don't actually invoke claude here — just verify the type signature.
    # Pass an empty list; should fall through cleanly without crashing on
    # the photo handling (even if Haiku call fails downstream, the type
    # handling itself shouldn't raise).
    result = analyze(
        {"id": "x", "type": "supplement", "notes": "creatine"},
        {"preferences": {"dailyStaples": {"creatine": {"name": "Creatine", "cal": 0, "protein": 0}}}},
        photo_path=[],  # empty list — should be treated same as None
    )
    # Should match the daily staple and short-circuit Haiku
    assert result.get("calories") == 0
    assert result.get("description") == "Creatine"
