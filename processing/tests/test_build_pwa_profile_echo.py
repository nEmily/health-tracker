"""Tests for build_pwa_profile_echo.py"""
import pytest
from lib.build_pwa_profile_echo import build
from lib import goals_resolver


def _profile(calories=1200, protein=85, fiber=20, water_oz=64, **extras):
    raw = {"calories": calories, "protein": protein, "fiber": fiber, "water_oz": water_oz}
    raw.update(extras)
    resolved = goals_resolver.resolve(raw)
    return {
        "goals": resolved,
        "_raw_goals": raw,
        "preferences": {},
    }


def test_narrow_back_compat_scalars():
    echo = build(_profile(calories=1200), None)
    goals = echo["goals"]
    # rich nested scalar should contain the value
    assert goals["calories"]["daily"] == 1200 or goals["calories"] == 1200


def test_rich_macros_structure():
    echo = build(_profile(protein=90), None)
    macros = echo["goals"]["macros"]
    assert macros["protein"]["target"] == 90


def test_fiber_rich_structure():
    echo = build(_profile(fiber=25), None)
    assert echo["goals"]["fiber"]["daily_g"] == 25


def test_water_rich_structure():
    echo = build(_profile(water_oz=80), None)
    assert echo["goals"]["water"]["daily_oz"] == 80


def test_phone_supplements_included():
    phone = {"supplements": {"ironTablet": True, "magnesium": {"dose": "400mg"}}}
    echo = build(_profile(), phone)
    assert echo["supplements"]["ironTablet"] is True


def test_phone_body_types_included():
    phone = {"bodyPhotoTypes": ["front", "back", "side"]}
    echo = build(_profile(), phone)
    assert "front" in echo["bodyPhotoTypes"]


def test_data_dir_prefs_win_over_phone():
    profile = _profile()
    profile["preferences"] = {"coachTone": "strict"}
    phone = {"preferences": {"coachTone": "gentle"}}
    echo = build(profile, phone)
    assert echo["preferences"]["coachTone"] == "strict"


def test_phone_prefs_merged_if_no_conflict():
    profile = _profile()
    profile["preferences"] = {"favorites": ["salmon"]}
    phone = {"preferences": {"dailyStaples": ["shake"]}}
    echo = build(profile, phone)
    assert "salmon" in echo["preferences"].get("favorites", [])
    assert "shake" in echo["preferences"].get("dailyStaples", [])


def test_no_phone_profile_ok():
    echo = build(_profile(), None)
    assert "goals" in echo
    # Phone-only sections absent
    assert "supplements" not in echo


def test_idempotent_resolve():
    """resolve(resolve(x)) == resolve(x) — echo should be stable through a second resolve."""
    raw = {"calories": 1200, "protein": 85}
    resolved1 = goals_resolver.resolve(raw)
    profile = {"goals": resolved1, "_raw_goals": raw, "preferences": {}}
    echo = build(profile, None)
    # Re-resolve the echo goals — should be same
    resolved2 = goals_resolver.resolve(echo["goals"])
    assert resolved2["calories"] == resolved1["calories"]
    assert resolved2["protein"] == resolved1["protein"]
