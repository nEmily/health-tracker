"""Regression tests for _normalize_coach_responses overriding LLM-supplied timestamps.

Bug (2026-05-04): LLM-generated timestamps were used as-is. The LLM tends
to fabricate plausible chat times (e.g. 17:00:00 on the dot, 17:13:20)
that don't reflect when synthesis actually ran. This caused chronological
display order on the phone to be wrong: chat showed user-user-coach-coach
clustered when in reality coach replies should sort by actual synthesis time.

Fix: orchestrator OVERRIDES timestamp with current time, ignoring whatever
the LLM put in.
"""
import time
from lib.invoke_day_synthesis import _normalize_coach_responses


def test_llm_timestamp_overridden():
    """Whatever the LLM put in, output uses real time."""
    fake_llm_ts = 1700000000000  # ~2023, way in the past
    entries = [{
        "id": "x",
        "timestamp": fake_llm_ts,
        "respondsTo": ["msg1"],
        "text": "reply",
    }]
    before = int(time.time() * 1000)
    result = _normalize_coach_responses(entries)
    after = int(time.time() * 1000)
    actual_ts = result[0]["timestamp"]
    assert before <= actual_ts <= after, (
        f"timestamp {actual_ts} should be between {before} and {after}, "
        f"not the LLM-supplied {fake_llm_ts}"
    )


def test_multiple_entries_get_ordered_timestamps():
    """When LLM emits multiple responses (rare in batched mode), each gets
    a distinct, monotonic timestamp so sort is stable."""
    entries = [
        {"id": f"r{i}", "timestamp": 100, "respondsTo": [], "text": f"r{i}"}
        for i in range(3)
    ]
    result = _normalize_coach_responses(entries)
    timestamps = [r["timestamp"] for r in result]
    assert timestamps == sorted(timestamps), "timestamps should be monotonic"
    assert len(set(timestamps)) == 3, "timestamps should be distinct"


def test_id_uses_real_timestamp_when_missing():
    """When entry has no id, generate one from the actual (overridden) ts."""
    entries = [{"respondsTo": [], "text": "reply"}]
    result = _normalize_coach_responses(entries)
    assert result[0]["id"].startswith("coach_resp_")
    # The id should reflect the new timestamp, not be hardcoded
    ts_in_id = int(result[0]["id"].replace("coach_resp_", ""))
    assert ts_in_id == result[0]["timestamp"]


def test_existing_id_preserved():
    entries = [{
        "id": "manual_id_xyz",
        "timestamp": 1700000000000,
        "respondsTo": [],
        "text": "x",
    }]
    result = _normalize_coach_responses(entries)
    assert result[0]["id"] == "manual_id_xyz"


def test_responds_to_list_preserved():
    entries = [{
        "respondsTo": ["m1", "m2", "m3"],
        "text": "batched reply",
    }]
    result = _normalize_coach_responses(entries)
    assert result[0]["respondsTo"] == ["m1", "m2", "m3"]


def test_legacy_replyto_scalar_migrated_to_array():
    entries = [{"replyTo": "m1", "text": "x"}]
    result = _normalize_coach_responses(entries)
    assert result[0]["respondsTo"] == ["m1"]
    assert result[0]["replyTo"] == "m1"  # backward-compat field also emitted
