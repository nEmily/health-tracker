"""Tests for validate_schema.py"""
import pytest
from lib.validate_schema import validate


def _minimal_output():
    return {
        "date": "2026-05-01",
        "entries": [{"id": "e1", "type": "food", "calories": 400}],
        "totals": {"calories": 400, "protein": 30},
    }


def test_valid_minimal():
    ok, violations = validate(_minimal_output())
    assert ok is True
    assert violations == []


def test_missing_required_field():
    output = _minimal_output()
    del output["date"]
    ok, violations = validate(output)
    assert ok is False
    assert any("date" in v for v in violations)


def test_em_dash_detected():
    output = _minimal_output()
    output["highlights"] = ["You did great—excellent work"]  # em-dash
    ok, violations = validate(output)
    assert ok is False
    assert any("em-dash" in v or "bad characters" in v for v in violations)


def test_smart_quotes_detected():
    output = _minimal_output()
    output["concerns"] = ["“Bad quote here”"]  # smart quotes
    ok, violations = validate(output)
    assert ok is False


def test_ingredient_cal_sum_violation():
    output = _minimal_output()
    output["mealPlan"] = {
        "source": "processing",
        "days": [{
            "meals": [{
                "name": "Lunch",
                "calories": 500,
                "protein": 40,
                "ingredients": [
                    {"item": "chicken", "grams": 150, "cal": 200, "protein": 30},
                    {"item": "rice", "grams": 100, "cal": 200, "protein": 5},
                    # sum = 400, meal says 500 — violation > 2
                ]
            }]
        }]
    }
    ok, violations = validate(output)
    assert ok is False
    assert any("cal sum" in v for v in violations)


def test_ingredient_cal_sum_within_tolerance():
    output = _minimal_output()
    output["mealPlan"] = {
        "source": "processing",
        "days": [{
            "meals": [{
                "name": "Lunch",
                "calories": 400,
                "protein": 30,
                "ingredients": [
                    {"item": "chicken", "grams": 150, "cal": 200, "protein": 30},
                    {"item": "rice", "grams": 100, "cal": 200, "protein": 4},
                    # sum = 400, meal says 400 — OK
                ]
            }]
        }]
    }
    ok, violations = validate(output)
    assert ok is True


def test_entry_missing_id():
    output = _minimal_output()
    output["entries"] = [{"type": "food", "calories": 300}]  # no id
    ok, violations = validate(output)
    assert ok is False
    assert any("id" in v for v in violations)


def test_totals_must_be_dict():
    output = _minimal_output()
    output["totals"] = [400, 30]
    ok, violations = validate(output)
    assert ok is False


def test_not_a_dict():
    ok, violations = validate("not a dict")
    assert ok is False
    assert any("not a dict" in v for v in violations)
