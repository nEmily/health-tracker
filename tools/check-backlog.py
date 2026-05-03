#!/usr/bin/env python3
"""check-backlog.py — Report which dates have unprocessed/stale analysis.

A date is "stale" if:
  1. Extract dir has log.json but no analysis exists, OR
  2. log.json contains entry IDs not present in analysis.entries, OR
  3. Analysis file has no synthesis content (highlights, concerns, coachResponses), OR
  4. Analysis mtime is older than log mtime (log was updated after analysis ran)

Usage:
  python tools/check-backlog.py [--data-dir <path>] [--extract-dir <path>]
                                [--quiet] [--exit-nonzero-if-stale]

Exit code 0 if no stale dates (unless --exit-nonzero-if-stale is set, then
exits with the count of stale dates).
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path


def find_stale(extract_dir: Path, analysis_dir: Path) -> list[tuple[str, str]]:
    """Return list of (date, reason) for each stale date."""
    stale: list[tuple[str, str]] = []
    if not extract_dir.exists():
        return stale

    for date_dir in sorted(extract_dir.iterdir()):
        if not date_dir.is_dir():
            continue
        date = date_dir.name
        log_path = date_dir / "log.json"
        if not log_path.exists():
            continue

        try:
            log = json.loads(log_path.read_text(encoding="utf-8"))
        except Exception as e:
            stale.append((date, f"log unreadable: {e}"))
            continue
        log_entries = log.get("entries", []) or []
        log_ids = {e.get("id") for e in log_entries if e.get("id")}

        analysis_path = analysis_dir / f"{date}.json"
        if not analysis_path.exists():
            stale.append((date, f"no analysis (log has {len(log_entries)} entries)"))
            continue

        try:
            a = json.loads(analysis_path.read_text(encoding="utf-8"))
        except Exception as e:
            stale.append((date, f"analysis unreadable: {e}"))
            continue

        a_ids = {e.get("id") for e in (a.get("entries") or []) if e.get("id")}
        missing = log_ids - a_ids
        if missing:
            stale.append((date, f"log has {len(log_ids)} entries, analysis has {len(a_ids)} ({len(missing)} missing)"))
            continue

        has_synth = bool(a.get("highlights") or a.get("concerns") or a.get("coachResponses"))
        if not has_synth:
            stale.append((date, "no synthesis content"))
            continue

        if analysis_path.stat().st_mtime < log_path.stat().st_mtime:
            stale.append((date, "analysis older than log"))

    return stale


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="coach", help="Path to data dir (contains analysis/)")
    ap.add_argument("--extract-dir", default=None,
                    help="Path to extract dir with daily/<date>/log.json (default: <data-dir>/incoming/extracted)")
    ap.add_argument("--quiet", action="store_true", help="Print only count, not per-date breakdown")
    ap.add_argument("--exit-nonzero-if-stale", action="store_true",
                    help="Exit with stale count as exit code (useful for cron warning)")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    analysis_dir = data_dir / "analysis"
    if args.extract_dir:
        extract_dir = Path(args.extract_dir) / "daily"
    else:
        extract_dir = data_dir / "incoming" / "extracted" / "daily"

    if not analysis_dir.exists():
        print(f"ERROR: analysis dir not found: {analysis_dir}", file=sys.stderr)
        sys.exit(2)

    stale = find_stale(extract_dir, analysis_dir)

    if args.quiet:
        print(len(stale))
    elif not stale:
        print("All dates clean.")
    else:
        print(f"{len(stale)} stale dates:")
        for d, reason in stale:
            print(f"  {d}: {reason}")

    if args.exit_nonzero_if_stale and stale:
        # Cap at 125 (max valid Unix exit code)
        sys.exit(min(len(stale), 125))


if __name__ == "__main__":
    main()
