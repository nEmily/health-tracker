"""
test_adversarial.py — Adversarial unit tests (T1) for each lib module.

Each test asserts the module either produces a defined error or a sensible
default — it must never throw an unhandled exception.
"""
import json
import sys
from pathlib import Path

import pytest

PROCESSING_DIR = Path(__file__).resolve().parent.parent
if str(PROCESSING_DIR) not in sys.path:
    sys.path.insert(0, str(PROCESSING_DIR))

from lib.load_profile import load_profile
from lib.apply_goal_updates import apply_goal_updates
from lib.weight_typo import detect as weight_detect
from lib.reconcile_entries import reconcile
from lib.fiber_split import estimate_split_inplace
from lib.compute_totals import compute as compute_totals
from lib.validate_schema import validate as validate_schema
from lib.parse_claude_json import parse_claude_json


# ── Shared helpers ────────────────────────────────────────────────────────────

_VALID_GOALS = {"calories": 1200, "protein": 80, "fiber": 25, "water_oz": 64}


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _minimal_valid_output(*, highlights_text=None) -> dict:
    """Minimal dict that passes validate_schema with no em-dash/smart-quote issues."""
    return {
        "date": "2026-05-01",
        "entries": [{"id": "e1"}],
        "totals": {"calories": 100, "protein": 10},
        "highlights": [highlights_text or "Good job today"],
    }


# ── load_profile ──────────────────────────────────────────────────────────────

class TestLoadProfileAdversarial:

    def test_missing_goals_raises_file_not_found(self, tmp_path):
        data_dir = tmp_path / "data"
        extract_dir = tmp_path / "extract"
        data_dir.mkdir()
        extract_dir.mkdir()
        with pytest.raises(FileNotFoundError, match="goals.json"):
            load_profile(data_dir, extract_dir)

    def test_malformed_goals_raises_value_error(self, tmp_path):
        data_dir = tmp_path / "data"
        extract_dir = tmp_path / "extract"
        (data_dir / "profile").mkdir(parents=True)
        extract_dir.mkdir()
        (data_dir / "profile" / "goals.json").write_text("{bad json!!!", encoding="utf-8")
        with pytest.raises(ValueError):
            load_profile(data_dir, extract_dir)

    def test_empty_preferences_proceeds(self, tmp_path):
        data_dir = tmp_path / "data"
        extract_dir = tmp_path / "extract"
        (data_dir / "profile").mkdir(parents=True)
        extract_dir.mkdir()
        _write_json(data_dir / "profile" / "goals.json", _VALID_GOALS)
        _write_json(data_dir / "profile" / "preferences.json", {})
        profile = load_profile(data_dir, extract_dir)
        assert profile["preferences"] == {}

    def test_bom_prefixed_goals_handled(self, tmp_path):
        data_dir = tmp_path / "data"
        extract_dir = tmp_path / "extract"
        (data_dir / "profile").mkdir(parents=True)
        extract_dir.mkdir()
        # Prepend UTF-8 BOM character — some editors/exports add this
        bom_content = "﻿" + json.dumps(_VALID_GOALS)
        (data_dir / "profile" / "goals.json").write_text(bom_content, encoding="utf-8")
        profile = load_profile(data_dir, extract_dir)
        assert profile["goals"]["calories"] == 1200


# ── apply_goal_updates ────────────────────────────────────────────────────────

class TestApplyGoalUpdatesAdversarial:

    def _setup(self, tmp_path, goals=None, updates=None):
        data_dir = tmp_path / "data"
        extract_dir = tmp_path / "extract"
        (data_dir / "profile").mkdir(parents=True)
        (extract_dir / "profile").mkdir(parents=True)
        _write_json(data_dir / "profile" / "goals.json", goals or _VALID_GOALS)
        if updates is not None:
            _write_json(extract_dir / "profile" / "goal-updates.json", updates)
        return data_dir, extract_dir

    def test_empty_updates_list_returns_zero(self, tmp_path):
        data_dir, extract_dir = self._setup(tmp_path, updates=[])
        assert apply_goal_updates(data_dir, extract_dir) == 0

    def test_malformed_update_no_timestamp_skipped(self, tmp_path, capsys):
        # An update dict with no "timestamp" key should be skipped
        data_dir, extract_dir = self._setup(tmp_path, updates=[{"calories": 1400}])
        result = apply_goal_updates(data_dir, extract_dir)
        assert result == 0
        captured = capsys.readouterr()
        assert "WARNING" in captured.out or "skipping" in captured.out.lower()

    def test_conflicting_updates_last_write_wins(self, tmp_path):
        data_dir, extract_dir = self._setup(
            tmp_path,
            goals={"calories": {"daily": 1200}},
            updates=[
                {"timestamp": 1000, "calories": 1200},
                {"timestamp": 2000, "calories": 1400},
                {"timestamp": 3000, "calories": 1100},
            ],
        )
        n = apply_goal_updates(data_dir, extract_dir)
        assert n >= 1
        with open(data_dir / "profile" / "goals.json") as f:
            updated = json.load(f)
        # Last write (timestamp=3000) wins — calories.daily should be 1100
        cal = updated.get("calories")
        if isinstance(cal, dict):
            assert cal.get("daily") == 1100
        else:
            assert cal == 1100


