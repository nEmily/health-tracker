"""Tests for weight_typo.py"""
import pytest
from lib.weight_typo import detect


def test_normal_no_correction():
    result = detect(102.5, [100.0, 101.0, 102.0, 101.5, 100.8])
    assert result["corrected"] is False
    assert result["value"] == 102.5
    assert result["raw_value"] == 102.5


def test_missing_decimal_10x():
    # 1012 instead of 101.2
    result = detect(1012.0, [100.0, 101.0, 102.0, 101.5, 100.8])
    assert result["corrected"] is True
    assert abs(result["value"] - 101.2) < 0.1
    assert "decimal" in result["correction_note"].lower()


def test_impossible_value_below_50():
    result = detect(30.0, [100.0, 101.0])
    assert "impossible" in (result.get("correction_note") or "").lower() or result.get("corrected")


def test_impossible_value_above_500():
    result = detect(600.0, [150.0, 152.0])
    assert result["correction_note"] is not None


def test_impossible_correctable_with_reference():
    # 1005 lbs — should be 100.5
    result = detect(1005.0, [100.0, 101.0, 100.5])
    assert result["corrected"] is True
    assert 99 < result["value"] < 102


def test_impossible_not_correctable_no_reference():
    result = detect(600.0, [])
    assert result["correction_note"] is not None
    # No reference — can't auto-correct
    assert result["value"] == 600.0 or result["corrected"] is False


def test_normal_fluctuation_not_corrected():
    # 5 lb gain — normal range, should not be corrected
    result = detect(107.0, [100.0, 101.0, 102.0, 103.0, 104.0])
    assert result["corrected"] is False


def test_empty_history():
    result = detect(102.0, [])
    assert result["corrected"] is False
    assert result["value"] == 102.0


def test_unit_is_lbs():
    result = detect(100.0, [99.0, 100.0])
    assert result["unit"] == "lbs"


def test_raw_value_preserved():
    result = detect(1012.0, [101.0, 102.0])
    assert result["raw_value"] == 1012.0
