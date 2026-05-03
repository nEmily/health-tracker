"""
test_invoke_entry_analyzer.py — Unit tests for the Haiku short-circuit (Task 1).

bodyPhoto, weight, bm entries must return without calling subprocess.
supplement and food entries must still go through the LLM path.
"""
from __future__ import annotations
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

PROCESSING_DIR = Path(__file__).resolve().parent.parent
if str(PROCESSING_DIR) not in sys.path:
    sys.path.insert(0, str(PROCESSING_DIR))

from lib.invoke_entry_analyzer import analyze, ZERO_CAL_TYPES  # noqa: E402


# ── Zero-cal short-circuit tests ──────────────────────────────────────────────

def test_body_photo_skips_subprocess():
    entry = {"id": "p1", "type": "bodyPhoto", "subtype": "front", "timestamp": "2026-05-03T10:00:00"}
    with patch("lib.invoke_entry_analyzer.subprocess.run") as mock_run:
        result = analyze(entry, {})
    mock_run.assert_not_called()
    assert result["calories"] == 0
    assert result["protein"] == 0
    assert result["confidence"] == "high"
    assert result["breakdown"] == []
    assert "_reanalyzedAt" in result
    assert "front" in result["description"]


def test_weight_skips_subprocess():
    entry = {"id": "w1", "type": "weight", "value": "101.1", "timestamp": "2026-05-03T08:00:00"}
    with patch("lib.invoke_entry_analyzer.subprocess.run") as mock_run:
        result = analyze(entry, {})
    mock_run.assert_not_called()
    assert result["calories"] == 0
    assert "101.1" in result["description"]


def test_bm_skips_subprocess():
    entry = {"id": "bm1", "type": "bm", "timestamp": "2026-05-03T09:00:00"}
    with patch("lib.invoke_entry_analyzer.subprocess.run") as mock_run:
        result = analyze(entry, {})
    mock_run.assert_not_called()
    assert result["calories"] == 0
    assert "Bowel" in result["description"]


def test_zero_cal_result_shape():
    """Short-circuit result must have the same macro fields as a full Haiku result."""
    entry = {"id": "p2", "type": "bodyPhoto", "subtype": "side"}
    result = analyze(entry, {})
    for field in ("calories", "protein", "carbs", "fat", "fiber",
                  "solubleFiber", "insolubleFiber", "confidence", "breakdown", "_reanalyzedAt"):
        assert field in result, f"Missing field: {field}"
    assert result["solubleFiber"] == 0.0
    assert result["insolubleFiber"] == 0.0


def test_existing_description_preserved():
    """If entry already has a description, it should not be overwritten."""
    entry = {"id": "p3", "type": "bodyPhoto", "description": "My custom description"}
    result = analyze(entry, {})
    assert result["description"] == "My custom description"


# ── supplement NOT in ZERO_CAL_TYPES ─────────────────────────────────────────

def test_supplement_not_in_zero_cal_types():
    """supplement must not be short-circuited — it may have nutrition data."""
    assert "supplement" not in ZERO_CAL_TYPES


def test_supplement_calls_subprocess():
    """supplement entries must go through the LLM path."""
    entry = {"id": "s1", "type": "supplement", "notes": "creatine 5g"}
    with patch("lib.invoke_entry_analyzer.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = ""
        result = analyze(entry, {})
    mock_run.assert_called()


# ── Food entry still calls subprocess ────────────────────────────────────────

def test_food_entry_calls_subprocess():
    """Food entries must still go through the Haiku LLM path."""
    entry = {"id": "f1", "type": "food", "notes": "chicken breast 6oz"}
    with patch("lib.invoke_entry_analyzer.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = ""
        result = analyze(entry, {})
    mock_run.assert_called()
    assert "_analysisError" in result  # both attempts failed → error annotation


def test_snack_entry_calls_subprocess():
    """Non-zero-cal type 'snack' must call subprocess."""
    entry = {"id": "sn1", "type": "snack", "notes": "apple"}
    with patch("lib.invoke_entry_analyzer.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = ""
        analyze(entry, {})
    mock_run.assert_called()
