"""Tests for knownProducts matching + label-photo learning.

Two parts:
  1. _match_known_product matches entry notes against preferences.knownProducts
     (rich trigger-driven shape) before falling back to the legacy
     dailyStaples shape.
  2. learn_from_analyzed_entries auto-grows knownProducts when an entry has
     isLabel:true after Haiku analysis.
"""
import json
import tempfile
from pathlib import Path
from lib.invoke_entry_analyzer import _match_known_product
from lib.learn_known_products import (
    _slugify, _derive_triggers, learn_from_analyzed_entries
)


# ── Profile with both knownProducts and dailyStaples ─────────────────────────

_PROFILE = {
    "preferences": {
        "knownProducts": {
            "_about": "comment line, must be skipped",
            "orgain_plant_protein": {
                "name": "Orgain Plant Protein",
                "cal": 160, "protein": 21, "carbs": 15, "fat": 4, "fiber": 4,
                "triggers": ["orgain plant protein"],
                "category": "shake",
            },
            "whey_isolate_taro": {
                "name": "Grass-fed whey isolate (taro/ube/vanilla)",
                "cal": 190, "protein": 30, "carbs": 5, "fat": 6, "fiber": 1,
                "triggers": ["whey isolate", "taro", "ube"],
                "category": "shake",
            },
            "ferrero_rocher": {
                "name": "Ferrero Rocher (1 piece)",
                "cal": 73, "protein": 1, "carbs": 6, "fat": 5, "fiber": 0,
                "triggers": ["ferrero rocher", "ferraro rocher"],
                "category": "candy",
            },
        },
        "dailyStaples": {
            "fiber": {"name": "Psyllium husk", "cal": 30, "protein": 0},
            "creatine": {"name": "Creatine", "cal": 0, "protein": 0},
        },
    }
}


# ── Match against knownProducts ──────────────────────────────────────────────

def test_match_orgain_via_known_products():
    entry = {"id": "x", "type": "supplement", "notes": "Orgain Plant Protein shake"}
    out = _match_known_product(entry, _PROFILE)
    assert out is not None
    assert out["calories"] == 160
    assert out["_knownProductMatch"] == "orgain_plant_protein"


def test_match_whey_isolate_via_known_products():
    """Critical: whey isolate now has its own knownProduct entry, so it
    matches deterministically without going to Haiku."""
    entry = {"id": "x", "type": "supplement",
             "notes": "Grass-fed whey isolate, taro/ube/vanilla flavored"}
    out = _match_known_product(entry, _PROFILE)
    assert out is not None
    assert out["calories"] == 190
    assert out["protein"] == 30
    assert out["_knownProductMatch"] == "whey_isolate_taro"


def test_match_ferrero_with_typo():
    """User often types 'Ferraro' (one r) — trigger list includes both."""
    entry = {"id": "x", "type": "meal", "notes": "one ferraro rocher"}
    out = _match_known_product(entry, _PROFILE)
    assert out is not None
    assert out["calories"] == 73


def test_known_products_apply_to_meal_type():
    """Unlike daily staples, knownProducts can match any entry type
    (meal, snack, drink, supplement) since labels apply broadly."""
    entry = {"id": "x", "type": "meal", "notes": "Orgain Plant Protein"}
    out = _match_known_product(entry, _PROFILE)
    assert out is not None
    assert out["_knownProductMatch"] == "orgain_plant_protein"


def test_unknown_shake_falls_through_to_haiku():
    """A shake not in knownProducts AND not matching dailyStaples triggers
    returns None so Haiku can analyze the photo label."""
    entry = {"id": "x", "type": "supplement", "notes": "Some random new shake brand"}
    assert _match_known_product(entry, _PROFILE) is None


def test_about_field_skipped():
    """Keys starting with _ (e.g. _about) must not be treated as products."""
    profile = {"preferences": {"knownProducts": {
        "_about": "comment",
        "real_product": {"name": "Real", "cal": 100, "protein": 10,
                          "triggers": ["real"]},
    }}}
    entry = {"id": "x", "type": "supplement", "notes": "comment"}
    # 'comment' shouldn't accidentally match the _about description
    assert _match_known_product(entry, profile) is None


def test_known_products_takes_precedence_over_dailystaples():
    """If both could match, knownProducts wins."""
    profile = {"preferences": {
        "knownProducts": {
            "fiber_brand": {"name": "Generic Fiber Brand", "cal": 50,
                             "protein": 1, "triggers": ["psyllium"]},
        },
        "dailyStaples": {
            "fiber": {"name": "Psyllium husk", "cal": 30, "protein": 0},
        },
    }}
    entry = {"id": "x", "type": "supplement", "notes": "psyllium"}
    out = _match_known_product(entry, profile)
    assert out is not None
    # Should have used knownProducts macros (50 cal), not dailyStaples (30)
    assert out["calories"] == 50


