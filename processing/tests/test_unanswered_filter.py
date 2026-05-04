"""Regression tests for _compute_unanswered.

Bug: 2026-05-03 analysis had 7 coach responses to the SAME user message id
(`coach_1777825909953_vpka`) and 3 to another. Each cron tick generated a
fresh response with a new response.id; the existing _merge_coach_responses
dedup-by-id never fired because new responses had new ids every time. Real
dedup must be on the message-id being responded to, not the response id.

These tests cover _compute_unanswered which is the new gate in front of the
synthesis call.
"""
from process_day import _compute_unanswered


def _msg(id_: str, text: str = "x") -> dict:
    return {"id": id_, "text": text, "timestamp": "2026-05-03T10:00:00Z"}


def _resp(responds_to: list[str], rid: str = "r1") -> dict:
    return {"id": rid, "respondsTo": responds_to, "text": "..."}


# ── Happy path ────────────────────────────────────────────────────────────────

def test_no_existing_analysis_all_unanswered():
    chat = [_msg("a"), _msg("b")]
    assert _compute_unanswered(chat, None) == chat


def test_empty_existing_responses_all_unanswered():
    chat = [_msg("a"), _msg("b")]
    assert _compute_unanswered(chat, {"coachResponses": []}) == chat


def test_message_already_answered_filtered_out():
    chat = [_msg("a"), _msg("b")]
    existing = {"coachResponses": [_resp(["a"])]}
    result = _compute_unanswered(chat, existing)
    assert [m["id"] for m in result] == ["b"]


def test_all_answered_returns_empty():
    chat = [_msg("a"), _msg("b")]
    existing = {"coachResponses": [_resp(["a", "b"])]}
    assert _compute_unanswered(chat, existing) == []


# ── The actual production bug ─────────────────────────────────────────────────

def test_seven_responses_to_same_message_dedups_correctly():
    """The 2026-05-03 production state: 7 responses to the same vpka message.
    A new message arriving must NOT trigger a re-response to vpka.
    """
    chat = [_msg("vpka"), _msg("604f"), _msg("new_msg")]
    existing = {
        "coachResponses": [
            _resp(["vpka"], rid=f"r{i}") for i in range(7)
        ] + [
            _resp(["604f"], rid=f"s{i}") for i in range(3)
        ]
    }
    result = _compute_unanswered(chat, existing)
    assert [m["id"] for m in result] == ["new_msg"], (
        f"Expected only new_msg unanswered; got {[m['id'] for m in result]}. "
        "If vpka or 604f appear, the duplicate-response bug is back."
    )


def test_new_response_ids_each_tick_dont_break_dedup():
    """Each cron tick generates fresh response ids. Dedup must work on the
    message being responded to, not the response id."""
    chat = [_msg("a")]
    # Simulate accumulated state after 3 cron ticks responding to same msg
    existing = {
        "coachResponses": [
            _resp(["a"], rid="resp_tick1_xxxx"),
            _resp(["a"], rid="resp_tick2_yyyy"),
            _resp(["a"], rid="resp_tick3_zzzz"),
        ]
    }
    assert _compute_unanswered(chat, existing) == []


# ── Backward compat / edge cases ─────────────────────────────────────────────

def test_legacy_replyto_scalar_recognized():
    """Old-format responses use replyTo: scalar instead of respondsTo: list."""
    chat = [_msg("a"), _msg("b")]
    existing = {"coachResponses": [{"id": "r1", "replyTo": "a", "text": "..."}]}
    result = _compute_unanswered(chat, existing)
    assert [m["id"] for m in result] == ["b"]


def test_mixed_old_and_new_response_shapes():
    chat = [_msg("a"), _msg("b"), _msg("c")]
    existing = {"coachResponses": [
        {"id": "r1", "replyTo": "a", "text": "..."},  # legacy
        {"id": "r2", "respondsTo": ["b"], "text": "..."},  # new
    ]}
    result = _compute_unanswered(chat, existing)
    assert [m["id"] for m in result] == ["c"]


def test_empty_chat_returns_empty():
    assert _compute_unanswered([], None) == []
    assert _compute_unanswered([], {"coachResponses": [_resp(["x"])]}) == []


def test_none_chat_returns_empty():
    """PWA emits coachChat: null (not missing) on days with no messages.
    dict.get('k', []) returns None for explicit null, so callers must handle it.
    Regression for 2026-05-04 cron failure."""
    assert _compute_unanswered(None, None) == []
    assert _compute_unanswered(None, {"coachResponses": [_resp(["x"])]}) == []


def test_coachresponses_explicitly_null_in_existing():
    """existing_analysis.coachResponses can also be None, not [], if a prior
    run wrote nothing. Don't crash."""
    chat = [_msg("a")]
    assert _compute_unanswered(chat, {"coachResponses": None}) == chat


def test_message_without_id_field_passes_through():
    """Defensive: malformed message with no id is treated as unanswered (can't dedup)."""
    chat = [{"text": "no id"}, _msg("a")]
    existing = {"coachResponses": [_resp(["a"])]}
    result = _compute_unanswered(chat, existing)
    # No-id message is NOT in already-responded set, so it survives
    assert len(result) == 1
    assert result[0].get("text") == "no id"


def test_respondsTo_with_none_or_empty_string_ignored():
    """Defensive: respondsTo may contain None or '' — must not match real msg ids."""
    chat = [_msg("a"), _msg("")]
    existing = {"coachResponses": [
        {"id": "r1", "respondsTo": [None, "", "a"], "text": "..."},
    ]}
    result = _compute_unanswered(chat, existing)
    # "a" filtered out; empty-id message survives (no match against real ids)
    assert [m["id"] for m in result] == [""]
