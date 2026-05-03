#!/usr/bin/env python3
"""reprocess-backlog.py — Catch up stale dates efficiently.

Two-tier strategy (avoids unnecessary LLM calls):
  Tier 1 (fast, no LLM): If all missing entries are zero-cal types
    (bodyPhoto, weight, bm, supplement), append them directly to
    analysis.entries[] with default fields. No synthesis re-run because
    totals/highlights don't change.
  Tier 2 (full reprocess): Dates with missing meal/food/snack/drink
    entries run process_day.py (Haiku per new entry + Sonnet synthesis).

Idempotent — safe to re-run. Skips dates already clean.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Entry types where LLM analysis adds nothing (zero calories by definition).
# When ONLY these are missing, we append directly without re-running synthesis.
ZERO_CAL_TYPES = {"bodyPhoto", "weight", "bm", "supplement"}

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
    ap.add_argument("--parallel", type=int, default=4,
                    help="Max concurrent dates (default 4). Each date spawns its own claude subprocesses.")
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

    # ── Tier 1: direct merge of zero-cal entries (fast path, no LLM) ──
    extract_daily_dir = extract_daily
    full_reprocess: list[str] = []
    merged_count = 0
    for date, _ in stale:
        log_p = extract_daily_dir / date / "log.json"
        a_p = analysis_dir / f"{date}.json"
        if not (log_p.exists() and a_p.exists()):
            full_reprocess.append(date)
            continue
        log = json.loads(log_p.read_text(encoding="utf-8"))
        a = json.loads(a_p.read_text(encoding="utf-8"))
        a_ids = {e.get("id") for e in (a.get("entries") or []) if e.get("id")}
        missing = [e for e in log.get("entries", []) if e.get("id") not in a_ids]
        if not missing:
            continue
        non_zero = [e for e in missing if e.get("type") not in ZERO_CAL_TYPES]
        if non_zero:
            full_reprocess.append(date)
            continue
        # All missing are zero-cal — direct append
        appended: list[dict] = []
        for e in missing:
            et = e.get("type")
            default_desc = {
                "bodyPhoto": f"Body photo ({e.get('subtype', 'body')})",
                "weight": f"Body weight: {e.get('value') or e.get('notes', '?')}",
                "bm": "Bowel movement",
                "supplement": e.get("notes") or e.get("description") or "Supplement",
            }.get(et, "Entry")
            appended.append({
                **e,
                "description": e.get("description") or default_desc,
                "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0,
                "solubleFiber": 0.0, "insolubleFiber": 0.0,
                "confidence": "high", "breakdown": [],
                "_mergedDirect": True,
            })
        a["entries"] = (a.get("entries") or []) + appended
        a["entries"].sort(key=lambda x: x.get("timestamp", ""))
        a_p.write_text(json.dumps(a, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  [merged] {date}: appended {len(appended)} zero-cal entries ({', '.join(e.get('type') for e in appended)})", flush=True)
        merged_count += len(appended)

    if merged_count:
        print(f"\nTier 1 done: {merged_count} entries appended directly without LLM calls.")

    if not full_reprocess:
        print("\nNo dates need full reprocess. All caught up.")
        return

    print(f"\nTier 2: {len(full_reprocess)} dates need full reprocess (have meal/food entries):")
    for d in full_reprocess:
        print(f"  {d}")
    print()

    repo_root = Path(__file__).resolve().parent.parent
    process_day = repo_root / "processing" / "process_day.py"
    stale = [(d, "") for d in full_reprocess]  # reuse downstream loop

    def _run_one(date: str) -> tuple[str, str, int, str]:
        t0 = time.time()
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
        return (date, status, elapsed, last)

    results = []
    print(f"Running {len(stale)} dates with {args.parallel}-way parallelism...\n", flush=True)
    t_start = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as ex:
        futures = {ex.submit(_run_one, date): date for date, _ in stale}
        completed = 0
        for fut in as_completed(futures):
            completed += 1
            date, status, elapsed, last = fut.result()
            results.append((date, status, elapsed))
            print(f"[{completed}/{len(stale)}] {date}: {status} in {elapsed}s  {last}", flush=True)
    total = int(time.time() - t_start)
    print(f"\nWall time: {total}s ({total//60}m {total%60}s)")

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
