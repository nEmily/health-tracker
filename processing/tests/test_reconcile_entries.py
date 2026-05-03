"""Tests for reconcile_entries.py"""
import pytest
from lib.reconcile_entries import reconcile


def _entry(id, **kwargs):
    return {"id": id, "type": "food", "notes": "test", **kwargs}


def _analyzed(id, **kwargs):
    return {"id": id, "calories": 300, "protein": 25, "description": "analyzed", **kwargs}


def test_new_entries_go_to_analyze():
    log = [_entry("e1"), _entry("e2")]
    existing = []
    new, kept = reconcile(log, existing)
    assert len(new) == 2
    assert len(kept) == 0
    ids = {e["id"] for e in new}
    assert ids == {"e1", "e2"}


def test_unchanged_entries_kept():
    log = [_entry("e1")]
    existing = [_analyzed("e1")]
    new, kept = reconcile(log, existing)
    assert len(new) == 0
    assert len(kept) == 1
    assert kept[0]["id"] == "e1"


def test_deleted_entry_dropped():
    log = [_entry("e1")]
    existing = [_analyzed("e1"), _analyzed("e2")]
    new, kept = reconcile(log, existing)
    assert len(kept) == 1
    assert kept[0]["id"] == "e1"
    assert all(e["id"] != "e2" for e in new + kept)


def test_reanalyze_requested_no_reanalyzed_at():
    log = [_entry("e1", _reanalyzeRequested=True, updatedAt=1000)]
    existing = [_analyzed("e1")]  # no _reanalyzedAt
    new, kept = reconcile(log, existing)
    assert len(new) == 1
    assert new[0]["id"] == "e1"


def test_reanalyze_already_done():
    # _reanalyzedAt is newer than updatedAt — no need to redo
    log = [_entry("e1", _reanalyzeRequested=True, updatedAt=1000)]
    existing = [_analyzed("e1", _reanalyzedAt=2000)]
    new, kept = reconcile(log, existing)
    assert len(kept) == 1
    assert kept[0]["id"] == "e1"


def test_reanalyze_stale():
    # updatedAt is newer than _reanalyzedAt — needs redo
    log = [_entry("e1", _reanalyzeRequested=True, updatedAt=3000)]
    existing = [_analyzed("e1", _reanalyzedAt=2000)]
    new, kept = reconcile(log, existing)
    assert len(new) == 1


def test_entry_without_id_always_new():
    log = [{"type": "food", "notes": "no id"}]
    existing = []
    new, kept = reconcile(log, existing)
    assert len(new) == 1


def test_mixed_scenario():
    log = [
        _entry("a"),                                        # existing, unchanged
        _entry("b", _reanalyzeRequested=True, updatedAt=5000),  # needs reanalysis
        _entry("c"),                                        # brand new
    ]
    existing = [
        _analyzed("a"),
        _analyzed("b", _reanalyzedAt=1000),  # stale
    ]
    new, kept = reconcile(log, existing)
    new_ids = {e["id"] for e in new}
    kept_ids = {e["id"] for e in kept}
    assert "a" in kept_ids
    assert "b" in new_ids
    assert "c" in new_ids
