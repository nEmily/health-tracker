"""Tests for daily staple lookup — deterministic macros for psyllium,
collagen, creatine, etc. instead of Haiku re-estimating each tick.

Critical: must NOT match the proteinShake staple on generic words like
"shake" or "protein" — user has 7+ specific shakes (whey, Flimeal, etc.)
that should be analyzed individually via photo/notes.
"""
from lib.invoke_entry_analyzer import _match_daily_staple


# Profile with all the typical daily staples Emily uses.
_PROFILE = {
    "preferences": {
        "dailyStaples": {
            "fiber":        {"name": "Psyllium husk", "cal": 30, "protein": 0, "fiber": 5},
            "collagen":     {"name": "Orgain Collagen Peptides + Probiotics",
                              "cal": 80, "protein": 20},
            "creatine":     {"name": "Creatine monohydrate", "cal": 0, "protein": 0},
            "proteinShake": {"name": "Orgain Plant Protein", "cal": 160, "protein": 21},
            "wellnessShot": {"name": "Suja Wellness Shot", "cal": 25, "protein": 0},
        }
    }
}


def _entry(notes, type_="supplement"):
    return {"id": "x", "type": type_, "notes": notes}


# ── Match scenarios ──────────────────────────────────────────────────────────

def test_fiber_matches_user_shorthand():
    out = _match_daily_staple(_entry("Fiber"), _PROFILE)
    assert out is not None
    assert out["calories"] == 30
    assert out["description"] == "Psyllium husk"
    assert out["_dailyStapleMatch"] == "fiber"


def test_fiber_matches_with_extra_text():
    out = _match_daily_staple(_entry("Fiber same as always"), _PROFILE)
    assert out is not None
    assert out["calories"] == 30


def test_psyllium_matches_fiber_staple():
    out = _match_daily_staple(_entry("psyllium husk dose"), _PROFILE)
    assert out is not None
    assert out["calories"] == 30


def test_creatine_matches_creatine_staple():
    out = _match_daily_staple(_entry("Creatine"), _PROFILE)
    assert out is not None
    assert out["calories"] == 0
    assert out["_dailyStapleMatch"] == "creatine"


def test_collagen_matches():
    out = _match_daily_staple(
        _entry("Orgain Collagen Peptides + Probiotics"), _PROFILE
    )
    assert out is not None
    assert out["calories"] == 80
    assert out["protein"] == 20


def test_orgain_plant_protein_matches():
    out = _match_daily_staple(
        _entry("Orgain Plant Protein shake"), _PROFILE
    )
    assert out is not None
    assert out["calories"] == 160


# ── Critical rejections (the user's "I have 7+ shakes" warning) ──────────────

def test_whey_isolate_does_not_match_proteinshake():
    """User has whey isolate as a separate product with different macros.
    Must NOT substitute Orgain Plant Protein's 160 cal for it."""
    out = _match_daily_staple(
        _entry("Grass-fed whey isolate, taro/ube/vanilla flavored"),
        _PROFILE,
    )
    assert out is None, "whey isolate must defer to Haiku, not match Orgain"


def test_flimeal_does_not_match_proteinshake():
    out = _match_daily_staple(
        _entry("Strawberry Flimeal protein shake with chia seeds"),
        _PROFILE,
    )
    assert out is None


def test_kachava_does_not_match():
    out = _match_daily_staple(
        _entry("Ka'chava chocolate flavor"),
        _PROFILE,
    )
    assert out is None


def test_huel_does_not_match():
    out = _match_daily_staple(
        _entry("Huel black edition vanilla"),
        _PROFILE,
    )
    assert out is None


def test_generic_word_protein_does_not_match():
    """Just 'protein' shouldn't trigger proteinShake — too generic."""
    out = _match_daily_staple(
        _entry("Some random protein source"),
        _PROFILE,
    )
    assert out is None


def test_generic_word_shake_does_not_match():
    out = _match_daily_staple(
        _entry("Chocolate shake"),
        _PROFILE,
    )
    assert out is None


# ── Type guards ──────────────────────────────────────────────────────────────

def test_meal_type_does_not_match():
    """Even if notes contain 'fiber', a meal entry shouldn't auto-match."""
    out = _match_daily_staple(
        _entry("High-fiber salad with chickpeas", type_="meal"),
        _PROFILE,
    )
    assert out is None


def test_drink_type_does_not_match():
    out = _match_daily_staple(
        _entry("Creatine in water", type_="drink"),
        _PROFILE,
    )
    assert out is None


# ── Edge cases ───────────────────────────────────────────────────────────────

def test_empty_notes_no_match():
    assert _match_daily_staple(_entry(""), _PROFILE) is None
    assert _match_daily_staple(_entry(None), _PROFILE) is None


def test_no_dailystaples_returns_none():
    out = _match_daily_staple(_entry("Fiber"), {"preferences": {}})
    assert out is None


def test_missing_macros_in_staple_returns_none():
    """If the staple definition lacks cal/protein, fall back to Haiku."""
    profile = {"preferences": {"dailyStaples": {
        "fiber": {"name": "Psyllium husk"},  # no cal/protein
    }}}
    out = _match_daily_staple(_entry("Fiber"), profile)
    assert out is None


def test_ambiguous_match_returns_none():
    """If user notes mention multiple staples, defer to Haiku."""
    out = _match_daily_staple(
        _entry("Fiber and creatine in one shot"),
        _PROFILE,
    )
    assert out is None


def test_dietary_dailystaples_path_also_works():
    """preferences.dietary.dailyStaples is the older nested shape."""
    profile = {"preferences": {"dietary": {"dailyStaples": {
        "creatine": {"name": "Creatine", "cal": 0, "protein": 0},
    }}}}
    out = _match_daily_staple(_entry("Creatine"), profile)
    assert out is not None
    assert out["_dailyStapleMatch"] == "creatine"


def test_match_sets_high_confidence():
    out = _match_daily_staple(_entry("Fiber"), _PROFILE)
    assert out["confidence"] == "high"


def test_match_preserves_entry_id():
    entry = {"id": "supp_xyz", "type": "supplement", "notes": "Fiber"}
    out = _match_daily_staple(entry, _PROFILE)
    assert out["id"] == "supp_xyz"
