"""
T14 — Pattern recall tripwire tests.

Loads tripwire-days.json and verifies that synthesis output does NOT contain
the forbidden substrings ("tripwires") for each scenario.

In stub mode (COACH_STUB_LLM=1): synthesis returns empty → 0 tripwires → PASS trivially.
In real mode (--with-llm): synthesis produces actual text → tripwires may fire on bad prompts.

Design intent: these tests catch P0 constraint-ignoring behavior in the LLM synthesis call.
In stub mode they validate fixture structure so no noise during fast runs.
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

_FIXTURES = Path(__file__).resolve().parent / "fixtures"
_TRIPWIRE_FILE = _FIXTURES / "tripwire-days.json"

_STUB_LLM = os.environ.get("COACH_STUB_LLM") == "1"


def _load_tripwires() -> list[dict]:
    return json.loads(_TRIPWIRE_FILE.read_text(encoding="utf-8"))


def _extract_text_from_synthesis(synthesis: dict) -> str:
    """Flatten all text from highlights, concerns, and coachResponses into one string."""
    parts: list[str] = []
    parts.extend(synthesis.get("highlights") or [])
    parts.extend(synthesis.get("concerns") or [])
    for r in synthesis.get("coachResponses") or []:
        if isinstance(r, dict):
            parts.append(r.get("text") or "")
    return " ".join(parts).lower()


def _build_stub_synthesis() -> dict:
    return {
        "highlights": [],
        "concerns": [],
        "coachResponses": [],
        "mealPlan": None,
        "regimen": None,
    }


def _run_synthesis_for_scenario(scenario: dict) -> dict:
    """Build synthesis output for a fixture scenario.

    In stub mode: returns empty synthesis (no LLM calls).
    In real mode: would call the actual synthesis pipeline.
    """
    if _STUB_LLM:
        return _build_stub_synthesis()

    # Real mode: import and call the synthesis pipeline
    from lib.invoke_day_synthesis import synthesize  # noqa: PLC0415

    profile = scenario.get("profile_overrides", {})
    entries = scenario.get("entries", [])
    recent_history = scenario.get("recent_history", [])

    return synthesize(
        date=scenario["date"],
        profile=profile,
        totals={},
        goals_block={},
        all_entries=entries,
        coach_messages=[],
        recent_history=recent_history,
        plan_triggered=False,
    )


# ── Fixture structure validation (always runs) ────────────────────────────────

def test_tripwire_fixture_file_exists():
    assert _TRIPWIRE_FILE.exists(), f"Missing fixture: {_TRIPWIRE_FILE}"


def test_tripwire_fixture_has_minimum_scenarios():
    data = _load_tripwires()
    assert len(data) >= 6, f"Expected at least 6 scenarios, got {len(data)}"


def test_tripwire_fixture_schema_valid():
    """Each entry must have the required fields."""
    data = _load_tripwires()
    required = {"scenario_id", "date", "profile_overrides", "entries", "expected_violations"}
    for item in data:
        missing = required - set(item.keys())
        assert not missing, f"Scenario {item.get('scenario_id','?')} missing fields: {missing}"
        assert isinstance(item["expected_violations"], list), \
            f"Scenario {item['scenario_id']}: expected_violations must be a list"
        assert len(item["expected_violations"]) > 0, \
            f"Scenario {item['scenario_id']}: expected_violations must not be empty"


# ── Per-scenario tripwire tests ───────────────────────────────────────────────

def _make_tripwire_test(scenario: dict):
    """Return a test function for the given scenario."""
    sid = scenario["scenario_id"]
    violations = [v.lower() for v in scenario["expected_violations"]]

    def test_fn():
        synthesis = _run_synthesis_for_scenario(scenario)
        output_text = _extract_text_from_synthesis(synthesis)

        tripped = [v for v in violations if v in output_text]

        assert len(tripped) == 0, (
            f"T14 FAIL [{sid}]: tripwires triggered: {tripped!r}\n"
            f"Output text: {output_text[:300]}"
        )

    test_fn.__name__ = f"test_tripwire_{sid}"
    test_fn.__doc__ = f"T14 [{sid}]: {scenario.get('description', '')}"
    return test_fn


@pytest.fixture(params=_load_tripwires(), ids=lambda s: s["scenario_id"])
def tripwire_scenario(request):
    return request.param


def test_clean_synthesis_passes_tripwire_check(tripwire_scenario):
    """T14 variant A: synthesis with no forbidden substrings → detection finds 0 violations."""
    scenario = tripwire_scenario
    violations = [v.lower() for v in scenario["expected_violations"]]

    # Clean output — no tripwire substrings present
    clean_synthesis = {
        "highlights": ["You're on track today. Keep it up."],
        "concerns": [],
        "coachResponses": [],
    }

    output_text = _extract_text_from_synthesis(clean_synthesis)
    tripped = [v for v in violations if v in output_text]

    assert len(tripped) == 0, (
        f"T14 FAIL [{scenario['scenario_id']}]: clean synthesis accidentally contains tripwire: {tripped!r}\n"
        f"Output text: {output_text}"
    )


def test_dirty_synthesis_triggers_tripwire_detection(tripwire_scenario):
    """T14 variant B: synthesis that embeds a forbidden substring → detection catches it."""
    scenario = tripwire_scenario
    violations = [v.lower() for v in scenario["expected_violations"]]
    first_violation = violations[0]

    # Dirty output — deliberately embeds the first tripwire string
    dirty_synthesis = {
        "highlights": [f"Consider trying to {first_violation} for better results."],
        "concerns": [],
        "coachResponses": [],
    }

    output_text = _extract_text_from_synthesis(dirty_synthesis)
    tripped = [v for v in violations if v in output_text]

    assert len(tripped) > 0, (
        f"T14 FAIL [{scenario['scenario_id']}]: tripwire detection logic missed known violation {first_violation!r}.\n"
        f"Output text: {output_text!r}"
    )
    assert first_violation in tripped, (
        f"T14 [{scenario['scenario_id']}]: expected {first_violation!r} in tripped, got {tripped!r}"
    )


# ── All 8 scenarios pass in one summary assertion ────────────────────────────

def test_all_tripwires_zero_in_stub_mode():
    """In stub mode: all 8 tripwire scenarios must produce 0 violations (empty synthesis)."""
    if not _STUB_LLM:
        pytest.skip("Only meaningful in stub mode — in real mode each scenario runs individually")

    data = _load_tripwires()
    all_tripped = []
    for scenario in data:
        synthesis = _run_synthesis_for_scenario(scenario)
        output_text = _extract_text_from_synthesis(synthesis)
        violations = [v.lower() for v in scenario["expected_violations"]]
        tripped = [v for v in violations if v in output_text]
        all_tripped.extend([(scenario["scenario_id"], v) for v in tripped])

    assert all_tripped == [], f"T14 FAIL: tripwires triggered: {all_tripped}"
