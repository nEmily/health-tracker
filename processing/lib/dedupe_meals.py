"""dedupe_meals.py — Detect when one meal was logged as multiple entries.

Common pattern: user takes photo of a dish, then 30-90 sec later takes a
photo of the nutrition label as a SECOND entry. Cron now counts both.

This module scans analyzed entries for likely-duplicate pairs and marks
the lower-quality one with _duplicateOf=<other_id>, zeroes its macros.
Detection is deterministic; no LLM call.

Heuristics (must be tight to avoid false positives):
  1. Both entries are food-bearing (meal/snack/drink)
  2. Same date
  3. Timestamps within DEDUPE_WINDOW_SEC (default 5 min)
  4. At least ONE of these signals:
     a. The later entry's notes reference the earlier one
        ("earlier", "from before", "the label", "from the photo", etc.)
     b. Both have photos AND the descriptions overlap heavily
        (Jaccard >= 0.4 on tokens after stopword removal)
     c. One is a known-product/label match and the other is the SAME
        product analyzed differently

When a duplicate is detected, the entry that came LATER in time is the
one zeroed (preserves the original entry; the second is the redundant
follow-up). The kept entry's description picks up "(label confirmed)" or
similar if the duplicate was a label match.

NOTE: this is conservative. When in doubt, leaves both entries alone
(better to have an inflated total than to silently drop user data).
"""
from __future__ import annotations
import re
from typing import Iterable

DEDUPE_WINDOW_SEC = 300  # 5 minutes
FOOD_TYPES = {"meal", "snack", "drink"}

# Phrases in notes that strongly suggest "this is the SAME meal as a prior entry"
_BACKREFERENCE_PATTERNS = [
    re.compile(r"\b(from\s+(?:the\s+)?(?:nutrition\s+)?label(?:\s+(?:earlier|above|before))?)\b", re.I),
    re.compile(r"\b(from\s+(?:earlier|before|the\s+previous|the\s+last))\b", re.I),
    re.compile(r"\b(this\s+is\s+the)\b", re.I),
    re.compile(r"\b(same\s+(?:as|meal\s+as)\s+(?:earlier|above|before|the\s+previous))\b", re.I),
    re.compile(r"\bdupe\b|\bduplicate\b", re.I),
]

_STOPWORDS = frozenset({
    "a", "an", "the", "with", "and", "or", "of", "in", "on", "at",
    "for", "to", "from", "by", "as", "is", "was", "be", "this", "that",
    "1", "2", "3", "one", "two", "three", "serving", "servings", "piece",
    "small", "medium", "large", "some", "few", "lots",
})


