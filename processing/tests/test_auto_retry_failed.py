"""Tests for auto-retry of failed entry analysis + best-effort salvage.

User's complaint (2026-05-04): "Coach should be able to restart analysis
if needed - user should NOT be told to randomly edit it just so it can be
reanalyzed. And we shouldn't be failing analysis in the first place."

Two-part fix:
  1. invoke_entry_analyzer salvages on triple-failure (returns sensible
     defaults, marks _reanalyzeRequested for next-tick retry, NEVER 0-cal)
  2. reconcile_entries treats _analysisError as auto-retry signal so the
     entry stays in the pipeline until it passes
"""
from lib.reconcile_entries import reconcile
from lib.invoke_entry_analyzer import _salvage_best_effort


# ── Salvage best-effort ───────────────────────────────────────────────────────

def test_salvage_uses_type_defaults_for_meal():
    entry = {"id": "x", "type": "meal", "notes": "1 serving"}
    out = _salvage_best_effort(entry, None)
    assert out["calories"] > 0, "meal should not silent-fail at 0 cal"
    assert out["protein"] >= 0
    assert out["confidence"] == "low"
    assert out["description"], "must have a description"


def test_salvage_uses_type_defaults_for_drink():
    entry = {"id": "x", "type": "drink", "notes": ""}
    out = _salvage_best_effort(entry, None)
    assert out["calories"] > 0


def test_salvage_uses_last_result_when_present():
    """If the LLM gave a partial result (some fields valid), use those."""
    entry = {"id": "x", "type": "meal", "notes": "lamb"}
    last = {"description": "Korean lamb bulgogi", "calories": 320, "protein": 28}  # missing carbs/fat/fiber
    out = _salvage_best_effort(entry, last)
    assert out["calories"] == 320  # used from LLM
    assert out["protein"] == 28
    assert out["description"] == "Korean lamb bulgogi"
    assert out["carbs"] >= 0  # filled from defaults
    assert out["fat"] >= 0


def test_salvage_ignores_non_numeric_in_last_result():
    """If LLM returned strings or null, fall back to type defaults for those."""
    entry = {"id": "x", "type": "meal"}
    last = {"calories": "around 400", "protein": None}
    out = _salvage_best_effort(entry, last)
    assert isinstance(out["calories"], (int, float))
    assert isinstance(out["protein"], (int, float))


def test_salvage_ignores_zero_calories_from_llm():
    """LLM sometimes returns 0 cal for unparseable photos. Use type default
    instead — never silent-fail a meal at 0 cal."""
    entry = {"id": "x", "type": "meal", "notes": ""}
    last = {"description": "No meal details", "calories": 0, "protein": 0,
            "carbs": 0, "fat": 0, "fiber": 0}
    out = _salvage_best_effort(entry, last)
    assert out["calories"] > 0, "must not silent-fail at 0 cal even if LLM said 0"


def test_salvage_description_falls_back_to_notes():
    entry = {"id": "x", "type": "meal", "notes": "user typed this"}
    out = _salvage_best_effort(entry, None)
    assert out["description"] == "user typed this"


# ── Reconcile auto-retries _analysisError entries ─────────────────────────────

def test_reconcile_retries_failed_entry_on_next_tick():
    """An entry with _analysisError should be re-routed to new_to_analyze
    even if _reanalyzeRequested isn't set on it.
    """
    log_entry = {
        "id": "meal_1",
        "type": "meal",
        "notes": "1 serving",
        "updatedAt": "2026-05-04T10:00:00Z",
    }
    existing_failed = {
        "id": "meal_1",
        "type": "meal",
        "notes": "1 serving",
        "calories": 400,  # fallback estimate
        "_analysisError": "schema_violations: ...",
        # No _reanalyzedAt — failure path doesn't set it
    }
    new_to_analyze, kept = reconcile([log_entry], [existing_failed])
    assert len(new_to_analyze) == 1, (
        f"failed entry should retry; got {len(new_to_analyze)} new, {len(kept)} kept"
    )
    assert new_to_analyze[0]["id"] == "meal_1"


def test_reconcile_keeps_clean_entry():
    """Entry that succeeded analysis previously stays put."""
    log_entry = {"id": "x", "type": "meal", "notes": "salad", "updatedAt": "2026-05-04T10:00:00Z"}
    existing_clean = {
        "id": "x", "type": "meal", "notes": "salad",
        "calories": 250, "protein": 18,
        "_reanalyzedAt": 1777920000000,  # newer than updatedAt
    }
    new_to_analyze, kept = reconcile([log_entry], [existing_clean])
    assert len(new_to_analyze) == 0
    assert len(kept) == 1


def test_reconcile_retries_when_user_edits_after_analysis():
    """User edited entry after analysis — needs re-analysis."""
    log_entry = {
        "id": "x", "type": "meal", "notes": "salad with chicken",  # edited
        "updatedAt": "2026-05-05T10:00:00Z",  # AFTER the reanalysis time
        "_reanalyzeRequested": True,
    }
    existing = {
        "id": "x", "type": "meal", "notes": "salad",
        "calories": 100,
        "_reanalyzedAt": 1777920000000,  # 2026-05-04 17:20 UTC — OLDER than edit
    }
    new_to_analyze, kept = reconcile([log_entry], [existing])
    assert len(new_to_analyze) == 1


def test_reconcile_retries_failed_even_when_reanalyzed_at_is_recent():
    """Critical edge: the salvage path doesn't set _reanalyzedAt, but
    even if it did somehow, _analysisError still routes to retry.
    """
    log_entry = {"id": "x", "type": "meal", "notes": "x", "updatedAt": "2026-05-04T10:00:00Z"}
    existing_failed = {
        "id": "x", "type": "meal", "notes": "x",
        "_reanalyzedAt": 1777950000000,  # set somehow
        "_analysisError": "still failing",
    }
    new_to_analyze, kept = reconcile([log_entry], [existing_failed])
    assert len(new_to_analyze) == 1, (
        "_analysisError should override the 'already clean' shortcut"
    )
