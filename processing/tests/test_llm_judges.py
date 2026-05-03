"""
Tests for llm_judges.py — voice_fidelity_judge and persona_consistency_judge.

Patches _call_claude_raw so no actual subprocess or claude invocations happen.
"""

from __future__ import annotations
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_PROCESSING = Path(__file__).resolve().parent.parent
if str(_PROCESSING) not in sys.path:
    sys.path.insert(0, str(_PROCESSING))

import tests.llm_judges as judges  # noqa: E402 (after sys.path setup)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pairs(n: int = 3) -> list[dict]:
    return [
        {
            "pair": i + 1,
            "original": f"Original {i+1}: You hit 82g protein vs 100g target.",
            "orchestrator": f"Orchestrator {i+1}: 82g protein today, 100g goal.",
            "context": {"date": f"2026-05-0{i+1}", "user_message": "how did I do?"},
        }
        for i in range(n)
    ]


def _responses(n: int = 3) -> list[str]:
    return [f"Coach response {i+1}: You hit {80 + i*5}g protein, great work." for i in range(n)]


# ── T1: voice_fidelity_judge input format — prompt contains all pairs ─────────

def test_voice_fidelity_judge_passes_all_pairs_to_prompt():
    """Each pair's original and orchestrator text must appear in the prompt."""
    captured_prompts: list[str] = []

    def fake_raw(prompt: str):
        captured_prompts.append(prompt)
        return [
            {"pair": i + 1, "winner": "tie", "rationale": "ok", "score": 3}
            for i in range(3)
        ]

    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", side_effect=fake_raw):
        judges.voice_fidelity_judge(_pairs(3))

    assert len(captured_prompts) == 1
    prompt = captured_prompts[0]
    assert "Pair 1" in prompt
    assert "Pair 2" in prompt
    assert "Pair 3" in prompt
    assert "Original 1" in prompt
    assert "Orchestrator 1" in prompt


# ── T2: voice_fidelity_judge output parsing ──────────────────────────────────

def test_voice_fidelity_judge_parses_winner_field():
    """Result must contain winner A/B/tie/both bad per pair."""
    canned = [
        {"pair": 1, "winner": "B", "rationale": "Better grounded", "score": 4},
        {"pair": 2, "winner": "tie", "rationale": "Even", "score": 3},
    ]

    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", return_value=canned):
        result = judges.voice_fidelity_judge(_pairs(2))

    assert len(result) == 2
    assert result[0]["winner"] == "B"
    assert result[1]["winner"] == "tie"
    assert all("rationale" in r for r in result)


# ── T3: voice_fidelity_judge prompt includes soul section ────────────────────

def test_voice_fidelity_judge_prompt_includes_soul_section():
    """Prompt must embed a CALIBRATION or Coach Soul section."""
    captured: list[str] = []

    def fake_raw(prompt: str):
        captured.append(prompt)
        return [{"pair": 1, "winner": "tie", "rationale": "ok", "score": 3}]

    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", side_effect=fake_raw):
        judges.voice_fidelity_judge(_pairs(1))

    assert len(captured) == 1
    # Soul section or calibration marker must be in the prompt
    assert "CALIBRATION" in captured[0] or "Soul" in captured[0] or "Coach" in captured[0]


# ── T4: voice_fidelity_judge fallback on parse error ─────────────────────────

def test_voice_fidelity_judge_fallback_on_error():
    """When _call_claude_raw raises, judge returns safe tie fallbacks."""
    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", side_effect=RuntimeError("timeout")):
        result = judges.voice_fidelity_judge(_pairs(2))

    assert len(result) == 2
    for r in result:
        assert r["winner"] in ("A", "B", "tie", "both bad")
        assert "rationale" in r


# ── T5: persona_consistency_judge passes all responses ────────────────────────

def test_persona_consistency_judge_passes_all_responses():
    """All responses must appear in the prompt passed to _call_claude_raw."""
    captured: list[str] = []

    def fake_raw(prompt: str):
        captured.append(prompt)
        return {"score": 4, "drifted_dimensions": [], "drift_examples": [], "summary": "ok"}

    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", side_effect=fake_raw):
        judges.persona_consistency_judge(_responses(3))

    assert len(captured) == 1
    for i in range(3):
        assert f"Response {i+1}" in captured[0]


# ── T6: persona_consistency_judge output parsing ─────────────────────────────

def test_persona_consistency_judge_returns_score_and_dimensions():
    """Result must have score, drifted_dimensions, drift_examples, summary."""
    canned = {
        "score": 4,
        "drifted_dimensions": ["tone register"],
        "drift_examples": ["Response 3 uses formal language"],
        "summary": "Mostly consistent, minor tone drift.",
    }

    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", return_value=canned):
        result = judges.persona_consistency_judge(_responses(3))

    assert result["score"] == 4
    assert "tone register" in result["drifted_dimensions"]
    assert len(result["drift_examples"]) == 1
    assert "summary" in result


# ── T7: persona_consistency_judge fallback on error ──────────────────────────

def test_persona_consistency_judge_fallback_on_error():
    """When _call_claude_raw raises, judge returns safe fallback dict."""
    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw", side_effect=ValueError("bad json")):
        result = judges.persona_consistency_judge(_responses(2))

    assert isinstance(result, dict)
    assert "score" in result
    assert isinstance(result["score"], int)
    assert 1 <= result["score"] <= 5


# ── T8: stub mode skips LLM calls entirely ───────────────────────────────────

def test_stub_mode_does_not_call_raw():
    """With _STUB_LLM=True, _call_claude_raw must not be called at all."""
    with patch.object(judges, "_STUB_LLM", True), \
         patch.object(judges, "_call_claude_raw") as mock_raw:
        result_v = judges.voice_fidelity_judge(_pairs(2))
        result_p = judges.persona_consistency_judge(_responses(2))

    mock_raw.assert_not_called()
    assert len(result_v) == 2
    assert all(r["winner"] == "tie" for r in result_v)
    assert result_p["score"] == 5
    assert "stub" in result_p["summary"].lower()


# ── T9: voice judge handles zero pairs ───────────────────────────────────────

def test_voice_fidelity_judge_empty_pairs():
    """Empty pairs list returns empty list without calling _call_claude_raw."""
    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw") as mock_raw:
        result = judges.voice_fidelity_judge([])

    mock_raw.assert_not_called()
    assert result == []


# ── T10: unexpected list-wrapped response handled by voice judge ──────────────

def test_voice_fidelity_judge_handles_unexpected_response_shape():
    """When judge returns an unexpected shape (dict instead of list), fallback gracefully."""
    # If the LLM returns a dict (wrong type), we get an empty list (no crash)
    with patch.object(judges, "_STUB_LLM", False), \
         patch.object(judges, "_call_claude_raw",
                      return_value={"error": "unexpected"}):
        result = judges.voice_fidelity_judge(_pairs(2))

    # Should be a list (empty or fallback), not raise
    assert isinstance(result, list)
