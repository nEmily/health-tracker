"""One-shot: correct psyllium husk fiber across historical analyses.

Bug: dailyStaples.fiber (Psyllium husk) was defined without a fiber field, so
every psyllium dose recorded 0g fiber instead of 5g. Across the user's
history this under-counts daily fiber by 5-15g (multiple doses per day).

This script:
  - Walks coach/analysis/*.json
  - For each entry whose description contains 'psyllium' AND fiber=0:
    sets fiber=5, solubleFiber=3.5, insolubleFiber=1.5, carbs=4 (if missing)
  - Recomputes totals from the corrected entry set
  - Writes back atomically

Pure data correction, no LLM calls, no coach response changes.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path


PSYLLIUM_FIBER = 5.0
PSYLLIUM_SOL = 3.5
PSYLLIUM_INSOL = 1.5
PSYLLIUM_CARBS = 4
PSYLLIUM_CAL = 30


def main():
    data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "coach")
    analysis_dir = data_dir / "analysis"
    if not analysis_dir.exists():
        print(f"No analysis dir at {analysis_dir}")
        return 1

    files = sorted(f for f in analysis_dir.glob("*.json"))
    total_corrected = 0
    days_changed = 0

    for f in files:
        try:
            a = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue

        entries = a.get("entries") or []
        changed = False
        for e in entries:
            desc = (e.get("description") or e.get("notes") or "").lower()
            if "psyllium" not in desc:
                continue
            # Only correct entries where fiber was clearly missing.
            # If a higher fiber value was set, leave it alone.
            cur_fib = e.get("fiber", 0) or 0
            if cur_fib >= PSYLLIUM_FIBER - 0.5:
                continue
            e["fiber"] = PSYLLIUM_FIBER
            e["solubleFiber"] = PSYLLIUM_SOL
            e["insolubleFiber"] = PSYLLIUM_INSOL
            # Top up carbs only if missing (don't clobber existing).
            if (e.get("carbs", 0) or 0) < PSYLLIUM_CARBS:
                e["carbs"] = PSYLLIUM_CARBS
            # Cal is usually already 30 from the staple match
            if (e.get("calories", 0) or 0) < PSYLLIUM_CAL - 5:
                e["calories"] = PSYLLIUM_CAL
            total_corrected += 1
            changed = True

        if not changed:
            continue

        # Recompute totals from the corrected entries (skip duplicates)
        totals = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0,
                  "solubleFiber": 0.0, "insolubleFiber": 0.0}
        for e in entries:
            if e.get("_duplicateOf"):
                continue
            for k in totals:
                v = e.get(k, 0)
                if isinstance(v, (int, float)):
                    totals[k] += v
        a["totals"] = totals

        # Atomic write
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(a, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, f)
        # Bust .uploaded marker so the relay re-syncs
        u = f.with_suffix(".json.uploaded")
        if u.exists():
            u.unlink()
        days_changed += 1
        print(f"  {f.stem}: corrected {sum(1 for e in entries if 'psyllium' in (e.get('description') or e.get('notes') or '').lower() and e.get('fiber') == PSYLLIUM_FIBER)} psyllium entries; new fiber={totals['fiber']}")

    print(f"\nDone. {total_corrected} psyllium entries corrected across {days_changed} days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
