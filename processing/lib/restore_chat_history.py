"""
restore_chat_history.py — Restore coach responses from conversations.md into analysis JSON files.

Reads conversations.md, parses Coach responses by date, and appends any missing
entries to the corresponding analysis/{date}.json files. Idempotent.

NO LLM calls. Pure Python / stdlib.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
from datetime import date as date_cls, datetime, timedelta
from pathlib import Path

# Pacific Time: UTC-7 (PDT throughout — slight inaccuracy acceptable, idempotency matters more)
_PDT_OFFSET = timedelta(hours=7)

_MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

# Header: "## Friday, May 1, 2026"
_HEADER_LONG_RE = re.compile(
    r'^##\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})\s*$', re.IGNORECASE
)
# Header: "## 2026-05-01" (written by append_conversations.py)
_HEADER_ISO_RE = re.compile(r'^##\s+(\d{4}-\d{2}-\d{2})\s*$')

# Coach line: "**Coach** (HH:MM AM/PM):" or "**Coach** (YYYY-MM-DD HH:MM AM/PM):"
_COACH_RE = re.compile(
    r'^\*\*Coach\*\*\s+\((?:\d{4}-\d{2}-\d{2}\s+)?(\d{1,2}:\d{2}\s+(?:AM|PM))\):\s*(.*)',
    re.IGNORECASE,
)


def _parse_date_header(line: str) -> str | None:
    """Parse a date header line to ISO YYYY-MM-DD. Returns None if not a date header."""
    m = _HEADER_ISO_RE.match(line)
    if m:
        return m.group(1)
    m = _HEADER_LONG_RE.match(line)
    if m:
        month_name = m.group(1).lower()
        day = int(m.group(2))
        year = int(m.group(3))
        month = _MONTH_NAMES.get(month_name)
        if month:
            return f"{year}-{month:02d}-{day:02d}"
    return None


def _time_to_epoch_ms(date_iso: str, time_str: str) -> int:
    """Convert ISO date and 'H:MM AM/PM' to epoch milliseconds (Pacific UTC-7)."""
    time_str = time_str.strip().upper()
    m = re.match(r'(\d{1,2}):(\d{2})\s+(AM|PM)', time_str)
    if m:
        hour, minute, ampm = int(m.group(1)), int(m.group(2)), m.group(3)
        if ampm == "PM" and hour != 12:
            hour += 12
        elif ampm == "AM" and hour == 12:
            hour = 0
    else:
        hour, minute = 0, 0

    y, mo, d = (int(x) for x in date_iso.split("-"))
    dt_naive = datetime(y, mo, d, hour, minute, 0)
    # Shift to UTC by adding PDT offset (UTC-7 → UTC = +7h)
    dt_utc = dt_naive + _PDT_OFFSET
    epoch_s = (dt_utc - datetime(1970, 1, 1)).total_seconds()
    return int(epoch_s * 1000)


def _make_restore_id(epoch_ms: int, text: str) -> str:
    h = hashlib.sha256(text.encode()).hexdigest()[:8]
    return f"restored_{epoch_ms}_{h}"


def _response_already_present(existing_responses: list[dict], text: str) -> bool:
    """Return True if a response with a matching 50-char prefix already exists."""
    prefix = text[:50]
    for resp in existing_responses:
        existing_text = resp.get("text", "")
        if len(text) >= 50:
            if existing_text[:50] == prefix:
                return True
        else:
            if existing_text == text:
                return True
    return False


def _parse_conversations_md(content: str) -> dict[str, list[dict]]:
    """Parse conversations.md into {date_iso: [{time_str, text}]} for Coach entries."""
    result: dict[str, list[dict]] = {}
    current_date: str | None = None

    for line in content.splitlines():
        date = _parse_date_header(line)
        if date is not None:
            current_date = date
            continue

        if current_date is None:
            continue

        m = _COACH_RE.match(line)
        if m:
            time_str = m.group(1).strip()
            text = m.group(2).strip()
            if text:
                result.setdefault(current_date, []).append({
                    "time_str": time_str,
                    "text": text,
                })

    return result


def _atomic_write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def restore_from_conversations_md(data_dir: Path) -> dict:
    """Restore missing coach responses from conversations.md into analysis JSON files.

    Args:
        data_dir: Path to the user's coach data directory.

    Returns:
        dict with keys: dates_processed, restored_count, skipped_existing, errors
    """
    today_iso = date_cls.today().isoformat()
    source_tag = f"conversations-md-restore-{today_iso}"

    conversations_path = data_dir / "conversations.md"
    if not conversations_path.exists():
        return {"dates_processed": 0, "restored_count": 0, "skipped_existing": 0, "errors": []}

    try:
        content = conversations_path.read_text(encoding="utf-8")
    except OSError as e:
        return {"dates_processed": 0, "restored_count": 0, "skipped_existing": 0, "errors": [str(e)]}

    try:
        by_date = _parse_conversations_md(content)
    except Exception as e:
        return {"dates_processed": 0, "restored_count": 0, "skipped_existing": 0, "errors": [f"Parse error: {e}"]}

    dates_processed = 0
    restored_count = 0
    skipped_existing = 0
    errors: list[str] = []

    for date_iso, coach_entries in by_date.items():
        if not coach_entries:
            continue

        analysis_path = data_dir / "analysis" / f"{date_iso}.json"
        if not analysis_path.exists():
            errors.append(f"Missing analysis file for {date_iso}")
            continue

        try:
            with open(analysis_path, encoding="utf-8") as f:
                analysis = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            errors.append(f"Failed to read {date_iso}.json: {e}")
            continue

        existing_responses: list[dict] = analysis.get("coachResponses", [])
        added_any = False

        for entry in coach_entries:
            text = entry["text"]
            time_str = entry["time_str"]

            if _response_already_present(existing_responses, text):
                skipped_existing += 1
                continue

            epoch_ms = _time_to_epoch_ms(date_iso, time_str)
            new_entry: dict = {
                "id": _make_restore_id(epoch_ms, text),
                "timestamp": epoch_ms,
                "respondsTo": [],
                "text": text,
                "_source": source_tag,
            }
            existing_responses.append(new_entry)
            restored_count += 1
            added_any = True

        if added_any:
            # Coerce timestamps to int for sort — historical entries may have
            # ISO strings, epoch ints, or missing timestamps. Bad/missing values
            # sort to the front (0).
            def _sort_key(r):
                t = r.get("timestamp", 0)
                if isinstance(t, int):
                    return t
                if isinstance(t, str):
                    # ISO 8601 string -> parse to epoch_ms; on failure, fall back to 0
                    try:
                        from datetime import datetime as _dt
                        dt = _dt.fromisoformat(t.replace("Z", "+00:00"))
                        return int(dt.timestamp() * 1000)
                    except Exception:
                        return 0
                return 0
            existing_responses.sort(key=_sort_key)
            analysis["coachResponses"] = existing_responses
            _atomic_write(analysis_path, analysis)

        dates_processed += 1

    return {
        "dates_processed": dates_processed,
        "restored_count": restored_count,
        "skipped_existing": skipped_existing,
        "errors": errors,
    }
