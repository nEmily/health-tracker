"""T19 — Batched coachResponses: one response per group of unanswered messages."""
import json
import time
import pytest
from unittest.mock import patch, MagicMock
from lib.invoke_day_synthesis import synthesize, _normalize_coach_responses


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_ARGS = dict(
    date="2026-05-02",
    profile={"preferences": {}},
    totals={"calories": 1200, "protein": 80},
    goals_block={"calories": {"target": 1200, "actual": 1200, "remaining": 0, "status": "on_track"}},
    all_entries=[],
    coach_messages=[],
    recent_history=[],
    plan_triggered=False,
)

_STUB_SYNTHESIS = {
    "highlights": ["Good calorie control today"],
    "concerns": [],
    "mealPlan": None,
    "regimen": None,
    "plan_decision_reason": "not-stale",
}


def _make_proc(llm_output: dict) -> MagicMock:
    """Wrap an LLM output dict as a mock subprocess.CompletedProcess."""
    inner = json.dumps(llm_output)
    stdout = json.dumps({"result": inner})
    proc = MagicMock()
    proc.returncode = 0
    proc.stdout = stdout
    return proc


def _user_msg(n: int, base_ts: int = 1_746_000_000_000) -> dict:
    return {"id": f"coach_msg_{n}", "timestamp": base_ts + n * 60_000, "text": f"Question {n}"}


# ---------------------------------------------------------------------------
# T19-A: 4 unanswered messages → exactly 1 batched coachResponse
# ---------------------------------------------------------------------------

def test_four_messages_batched_into_one_response():
    msgs = [_user_msg(i) for i in range(1, 5)]
    ids = [m["id"] for m in msgs]

    llm_resp = {
        **_STUB_SYNTHESIS,
        "coachResponses": [{
            "id": "coach_resp_99999",
            "timestamp": 1_746_000_300_000,
            "respondsTo": ids,
            "text": "Here is a combined answer to all your questions.",
        }],
    }

    with patch("lib.invoke_day_synthesis.subprocess.run", return_value=_make_proc(llm_resp)):
        result = synthesize(**_BASE_ARGS, unanswered_messages=msgs)

    responses = result["coachResponses"]
    assert len(responses) == 1, f"expected 1 response, got {len(responses)}"
    assert responses[0]["respondsTo"] == ids
    assert len(responses[0]["respondsTo"]) == 4
    assert all(mid in responses[0]["respondsTo"] for mid in ids)


# ---------------------------------------------------------------------------
# T19-B: 1 unanswered message → respondsTo: [single_id]
# ---------------------------------------------------------------------------

def test_single_message_single_id_in_responds_to():
    msgs = [_user_msg(1)]
    llm_resp = {
        **_STUB_SYNTHESIS,
        "coachResponses": [{
            "id": "coach_resp_11111",
            "timestamp": 1_746_000_060_000,
            "respondsTo": ["coach_msg_1"],
            "text": "Here is your answer.",
        }],
    }

    with patch("lib.invoke_day_synthesis.subprocess.run", return_value=_make_proc(llm_resp)):
        result = synthesize(**_BASE_ARGS, unanswered_messages=msgs)

    responses = result["coachResponses"]
    assert len(responses) == 1
    assert responses[0]["respondsTo"] == ["coach_msg_1"]


# ---------------------------------------------------------------------------
# T19-C: 0 unanswered messages → empty coachResponses
# ---------------------------------------------------------------------------

def test_zero_messages_empty_coach_responses():
    llm_resp = {
        **_STUB_SYNTHESIS,
        "coachResponses": [],
    }

    with patch("lib.invoke_day_synthesis.subprocess.run", return_value=_make_proc(llm_resp)):
        result = synthesize(**_BASE_ARGS, unanswered_messages=[])

    assert result["coachResponses"] == []


# ---------------------------------------------------------------------------
# T19-D: backward compat — model returns old replyTo scalar → normalized
# ---------------------------------------------------------------------------

def test_old_reply_to_scalar_normalized_to_responds_to_array():
    """When the model returns the old replyTo: scalar schema, _normalize_coach_responses
    migrates it to respondsTo: [id] and also emits replyTo for backward compat."""
    raw = [{"replyTo": "coach_msg_7", "text": "Old-style reply.", "timestamp": 1_746_000_000_001}]
    normalized = _normalize_coach_responses(raw)

    assert len(normalized) == 1
    entry = normalized[0]
    assert entry["respondsTo"] == ["coach_msg_7"]
    assert entry["replyTo"] == "coach_msg_7"  # backward compat preserved
    assert "id" in entry
    assert "timestamp" in entry


# ---------------------------------------------------------------------------
# T19-E: backward compat — new schema also emits replyTo: respondsTo[0]
# ---------------------------------------------------------------------------

def test_new_schema_emits_reply_to_for_backward_compat():
    msgs = [_user_msg(1), _user_msg(2)]
    ids = [m["id"] for m in msgs]

    llm_resp = {
        **_STUB_SYNTHESIS,
        "coachResponses": [{
            "id": "coach_resp_22222",
            "timestamp": 1_746_000_200_000,
            "respondsTo": ids,
            "text": "Addressing both your questions.",
        }],
    }

    with patch("lib.invoke_day_synthesis.subprocess.run", return_value=_make_proc(llm_resp)):
        result = synthesize(**_BASE_ARGS, unanswered_messages=msgs)

    entry = result["coachResponses"][0]
    assert entry["respondsTo"] == ids
    # replyTo must equal the first id in respondsTo for old client compat
    assert entry["replyTo"] == ids[0]


# ---------------------------------------------------------------------------
# T19-F: unanswered_messages=None falls back to legacy mode (no crash)
# ---------------------------------------------------------------------------

def test_legacy_mode_no_unanswered_messages_param():
    llm_resp = {
        **_STUB_SYNTHESIS,
        "coachResponses": [],
    }

    with patch("lib.invoke_day_synthesis.subprocess.run", return_value=_make_proc(llm_resp)):
        # unanswered_messages not passed → legacy per-message mode
        result = synthesize(**_BASE_ARGS)

    assert "coachResponses" in result
    assert isinstance(result["coachResponses"], list)
