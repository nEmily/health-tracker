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


def _slugify(name: str) -> str:
    """orgain plant protein -> orgain_plant_protein. ASCII, lowercase, _-joined."""
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s[:60] or "product"


def _derive_triggers(name: str) -> list[str]:
    """Build a conservative trigger list from the product name.

    Strategy:
      1. Full lowercased name (always — generic words OK inside phrases)
      2. First 3 raw tokens joined (still keeps generic words in the phrase
         but not as standalone triggers)
      3. First distinctive (non-generic) token alone if length >= 5 chars
         (single-token triggers are riskier; distinct + long enough)
    """
    name_lc = (name or "").lower().strip()
    if not name_lc:
        return []
    triggers: list[str] = [name_lc]
    raw_tokens = [t for t in re.split(r"\s+", name_lc) if t]
    if len(raw_tokens) >= 2:
        triggers.append(" ".join(raw_tokens[:3]))
    distinctive = [t for t in raw_tokens if t not in _GENERIC_TOKENS]
    if distinctive and len(distinctive[0]) >= 5:
        triggers.append(distinctive[0])
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
        existing = products.get(key)
        if existing == new_record:
            continue  # idempotent — no change
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
