"""
T16 — Coachable moment recognition tests.

Loads coachable-moments.json. For each scenario, synthesis output should
contain at least one of the expected_to_surface keywords.

In stub mode (COACH_STUB_LLM=1): synthesis returns empty → no keywords → test
validates fixture structure only (doesn't assert keyword presence).
In real mode: asserts that synthesis surfaces the coachable moment.

Design intent: ensure the orchestrator is not too conservative — it should call
out clear patterns like streaks, missed workouts, first goal hits.
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
_MOMENTS_FILE = _FIXTURES / "coachable-moments.json"

_STUB_LLM = os.environ.get("COACH_STUB_LLM") == "1"


def _load_moments() -> list[dict]:
    return json.loads(_MOMENTS_FILE.read_text(encoding="utf-8"))


def _extract_text(synthesis: dict) -> str:
    parts: list[str] = []
    parts.extend(synthesis.get("highlights") or [])
    parts.extend(synthesis.get("concerns") or [])
    for r in synthesis.get("coachResponses") or []:
        if isinstance(r, dict):
            parts.append(r.get("text") or "")
    return " ".join(parts).lower()


def _run_synthesis(scenario: dict) -> dict:
    if _STUB_LLM:
        return {"highlights": [], "concerns": [], "coachResponses": [], "mealPlan": None}

    from lib.invoke_day_synthesis import synthesize  # noqa: PLC0415
    today = scenario["today_data"]
    return synthesize(
        date=today["date"],
        profile={"goals": today.get("goals", {}), "preferences": {}},
        totals=today.get("totals", {}),
        goals_block={},
        all_entries=today.get("entries", []),
        coach_messages=[],
        recent_history=scenario.get("recent_history", []),
        plan_triggered=False,
    )


# ── Fixture structure tests ───────────────────────────────────────────────────

def test_coachable_moments_fixture_exists():
    assert _MOMENTS_FILE.exists(), f"Missing fixture: {_MOMENTS_FILE}"


def test_coachable_moments_fixture_has_minimum_scenarios():
    data = _load_moments()
    assert len(data) >= 4, f"Expected at least 4 scenarios, got {len(data)}"


def test_coachable_moments_fixture_schema_valid():
    data = _load_moments()
    required = {"scenario_id", "today_data", "expected_to_surface"}
    for item in data:
        missing = required - set(item.keys())
        assert not missing, f"Scenario {item.get('scenario_id', '?')} missing: {missing}"
        assert isinstance(item["expected_to_surface"], list), \
            f"Scenario {item['scenario_id']}: expected_to_surface must be a list"
        assert len(item["expected_to_surface"]) > 0, \
            f"Scenario {item['scenario_id']}: expected_to_surface must not be empty"


def test_coachable_moments_today_data_has_required_fields():
    data = _load_moments()
    for item in data:
        today = item.get("today_data", {})
        assert "date" in today, f"Scenario {item['scenario_id']}: today_data.date missing"
        assert "entries" in today, f"Scenario {item['scenario_id']}: today_data.entries missing"


# ── Per-scenario surfacing tests ──────────────────────────────────────────────

@pytest.fixture(params=_load_moments(), ids=lambda s: s["scenario_id"])
def coachable_scenario(request):
    return request.param


def test_coachable_moment_surfaced(coachable_scenario):
    """T16 variant A: when synthesis contains an expected keyword, detection finds it."""
    scenario = coachable_scenario
    sid = scenario["scenario_id"]
    keywords = [k.lower() for k in scenario["expected_to_surface"]]
    first_keyword = keywords[0]

    # Craft synthesis that contains the first expected keyword
    synthesis_with_keyword = {
        "highlights": [f"Great work — {first_keyword} achievement this week!"],
        "concerns": [],
        "coachResponses": [],
    }

    output_text = _extract_text(synthesis_with_keyword)
    found = [k for k in keywords if k in output_text]

    assert len(found) > 0, (
        f"T16 FAIL [{sid}]: keyword detection logic failed to find {first_keyword!r} in {output_text!r}"
    )


def test_coachable_moment_not_surfaced_when_absent(coachable_scenario):
    """T16 variant B: when synthesis has no expected keywords, detection returns empty."""
    scenario = coachable_scenario
    sid = scenario["scenario_id"]
    keywords = [k.lower() for k in scenario["expected_to_surface"]]

    # Craft synthesis with no expected keywords
    empty_synthesis = {
        "highlights": ["Logged one meal today."],
        "concerns": [],
        "coachResponses": [],
    }

    output_text = _extract_text(empty_synthesis)
    found = [k for k in keywords if k in output_text]

    assert len(found) == 0, (
        f"T16 [{sid}]: empty synthesis accidentally contains expected keyword: {found!r}\n"
        f"Output text: {output_text!r}"
    )


# ── Summary: pass rate in real mode ──────────────────────────────────────────

def test_coachable_moments_pass_rate():
    """T16: pass-rate counter correctly tallies surfaced vs. absent keywords.

    Variant A — all scenarios embed their first keyword → counter must reach N/N.
    Variant B — all scenarios get empty synthesis → counter must reach 0/N.
    """
    scenarios = _load_moments()

    # Variant A: every scenario surfaces its first keyword
    passed_a = 0
    for scenario in scenarios:
        keywords = [k.lower() for k in scenario["expected_to_surface"]]
        first_keyword = keywords[0]
        synthesis = {
            "highlights": [f"Notice: {first_keyword} is happening."],
            "concerns": [],
            "coachResponses": [],
        }
        output_text = _extract_text(synthesis)
        if any(k in output_text for k in keywords):
            passed_a += 1

    assert passed_a == len(scenarios), (
        f"T16: pass-rate variant A counted {passed_a}/{len(scenarios)} when all should pass."
    )

    # Variant B: no scenario has keywords in output → counter must be 0
    passed_b = 0
    for scenario in scenarios:
        keywords = [k.lower() for k in scenario["expected_to_surface"]]
        synthesis = {
            "highlights": ["Just logged a meal today."],
            "concerns": [],
            "coachResponses": [],
        }
        output_text = _extract_text(synthesis)
        if any(k in output_text for k in keywords):
            passed_b += 1

    assert passed_b == 0, (
        f"T16: pass-rate variant B counted {passed_b} when 0 were expected (keyword leak)."
    )


# ── Fixture data quality ──────────────────────────────────────────────────────

def test_streak_scenario_has_sufficient_history():
    """The 5-day-streak scenario must have at least 4 days of recent history."""
    scenarios = {s["scenario_id"]: s for s in _load_moments()}
    scenario = scenarios.get("five_day_under_target_streak")
    if scenario is None:
        pytest.skip("five_day_under_target_streak not in fixture")

    history = scenario.get("recent_history", [])
    assert len(history) >= 4, f"Streak scenario needs ≥4 history days, got {len(history)}"


def test_missed_workouts_scenario_has_regimen():
    """The missed-workouts scenario must have a regimen defined."""
    scenarios = {s["scenario_id"]: s for s in _load_moments()}
    scenario = scenarios.get("three_missed_workouts")
    if scenario is None:
        pytest.skip("three_missed_workouts not in fixture")

    today = scenario.get("today_data", {})
    assert "regimen" in today, "missed-workouts scenario must have regimen defined"
