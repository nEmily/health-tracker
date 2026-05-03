"""Tests for commit_plan.py — validation rules and commit behavior."""
import json
import sys
from pathlib import Path
import pytest

# Make coach-plugin/scripts importable
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "coach-plugin" / "scripts"))

from commit_plan import validate_plan, commit_plan  # noqa: E402


# ── Fixtures ─────────────────────────────────────────────────────────────────

def _ingredient(name="Chicken breast", grams=100, cal=165, protein=31):
    return {"name": name, "grams": grams, "cal": cal, "protein": protein}


def _meal(name="Lunch", calories=165, protein=31, fat=3, fiber=0, prep_time=10, ingredients=None):
    if ingredients is None:
        ingredients = [_ingredient(cal=calories)]
    return {
        "name": name,
        "calories": calories,
        "protein": protein,
        "fat": fat,
        "fiber": fiber,
        "prep_time": prep_time,
        "ingredients": ingredients,
    }


def _valid_plan(num_days=1):
    days = []
    for i in range(num_days):
        meal = _meal(name=f"Meal day {i}")
        days.append({
            "meals": [meal],
            "day_totals": {"calories": meal["calories"], "protein": meal["protein"],
                           "fat": meal["fat"], "fiber": meal["fiber"]},
        })
    return {"days": days}


def _make_data_dir(tmp_path, date="2026-05-01", analysis_extra=None):
    """Create a minimal data dir with an analysis JSON for the given date."""
    analysis_dir = tmp_path / "analysis"
    analysis_dir.mkdir(parents=True)
    data = {"date": date, "entries": []}
    if analysis_extra:
        data.update(analysis_extra)
    (analysis_dir / f"{date}.json").write_text(json.dumps(data), encoding="utf-8")
    return tmp_path


# ── validate_plan tests ───────────────────────────────────────────────────────

def test_valid_plan_passes():
    validate_plan(_valid_plan())


def test_missing_days_key_raises():
    with pytest.raises(ValueError, match="missing 'days'"):
        validate_plan({})


def test_meal_missing_required_field_raises():
    plan = _valid_plan()
    del plan["days"][0]["meals"][0]["calories"]
    with pytest.raises(ValueError, match="missing fields"):
        validate_plan(plan)


def test_ingredient_missing_field_raises():
    ing = _ingredient()
    del ing["grams"]
    plan = _valid_plan()
    plan["days"][0]["meals"][0]["ingredients"] = [ing]
    with pytest.raises(ValueError, match="missing fields"):
        validate_plan(plan)


def test_ingredient_cal_sum_mismatch_raises():
    # meal.calories = 165, but ingredient.cal = 200 → difference of 35 > ±2
    plan = _valid_plan()
    plan["days"][0]["meals"][0]["ingredients"] = [_ingredient(cal=200)]
    plan["days"][0]["meals"][0]["calories"] = 165
    with pytest.raises(ValueError, match="ingredient cal sum"):
        validate_plan(plan)


def test_ingredient_cal_sum_within_tolerance_passes():
    # ±2 is acceptable
    plan = _valid_plan()
    plan["days"][0]["meals"][0]["ingredients"] = [_ingredient(cal=166)]
    plan["days"][0]["meals"][0]["calories"] = 165
    validate_plan(plan)  # should NOT raise


def test_day_totals_mismatch_raises():
    plan = _valid_plan()
    # day_totals says 500 cal, but meal.calories = 165 → difference > ±2
    plan["days"][0]["day_totals"]["calories"] = 500
    with pytest.raises(ValueError, match="day_totals.calories"):
        validate_plan(plan)


def test_day_totals_within_tolerance_passes():
    plan = _valid_plan()
    plan["days"][0]["day_totals"]["calories"] = plan["days"][0]["meals"][0]["calories"] + 1
    validate_plan(plan)  # should NOT raise


def test_multiple_meals_cal_sum():
    m1 = _meal(name="Breakfast", calories=300, ingredients=[_ingredient(cal=300)])
    m2 = _meal(name="Dinner", calories=500, ingredients=[_ingredient(cal=500)])
    plan = {
        "days": [{
            "meals": [m1, m2],
            "day_totals": {"calories": 800, "protein": m1["protein"] + m2["protein"],
                           "fat": 6, "fiber": 0},
        }]
    }
    validate_plan(plan)


# ── commit_plan integration tests ─────────────────────────────────────────────

