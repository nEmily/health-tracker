"""Tests for lib.goals_resolver — normalization, status helpers, edge cases."""

import copy
import pytest
from lib.goals_resolver import (
    resolve,
    protein_status,
    fiber_status,
    calories_status,
    water_status,
)


# ---------------------------------------------------------------------------
# resolve — narrow shape (legacy phone)
# ---------------------------------------------------------------------------

class TestNarrowShape:
    def test_bare_scalars(self):
        r = resolve({"calories": 850, "protein": 85, "fiber": 20, "water_oz": 60})
        assert r["calories"] == 850
        assert r["protein"] == 85
        assert r["fiber"] == 20
        assert r["water_oz"] == 60

    def test_defaults_when_empty(self):
        r = resolve({})
        assert r["calories"] == 2000
        assert r["protein"] == 100
        assert r["fiber"] == 25
        assert r["water_oz"] == 64

    def test_defaults_when_none(self):
        r = resolve(None)
        assert r["calories"] == 2000

    def test_floor_ceiling_absent_returns_none(self):
        r = resolve({"calories": 1200, "protein": 90})
        assert r["protein_floor"] is None
        assert r["protein_ceiling"] is None
        assert r["fiber_floor_g"] is None
        assert r["fiber_ceiling_g"] is None
        assert r["water_floor_oz"] is None


# ---------------------------------------------------------------------------
# resolve — rich shape (canonical nested)
# ---------------------------------------------------------------------------

class TestRichShape:
    def test_calories_daily_nested(self):
        r = resolve({"calories": {"daily": 1200}})
        assert r["calories"] == 1200

    def test_macros_protein_target(self):
        r = resolve({"macros": {"protein": {"target": 95, "floor": 70, "ceiling": 130}}})
        assert r["protein"] == 95
        assert r["protein_floor"] == 70
        assert r["protein_ceiling"] == 130

    def test_macros_protein_grams_fallback(self):
        r = resolve({"macros": {"protein": {"grams": 88}}})
        assert r["protein"] == 88

    def test_fiber_dict(self):
        r = resolve({"fiber": {"daily_g": 30, "floor_g": 18, "ceiling_g": 50, "trackSplit": True}})
        assert r["fiber"] == 30
        assert r["fiber_floor_g"] == 18
        assert r["fiber_ceiling_g"] == 50
        assert r["fiber_track_split"] is True

    def test_water_dict(self):
        r = resolve({"water": {"daily_oz": 80, "floor_oz": 48}})
        assert r["water_oz"] == 80
        assert r["water_floor_oz"] == 48

    def test_passthrough_weight(self):
        goals = {"calories": 1500, "weight": {"floor": 95.0, "goal": 90.0}}
        r = resolve(goals)
        assert r["weight"] == {"floor": 95.0, "goal": 90.0}

    def test_passthrough_body_composition(self):
        bc = {"bf_pct": 22, "target_bf": 18}
        r = resolve({"bodyComposition": bc})
        assert r["body_composition"] == bc


# ---------------------------------------------------------------------------
# resolve — idempotency
# ---------------------------------------------------------------------------

class TestIdempotency:
    def test_narrow_idempotent(self):
        raw = {"calories": 1000, "protein": 80, "fiber": 22, "water_oz": 56}
        once = resolve(raw)
        twice = resolve(once)
        assert once == twice

    def test_rich_idempotent(self):
        raw = {
            "calories": {"daily": 1400},
            "macros": {"protein": {"target": 110, "floor": 85, "ceiling": 150}},
            "fiber": {"daily_g": 28, "floor_g": 15, "ceiling_g": 60},
            "water": {"daily_oz": 72, "floor_oz": 48},
        }
        once = resolve(raw)
        twice = resolve(once)
        assert once == twice

    def test_empty_idempotent(self):
        once = resolve({})
        twice = resolve(once)
        assert once == twice


# ---------------------------------------------------------------------------
# Status boundary values
# ---------------------------------------------------------------------------

