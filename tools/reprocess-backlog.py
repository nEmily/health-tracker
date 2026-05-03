#!/usr/bin/env python3
"""reprocess-backlog.py — Reprocess all stale dates serially.

Uses tools/check-backlog.py logic to find stale dates, then runs
processing/process_day.py on each one in date order.

Usage:
  python tools/reprocess-backlog.py [--data-dir <path>] [--extract-dir <path>]
                                    [--dry-run]

Idempotent — safe to re-run. Skips dates that are already clean.
"""
from __future__ import annotations
import argparse
import subprocess
import sys
import time
from pathlib import Path

# Local import so we share the staleness logic
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from importlib import import_module
check_backlog = import_module("check-backlog")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="coach")
    ap.add_argument("--extract-dir", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    if args.extract_dir:
        extract_dir = Path(args.extract_dir)
        extract_daily = extract_dir / "daily"
    else:
        extract_dir = data_dir / "incoming" / "extracted"
        extract_daily = extract_dir / "daily"

    analysis_dir = data_dir / "analysis"
    stale = check_backlog.find_stale(extract_daily, analysis_dir)
    if not stale:
        print("All dates clean. Nothing to do.")
        return

    print(f"{len(stale)} stale dates to reprocess:")
    for d, reason in stale:
        print(f"  {d}: {reason}")
    print()

    if args.dry_run:
        print("--dry-run: not running.")
        return

    repo_root = Path(__file__).resolve().parent.parent
    process_day = repo_root / "processing" / "process_day.py"

    results = []
    for i, (date, _) in enumerate(stale, 1):
        t0 = time.time()
        print(f"[{i}/{len(stale)}] processing {date}...", flush=True)
        r = subprocess.run(
            ["python", str(process_day), "--date", date,
             "--data-dir", str(data_dir), "--extract-dir", str(extract_dir)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=600,
        )
        elapsed = int(time.time() - t0)
        ok = r.returncode == 0 and (analysis_dir / f"{date}.json").exists()
        status = "OK" if ok else "FAIL"
        last = (r.stdout.strip().splitlines() or [""])[-1][-200:]
        results.append((date, status, elapsed))
        print(f"  -> {status} in {elapsed}s  {last}", flush=True)

    ok_count = sum(1 for _, s, _ in results if s == "OK")
    print()
    print(f"{ok_count}/{len(results)} succeeded")

    remaining = check_backlog.find_stale(extract_daily, analysis_dir)
    if remaining:
        print(f"\nStill stale after run: {len(remaining)}")
        for d, reason in remaining:
            print(f"  {d}: {reason}")
        sys.exit(1)
    else:
        print("\nAll dates clean.")


if __name__ == "__main__":
    main()