def _ts_seconds(value) -> float | None:
    """Parse various timestamp shapes to seconds-since-epoch."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Heuristic: assume milliseconds if very large
        return value / 1000.0 if value > 1e11 else float(value)
    if isinstance(value, str):
        # Try ISO 8601
        try:
            from datetime import datetime
            # fromisoformat doesn't handle 'Z' before 3.11; strip it
            s = value.rstrip("Z").replace("Z", "")
            return datetime.fromisoformat(s).timestamp()
        except Exception:
            return None
    return None


def _tokens(text: str) -> set[str]:
    """Lowercase + drop stopwords + drop pure-numeric for Jaccard comparison."""
    if not text:
        return set()
    raw = re.findall(r"[a-z]+", text.lower())
    return {t for t in raw if t not in _STOPWORDS and len(t) >= 3}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a | b), 1)


def _has_backref(text: str) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in _BACKREFERENCE_PATTERNS)


def _is_food(entry: dict) -> bool:
    return entry.get("type") in FOOD_TYPES


def find_duplicate_pairs(entries: list[dict]) -> list[tuple[int, int, str]]:
    """Return list of (kept_idx, duplicate_idx, reason) tuples.

    The 'duplicate_idx' is the entry that should be marked as redundant
    (zero macros). Conservative — when uncertain, returns no pair.
    """
    food_entries = [(i, e) for i, e in enumerate(entries) if _is_food(e)]
    food_entries.sort(key=lambda x: _ts_seconds(x[1].get("timestamp")) or 0)

    pairs: list[tuple[int, int, str]] = []
    used: set[int] = set()  # an entry can't be both kept-of-X AND dup-of-Y

    for i in range(len(food_entries)):
        idx_a, entry_a = food_entries[i]
        if idx_a in used:
            continue
        ts_a = _ts_seconds(entry_a.get("timestamp"))
        if ts_a is None:
            continue

        for j in range(i + 1, len(food_entries)):
            idx_b, entry_b = food_entries[j]
            if idx_b in used:
                continue
            ts_b = _ts_seconds(entry_b.get("timestamp"))
            if ts_b is None:
                continue

            # Window check
            delta = abs(ts_b - ts_a)
            if delta > DEDUPE_WINDOW_SEC:
                break  # entries are time-sorted; further pairs only farther apart

            reason = _classify_duplicate(entry_a, entry_b)
            if reason is None:
                continue

            # The LATER one is the duplicate (preserve original first entry).
            if ts_b >= ts_a:
                kept_idx, dup_idx = idx_a, idx_b
            else:
                kept_idx, dup_idx = idx_b, idx_a

            pairs.append((kept_idx, dup_idx, reason))
            used.add(kept_idx)
            used.add(dup_idx)
            break

    return pairs


def _classify_duplicate(a: dict, b: dict) -> str | None:
    """Return a reason string if a and b are likely the same meal, else None."""
    notes_a = a.get("notes") or ""
    notes_b = b.get("notes") or ""
    desc_a = a.get("description") or ""
    desc_b = b.get("description") or ""

    # Strong signal: explicit backreference in either entry's notes
    if _has_backref(notes_a) or _has_backref(notes_b):
        return "backreference-in-notes"

    # Both have photos + description overlap is high
    if a.get("photo") and b.get("photo"):
        toks_a = _tokens(desc_a) | _tokens(notes_a)
        toks_b = _tokens(desc_b) | _tokens(notes_b)
        score = _jaccard(toks_a, toks_b)
        if score >= 0.4:
            return f"description-overlap (jaccard={score:.2f})"

        # One is a known-product / label match — check name overlap
        kpm_a = a.get("_knownProductMatch") or a.get("_dailyStapleMatch")
        kpm_b = b.get("_knownProductMatch") or b.get("_dailyStapleMatch")
        if kpm_a and not kpm_b:
            # A is a label/known-product; if B's description tokens overlap
            # with A's, treat as same item
            if _jaccard(toks_a, toks_b) >= 0.25:
                return f"label-match-on-{kpm_a}"
        elif kpm_b and not kpm_a:
            if _jaccard(toks_a, toks_b) >= 0.25:
                return f"label-match-on-{kpm_b}"

    return None


def apply_duplicate_marks(entries: list[dict]) -> int:
    """Mark detected duplicates in-place. Returns count of marked entries.

    The kept entry gets _hasDuplicate=<dup_id>; the duplicate gets:
      - _duplicateOf=<kept_id>
      - calories/protein/carbs/fat/fiber zeroed
      - description prefixed with '[merged]'
    """
    pairs = find_duplicate_pairs(entries)
    for kept_idx, dup_idx, reason in pairs:
        kept = entries[kept_idx]
        dup = entries[dup_idx]
        kept["_hasDuplicate"] = dup.get("id")
        dup["_duplicateOf"] = kept.get("id")
        dup["_duplicateReason"] = reason
        dup["_originalCalories"] = dup.get("calories", 0)
        dup["_originalProtein"] = dup.get("protein", 0)
        for field in ("calories", "protein", "carbs", "fat", "fiber",
                      "solubleFiber", "insolubleFiber"):
            dup[field] = 0 if field not in ("solubleFiber", "insolubleFiber") else 0.0
        # Make the description visibly tagged
        orig_desc = dup.get("description") or "Entry"
        if not orig_desc.startswith("[merged]"):
            dup["description"] = f"[merged with {kept.get('id', 'previous')}] {orig_desc}"
    return len(pairs)
