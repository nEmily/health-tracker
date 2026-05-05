"""Tests for conversations.md fallback when analysis JSON is missing.

User: 'it seems the messages keep getting overwritten but again, when coach
chat has a message, it should NOT be able to rewrite itself.'

Bug: process_day's chat-immutability merge only fired when the analysis
file existed. If the file was deleted (or corrupted, or first-run after
a wipe), the existing coach responses had nowhere to come from -> they
were lost on re-processing. Fix: read conversations.md as a backstop.
"""
import json
from pathlib import Path
from lib.restore_chat_history import load_coach_responses_for_date


def test_load_returns_responses_for_date(tmp_path):
    md_content = """## Friday, May 4, 2026

**You** (10:00 AM): hey

**Coach** (10:30 AM): That's a real question and worth digging into. Try X first.

**You** (11:00 AM): cool

**Coach** (11:30 AM): Solid. Watch how it lands and we can iterate.
"""
    (tmp_path / "conversations.md").write_text(md_content, encoding="utf-8")
    out = load_coach_responses_for_date(tmp_path, "2026-05-04")
    assert len(out) == 2
    assert out[0]["text"].startswith("That's a real question")
    assert out[1]["text"].startswith("Solid.")
    # Each has the required schema fields
    for r in out:
        assert "id" in r
        assert "timestamp" in r
        assert "respondsTo" in r
        assert "_source" in r


def test_load_returns_empty_for_unknown_date(tmp_path):
    (tmp_path / "conversations.md").write_text("## Friday, May 4, 2026\n\n**Coach** (10:00 AM): hi\n", encoding="utf-8")
    assert load_coach_responses_for_date(tmp_path, "2099-01-01") == []


def test_load_returns_empty_when_no_file(tmp_path):
    assert load_coach_responses_for_date(tmp_path, "2026-05-04") == []


def test_load_handles_iso_date_headers(tmp_path):
    """append_conversations.py writes '## 2026-05-04' style headers; old
    historical content uses '## Friday, May 4, 2026'. Both must work."""
    md = "## 2026-05-04\n\n**Coach** (10:00 AM): from iso header\n"
    (tmp_path / "conversations.md").write_text(md, encoding="utf-8")
    out = load_coach_responses_for_date(tmp_path, "2026-05-04")
    assert len(out) == 1
    assert "from iso header" in out[0]["text"]


def test_load_idempotent_id_for_same_text(tmp_path):
    """Same text on the same date should produce the same id, so dedup works."""
    md = "## 2026-05-04\n\n**Coach** (10:00 AM): exact text\n"
    (tmp_path / "conversations.md").write_text(md, encoding="utf-8")
    a = load_coach_responses_for_date(tmp_path, "2026-05-04")
    b = load_coach_responses_for_date(tmp_path, "2026-05-04")
    assert a[0]["id"] == b[0]["id"]


def test_load_skips_blank_coach_lines(tmp_path):
    md = "## 2026-05-04\n\n**Coach** (10:00 AM): \n**Coach** (10:01 AM): real text\n"
    (tmp_path / "conversations.md").write_text(md, encoding="utf-8")
    out = load_coach_responses_for_date(tmp_path, "2026-05-04")
    assert len(out) == 1
    assert out[0]["text"] == "real text"
