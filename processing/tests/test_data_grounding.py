"""
Unit tests for lib/data_grounding.py

Covers: entity-in-today PASS, temporal-marker PASS, missing-marker FAIL,
case-insensitivity, multiple entities, numerical grounding, empty inputs,
malformed synthesis output.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.data_grounding import validate_grounding


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _profile(extras=None):
    base = {"preferences": {"dietary": {"favorites": [], "dailyStaples": []}}, "goals": {}}
    if extras:
        base.update(extras)
    return base


def _entry(name="", notes="", description="", **kwargs):
    e = {"name": name, "notes": notes, "description": description}
    e.update(kwargs)
    return e


# ── Test 1: Entity in today's entries → PASS ──────────────────────────────────

def test_entity_in_today_passes():
    synthesis = {"highlights": ["Great salmon intake today!"], "concerns": [], "coachResponses": []}
    entries = [_entry(name="Grilled Salmon", calories=400, protein=45)]
    totals = {"calories": 400, "protein": 45}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is True
    assert result["violations"] == []


# ── Test 2: Entity not in today's entries + temporal marker → PASS ────────────

def test_temporal_marker_passes():
    synthesis = {
        "highlights": ["Yesterday's sablefish gave you a great protein base."],
        "concerns": [],
        "coachResponses": [],
    }
    entries = [_entry(name="Protein Shake", calories=200, protein=30)]
    totals = {"calories": 200, "protein": 30}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is True
    assert result["violations"] == []


# ── Test 3: Entity not in today's entries, no marker → FAIL ──────────────────

def test_entity_not_in_today_no_marker_fails():
    synthesis = {
        "highlights": ["Great sablefish intake boosted your omega-3s."],
        "concerns": [],
        "coachResponses": [],
    }
    entries = [_entry(name="Chicken breast", calories=300, protein=40)]
    totals = {"calories": 300, "protein": 40}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is False
    assert any("sablefish" in v for v in result["violations"])
    assert "sablefish" in result["suggested_retry_feedback"]


# ── Test 4: Case-insensitive entity matching ──────────────────────────────────

def test_case_insensitive_entity_in_today():
    synthesis = {"highlights": ["Salmon hit your omega target!"], "concerns": [], "coachResponses": []}
    entries = [_entry(name="SALMON FILLET", calories=350, protein=42)]
    totals = {"calories": 350, "protein": 42}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is True


def test_case_insensitive_entity_not_in_today():
    synthesis = {"highlights": ["Excellent Sablefish choice."], "concerns": [], "coachResponses": []}
    entries = [_entry(name="chicken soup", calories=250)]
    totals = {"calories": 250}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is False
    assert any("sablefish" in v for v in result["violations"])


# ── Test 5: Multiple entities, mixed pass/fail ────────────────────────────────

def test_multiple_entities_mixed():
    synthesis = {
        "highlights": [
            "Your salmon was on point.",          # salmon in entries → PASS
            "That edamame from last week paid off.",  # edamame + temporal marker → PASS
            "Great tuna intake.",                 # tuna NOT in entries, no marker → FAIL
        ],
        "concerns": [],
        "coachResponses": [],
    }
    entries = [_entry(name="salmon fillet", calories=400)]
    totals = {"calories": 400}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is False
    violations_text = " ".join(result["violations"])
    assert "tuna" in violations_text
    assert "salmon" not in violations_text
    assert "edamame" not in violations_text


# ── Test 6: Numerical claim grounding ────────────────────────────────────────

def test_numerical_claim_grounded_passes():
    synthesis = {"highlights": ["You hit 142g protein today!"], "concerns": [], "coachResponses": []}
    entries = [_entry(name="chicken", protein=142, calories=500)]
    totals = {"calories": 500, "protein": 142}
    result = validate_grounding(synthesis, entries, totals, _profile())
    # Numerical mismatches are warnings only — should not affect ok
    assert result["ok"] is True


def test_numerical_mismatch_is_warning_not_violation():
    synthesis = {"highlights": ["You had 500g protein!"], "concerns": [], "coachResponses": []}
    entries = [_entry(name="chicken", protein=45, calories=300)]
    totals = {"calories": 300, "protein": 45}
    result = validate_grounding(synthesis, entries, totals, _profile())
    # 500g is not in totals/entries — should be a warning, NOT a violation
    assert result["ok"] is True  # no entity violations
    # warnings may or may not fire (500g protein is extreme)
    assert "violations" in result
    assert "warnings" in result


# ── Test 7: Empty inputs ──────────────────────────────────────────────────────

def test_empty_synthesis_output():
    synthesis = {"highlights": [], "concerns": [], "coachResponses": []}
    result = validate_grounding(synthesis, [], {}, _profile())
    assert result["ok"] is True
    assert result["violations"] == []


def test_empty_entries_no_references():
    synthesis = {"highlights": ["Great hydration day."], "concerns": [], "coachResponses": []}
    result = validate_grounding(synthesis, [], {"water": 2000}, _profile())
    # "Great hydration day" contains no food entity keywords → PASS
    assert result["ok"] is True


# ── Test 8: Malformed synthesis output ───────────────────────────────────────

def test_malformed_synthesis_missing_keys():
    result = validate_grounding({}, [], {}, _profile())
    assert result["ok"] is True
    assert result["violations"] == []


def test_malformed_synthesis_none_lists():
    synthesis = {"highlights": None, "concerns": None, "coachResponses": None}
    result = validate_grounding(synthesis, [], {}, _profile())
    assert result["ok"] is True


def test_malformed_coach_response_no_text():
    synthesis = {
        "highlights": [],
        "concerns": [],
        "coachResponses": [{"replyTo": "hello", "timestamp": 1234567890}],
    }
    result = validate_grounding(synthesis, [], {}, _profile())
    assert result["ok"] is True


# ── Test 9: Profile favorites and staples added to entity set ─────────────────

def test_profile_favorites_included_in_entity_set():
    profile = _profile()
    profile["preferences"]["dietary"]["favorites"] = ["miso soup", "edamame"]
    synthesis = {
        "highlights": ["Your miso soup was a perfect low-cal choice."],
        "concerns": [],
        "coachResponses": [],
    }
    # miso soup is NOT in today's entries → should FAIL (profile favorite, no temporal marker)
    entries = [_entry(name="brown rice", calories=200)]
    totals = {"calories": 200}
    result = validate_grounding(synthesis, profile["preferences"]["dietary"]["favorites"] and synthesis and entries and [], {}, profile)
    # Re-run properly
    result = validate_grounding(synthesis, entries, totals, profile)
    assert result["ok"] is False
    assert any("miso soup" in v for v in result["violations"])


# ── Test 10: Temporal marker in concerns ─────────────────────────────────────

def test_temporal_marker_in_concerns():
    synthesis = {
        "highlights": [],
        "concerns": ["Yesterday's salmon was high in sodium — balance it today."],
        "coachResponses": [],
    }
    entries = [_entry(name="chicken", calories=300)]
    totals = {"calories": 300}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is True


# ── Test 11: Temporal marker in coachResponses ────────────────────────────────

def test_temporal_marker_in_coach_response():
    synthesis = {
        "highlights": [],
        "concerns": [],
        "coachResponses": [
            {
                "replyTo": "how was my week?",
                "text": "Earlier this week you had sablefish which was excellent for omega-3s.",
                "timestamp": 1234567890,
            }
        ],
    }
    entries = [_entry(name="protein shake", calories=200)]
    totals = {"calories": 200}
    result = validate_grounding(synthesis, entries, totals, _profile())
    assert result["ok"] is True