def test_commit_plan_writes_meal_plan(tmp_path):
    date = "2026-05-01"
    data_dir = _make_data_dir(tmp_path, date)
    plan = _valid_plan()

    commit_plan(date, plan, source="coach-session", data_dir=data_dir)

    analysis = json.loads((data_dir / "analysis" / f"{date}.json").read_text())
    assert "mealPlan" in analysis
    assert analysis["mealPlan"]["source"] == "coach-session"
    for day in analysis["mealPlan"]["days"]:
        assert day["source"] == "coach-session"


def test_commit_plan_sets_sources_on_all_days(tmp_path):
    date = "2026-05-01"
    data_dir = _make_data_dir(tmp_path, date)
    plan = _valid_plan(num_days=3)

    commit_plan(date, plan, source="coach-session-2026-05-01", data_dir=data_dir)

    analysis = json.loads((data_dir / "analysis" / f"{date}.json").read_text())
    for day in analysis["mealPlan"]["days"]:
        assert day["source"] == "coach-session-2026-05-01"


def test_commit_plan_deletes_uploaded_marker(tmp_path):
    date = "2026-05-01"
    data_dir = _make_data_dir(tmp_path, date)
    marker = data_dir / "analysis" / f"{date}.json.uploaded"
    marker.write_text("1")

    commit_plan(date, _valid_plan(), source="coach-session", data_dir=data_dir)

    assert not marker.exists()


def test_commit_plan_appends_timeline_event(tmp_path):
    date = "2026-05-01"
    data_dir = _make_data_dir(tmp_path, date)

    commit_plan(date, _valid_plan(), source="coach-session", data_dir=data_dir)

    timeline = json.loads((data_dir / "timeline.json").read_text())
    assert len(timeline) >= 1
    event = timeline[-1]
    assert event["type"] == "preference"
    assert event["source"] == "coach-session"
    assert date in event["summary"]


def test_commit_plan_missing_analysis_exits(tmp_path):
    # analysis/2026-01-01.json does not exist
    with pytest.raises(SystemExit) as exc_info:
        commit_plan("2026-01-01", _valid_plan(), source="coach-session", data_dir=tmp_path)
    assert exc_info.value.code != 0


def test_commit_plan_invalid_plan_exits_no_write(tmp_path):
    date = "2026-05-01"
    data_dir = _make_data_dir(tmp_path, date)
    original = (data_dir / "analysis" / f"{date}.json").read_text()

    bad_plan = _valid_plan()
    bad_plan["days"][0]["meals"][0]["ingredients"] = [_ingredient(cal=9999)]  # cal sum mismatch

    with pytest.raises(SystemExit) as exc_info:
        commit_plan(date, bad_plan, source="coach-session", data_dir=data_dir)
    assert exc_info.value.code != 0
    # File must be unchanged
    assert (data_dir / "analysis" / f"{date}.json").read_text() == original


def test_commit_plan_preserves_existing_analysis_fields(tmp_path):
    date = "2026-05-01"
    extra = {"entries": [{"id": "e1", "calories": 100}], "highlights": ["Good job"]}
    data_dir = _make_data_dir(tmp_path, date, analysis_extra=extra)

    commit_plan(date, _valid_plan(), source="coach-session", data_dir=data_dir)

    analysis = json.loads((data_dir / "analysis" / f"{date}.json").read_text())
    assert analysis["entries"] == extra["entries"]
    assert analysis["highlights"] == extra["highlights"]


# ── Adversarial / chaos tests ─────────────────────────────────────────────────

def test_validate_plan_non_dict_raises():
    with pytest.raises(ValueError, match="must be a JSON object"):
        validate_plan([])


def test_validate_plan_days_not_list_raises():
    with pytest.raises(ValueError, match="'days' must be a list"):
        validate_plan({"days": "not a list"})


def test_validate_plan_ingredient_cal_not_numeric_raises():
    plan = _valid_plan()
    plan["days"][0]["meals"][0]["ingredients"][0]["cal"] = "not_a_number"
    with pytest.raises(ValueError, match="must be numeric"):
        validate_plan(plan)


def test_validate_plan_empty_days_passes():
    # An empty days list is structurally valid (no meals to check)
    validate_plan({"days": []})


def test_validate_plan_meal_ingredients_not_list_raises():
    plan = _valid_plan()
    plan["days"][0]["meals"][0]["ingredients"] = "oops"
    with pytest.raises(ValueError, match="must be a list"):
        validate_plan(plan)
