"""Tests for synthesis voice integration — soul loading, tone rules embedding, non-gating validator."""

from __future__ import annotations
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROCESSING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROCESSING_DIR))

from lib.invoke_day_synthesis import _build_synthesis_prompt, _load_coach_soul, synthesize

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_PROFILE_WITH_RULES = {
    "goals": {"calories": 1200, "protein": 100},
    "preferences": {
        "coachingTone": {
            "rules": [
                "Speak in concrete, specific numbers (e.g., '82g protein vs 100g target').",
                "Reference physiological mechanisms when relevant.",
            ]
        }
    },
}

_TOTALS = {"calories": 900, "protein": 82, "fiber": 15}
_GOALS_BLOCK = {"calories": {"status": "under", "target": 1200, "actual": 900}}


def _build(**overrides) -> str:
    defaults = dict(
        date="2026-05-01",
        profile=_PROFILE_WITH_RULES,
        totals=_TOTALS,
        goals_block=_GOALS_BLOCK,
        all_entries=[],
        coach_messages=[],
        recent_history=[],
        plan_triggered=False,
    )
    defaults.update(overrides)
    return _build_synthesis_prompt(**defaults)


# ---------------------------------------------------------------------------
# Soul loading
# ---------------------------------------------------------------------------

class TestCoachSoulLoading:
    def test_soul_loads_and_has_content(self):
        soul = _load_coach_soul()
        assert len(soul) > 200, "Soul section should be substantial"

    def test_soul_contains_core_identity(self):
        soul = _load_coach_soul()
        assert "Coach" in soul

    def test_soul_contains_communication_guidance(self):
        soul = _load_coach_soul()
        lower = soul.lower()
        assert "data" in lower or "numbers" in lower or "specific" in lower

    def test_soul_does_not_include_on_demand_references(self):
        # The 'On-Demand References' section comes after the soul — should be cut off
        soul = _load_coach_soul()
        assert "On-Demand References" not in soul


# ---------------------------------------------------------------------------
# Synthesis prompt voice embedding
# ---------------------------------------------------------------------------

class TestSynthesisPromptVoice:
    def test_prompt_includes_soul_section(self):
        prompt = _build()
        assert "COACH SOUL" in prompt

    def test_prompt_includes_soul_content(self):
        soul = _load_coach_soul()
        prompt = _build()
        # At least some characteristic soul text should appear verbatim
        assert "Data-grounded" in prompt or "Coach" in prompt
        assert len([line for line in soul.splitlines() if line.strip() and line.strip() in prompt]) >= 3

    def test_prompt_includes_tone_rules_from_preferences(self):
        prompt = _build()
        assert "Speak in concrete, specific numbers" in prompt
        assert "Reference physiological mechanisms" in prompt

    def test_prompt_has_voice_apply_instruction(self):
        prompt = _build()
        assert "SOUL" in prompt
        assert "tone rules" in prompt.lower() or "voice" in prompt.lower()

    def test_prompt_has_no_banned_phrase_checklist(self):
        # Synthesis prompt must not enumerate banned phrases — that's tone_validator's job
        prompt = _build()
        assert "Banned phrases:" not in prompt

    def test_prompt_tone_rules_with_empty_coaching_tone(self):
        profile_no_tone = {"goals": {"calories": 1200}, "preferences": {}}
        prompt = _build(profile=profile_no_tone)
        # Falls back to default tone guidance — should still have tone section
        assert "TONE RULES" in prompt or "tone" in prompt.lower()

    def test_prompt_tone_rules_with_missing_preferences(self):
        profile_bare = {"goals": {"calories": 1200}}
        prompt = _build(profile=profile_bare)
        assert "COACH SOUL" in prompt  # soul always present regardless


# ---------------------------------------------------------------------------
# Tone validator is non-gating — violations must not block synthesis output
# ---------------------------------------------------------------------------

