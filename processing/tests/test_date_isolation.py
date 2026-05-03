"""
T20 — Date isolation regression tests.

Ensures synthesis output cannot reference food entities from prior days
without temporal markers. Covers the sablefish hallucination bug (2026-04-30).
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.data_grounding import validate_grounding

_PROFILE = {"preferences": {"dietary": {"favorites": [], "dailyStaples": []}}, "goals": {}}

# ── T20-1: Bare sablefish reference → FAIL ────────────────────────────────────

def test_sablefish_no_marker_is_violation():
    """synthesis references sablefish; today's entries have none → violation."""
    synthesis = {
        "highlights": ["Great sablefish intake supported your omega-3 goals."],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [
        {"name": "Protein shake", "calories": 200, "protein": 30},
        {"name": "Chicken breast", "calories": 350, "protein": 45},
    ]
    today_totals = {"calories": 550, "protein": 75}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is False
    assert any("sablefish" in v for v in result["violations"])
    assert "sablefish" in result["suggested_retry_feedback"]


# ── T20-2: "yesterday's sablefish" → PASS ────────────────────────────────────

def test_sablefish_with_temporal_marker_passes():
    """synthesis references 'yesterday's sablefish'; temporal marker present → ok."""
    synthesis = {
        "highlights": ["Yesterday's sablefish gave you an excellent omega-3 foundation."],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [
        {"name": "Protein shake", "calories": 200, "protein": 30},
    ]
    today_totals = {"calories": 200, "protein": 30}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is True
    assert result["violations"] == []


# ── T20-3: sablefish in today's entries → PASS ───────────────────────────────

def test_sablefish_in_today_entries_passes():
    """synthesis references sablefish and it IS in today's entries → ok."""
    synthesis = {
        "highlights": ["Sablefish was a solid omega-3 source today."],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [
        {"name": "Sablefish fillet", "calories": 420, "protein": 38},
    ]
    today_totals = {"calories": 420, "protein": 38}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is True


# ── T20-4: "earlier this week" temporal marker → PASS ────────────────────────

def test_earlier_this_week_marker_passes():
    synthesis = {
        "highlights": [],
        "concerns": ["Earlier this week your sablefish was great, keep that trend going."],
        "coachResponses": [],
    }
    today_entries = [{"name": "brown rice", "calories": 200}]
    today_totals = {"calories": 200}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is True


# ── T20-5: Multiple historical entities, one marked, one not → partial FAIL ──

def test_mixed_temporal_coverage():
    """Yesterday's salmon passes; bare tuna reference fails."""
    synthesis = {
        "highlights": [
            "Yesterday's salmon was high quality.",
            "Tuna is showing up well in your macros.",
        ],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [{"name": "Protein shake", "calories": 180, "protein": 25}]
    today_totals = {"calories": 180, "protein": 25}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is False
    violations_text = " ".join(result["violations"])
    assert "tuna" in violations_text
    assert "salmon" not in violations_text


# ── T20-6: Live-data regression (2026-04-30) ─────────────────────────────────

_LIVE_ANALYSIS_PATH = Path(__file__).resolve().parent.parent.parent / "coach" / "analysis" / "2026-04-30.json"


@pytest.mark.skipif(
    not _LIVE_ANALYSIS_PATH.exists(),
    reason="Live analysis file not present in this environment",
)
def test_sablefish_regression_live_data():
    """Regression: 2026-04-30 analysis entries should not include sablefish,
    yet the synthesis from that day reportedly mentioned it bare.
    Validate that if we run grounding on a bare-sablefish synthesis
    against those real entries, it catches the violation."""
    with open(_LIVE_ANALYSIS_PATH, encoding="utf-8") as f:
        live_data = json.load(f)

    today_entries = live_data.get("entries", [])
    today_totals = live_data.get("totals", {})

    # Synthetic synthesis that mimics the reported hallucination
    synthesis = {
        "highlights": ["Great sablefish intake provided excellent omega-3s."],
        "concerns": [],
        "coachResponses": [],
    }

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    # If sablefish was genuinely in that day's entries, this test would pass,
    # which is also correct behavior. The bug was it was NOT there.
    if any("sablefish" in (e.get("name") or "").lower() for e in today_entries):
        assert result["ok"] is True  # Sablefish was actually logged — no violation
    else:
        assert result["ok"] is False
        assert any("sablefish" in v for v in result["violations"])


# ── T20-7: Date-format temporal marker ───────────────────────────────────────

def test_iso_date_temporal_marker_passes():
    """An explicit ISO date (2026-04-29) near a sablefish reference → PASS."""
    synthesis = {
        "highlights": ["On 2026-04-29, sablefish gave you solid protein."],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [{"name": "oatmeal", "calories": 300}]
    today_totals = {"calories": 300}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is True


# ── T20-8: "X days ago" temporal marker ──────────────────────────────────────

def test_days_ago_temporal_marker_passes():
    synthesis = {
        "highlights": ["3 days ago your salmon intake was perfect."],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [{"name": "chicken", "calories": 300}]
    today_totals = {"calories": 300}

    result = validate_grounding(synthesis, today_entries, today_totals, _PROFILE)

    assert result["ok"] is True
