"""
build_pwa_profile_echo.py — Build the pwaProfile.goals echo for analysis output.

The PWA receives this echo in every analysis result to keep its local goals
in sync with the canonical processing-side version.

Outputs BOTH:
  - rich shape (canonical nested structure)
  - narrow back-compat scalar fields (calories, protein, fiber, water_oz)

Phone-only sections (supplements, bodyPhotoTypes, moreOptions) come from
the extracted pwa-profile.json, not from data_dir canonical files.

data_dir preferences win over phone preferences on conflict.

NO LLM calls. Pure Python.
"""

from __future__ import annotations


def build(profile: dict, phone_pwa_profile: dict | None) -> dict:
    """Build pwaProfile echo dict for inclusion in analysis JSON.

    Args:
        profile:          Output of load_profile.load_profile()
        phone_pwa_profile: The raw pwa-profile.json from extract_dir, or None.

    Returns:
        dict suitable for analysis["pwaProfile"]
    """
    phone = phone_pwa_profile or {}
    resolved = profile.get("goals") or {}
    raw_goals = profile.get("_raw_goals") or {}

    # ── Goals echo — both shapes ──────────────────────────────────────────────
    goals_echo = _build_goals_echo(resolved, raw_goals)

    # ── Preferences — data_dir wins on conflict ───────────────────────────────
    phone_prefs = phone.get("preferences") or {}
    canonical_prefs = profile.get("preferences") or {}
    merged_prefs = {**phone_prefs, **canonical_prefs}

    # ── Phone-only sections ───────────────────────────────────────────────────
    supplements   = profile.get("supplements") or phone.get("supplements") or None
    body_types    = profile.get("bodyPhotoTypes") or phone.get("bodyPhotoTypes") or None
    more_options  = profile.get("moreOptions") or phone.get("moreOptions") or None

    echo: dict = {
        "goals": goals_echo,
        "preferences": merged_prefs,
    }
    if supplements is not None:
        echo["supplements"] = supplements
    if body_types is not None:
        echo["bodyPhotoTypes"] = body_types
    if more_options is not None:
        echo["moreOptions"] = more_options

    return echo


def _build_goals_echo(resolved: dict, raw_goals: dict) -> dict:
    """Build goals section with both narrow scalar and rich nested fields."""
    # Narrow back-compat scalars
    echo = {
        "calories": resolved.get("calories", 2000),
        "protein":  resolved.get("protein", 100),
        "fiber":    resolved.get("fiber", 25),
        "water_oz": resolved.get("water_oz", 64),
    }

    # Rich nested shape — mirrors canonical Goal schema
    cal = resolved.get("calories", 2000)
    echo["calories"] = {"daily": cal, "scalar": cal}  # both forms

    prot_floor   = resolved.get("protein_floor")
    prot_ceiling = resolved.get("protein_ceiling")
    prot_target  = resolved.get("protein", 100)

    echo["macros"] = {
        "protein": {
            "target":  prot_target,
            "floor":   prot_floor,
            "ceiling": prot_ceiling,
        }
    }

    fiber_target  = resolved.get("fiber", 25)
    fiber_floor   = resolved.get("fiber_floor_g")
    fiber_ceiling = resolved.get("fiber_ceiling_g")
    fiber_split   = resolved.get("fiber_track_split", False)

    echo["fiber"] = {
        "daily_g":    fiber_target,
        "floor_g":    fiber_floor,
        "ceiling_g":  fiber_ceiling,
        "trackSplit": fiber_split,
    }

    water_target = resolved.get("water_oz", 64)
    water_floor  = resolved.get("water_floor_oz")

    echo["water"] = {
        "daily_oz": water_target,
        "floor_oz": water_floor,
    }

    # Passthrough rich extras if present
    for key in ("weight", "body_composition", "transit", "hardcore"):
        val = resolved.get(key)
        if val is not None:
            echo[key] = val

    # Copy any other raw fields not handled above (forward compat)
    for k, v in raw_goals.items():
        if k not in echo:
            echo[k] = v

    return echo
