"""Tests for append_conversations.py"""
import pytest
from pathlib import Path
from datetime import timedelta
from lib.append_conversations import append, rotate_if_needed, _pt_now


def _msg(text, ts=None):
    m = {"text": text}
    if ts:
        m["timestamp"] = ts
    return m


def _resp(reply_to, text, ts=None):
    r = {"replyTo": reply_to, "text": text}
    if ts:
        r["timestamp"] = ts
    return r


def test_creates_file_if_missing(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [_msg("How am I doing?")], [_resp("How am I doing?", "Looking good today.")])
    assert (data_dir / "conversations.md").exists()


def test_writes_user_and_coach(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [_msg("test msg")], [_resp("test msg", "coach reply")])
    content = (data_dir / "conversations.md").read_text(encoding="utf-8")
    assert "test msg" in content
    assert "coach reply" in content


def test_user_coach_labels(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [_msg("question")], [_resp("question", "answer")])
    content = (data_dir / "conversations.md").read_text(encoding="utf-8")
    assert "**User**" in content
    assert "**Coach**" in content


def test_date_header_created(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [_msg("hi")], [])
    content = (data_dir / "conversations.md").read_text(encoding="utf-8")
    assert "## 20" in content  # date header starts with year


def test_append_to_existing_date_section(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    conv = data_dir / "conversations.md"
    # Pre-populate with today's header
    from lib.append_conversations import _pt_now
    today = _pt_now()
    date_str = f"{today.year}-{today.month:02d}-{today.day:02d}"
    conv.write_text(f"## {date_str}\n\n**User** (12:00 PM): old message\n\n")
    append(data_dir, [_msg("new message")], [_resp("new message", "new reply")])
    content = conv.read_text(encoding="utf-8")
    assert "old message" in content
    assert "new message" in content
    assert content.count(f"## {date_str}") == 1  # only one header


def test_empty_inputs_no_write(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [], [])
    assert not (data_dir / "conversations.md").exists()


def test_message_without_response(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [_msg("unresponded message")], [])
    content = (data_dir / "conversations.md").read_text(encoding="utf-8")
    assert "unresponded message" in content


def test_new_date_prepended(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    conv = data_dir / "conversations.md"
    conv.write_text("## 2026-01-01\n\nOld content\n")
    append(data_dir, [_msg("today")], [_resp("today", "response")])
    content = conv.read_text(encoding="utf-8")
    assert "Old content" in content
    assert "today" in content


def test_pacific_time_format(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    append(data_dir, [_msg("time test")], [])
    content = (data_dir / "conversations.md").read_text(encoding="utf-8")
    # Should contain AM or PM
    assert "AM" in content or "PM" in content


# ---------------------------------------------------------------------------
# Helpers for rotate_if_needed tests
# ---------------------------------------------------------------------------

def _date_str(offset_days: int = 0) -> str:
    """Return YYYY-MM-DD for today + offset_days (Pacific time)."""
    d = (_pt_now() + timedelta(days=offset_days)).date()
    return d.strftime("%Y-%m-%d")


def _iso_week(offset_days: int = 0) -> str:
    """Return YYYY-Www for today + offset_days."""
    d = (_pt_now() + timedelta(days=offset_days)).date()
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _section(offset_days: int, message: str) -> str:
    return f"## {_date_str(offset_days)}\n\n**User** (10:00 AM): {message}\n\n"


# ---------------------------------------------------------------------------
# rotate_if_needed tests
# ---------------------------------------------------------------------------

def test_rotate_empty_file(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "conversations.md").write_text("", encoding="utf-8")
    result = rotate_if_needed(data_dir)
    assert result["rotated"] is False
    assert result["archived_weeks"] == []
    assert result["lines_remaining"] == 0


def test_rotate_no_rotation_needed_one_week(tmp_path):
    """Under 5000 lines and a single ISO week → no rotation."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    content = _section(0, "hello") + _section(-1, "yesterday")
    (data_dir / "conversations.md").write_text(content, encoding="utf-8")
    result = rotate_if_needed(data_dir)
    assert result["rotated"] is False
    assert result["lines_remaining"] > 0


def test_rotate_three_weeks_archives_oldest(tmp_path):
    """File spanning 3 ISO weeks: oldest week is archived, current and last week stay."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    content = (
        _section(0, "current week msg")
        + _section(-7, "last week msg")
        + _section(-21, "old message")
    )
    (data_dir / "conversations.md").write_text(content, encoding="utf-8")

    result = rotate_if_needed(data_dir)

    assert result["rotated"] is True
    assert len(result["archived_weeks"]) >= 1

    remaining = (data_dir / "conversations.md").read_text(encoding="utf-8")
    assert "current week msg" in remaining
    assert "last week msg" in remaining
    assert "old message" not in remaining


def test_rotate_archive_file_location_and_content(tmp_path):
    """Archived week lands in conversations/YYYY-Www.md with correct content."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    old_week = _iso_week(-21)
    # Three distinct weeks guarantees the "> 2 weeks" rotation condition fires.
    content = _section(0, "current") + _section(-7, "last week") + _section(-21, "archived content")
    (data_dir / "conversations.md").write_text(content, encoding="utf-8")

    rotate_if_needed(data_dir)

    archive_file = data_dir / "conversations" / f"{old_week}.md"
    assert archive_file.exists(), f"Expected archive at {archive_file}"
    archive_content = archive_file.read_text(encoding="utf-8")
    assert "archived content" in archive_content
    assert "current" not in archive_content


def test_rotate_marker_line_added(tmp_path):
    """After rotation, conversations.md starts with an archived-weeks marker."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    content = _section(0, "now") + _section(-7, "last week") + _section(-21, "old")
    (data_dir / "conversations.md").write_text(content, encoding="utf-8")

    rotate_if_needed(data_dir)

    remaining = (data_dir / "conversations.md").read_text(encoding="utf-8")
    assert remaining.startswith("<!-- archived:")
    first_line = remaining.splitlines()[0]
    assert "W" in first_line           # contains a week string like 2026-W15
    assert "-->" in first_line


def test_rotate_idempotent(tmp_path):
    """Calling rotate_if_needed twice does nothing on the second call."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    content = _section(0, "current") + _section(-7, "last week") + _section(-21, "old")
    (data_dir / "conversations.md").write_text(content, encoding="utf-8")

    result1 = rotate_if_needed(data_dir)
    assert result1["rotated"] is True

    result2 = rotate_if_needed(data_dir)
    assert result2["rotated"] is False
    assert result2["archived_weeks"] == []