class TestProteinStatus:
    def setup_method(self):
        self.r = resolve({"protein": 100, "macros": {"protein": {"floor": 80}}})

    def test_high_at_target(self):
        assert protein_status(100, self.r) == "high"

    def test_high_above_target(self):
        assert protein_status(120, self.r) == "high"

    def test_on_track_at_floor(self):
        assert protein_status(80, self.r) == "on_track"

    def test_on_track_between_floor_and_target(self):
        assert protein_status(90, self.r) == "on_track"

    def test_low_below_floor(self):
        assert protein_status(79, self.r) == "low"

    def test_low_at_zero(self):
        assert protein_status(0, self.r) == "low"

    def test_no_floor_on_track(self):
        r = resolve({"protein": 100})
        assert protein_status(1, r) == "on_track"  # floor defaults to 0


class TestFiberStatus:
    def setup_method(self):
        self.r = resolve({"fiber": {"daily_g": 25, "floor_g": 15, "ceiling_g": 50}})

    def test_high_above_ceiling(self):
        assert fiber_status(51, self.r) == "high"

    def test_on_track_at_ceiling(self):
        assert fiber_status(50, self.r) == "on_track"

    def test_on_track_at_floor(self):
        assert fiber_status(15, self.r) == "on_track"

    def test_low_below_floor(self):
        assert fiber_status(14, self.r) == "low"

    def test_no_ceiling_never_high(self):
        r = resolve({"fiber": {"daily_g": 25, "floor_g": 10}})
        assert fiber_status(9999, r) == "on_track"


class TestCaloriesStatus:
    def setup_method(self):
        self.r = resolve({"calories": 1200})

    def test_on_track_exact(self):
        assert calories_status(1200, self.r) == "on_track"

    def test_on_track_plus_150(self):
        assert calories_status(1350, self.r) == "on_track"

    def test_over_at_1351(self):
        assert calories_status(1351, self.r) == "over"

    def test_on_track_minus_150(self):
        assert calories_status(1050, self.r) == "on_track"

    def test_under_at_1049(self):
        assert calories_status(1049, self.r) == "under"

    def test_under_zero(self):
        assert calories_status(0, self.r) == "under"

    def test_over_very_high(self):
        assert calories_status(5000, self.r) == "over"


class TestWaterStatus:
    def setup_method(self):
        self.r = resolve({"water": {"daily_oz": 64, "floor_oz": 32}})

    def test_high_at_target(self):
        assert water_status(64, self.r) == "high"

    def test_high_above_target(self):
        assert water_status(80, self.r) == "high"

    def test_on_track_at_floor(self):
        assert water_status(32, self.r) == "on_track"

    def test_on_track_between_floor_and_target(self):
        assert water_status(48, self.r) == "on_track"

    def test_under_below_floor(self):
        assert water_status(31, self.r) == "under"

    def test_under_zero(self):
        assert water_status(0, self.r) == "under"

    def test_no_floor_on_track(self):
        r = resolve({"water_oz": 64})
        assert water_status(1, r) == "on_track"  # floor defaults to 0


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_zero_values_use_defaults(self):
        # Zero is falsy — should fall through to defaults
        r = resolve({"calories": 0, "protein": 0, "fiber": 0, "water_oz": 0})
        # 0 is a valid number so it IS used (not replaced by default)
        # ...actually 0 for calories makes no sense, but the function should respect it
        # Per _num: 0 is a valid float, so it returns 0, not the default
        assert r["calories"] == 0

    def test_null_body_comp_transit(self):
        r = resolve({"bodyComposition": None, "transit": None})
        assert r["body_composition"] is None
        assert r["transit"] is None

    def test_fiber_track_split_camel(self):
        r = resolve({"fiber": {"daily_g": 25, "trackSplit": True}})
        assert r["fiber_track_split"] is True

    def test_fiber_track_split_snake(self):
        r = resolve({"fiber_track_split": True})
        assert r["fiber_track_split"] is True

    def test_calories_target_alias(self):
        r = resolve({"calories": {"target": 1500}})
        assert r["calories"] == 1500

    def test_water_target_oz_alias(self):
        r = resolve({"water": {"target_oz": 70}})
        assert r["water_oz"] == 70
