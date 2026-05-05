"""Backfill conversations.md from analysis JSON files.

Bug: append_conversations.py was looking up responses by msg text, but
responses are keyed by msg id. Since the respondsTo schema migration,
no coach responses have been appended to conversations.md.

This script walks coach/analysis/*.json, reads each day's coachResponses
+ associated user messages from log.json, and pairs them into the
append_conversations format. Idempotent — checks existing content
before adding.

Usage: python tools/backfill-conversations-md.py [--data-dir coach] [--dry-run]
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "processing"))

from lib.append_conversations import _format_timestamp, _extract_dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="coach")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    analysis_dir = data_dir / "analysis"
    extracted_dir = data_dir / "incoming" / "extracted" / "daily"
    archive_dir = data_dir / "archive"
    conversations_path = data_dir / "conversations.md"

    # Load existing content to dedupe
    existing = ""
    if conversations_path.exists():
        existing = conversations_path.read_text(encoding="utf-8")

    # Walk analysis files in date order
    files = sorted([f for f in analysis_dir.glob("*.json") if re.match(r"\d{4}-\d{2}-\d{2}\.json$", f.name)])
    print(f"Scanning {len(files)} analysis files...")

    by_date: dict[str, list[str]] = {}
    total_added = 0

    for f in files:
        date_iso = f.stem
        try:
            analysis = json.loads(f.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"  skip {date_iso}: {exc}")
            continue

        coach_responses = analysis.get("coachResponses") or []
        if not coach_responses:
            continue

        # Try to find user messages from log.json (extracted or archive)
        log_data = _read_log(date_iso, extracted_dir, archive_dir)
        coach_chat = (log_data.get("coachChat") if log_data else None) or []

        msgs_by_id = {(m.get("id") or ""): m for m in coach_chat if isinstance(m, dict)}

        # Build paired output for this date
        date_lines: list[str] = []
        used_response_ids = set()

        # Pair each user msg with its responses, in chat order
        chat_sorted = sorted(
            [m for m in coach_chat if isinstance(m, dict)],
            key=lambda m: m.get("timestamp") or 0,
        )
        # Build response lookup by msg id
        responses_by_msg_id: dict[str, list[dict]] = {}
        for r in coach_responses:
            target_ids = r.get("respondsTo") or ([r["replyTo"]] if r.get("replyTo") else [])
            for mid in target_ids:
                responses_by_msg_id.setdefault(str(mid), []).append(r)

        for m in chat_sorted:
            mid = m.get("id") or ""
            text = (m.get("text") or "").strip()
            if not text:
                continue
            ts = _format_timestamp(_extract_dt(m.get("timestamp")))
            line = f"**User** ({ts}): {text}"
            if line in existing:
                continue
            date_lines.append(line)
            for r in responses_by_msg_id.get(mid, []):
                rid = r.get("id") or id(r)
                if rid in used_response_ids:
                    continue
                used_response_ids.add(rid)
                rtext = (r.get("text") or "").strip()
                if not rtext:
                    continue
                rts = _format_timestamp(_extract_dt(r.get("timestamp")))
                rline = f"**Coach** ({rts}): {rtext}"
                date_lines.append(rline)
            date_lines.append("")

        # Unsolicited responses (no target message id)
        for r in coach_responses:
            rid = r.get("id") or id(r)
            if rid in used_response_ids:
                continue
            target_ids = r.get("respondsTo") or ([r["replyTo"]] if r.get("replyTo") else [])
            if target_ids:
                continue  # had targets but they weren't in chat — skip
            rtext = (r.get("text") or "").strip()
            if not rtext:
                continue
            rts = _format_timestamp(_extract_dt(r.get("timestamp")))
            rline = f"**Coach** ({rts}): {rtext}"
            if rline in existing:
                continue
            date_lines.append(rline)
            date_lines.append("")
            used_response_ids.add(rid)

        if date_lines:
            by_date[date_iso] = date_lines
            total_added += sum(1 for line in date_lines if line.startswith("**Coach**"))

    if not by_date:
        print("Nothing to backfill — conversations.md already covers all analysis files.")
        return

    print(f"\nWill add ~{total_added} coach responses across {len(by_date)} dates:")
    for d, lines in sorted(by_date.items()):
        coach_count = sum(1 for line in lines if line.startswith("**Coach**"))
        print(f"  {d}: +{coach_count} responses")

    if args.dry_run:
        print("\n--dry-run: not writing.")
        return

    # Append at the end of conversations.md, with date headers as needed
    new_sections: list[str] = []
    for d, lines in sorted(by_date.items()):
        # Try to match the "## Friday, May 4, 2026" style of older entries
        try:
            dt = datetime.strptime(d, "%Y-%m-%d")
            header = f"## {dt.strftime('%A, %B %-d, %Y')}" if hasattr(dt, "strftime") else f"## {d}"
        except Exception:
            header = f"## {d}"
        # Windows strftime doesn't have %-d; fall back if it failed
        if "%-d" in header:
            header = f"## {d}"
        # Skip header if already present
        header_re = re.compile(rf"^##\s+(?:\w+,\s+\w+\s+\d+,\s+\d+|{re.escape(d)})\s*$", re.MULTILINE)
        if not header_re.search(existing):
            new_sections.append(f"\n{header}\n")
        new_sections.append("\n".join(lines).rstrip() + "\n")

    new_block = "\n".join(new_sections).rstrip() + "\n"
    if existing and not existing.endswith("\n"):
        existing += "\n"
    final = existing + ("\n" if existing else "") + new_block
    conversations_path.write_text(final, encoding="utf-8")
    print(f"\nWrote {len(new_block)} bytes to {conversations_path}")


def _read_log(date_iso: str, extracted: Path, archive: Path) -> dict | None:
    """Best-effort read of the day's log.json from extracted or archive ZIP."""
    p = extracted / date_iso / "log.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    # Try archive ZIP
    import zipfile
    z_candidates = list(archive.glob(f"health-{date_iso}.zip")) if archive.exists() else []
    for z_path in z_candidates:
        try:
            with zipfile.ZipFile(z_path) as z:
                inner = f"daily/{date_iso}/log.json"
                if inner in z.namelist():
                    return json.loads(z.read(inner).decode("utf-8"))
        except Exception:
            continue
    return None


if __name__ == "__main__":
    main()
