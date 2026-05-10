"""T18 — Tests for coachResponses append-only (chat immutability) rule in process_day."""
import pytest

from process_day import _merge_coach_responses


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resp(id_: str, text: str, timestamp: int = 1000, responds_to=None) -> dict:
    return {
        "id": id_, "timestamp": timestamp,
        "respondsTo": responds_to or [],
        "text": text,
    }


# ── New harder rule: drop new responses whose targets are already answered ──

def test_drop_new_response_to_already_answered_message():
    """If existing already answered msg X, a new response targeting X is
    dropped (not appended). Prevents duplicate-response storms when a later
    cron run incorrectly thinks X is unanswered.

    Per CLAUDE.md #9: never rewrite history. The user has already read the
    existing answer to X.
    """
    existing = [_resp("orig_a", "First answer to X", responds_to=["msg_x"])]
    new = [_resp("new_b", "Different attempt to answer X", responds_to=["msg_x"])]
    merged = _merge_coach_responses(existing, new)
    assert len(merged) == 1
    assert merged[0]["id"] == "orig_a"
    assert "First answer" in merged[0]["text"]


def test_drop_when_all_targets_already_answered_in_batched_response():
    """If existing has a batched response covering [x, y, z], a new
    individual response targeting x is dropped. Same for y or z."""
    existing = [_resp("orig_batched", "Batched", responds_to=["x", "y", "z"])]
    new = [
        _resp("dup_x", "to x", responds_to=["x"]),
        _resp("dup_y", "to y", responds_to=["y"]),
    ]
    merged = _merge_coach_responses(existing, new)
    assert len(merged) == 1
    assert merged[0]["id"] == "orig_batched"


def test_keep_new_response_targeting_genuinely_new_message():
    """New response covering a message NOT yet answered is appended."""
    existing = [_resp("orig", "to x", responds_to=["x"])]
    new = [_resp("new_resp", "to y", responds_to=["y"])]
    merged = _merge_coach_responses(existing, new)
    assert len(merged) == 2
    assert {r["id"] for r in merged} == {"orig", "new_resp"}


def test_keep_partial_new_target_set():
    """Edge case: new response targets [x, y] where x is already answered
    but y is not. Currently we drop ONLY if ALL targets are already
    answered. This response covers a new target, so keep it."""
    existing = [_resp("orig", "to x", responds_to=["x"])]
    new = [_resp("new", "to x and y", responds_to=["x", "y"])]
    merged = _merge_coach_responses(existing, new)
    assert len(merged) == 2  # both kept


def test_legacy_replyto_scalar_treated_same_as_respondsTo():
    """Old responses use replyTo scalar; should still register as already-answered."""
    existing = [{"id": "old", "text": "old", "replyTo": "x"}]
    new = [_resp("new", "duplicate to x", responds_to=["x"])]
    merged = _merge_coach_responses(existing, new)
    assert len(merged) == 1
    assert merged[0]["id"] == "old"


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_existing_plus_new_all_present():
    """Existing [A, B] merged with new [C, D] yields [A, B, C, D] in order."""
    existing = [_resp("A", "Response A", 1000), _resp("B", "Response B", 2000)]
    new = [_resp("C", "Response C", 3000), _resp("D", "Response D", 4000)]

    merged = _merge_coach_responses(existing, new)

    assert [r["id"] for r in merged] == ["A", "B", "C", "D"]


def test_existing_entries_byte_identical_after_merge():
    """A and B from existing must be verbatim in the merged result — not touched."""
    a = _resp("A", "Exact text for A verbatim", 1000)
    b = _resp("B", "Exact text for B verbatim", 2000)
    existing = [dict(a), dict(b)]
    new = [_resp("C", "Response C", 3000), _resp("D", "Response D", 4000)]

    merged = _merge_coach_responses(existing, new)

    a_merged = next(r for r in merged if r["id"] == "A")
    b_merged = next(r for r in merged if r["id"] == "B")
    assert a_merged == a
    assert b_merged == b


def test_duplicate_id_keeps_existing_not_new():
    """If new contains B with same id as existing B, existing B is kept; new B discarded. E is appended."""
    b_existing = _resp("B", "EXISTING B — this text must survive", 2000)
    b_new = _resp("B", "NEW B — this must be discarded", 9999)
    existing = [_resp("A", "Response A", 1000), b_existing]
    new = [b_new, _resp("E", "Response E", 3000)]

    merged = _merge_coach_responses(existing, new)

    b_merged = next(r for r in merged if r["id"] == "B")
    assert b_merged["text"] == "EXISTING B — this text must survive"
    assert b_merged["timestamp"] == 2000

    ids = [r["id"] for r in merged]
    assert "E" in ids
    assert ids.count("B") == 1


def test_empty_new_existing_unchanged():
    """No new responses — existing list returned unchanged."""
    existing = [_resp("A", "Response A", 1000), _resp("B", "Response B", 2000)]

    merged = _merge_coach_responses(existing, [])

    assert merged == existing


def test_empty_existing_all_new_added():
    """No existing responses — all new entries are added."""
    new = [_resp("C", "Response C", 3000)]

    merged = _merge_coach_responses([], new)

    assert [r["id"] for r in merged] == ["C"]


def test_no_id_new_entry_always_appended():
    """A new entry without an 'id' field is always appended (no deduplication possible)."""
    existing = [_resp("A", "Response A", 1000)]
    new_no_id = {"timestamp": 2000, "respondsTo": [], "text": "No ID response"}

    merged = _merge_coach_responses(existing, [new_no_id])

    assert len(merged) == 2
    assert merged[-1]["text"] == "No ID response"
