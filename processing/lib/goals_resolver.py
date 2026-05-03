"""
goals_resolver.py — Deterministic goal normalization and status helpers.

Mirrors the JS schema-tolerance logic in score.js / goals.js.
NO LLM calls. Pure Python.

Canonical resolved shape (flat dict):
  calories, protein, fiber, water_oz            — scalars (backward compat)
  protein_floor, protein_ceiling                — scalar or None
  fiber_floor_g, fiber_ceiling_g                — scalar or None
  fiber_track_split                             — bool
  water_floor_oz                                — scalar or None
  weight, body_composition, transit, hardcore   — passthrough dicts or None
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
_DEFAULT_CALORIES = 2000
_DEFAULT_PROTEIN  = 100
_DEFAULT_FIBER    = 25
_DEFAULT_WATER_OZ = 64


# ---------------------------------------------------------------------------
# resolve
# ---------------------------------------------------------------------------

def resolve(raw: dict) -> dict:
    """Normalize any goals shape to the canonical flat resolved dict.

    Handles:
      - narrow shape: {calories: 850, protein: 85, fiber: 20, water_oz: 64}
      - rich shape:   {calories: {daily: 850}, macros: {protein: {target: 85}}, ...}
      - already-resolved: idempotent, resolve(resolve(x)) == resolve(x)
    """
    if not raw:
        raw = {}

    # --- calories ---
    cal = raw.get("calories")
    if isinstance(cal, dict):
        calories = _num(cal.get("daily") or cal.get("target"), _DEFAULT_CALORIES)
    else:
        calories = _num(cal, _DEFAULT_CALORIES)

    # --- protein ---
    macros = raw.get("macros") or {}
    protein_obj = macros.get("protein") or {}

    protein = _num(
        raw.get("protein")
        or protein_obj.get("target")
        or protein_obj.get("grams"),
        _DEFAULT_PROTEIN,
    )
    protein_floor = _num_or_none(
        raw.get("protein_floor") or protein_obj.get("floor")
    )
    protein_ceiling = _num_or_none(
        raw.get("protein_ceiling") or protein_obj.get("ceiling")
    )

    # --- fiber ---
    fiber_raw = raw.get("fiber")
    if isinstance(fiber_raw, dict):
        fiber       = _num(fiber_raw.get("daily_g") or fiber_raw.get("target"), _DEFAULT_FIBER)
        fiber_floor   = _num_or_none(fiber_raw.get("floor_g"))
        fiber_ceiling = _num_or_none(fiber_raw.get("ceiling_g"))
        fiber_split   = bool(fiber_raw.get("trackSplit") or fiber_raw.get("track_split"))
    else:
        fiber = _num(
            raw.get("fiber_g")
            or (fiber_raw if isinstance(fiber_raw, (int, float)) else None),
            _DEFAULT_FIBER,
        )
        fiber_floor   = _num_or_none(raw.get("fiber_floor_g"))
        fiber_ceiling = _num_or_none(raw.get("fiber_ceiling_g"))
        fiber_split   = bool(raw.get("fiber_track_split") or raw.get("fiber_trackSplit"))

    # --- water ---
    water_raw = raw.get("water")
    if isinstance(water_raw, dict):
        water_oz      = _num(water_raw.get("daily_oz") or water_raw.get("target_oz"), _DEFAULT_WATER_OZ)
        water_floor   = _num_or_none(water_raw.get("floor_oz"))
    else:
        water_oz    = _num(raw.get("water_oz"), _DEFAULT_WATER_OZ)
        water_floor = _num_or_none(raw.get("water_floor_oz"))

    # --- passthrough rich extras ---
    weight           = raw.get("weight") or None
    body_composition = raw.get("bodyComposition") or raw.get("body_composition") or None
    transit          = raw.get("transit") or None
    hardcore         = raw.get("hardcore") or None

    return {
        # backward-compat scalars
        "calories":          calories,
        "protein":           protein,
        "fiber":             fiber,
        "water_oz":          water_oz,
        # extended floor / ceiling
        "protein_floor":     protein_floor,
        "protein_ceiling":   protein_ceiling,
        "fiber_floor_g":     fiber_floor,
        "fiber_ceiling_g":   fiber_ceiling,
        "fiber_track_split": fiber_split,
        "water_floor_oz":    water_floor,
        # rich-shape passthrough
        "weight":            weight,
        "body_composition":  body_composition,
        "transit":           transit,
        "hardcore":          hardcore,
    }


# ---------------------------------------------------------------------------
# Status helpers
# ---------------------------------------------------------------------------

def protein_status(actual: float, resolved: dict) -> str:
    """Return 'low' | 'on_track' | 'high'."""
    target = resolved["protein"]
    floor  = resolved.get("protein_floor") or 0

    if actual >= target:
        return "high"
    if actual >= floor:
        return "on_track"
    return "low"


def fiber_status(actual: float, resolved: dict) -> str:
    """Return 'low' | 'on_track' | 'high'."""
    floor   = resolved.get("fiber_floor_g") or 0
    ceiling = resolved.get("fiber_ceiling_g")  # None = no upper bound

    if ceiling is not None and actual > ceiling:
        return "high"
    if actual >= floor:
        return "on_track"
    return "low"


def calories_status(actual: float, resolved: dict) -> str:
    """Return 'under' | 'on_track' | 'over'."""
    target = resolved["calories"]
    diff   = actual - target

    if diff > 150:
        return "over"
    if diff < -150:
        return "under"
    return "on_track"


def water_status(actual_oz: float, resolved: dict) -> str:
    """Return 'under' | 'on_track' | 'high'."""
    target = resolved["water_oz"]
    floor  = resolved.get("water_floor_oz") or 0

    if actual_oz >= target:
        return "high"
    if actual_oz >= floor:
        return "on_track"
    return "under"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _num(value, default: float) -> float:
    """Return value as float if numeric, else default."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return default


def _num_or_none(value) -> float | None:
    """Return value as float if numeric, else None."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return None