def test_dailystaples_fallback_when_knownproducts_absent():
    """No knownProducts → fall through to dailyStaples matcher."""
    profile = {"preferences": {"dailyStaples": {
        "fiber": {"name": "Psyllium husk", "cal": 30, "protein": 0},
    }}}
    entry = {"id": "x", "type": "supplement", "notes": "Fiber"}
    out = _match_known_product(entry, profile)
    assert out is not None
    assert out["calories"] == 30


def test_ambiguous_match_returns_none():
    """If 2+ knownProducts triggers match (with different macros), defer
    to Haiku rather than guessing."""
    profile = {"preferences": {"knownProducts": {
        "a": {"name": "A", "cal": 100, "protein": 5, "triggers": ["foo"]},
        "b": {"name": "B", "cal": 200, "protein": 10, "triggers": ["bar"]},
    }}}
    entry = {"id": "x", "type": "supplement", "notes": "foo bar"}
    assert _match_known_product(entry, profile) is None


# ── Slugify + derive triggers ────────────────────────────────────────────────

def test_slugify_basic():
    assert _slugify("Orgain Plant Protein") == "orgain_plant_protein"
    assert _slugify("Strawberry Flimeal!") == "strawberry_flimeal"


def test_slugify_unicode_falls_back_to_underscore():
    assert _slugify("Ka'chava Chocolate") == "ka_chava_chocolate"


def test_derive_triggers_drops_generic_words():
    triggers = _derive_triggers("Orgain Plant Protein Shake Powder")
    # Should NOT include generic 'shake' or 'powder' as standalone triggers
    assert "shake" not in triggers
    assert "powder" not in triggers
    assert "orgain plant protein" in triggers


def test_derive_triggers_includes_full_name():
    name = "Strawberry Flimeal"
    triggers = _derive_triggers(name)
    assert name.lower() in triggers


# ── learn_from_analyzed_entries ─────────────────────────────────────────────

def test_learn_adds_label_to_knownproducts(tmp_path):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    prefs_path = profile_dir / "preferences.json"
    prefs_path.write_text(json.dumps({"knownProducts": {}}), encoding="utf-8")

    label_entry = {
        "id": "supp_xyz",
        "type": "supplement",
        "calories": 220,
        "protein": 20,
        "carbs": 25,
        "fat": 6,
        "fiber": 5,
        "isLabel": True,
        "labelData": {
            "productName": "Strawberry Flimeal",
            "servingSize": "1 packet (52g)",
            "servingsPerContainer": 7,
        },
    }
    n = learn_from_analyzed_entries([label_entry], tmp_path)
    assert n == 1

    prefs = json.loads(prefs_path.read_text(encoding="utf-8"))
    products = prefs["knownProducts"]
    assert "strawberry_flimeal" in products
    p = products["strawberry_flimeal"]
    assert p["cal"] == 220
    assert p["protein"] == 20
    assert "strawberry flimeal" in p["triggers"]
    assert p["servingSize"] == "1 packet (52g)"
    assert p["category"] == "other" or "shake" in p["category"] or "supplement" in p["category"]


def test_learn_idempotent(tmp_path):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    prefs_path = profile_dir / "preferences.json"
    prefs_path.write_text(json.dumps({"knownProducts": {}}), encoding="utf-8")

    label_entry = {
        "id": "x", "type": "supplement",
        "calories": 200, "protein": 20, "carbs": 10, "fat": 5, "fiber": 2,
        "isLabel": True,
        "labelData": {"productName": "Test Product", "servingSize": "1"},
    }
    learn_from_analyzed_entries([label_entry], tmp_path)
    n2 = learn_from_analyzed_entries([label_entry], tmp_path)
    assert n2 == 0, "re-running on identical label should be a no-op"


def test_learn_skips_non_label_entries(tmp_path):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    prefs_path = profile_dir / "preferences.json"
    prefs_path.write_text(json.dumps({"knownProducts": {}}), encoding="utf-8")

    regular_meal = {
        "id": "x", "type": "meal",
        "calories": 400, "protein": 25,
        # no isLabel
    }
    n = learn_from_analyzed_entries([regular_meal], tmp_path)
    assert n == 0


def test_learn_writes_timeline_event(tmp_path):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    prefs_path = profile_dir / "preferences.json"
    prefs_path.write_text(json.dumps({"knownProducts": {}}), encoding="utf-8")

    label_entry = {
        "id": "x", "type": "supplement",
        "calories": 200, "protein": 20, "carbs": 10, "fat": 5, "fiber": 2,
        "isLabel": True,
        "labelData": {"productName": "Test Bar"},
    }
    learn_from_analyzed_entries([label_entry], tmp_path)
    timeline = json.loads((tmp_path / "profile" / "timeline.json").read_text(encoding="utf-8"))
    assert len(timeline) >= 1
    last = timeline[-1]
    assert last["type"] == "preference"
    assert "label" in last["summary"].lower() or "product" in last["summary"].lower()


def test_learn_handles_missing_preferences_gracefully(tmp_path):
    """If preferences.json doesn't exist, return 0 without crashing."""
    label_entry = {"id": "x", "isLabel": True, "labelData": {"productName": "X"}}
    n = learn_from_analyzed_entries([label_entry], tmp_path)
    assert n == 0
