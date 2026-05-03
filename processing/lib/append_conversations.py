"""
append_conversations.py — Append coach message/response pairs to conversations.md.

Appends under a YYYY-MM-DD date header (Pacific time).
Creates the file and/or the date header if missing.
Rotates old weeks to conversations/YYYY-Www.md when the file grows large.

NO LLM calls. Pure Python / stdlib.
"""

from __future__ import annotations
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Pacific Time offset: UTC-8 (standard) / UTC-7 (daylight)
# Use a simple heuristic — datetime.now(timezone.utc) minus 8h (conservative)
_PT_OFFSET = timedelta(hours=8)


def _pt_now() -> datetime:
    """Return current Pacific Time (naive, approximate — assumes UTC-8)."""
    return datetime.now(timezone.utc) - _PT_OFFSET


def _format_timestamp(dt: datetime | None = None) -> str:
    """Format datetime as 'YYYY-MM-DD HH:MM AM/PM' in Pacific Time."""
    if dt is None:
        dt = _pt_now()
    hour = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return f"{dt.year}-{dt.month:02d}-{dt.day:02d} {hour}:{dt.minute:02d} {ampm}"


def append(
    data_dir: Path,
    coach_messages: list[dict],
    coach_responses: list[dict],
) -> None:
    """Append message+response pairs to data_dir/conversations.md.

    Args:
        data_dir:        Path to the user's coach data directory.
        coach_messages:  List of user messages (each has at least 'text' and optionally 'timestamp').
        coach_responses: List of response dicts (each has 'replyTo', 'text', 'timestamp').
    """
    if not coach_messages and not coach_responses:
        return

    conversations_path = data_dir / "conversations.md"
    today_pt = _pt_now()
    date_str = f"{today_pt.year}-{today_pt.month:02d}-{today_pt.day:02d}"
    date_header = f"## {date_str}"

    # Build a response lookup by replyTo text (for pairing)
    response_by_reply_to: dict[str, dict] = {}
    for resp in coach_responses:
        reply_to = resp.get("replyTo", "").strip()
        if reply_to:
            response_by_reply_to[reply_to] = resp

    # Build new lines to append
    new_lines: list[str] = []

    for msg in coach_messages:
        msg_text = (msg.get("text") or "").strip()
        if not msg_text:
            continue

        msg_ts = _format_timestamp(_extract_dt(msg.get("timestamp")))
        new_lines.append(f"**User** ({msg_ts}): {msg_text}")

        response = response_by_reply_to.get(msg_text)
        if response:
            resp_text = (response.get("text") or "").strip()
            resp_ts = _format_timestamp(_extract_dt(response.get("timestamp")))
            new_lines.append(f"**Coach** ({resp_ts}): {resp_text}")

        new_lines.append("")  # blank line separator

    if not new_lines:
        return

    # Read existing content
    existing_content = ""
    if conversations_path.exists():
        existing_content = conversations_path.read_text(encoding="utf-8")

    # Check if date header already exists
    header_pattern = re.compile(rf'^{re.escape(date_header)}\s*$', re.MULTILINE)

    if header_pattern.search(existing_content):
        # Append after the existing date header's content
        # Find the position just before the next ## header or end of file
        parts = header_pattern.split(existing_content, maxsplit=1)
        before_header = parts[0] + date_header + "\n"
        after_header = parts[1] if len(parts) > 1 else ""

        # Find the next section boundary
        next_header_match = re.search(r'\n## ', after_header)
        if next_header_match:
            existing_section = after_header[:next_header_match.start()]
            rest = after_header[next_header_match.start():]
            new_content = (
                before_header
                + existing_section.rstrip()
                + "\n\n"
                + "\n".join(new_lines).rstrip()
                + "\n\n"
                + rest
            )
        else:
            new_content = (
                before_header
                + after_header.rstrip()
                + "\n\n"
                + "\n".join(new_lines).rstrip()
                + "\n"
            )
    else:
        # Prepend a new date header at the top (most recent first)
        new_section = date_header + "\n\n" + "\n".join(new_lines).rstrip() + "\n"
        if existing_content:
            new_content = new_section + "\n" + existing_content
        else:
            new_content = new_section

    conversations_path.write_text(new_content, encoding="utf-8")

    if len(new_content.splitlines()) > 4500:
        rotate_if_needed(data_dir)


