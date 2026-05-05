"""learn_known_products.py — Auto-grow preferences.knownProducts when the
entry analyzer detects a nutrition-facts label photo.

When Haiku marks an entry with isLabel:true and labelData, this module:
  1. Reads coach/profile/preferences.json
  2. Slugifies the product name into a knownProducts key
  3. Adds an entry with macros from the analyzed result + triggers derived
     from the product name
  4. Writes preferences.json atomically + appends a timeline event

Idempotent: re-running on the same label updates the existing entry rather
than creating a duplicate.

Stdlib only.
"""
from __future__ import annotations
import json
import re
import time
from pathlib import Path


_GENERIC_TOKENS = {
    "and", "with", "the", "a", "an", "of", "for", "to", "in",
    "powder", "shake", "drink", "supplement", "protein", "shot",
    "stick", "bottle", "bar", "pack", "single", "serving", "size",
    "ready", "to", "drink",
    "+", "-", "&",
}


_NAME_DEDUP_STOPWORDS = frozenset({
    "the", "a", "an", "of", "for", "to", "in", "and", "with",
    "style", "size", "single", "serving", "meal", "shake",
    "drink", "supplement", "powder",
})


def _normalize_name_for_dedup(name: str) -> str:
    """Reduce a product name to a canonical fingerprint for dedup.

    'Family Style Pasta' and 'Family Style Meat Pasta' are clearly the same
    Trader Joe's product photographed twice. We normalize by:
      - lowercasing
      - dropping stopwords
      - sorting remaining tokens
    Result: 'family pasta' from the first, 'family meat pasta' from the
    second. Different fingerprints -> still treated as separate products.
    But minor variations like trailing 'meal' or pluralization collapse.

    This is intentionally conservative — when in doubt, keep separate
    entries (user can merge manually). False merges are worse than dups.
    """
    if not name:
        return ""
    tokens = [
        re.sub(r"[^a-z0-9]", "", t.lower())
        for t in name.split()
    ]
    distinctive = sorted(t for t in tokens if t and t not in _NAME_DEDUP_STOPWORDS)
    return " ".join(distinctive)


def _slugify(name: str) -> str:
    """orgain plant protein -> orgain_plant_protein. ASCII, lowercase, _-joined."""
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s[:60] or "product"


def _derive_triggers(name: str) -> list[str]:
    """Build a conservative trigger list from the product name.

    NEVER returns single-word triggers. Single words ("chocolate", "family",
    "fiber") false-match unrelated entries. Auto-learning has to be safe by
    default — the user can manually add narrower or broader triggers later.

    Strategy:
      1. Full lowercased name
      2. First 3 raw tokens joined (if name is 3+ tokens)
      3. First 2 raw tokens joined (if name is 2+ tokens)
    """
    name_lc = (name or "").lower().strip()
    if not name_lc:
        return []
    raw_tokens = [t for t in re.split(r"\s+", name_lc) if t]
    if len(raw_tokens) < 2:
        # Single-token product name is too generic for auto-derived
        # triggers. The user can manually add a trigger if needed.
        return [name_lc] if name_lc else []
    triggers: list[str] = [name_lc]
    if len(raw_tokens) >= 3:
        triggers.append(" ".join(raw_tokens[:3]))
    triggers.append(" ".join(raw_tokens[:2]))
    # Dedup, preserve order
    seen = set()
    return [t for t in triggers if not (t in seen or seen.add(t))]


def learn_from_analyzed_entries(
    entries: list[dict],
    data_dir: Path,
) -> int:
    """Scan analyzed entries; for any with isLabel:true, add to knownProducts.

    Returns the number of products added or updated.
    """
    label_entries = [
        e for e in entries
        if isinstance(e, dict) and e.get("isLabel") and isinstance(e.get("labelData"), dict)
    ]
    if not label_entries:
        return 0

    prefs_path = data_dir / "profile" / "preferences.json"
    if not prefs_path.exists():
        return 0
    prefs = json.loads(prefs_path.read_text(encoding="utf-8"))
    products = prefs.setdefault("knownProducts", {})
    if not isinstance(products, dict):
        return 0

    changed = 0
    for entry in label_entries:
        name = (entry["labelData"].get("productName") or entry.get("description") or "").strip()
        if not name:
            continue
        key = _slugify(name)
        new_record = {
            "name": name,
            "cal": entry.get("calories", 0),
            "protein": entry.get("protein", 0),
            "carbs": entry.get("carbs", 0),
            "fat": entry.get("fat", 0),
            "fiber": entry.get("fiber", 0),
            "triggers": _derive_triggers(name),
            "category": _guess_category(name),
            "servingSize": entry["labelData"].get("servingSize"),
            "servingsPerContainer": entry["labelData"].get("servingsPerContainer"),
            "source": "auto-learned-from-label-photo",
            "addedFromEntry": entry.get("id"),
            "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        # Dedup: if a product with a similar normalized name already exists,
        # update IT rather than creating a near-duplicate. Trader Joe's photo
        # was OCR'd as both "Family Style Pasta" and "Family Style Meat Pasta"
        # in two separate runs — same product, two slugs without this guard.
        normalized = _normalize_name_for_dedup(name)
        existing_key = key
        for ek, ev in products.items():
            if ek.startswith("_") or not isinstance(ev, dict):
                continue
            if _normalize_name_for_dedup(ev.get("name", "")) == normalized:
                existing_key = ek
                break

        existing = products.get(existing_key)
        # Compare ignoring lastUpdated (second-resolution wall-clock varies)
        if existing and isinstance(existing, dict):
            existing_compared = {k: v for k, v in existing.items() if k != "lastUpdated"}
            new_compared = {k: v for k, v in new_record.items() if k != "lastUpdated"}
            if existing_compared == new_compared:
                continue  # idempotent — no meaningful change
        # If we matched an existing product by normalized name but with a
        # different slug, replace the old slug. Otherwise, write under the
        # newly-slugified key.
        if existing_key != key and existing_key in products:
            products.pop(existing_key, None)
        products[key] = new_record
        changed += 1

    if changed == 0:
        return 0

    # Atomic write
    tmp = prefs_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(prefs, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(prefs_path)

    # Append timeline event
    timeline_path = data_dir / "profile" / "timeline.json"
    try:
        timeline = json.loads(timeline_path.read_text(encoding="utf-8")) if timeline_path.exists() else []
    except Exception:
        timeline = []
    if not isinstance(timeline, list):
        timeline = []
    timeline.append({
        "date": time.strftime("%Y-%m-%d"),
        "timestamp": int(time.time() * 1000),
        "level": "minor",
        "type": "preference",
        "summary": f"Learned {changed} new product(s) from nutrition-label photo(s)",
        "reason": "Entry analyzer detected isLabel:true; auto-added to knownProducts",
        "source": "label-learner",
    })
    timeline_path.write_text(json.dumps(timeline, indent=2, ensure_ascii=False), encoding="utf-8")

    return changed


def _guess_category(name: str) -> str:
    n = (name or "").lower()
    if any(w in n for w in ("shake", "protein", "whey", "isolate", "casein")):
        return "shake"
    if any(w in n for w in ("bar", "snack")):
        return "bar"
    if any(w in n for w in ("yogurt", "kefir", "milk", "cheese")):
        return "dairy"
    if any(w in n for w in ("supplement", "capsule", "tablet", "creatine", "collagen")):
        return "supplement"
    return "other"
