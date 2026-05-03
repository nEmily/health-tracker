"""
reconcile_entries.py — Determine which log entries need LLM re-analysis vs. kept as-is.

Matching is by entry `id` field.

Rules:
  - Entry in log but not in existing → new_to_analyze
  - Entry in existing but not in log → dropped (deleted by user)
  - Entry in both, no _reanalyzeRequested flag → kept_verbatim
  - Entry in both, _reanalyzeRequested=True, no _reanalyzedAt OR
    _reanalyzedAt older than updatedAt → new_to_analyze (re-do)
  - Entry in both, _reanalyzeRequested=True, _reanalyzedAt newer than updatedAt → kept_verbatim

NO LLM calls. Pure Python.
"""

from __future__ import annotations
from typing import Any


def reconcile(
    log_entries: list[dict[str, Any]],
    existing_entries: list[dict[str, Any]],
) -> tuple[list[dict], list[dict]]:
    """Split log entries into (new_to_analyze, kept_verbatim).

    Args:
        log_entries:     Entries from today's log.json (source of truth for what exists).
        existing_entries: Entries from the most recent analysis JSON for this date.

    Returns:
        (new_to_analyze, kept_verbatim)
    """
    existing_by_id: dict[str, dict] = {
        e["id"]: e for e in existing_entries if "id" in e
    }

    # Deduplicate log_entries by id (keep last occurrence)
    seen_ids: dict[str, int] = {}
    for i, entry in enumerate(log_entries):
        eid = entry.get("id")
        if eid is not None:
            if eid in seen_ids:
                print(f"[reconcile] WARNING: duplicate entry id {eid!r} in log — keeping last occurrence", flush=True)
            seen_ids[eid] = i
    deduped_log: list[dict] = []
    _used_indices: set[int] = set(seen_ids.values())
    for i, entry in enumerate(log_entries):
        eid = entry.get("id")
        if eid is None or i == seen_ids.get(eid):
            deduped_log.append(entry)

    new_to_analyze: list[dict] = []
    kept_verbatim: list[dict] = []

    for entry in deduped_log:
        entry_id = entry.get("id")
        if entry_id is None:
            # No id — treat as new
            new_to_analyze.append(entry)
            continue

        existing = existing_by_id.get(entry_id)

        if existing is None:
            # Brand-new entry not in existing analysis
            new_to_analyze.append(entry)
            continue

        # Entry exists — check reanalysis flag
        if entry.get("_reanalyzeRequested") or existing.get("_reanalyzeRequested"):
            updated_at = _ts(entry.get("updatedAt") or entry.get("createdAt"))
            reanalyzed_at = _ts(existing.get("_reanalyzedAt"))

            if reanalyzed_at is not None and reanalyzed_at > updated_at:
                # Already re-analyzed after the last edit — keep it
                kept_verbatim.append(existing)
            else:
                # Needs re-analysis: merge log entry fields over existing
                merged = {**existing, **entry}
                new_to_analyze.append(merged)
        else:
            # No flag — keep existing analysis verbatim
            kept_verbatim.append(existing)

    return new_to_analyze, kept_verbatim


def _ts(value: Any) -> float | None:
    """Coerce a timestamp (int ms, float, or ISO string) to a comparable float.

    Returns None if value is missing or unparseable.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        # ISO 8601 strings are lexicographically sortable — use as-is for comparison
        return _iso_to_ms(value)
    return None


def _iso_to_ms(s: str) -> float | None:
    """Parse ISO 8601 datetime string to milliseconds epoch (approximate)."""
    import re
    # Accept: YYYY-MM-DDTHH:MM:SS.sssZ  or  YYYY-MM-DDTHH:MM:SSZ
    m = re.match(
        r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?', s
    )
    if not m:
        return None
    from datetime import datetime, timezone
    try:
        dt = datetime(
            int(m.group(1)), int(m.group(2)), int(m.group(3)),
            int(m.group(4)), int(m.group(5)), int(m.group(6)),
            tzinfo=timezone.utc,
        )
        return dt.timestamp() * 1000
    except ValueError:
        return None
