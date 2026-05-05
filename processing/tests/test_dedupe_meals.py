"""Tests for meal-entry deduplication.

Today's bug: user logged 1 pasta meal as 2 entries (label photo + dish
photo, 65 sec apart). Cron counted both -> 600 cal double-count. Old
monolith Sonnet caught this; new orchestrator did not. Fixed with
deterministic dedupe_meals.
"""
from lib.dedupe_meals import (
    find_duplicate_pairs, apply_duplicate_marks, _has_backref, _tokens, _jaccard
)


def _meal(id_, ts, notes="", desc="", cal=400, photo=True, **kw):
    return {
        "id": id_, "type": "meal", "date": "2026-05-04",
        "timestamp": ts, "notes": notes, "description": desc,
        "calories": cal, "protein": 20, "carbs": 30, "fat": 15, "fiber": 4,
        "photo": photo, **kw,
    }


# ── The actual production case ──────────────────────────────────────────────

def test_production_2026_05_04_pasta_pair():
    """Real entries from today's bug. The 2nd entry's notes literally say
    'pasta from the nutrition label earlier' — strong backreference signal."""
    entries = [
        _meal("meal_1777942467788_5d4a", "2026-05-05T00:54:27.788Z",
              notes="1 serving",
              desc="Trader Joe's Family Style Pasta (Cheese Ravioli or similar) - 1 serving",
              cal=310,
              _knownProductMatch="family_style_pasta"),
        _meal("meal_1777942532072_8qj9", "2026-05-05T00:55:32.072Z",
              notes="pasta from the nutrition label earlier",
              desc="Pasta with meat sauce",
              cal=650),
    ]
    pairs = find_duplicate_pairs(entries)
    assert len(pairs) == 1
    kept_idx, dup_idx, reason = pairs[0]
    # The label-matched one (cal=310) is the canonical entry; the later
    # dish photo gets marked as duplicate.
    assert entries[dup_idx]["id"] == "meal_1777942532072_8qj9"
    assert "backreference" in reason


def test_apply_marks_zeroes_macros():
    entries = [
        _meal("a", "2026-05-04T10:00:00Z", desc="Pasta with sauce"),
        _meal("b", "2026-05-04T10:01:30Z", notes="pasta from earlier", desc="Same pasta"),
    ]
    n = apply_duplicate_marks(entries)
    assert n == 1
    dup = next(e for e in entries if e.get("_duplicateOf"))
    kept = next(e for e in entries if e.get("_hasDuplicate"))
    assert dup["calories"] == 0
    assert dup["protein"] == 0
    assert dup["_originalCalories"] > 0  # preserved for audit
    assert dup["description"].startswith("[merged with")
    assert kept["calories"] > 0
    assert kept["_hasDuplicate"] == dup["id"]


# ── Backreference detection ─────────────────────────────────────────────────

def test_backref_phrases():
    assert _has_backref("from the nutrition label earlier")
    assert _has_backref("pasta from the label")
    assert _has_backref("from before")
    assert _has_backref("this is the same as earlier")
    assert _has_backref("this is the steak from before")
    assert _has_backref("dupe of above")


def test_no_backref_in_normal_text():
    assert not _has_backref("220g salmon sashimi")
    assert not _has_backref("Tuna salad with sriracha")
    assert not _has_backref("")
    assert not _has_backref(None)


# ── Time-window enforcement ─────────────────────────────────────────────────

def test_far_apart_entries_not_dedup():
    """Two pasta meals 6 hours apart are real separate meals, not dupes."""
    entries = [
        _meal("a", "2026-05-04T08:00:00Z", desc="Pasta with sauce"),
        _meal("b", "2026-05-04T14:00:00Z", desc="Pasta with sauce", notes="from earlier"),
    ]
    # Even with backreference, 6 hours is too far apart — clearly a new meal
    pairs = find_duplicate_pairs(entries)
    assert pairs == []


def test_within_window_with_backref_dedup():
    entries = [
        _meal("a", "2026-05-04T10:00:00Z"),
        _meal("b", "2026-05-04T10:04:00Z", notes="from earlier"),  # 4 min later
    ]
    pairs = find_duplicate_pairs(entries)
    assert len(pairs) == 1


def test_outside_window_no_dedup():
    entries = [
        _meal("a", "2026-05-04T10:00:00Z"),
        _meal("b", "2026-05-04T10:06:00Z", notes="from earlier"),  # >5 min
    ]
    pairs = find_duplicate_pairs(entries)
    assert pairs == []


# ── Description-overlap dedup ───────────────────────────────────────────────

def test_high_overlap_with_photos_dedups():
    entries = [
        _meal("a", "2026-05-04T10:00:00Z",
              desc="Korean BBQ short ribs with rice and kimchi"),
        _meal("b", "2026-05-04T10:02:00Z",
              desc="Short ribs Korean BBQ rice kimchi"),  # same words shuffled
    ]
    pairs = find_duplicate_pairs(entries)
    assert len(pairs) == 1
    # No backref in this case; reason should mention overlap
    assert "overlap" in pairs[0][2]


def test_low_overlap_no_dedup():
    """Two photos within window but totally different meals — leave alone."""
    entries = [
        _meal("a", "2026-05-04T10:00:00Z", desc="Salmon sashimi with avocado"),
        _meal("b", "2026-05-04T10:02:00Z", desc="Chocolate cake with whipped cream"),
    ]
    pairs = find_duplicate_pairs(entries)
    assert pairs == []


# ── Don't pair non-food types ───────────────────────────────────────────────

def test_supplements_not_deduped():
    entries = [
        {**_meal("a", "2026-05-04T10:00:00Z"), "type": "supplement", "notes": "Fiber"},
        {**_meal("b", "2026-05-04T10:01:00Z"), "type": "supplement", "notes": "Fiber"},
    ]
    pairs = find_duplicate_pairs(entries)
    assert pairs == []


# ── Conservatism ────────────────────────────────────────────────────────────

def test_no_dedup_without_photos_or_strong_signal():
    """Two text-only entries with vague matching descriptions — leave alone."""
    entries = [
        _meal("a", "2026-05-04T10:00:00Z", notes="meal", desc="meal", photo=False),
        _meal("b", "2026-05-04T10:02:00Z", notes="meal", desc="meal", photo=False),
    ]
    pairs = find_duplicate_pairs(entries)
    assert pairs == []


def test_three_entries_only_one_pair():
    """Don't chain dedupes — once an entry is paired, it's used up."""
    entries = [
        _meal("a", "2026-05-04T10:00:00Z", desc="Pasta with sauce"),
        _meal("b", "2026-05-04T10:01:00Z", notes="from earlier", desc="Same pasta"),
        _meal("c", "2026-05-04T10:02:00Z", notes="also from earlier", desc="Same pasta"),
    ]
    pairs = find_duplicate_pairs(entries)
    assert len(pairs) == 1, "should pair (a,b); c is too late to dedup with a"


def test_jaccard_basic():
    assert _jaccard(_tokens("pasta with sauce"), _tokens("pasta with sauce")) == 1.0
    assert _jaccard(_tokens("salmon"), _tokens("chocolate")) == 0.0
    assert 0 < _jaccard(_tokens("pasta sauce cheese"), _tokens("pasta sauce")) < 1