# ── weight_typo ───────────────────────────────────────────────────────────────

class TestWeightTypoAdversarial:

    def test_value_zero_returns_note(self):
        result = weight_detect(0, [])
        assert result["correction_note"] is not None
        assert result["raw_value"] == 0

    def test_negative_value_returns_note(self):
        result = weight_detect(-5.0, [100.0, 101.0])
        assert result["correction_note"] is not None

    def test_last_5_days_empty_no_correction(self):
        result = weight_detect(150.0, [])
        assert result["corrected"] is False
        assert result["value"] == 150.0

    def test_last_5_days_all_none_no_correction(self):
        # None entries in the history list must not raise TypeError
        result = weight_detect(150.0, [None, None, None])
        assert result["corrected"] is False
        assert result["value"] == 150.0


# ── reconcile_entries ─────────────────────────────────────────────────────────

class TestReconcileEntriesAdversarial:

    def test_duplicate_ids_deduplicated(self, capsys):
        log = [
            {"id": "e1", "notes": "first"},
            {"id": "e1", "notes": "second"},  # duplicate — second kept
        ]
        new_entries, kept = reconcile(log, [])
        # Should only have one entry with id e1
        all_e1 = [e for e in new_entries + kept if e.get("id") == "e1"]
        assert len(all_e1) == 1
        assert all_e1[0].get("notes") == "second"
        captured = capsys.readouterr()
        assert "duplicate" in captured.out.lower() or "WARNING" in captured.out

    def test_existing_id_missing_from_log_is_dropped(self):
        log = [{"id": "e1", "notes": "kept"}]
        existing = [
            {"id": "e1", "calories": 200},
            {"id": "e2", "calories": 300},  # not in log — deleted
        ]
        new_entries, kept = reconcile(log, existing)
        all_ids = {e.get("id") for e in new_entries + kept}
        assert "e1" in all_ids
        assert "e2" not in all_ids

    def test_empty_log_existing_five_all_dropped(self):
        existing = [{"id": f"e{i}"} for i in range(5)]
        new_entries, kept = reconcile([], existing)
        assert new_entries == []
        assert kept == []

    def test_both_empty_returns_empty_tuple(self):
        new_entries, kept = reconcile([], [])
        assert new_entries == []
        assert kept == []


# ── fiber_split ───────────────────────────────────────────────────────────────

class TestFiberSplitAdversarial:

    def test_description_none_uses_default_split(self):
        entry = {"id": "e1", "fiber": 10, "description": None}
        estimate_split_inplace([entry])
        assert entry["solubleFiber"] + entry["insolubleFiber"] == pytest.approx(10.0, abs=0.2)
        # Default split is 25/75
        assert entry["solubleFiber"] == pytest.approx(2.5, abs=0.2)

    def test_fiber_zero_gives_zero_split(self):
        entry = {"id": "e1", "fiber": 0, "description": "oatmeal"}
        estimate_split_inplace([entry])
        assert entry["solubleFiber"] == 0.0
        assert entry["insolubleFiber"] == 0.0

    def test_fiber_999_sums_to_999(self):
        entry = {"id": "e1", "fiber": 999, "description": None}
        estimate_split_inplace([entry])
        total = entry["solubleFiber"] + entry["insolubleFiber"]
        assert total == pytest.approx(999.0, abs=0.5)

    def test_regex_special_chars_in_description_no_crash(self):
        # description with regex metacharacters should never raise
        entry = {"id": "e1", "fiber": 5, "description": "[test] (raw) broccoli + extras? $2.00"}
        estimate_split_inplace([entry])
        assert entry["solubleFiber"] + entry["insolubleFiber"] == pytest.approx(5.0, abs=0.2)