def rotate_if_needed(data_dir: Path) -> dict:
    """Rotate old weeks from conversations.md into conversations/YYYY-Www.md.

    Triggers when the file exceeds 5000 lines OR spans more than 2 ISO weeks.
    Keeps the current week and the previous week in conversations.md.
    Writes older content atomically to per-week archive files.

    Returns:
        dict with keys:
          rotated (bool)        — whether any rotation occurred this call
          archived_weeks (list) — week strings archived this call (e.g. ['2026-W15'])
          lines_remaining (int) — line count in conversations.md after rotation
    """
    conversations_path = data_dir / "conversations.md"

    if not conversations_path.exists():
        return {"rotated": False, "archived_weeks": [], "lines_remaining": 0}

    content = conversations_path.read_text(encoding="utf-8")
    if not content.strip():
        return {"rotated": False, "archived_weeks": [], "lines_remaining": 0}

    # Strip and remember any existing archived-weeks marker at the top.
    marker_re = re.compile(r'^<!-- archived:.*?-->\n?', re.MULTILINE)
    marker_match = marker_re.search(content)
    existing_archived: set[str] = set()
    if marker_match:
        existing_archived.update(re.findall(r'\d{4}-W\d{2}', marker_match.group(0)))
    content_clean = marker_re.sub("", content).lstrip("\n")

    # Parse ## YYYY-MM-DD date headers.
    date_header_re = re.compile(r'^## (\d{4}-\d{2}-\d{2})\s*$', re.MULTILINE)
    header_matches = list(date_header_re.finditer(content_clean))

    if not header_matches:
        return {"rotated": False, "archived_weeks": [], "lines_remaining": len(content.splitlines())}

    # Build ordered list of (date_str, week_str, section_text).
    sections: list[tuple[str, str, str]] = []
    for i, match in enumerate(header_matches):
        date_str_raw = match.group(1)
        try:
            d = datetime.strptime(date_str_raw, "%Y-%m-%d").date()
        except ValueError:
            continue
        iso_cal = d.isocalendar()
        week_str = f"{iso_cal[0]}-W{iso_cal[1]:02d}"
        start = match.start()
        end = header_matches[i + 1].start() if i + 1 < len(header_matches) else len(content_clean)
        sections.append((date_str_raw, week_str, content_clean[start:end]))

    all_weeks = {s[1] for s in sections}
    line_count = len(content.splitlines())

    if line_count <= 5000 and len(all_weeks) <= 2:
        return {"rotated": False, "archived_weeks": [], "lines_remaining": line_count}

    # Determine which weeks to keep (current + last) and which to archive.
    today = _pt_now().date()
    cur_iso = today.isocalendar()
    last_iso = (today - timedelta(days=7)).isocalendar()
    current_week = f"{cur_iso[0]}-W{cur_iso[1]:02d}"
    last_week = f"{last_iso[0]}-W{last_iso[1]:02d}"
    weeks_to_keep = {current_week, last_week}
    weeks_to_archive = all_weeks - weeks_to_keep

    if not weeks_to_archive:
        return {"rotated": False, "archived_weeks": [], "lines_remaining": line_count}

    # Group archive sections by week.
    archive_by_week: dict[str, list[str]] = {}
    for _, week_str, section_text in sections:
        if week_str in weeks_to_archive:
            archive_by_week.setdefault(week_str, []).append(section_text)

    conversations_dir = data_dir / "conversations"
    conversations_dir.mkdir(exist_ok=True)
    newly_archived: list[str] = []

    for week_str in sorted(archive_by_week):
        archive_path = conversations_dir / f"{week_str}.md"
        week_content = "".join(archive_by_week[week_str])
        if archive_path.exists():
            existing = archive_path.read_text(encoding="utf-8")
            week_content = existing.rstrip() + "\n\n" + week_content
        tmp_path = archive_path.parent / (archive_path.name + ".tmp")
        tmp_path.write_text(week_content, encoding="utf-8")
        tmp_path.replace(archive_path)
        newly_archived.append(week_str)

    # Rebuild conversations.md with only the kept weeks.
    kept_content = "".join(s[2] for s in sections if s[1] in weeks_to_keep)
    all_archived_sorted = sorted(existing_archived | set(newly_archived))
    marker_line = f"<!-- archived: {', '.join(all_archived_sorted)} -->\n"
    new_content = marker_line + kept_content

    tmp_conv = conversations_path.parent / (conversations_path.name + ".tmp")
    tmp_conv.write_text(new_content, encoding="utf-8")
    tmp_conv.replace(conversations_path)

    return {
        "rotated": True,
        "archived_weeks": newly_archived,
        "lines_remaining": len(new_content.splitlines()),
    }


def _extract_dt(ts: int | float | str | None) -> datetime | None:
    """Convert timestamp (ms epoch int or ISO string) to datetime."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        try:
            return datetime.fromtimestamp(ts / 1000, tz=timezone.utc) - _PT_OFFSET
        except (OSError, OverflowError):
            return None
    if isinstance(ts, str):
        try:
            # Try ISO 8601
            dt = datetime.fromisoformat(ts.rstrip("Z"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc) - _PT_OFFSET
        except ValueError:
            return None
    return None
