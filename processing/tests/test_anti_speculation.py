"""
T15 — Anti-AI-speculation tests.

Uses anti-speculation-prompts.json fixtures. For each scenario, a synthetic "naive"
bad response is passed through data_grounding.validate_grounding() to verify the
grounding module catches ungrounded food entity claims.

This test does NOT require LLM calls — it tests the grounding module directly
by constructing what a speculative LLM would say and verifying the gate catches it.

Design intent: validate that data_grounding.py catches the class of "AI indexing on
training rather than logged data" failures that Emily called out historically.
"""

from __future__ import annotations
import json
import os
import sys
from pathlib import Path

import pytest

_PROCESSING = Path(__file__).resolve().parent.parent
if str(_PROCESSING) not in sys.path:
    sys.path.insert(0, str(_PROCESSING))

from lib.data_grounding import validate_grounding  # noqa: E402

_FIXTURES = Path(__file__).resolve().parent / "fixtures"
_ANTI_SPEC_FILE = _FIXTURES / "anti-speculation-prompts.json"


def _load_scenarios() -> list[dict]:
    return json.loads(_ANTI_SPEC_FILE.read_text(encoding="utf-8"))


def _profile(scenario: dict) -> dict:
    return {"preferences": {"dietary": {"favorites": [], "dailyStaples": []}}, "goals": {}}


# ── Fixture structure tests (always run) ─────────────────────────────────────

def test_anti_speculation_fixture_exists():
    assert _ANTI_SPEC_FILE.exists(), f"Missing fixture: {_ANTI_SPEC_FILE}"


def test_anti_speculation_fixture_has_minimum_scenarios():
    data = _load_scenarios()
    assert len(data) >= 5, f"Expected at least 5 scenarios, got {len(data)}"


def test_anti_speculation_fixture_schema_valid():
    data = _load_scenarios()
    required = {"scenario_id", "prompt", "today_entries", "today_totals"}
    for item in data:
        missing = required - set(item.keys())
        assert not missing, f"Scenario {item.get('scenario_id', '?')} missing: {missing}"


# ── Grounding check on naive bad responses ───────────────────────────────────

@pytest.fixture(
    params=_load_scenarios(),
    ids=lambda s: s["scenario_id"],
)
def anti_spec_scenario(request):
    return request.param


def test_naive_bad_response_fails_grounding(anti_spec_scenario):
    """T15: A naive/speculative response that references food entities not in today's entries
    should be caught by validate_grounding (entity violation or is identified as generic).

    For scenarios where the naive response contains food entities not in today's data,
    grounding must return ok=False.

    For scenarios that are pure-generic-advice (no food entities), we verify the test
    can at least be structured — these are annotated with is_generic_advice_check=True.
    """
    scenario = anti_spec_scenario
    sid = scenario["scenario_id"]

    naive_response = scenario.get("naive_bad_response", "")
    today_entries = scenario.get("today_entries", [])
    today_totals = scenario.get("today_totals", {})
    grounding_should_catch = scenario.get("grounding_should_catch", [])
    is_generic_check = scenario.get("is_generic_advice_check", False)

    if not grounding_should_catch and is_generic_check:
        # Pure generic advice (no food entities) — grounding passes because no entity claims
        # This is expected: data_grounding catches entity bleed, not generic advice per se
        # The synthesis prompt engineering handles the generic-advice problem at generation time
        synthesis = {"highlights": [naive_response], "concerns": [], "coachResponses": []}
        result = validate_grounding(synthesis, today_entries, today_totals, _profile(scenario))
        # Grounding may or may not flag this — it's an entity-based check, not style-based
        # We just verify the module doesn't crash
        assert "ok" in result
        assert "violations" in result
        return

    if not naive_response:
        pytest.skip(f"No naive_bad_response defined for scenario {sid}")

    synthesis = {
        "highlights": [naive_response],
        "concerns": [],
        "coachResponses": [],
    }

    result = validate_grounding(synthesis, today_entries, today_totals, _profile(scenario))

    if grounding_should_catch:
        # We expect grounding to fail — entities referenced not in today's entries
        assert result["ok"] is False, (
            f"T15 [{sid}]: expected grounding failure but got ok=True.\n"
            f"Violations: {result['violations']}\n"
            f"Today entries: {[e.get('name') for e in today_entries]}\n"
            f"Naive response: {naive_response[:200]}"
        )
        violations_text = " ".join(result["violations"]).lower()
        caught = [e for e in grounding_should_catch if e.lower() in violations_text]
        assert len(caught) > 0, (
            f"T15 [{sid}]: grounding failed but didn't catch expected entities.\n"
            f"Expected to catch: {grounding_should_catch}\n"
            f"Violations: {result['violations']}"
        )


def test_good_grounded_response_passes(anti_spec_scenario):
    """T15: A well-grounded response (references only today's logged food) must pass."""
    scenario = anti_spec_scenario
    today_entries = scenario.get("today_entries", [])
    today_totals = scenario.get("today_totals", {})

    if not today_entries:
        pytest.skip("No today_entries in scenario — can't build grounded response")

    first_entry_name = today_entries[0].get("name", "your meal")
    grounded_response = f"You logged {first_entry_name} today. That puts you on track."

    synthesis = {
        "highlights": [grounded_response],
        "concerns": [],
        "coachResponses": [],
    }

    result = validate_grounding(synthesis, today_entries, today_totals, _profile(scenario))
    assert result["ok"] is True, (
        f"T15 [{scenario['scenario_id']}]: grounded response failed unexpectedly.\n"
        f"Violations: {result['violations']}"
    )


# ── Bloating scenario specific (sableback-class entity-bleed) ────────────────

def test_bloating_naive_response_grounding():
    """Bloating scenario: naive response invents cruciferous veggies not in entries."""
    scenarios = {s["scenario_id"]: s for s in _load_scenarios()}
    scenario = scenarios.get("bloating_no_trigger")
    if scenario is None:
        pytest.skip("bloating_no_trigger scenario not in fixture")

    naive = scenario["naive_bad_response"]
    today_entries = scenario["today_entries"]
    today_totals = scenario["today_totals"]

    synthesis = {"highlights": [naive], "concerns": [], "coachResponses": []}
    result = validate_grounding(synthesis, today_entries, today_totals, _profile(scenario))

    # broccoli, beans, onions, garlic, wheat are not in today's entries → violation
    assert result["ok"] is False
    violations_lower = " ".join(result["violations"]).lower()
    # At least one of the invented entities should be flagged
    speculative_entities = ["broccoli", "beans", "onions", "garlic", "wheat"]
    caught = [e for e in speculative_entities if e in violations_lower]
    assert len(caught) > 0, f"Expected one of {speculative_entities} to be caught, got: {result['violations']}"


# ── Retry feedback is non-empty on grounding failure ─────────────────────────

def test_grounding_failure_includes_retry_feedback():
    """When grounding fails, suggested_retry_feedback must be non-empty."""
    synthesis = {
        "highlights": ["Your salmon intake was great for omega-3s."],
        "concerns": [],
        "coachResponses": [],
    }
    today_entries = [{"name": "Protein shake", "calories": 200, "protein": 30}]
    today_totals = {"calories": 200, "protein": 30}
    profile = {"preferences": {"dietary": {"favorites": []}}, "goals": {}}

    result = validate_grounding(synthesis, today_entries, today_totals, profile)

    if result["ok"] is False:
        assert result["suggested_retry_feedback"] != "", \
            "On grounding failure, retry feedback must not be empty"