# ── compute_totals ────────────────────────────────────────────────────────────

class TestComputeTotalsAdversarial:

    def test_negative_macros_summed_correctly(self):
        entries = [
            {"calories": 300, "protein": 20},
            {"calories": -50, "protein": -5},  # e.g. correction entry
        ]
        totals = compute_totals(entries)
        assert totals["calories"] == pytest.approx(250.0)
        assert totals["protein"] == pytest.approx(15.0)

    def test_string_typed_numbers_coerced(self):
        entries = [{"calories": "200", "protein": "15", "carbs": "30", "fat": "5", "fiber": "3"}]
        totals = compute_totals(entries)
        assert totals["calories"] == pytest.approx(200.0)
        assert totals["protein"] == pytest.approx(15.0)

    def test_workout_entries_excluded_from_food_sums(self):
        entries = [
            {"type": "food", "calories": 400, "protein": 30},
            {"type": "workout", "calories": 999, "protein": 999},
            {"type": "exercise", "calories": 999, "protein": 999},
            {"type": "fitness", "calories": 999, "protein": 999},
        ]
        totals = compute_totals(entries)
        assert totals["calories"] == pytest.approx(400.0)
        assert totals["protein"] == pytest.approx(30.0)

    def test_empty_entries_all_zeros(self):
        totals = compute_totals([])
        assert totals["calories"] == 0.0
        assert totals["protein"] == 0.0
        assert totals["fiber"] == 0.0


# ── validate_schema ───────────────────────────────────────────────────────────

class TestValidateSchemaAdversarial:

    def test_em_dash_fails(self):
        output = _minimal_valid_output(highlights_text="Great run — keep it up")
        ok, violations = validate_schema(output)
        assert ok is False
        assert any("em-dash" in v.lower() or "bad char" in v.lower() for v in violations)

    def test_smart_quote_fails(self):
        output = _minimal_valid_output(highlights_text="“Excellent” work today")
        ok, violations = validate_schema(output)
        assert ok is False
        assert any("bad char" in v.lower() or "smart" in v.lower() for v in violations)

    def test_ingredient_sum_mismatch_by_3_fails(self):
        output = _minimal_valid_output()
        output["mealPlan"] = {
            "days": [{
                "meals": [{
                    "name": "Lunch",
                    "calories": 100,
                    "ingredients": [{"cal": 103}],  # off by 3 — outside ±2
                }]
            }]
        }
        ok, violations = validate_schema(output)
        assert ok is False
        assert any("103" in v or "ingredient" in v.lower() for v in violations)

    def test_ingredient_sum_within_2_passes(self):
        output = _minimal_valid_output()
        output["mealPlan"] = {
            "days": [{
                "meals": [{
                    "name": "Lunch",
                    "calories": 100,
                    "ingredients": [{"cal": 101}],  # off by 1 — within ±2
                }]
            }]
        }
        ok, violations = validate_schema(output)
        # This violation must NOT appear
        meal_violations = [v for v in violations if "ingredient" in v.lower()]
        assert meal_violations == []


# ── parse_claude_json ─────────────────────────────────────────────────────────

class TestParseClaudeJsonAdversarial:

    def test_non_json_stdout_raises_value_error(self):
        with pytest.raises(ValueError, match="not valid JSON"):
            parse_claude_json("this is not json at all")

    def test_no_result_key_raises_value_error(self):
        stdout = json.dumps({"type": "result", "subtype": "success"})  # no "result" key
        with pytest.raises(ValueError):
            parse_claude_json(stdout)

    def test_nested_fences_extracts_outer_correctly(self):
        # Outer JSON has a string field that contains a nested code fence
        inner = '```json {"inner": 2} ```'
        outer_obj = {"outer": 1, "note": inner}
        fenced_text = "```json\n" + json.dumps(outer_obj) + "\n```"
        stdout = json.dumps({"result": fenced_text})
        result = parse_claude_json(stdout)
        assert result["outer"] == 1
        assert result["note"] == inner

    def test_multiple_json_objects_takes_first(self):
        # Two fenced JSON blocks — first should be returned
        text = '```json {"first": 1} ``` extra text ```json {"second": 2} ```'
        stdout = json.dumps({"result": text})
        result = parse_claude_json(stdout)
        assert result.get("first") == 1
        assert "second" not in result
