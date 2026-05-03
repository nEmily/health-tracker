"""T21 — Tests for restore_chat_history.restore_from_conversations_md."""
import json
import pytest
from pathlib import Path

from lib.restore_chat_history import restore_from_conversations_md


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def data_dir(tmp_path):
    (tmp_path / "analysis").mkdir()
    return tmp_path


def _write_analysis(data_dir: Path, date: str, coach_responses: list | None = None) -> Path:
    path = data_dir / "analysis" / f"{date}.json"
    data = {"date": date, "entries": [], "coachResponses": coach_responses or []}
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _write_conversations(data_dir: Path, content: str) -> Path:
    path = data_dir / "conversations.md"
    path.write_text(content, encoding="utf-8")
    return path


def _read_analysis(data_dir: Path, date: str) -> dict:
    return json.loads((data_dir / "analysis" / f"{date}.json").read_text())


# Shared conversations content covering 2 dates, 3 coach responses total
CONVERSATIONS_TWO_DATES = """\
## Friday, May 1, 2026

**User** (10:00 AM): How am I doing today?
**Coach** (10:01 AM): You are doing great today! Keep up the good work on your goals.

**User** (2:00 PM): What should I eat for dinner?
**Coach** (2:01 PM): Try a high protein meal with vegetables for dinner.

## Saturday, May 2, 2026

**User** (9:00 AM): Morning check-in.
**Coach** (9:01 AM): Good morning! You had a solid day yesterday, keep it up.
"""


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_restores_missing_responses(data_dir):
    """3 coach responses across 2 dates — 1 already present, 2 should be restored."""
    _write_analysis(data_dir, "2026-05-01", coach_responses=[{
        "id": "existing_1",
        "timestamp": 1000,
        "respondsTo": [],
        "text": "You are doing great today! Keep up the good work on your goals.",
    }])
    _write_analysis(data_dir, "2026-05-02")
    _write_conversations(data_dir, CONVERSATIONS_TWO_DATES)

    result = restore_from_conversations_md(data_dir)

    assert result["restored_count"] == 2
    assert result["skipped_existing"] == 1

    day1 = _read_analysis(data_dir, "2026-05-01")
    texts = [r["text"] for r in day1["coachResponses"]]
    assert "You are doing great today! Keep up the good work on your goals." in texts
    assert "Try a high protein meal with vegetables for dinner." in texts

    day2 = _read_analysis(data_dir, "2026-05-02")
    assert any("Good morning" in r["text"] for r in day2["coachResponses"])


def test_source_field_set_on_restored_entries(data_dir):
    """Every restored entry must have _source containing 'conversations-md-restore-'."""
    _write_analysis(data_dir, "2026-05-01")
    _write_analysis(data_dir, "2026-05-02")
    _write_conversations(data_dir, CONVERSATIONS_TWO_DATES)

    restore_from_conversations_md(data_dir)

    for date in ("2026-05-01", "2026-05-02"):
        analysis = _read_analysis(data_dir, date)
        for r in analysis["coachResponses"]:
            assert "_source" in r
            assert "conversations-md-restore-" in r["_source"]


def test_idempotent_no_duplicates_on_rerun(data_dir):
    """Re-running on the same conversations.md must produce no new entries."""
    _write_analysis(data_dir, "2026-05-01")
    _write_analysis(data_dir, "2026-05-02")
    _write_conversations(data_dir, CONVERSATIONS_TWO_DATES)

    result1 = restore_from_conversations_md(data_dir)
    result2 = restore_from_conversations_md(data_dir)

    assert result1["restored_count"] == 3
    assert result2["restored_count"] == 0
    assert result2["skipped_existing"] == 3

    # No duplicate entries in files
    for date in ("2026-05-01", "2026-05-02"):
        analysis = _read_analysis(data_dir, date)
        texts = [r["text"] for r in analysis["coachResponses"]]
        assert len(texts) == len(set(texts))


def test_malformed_lines_skipped_valid_entries_processed(data_dir):
    """Lines that don't match any pattern are ignored; valid Coach lines still restore."""
    _write_analysis(data_dir, "2026-05-01")
    content = """\
## Friday, May 1, 2026

MALFORMED LINE WITHOUT FORMAT
random garbage: not a message
**Coach** (10:01 AM): Valid response that should be restored.
"""
    _write_conversations(data_dir, content)

    result = restore_from_conversations_md(data_dir)

    assert result["errors"] == []
    day1 = _read_analysis(data_dir, "2026-05-01")
    assert any("Valid response that should be restored." in r["text"] for r in day1["coachResponses"])


def test_missing_analysis_file_counted_in_errors(data_dir):
    """A date in conversations.md with no matching analysis file increments errors."""
    # Only create analysis for May 2, not May 1
    _write_analysis(data_dir, "2026-05-02")
    _write_conversations(data_dir, CONVERSATIONS_TWO_DATES)

    result = restore_from_conversations_md(data_dir)

    assert len(result["errors"]) == 1
    assert "2026-05-01" in result["errors"][0]
    # May 2 still processed
    assert result["restored_count"] == 1


def test_date_with_no_coach_responses_is_noop(data_dir):
    """A date section with only User lines should not modify analysis or add errors."""
    _write_analysis(data_dir, "2026-05-01")
    content = """\
## Friday, May 1, 2026

**User** (10:00 AM): Hello, is anyone there?
"""
    _write_conversations(data_dir, content)

    result = restore_from_conversations_md(data_dir)

    assert result["restored_count"] == 0
    assert result["errors"] == []
    day1 = _read_analysis(data_dir, "2026-05-01")
    assert day1["coachResponses"] == []


def test_no_conversations_file_returns_zeros(data_dir):
    """Missing conversations.md returns all-zero result without error."""
    result = restore_from_conversations_md(data_dir)

    assert result == {"dates_processed": 0, "restored_count": 0, "skipped_existing": 0, "errors": []}


def test_iso_date_header_format_supported(data_dir):
    """## YYYY-MM-DD headers (written by append_conversations.py) are also parsed."""
    _write_analysis(data_dir, "2026-05-01")
    content = """\
## 2026-05-01

**User** (10:00 AM): How am I doing?
**Coach** (10:01 AM): Looking good today, keep it up!
"""
    _write_conversations(data_dir, content)

    result = restore_from_conversations_md(data_dir)

    assert result["restored_count"] == 1
    day1 = _read_analysis(data_dir, "2026-05-01")
    assert any("Looking good today" in r["text"] for r in day1["coachResponses"])


def test_full_date_timestamp_format_in_coach_line(data_dir):
    """Timestamp format 'YYYY-MM-DD HH:MM AM/PM' (from append_conversations.py) is parsed."""
    _write_analysis(data_dir, "2026-05-01")
    content = """\
## 2026-05-01

**User** (2026-05-01 10:00 AM): Test message.
**Coach** (2026-05-01 10:01 AM): Response with full timestamp format.
"""
    _write_conversations(data_dir, content)

    result = restore_from_conversations_md(data_dir)

    assert result["restored_count"] == 1
    day1 = _read_analysis(data_dir, "2026-05-01")
    assert any("full timestamp format" in r["text"] for r in day1["coachResponses"])
