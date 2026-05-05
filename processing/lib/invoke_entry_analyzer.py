"""
invoke_entry_analyzer.py — Analyze a single food entry via claude -p (Haiku).

Builds a ~30-line focused prompt, calls claude -p, parses the JSON result.
Retries once on schema violation.

LLM calls: YES (Haiku per entry, parallelized by orchestrator).
"""

from __future__ import annotations
import json
import subprocess
from pathlib import Path
from lib.parse_claude_json import parse_claude_json

_REQUIRED_FIELDS = ("description", "calories", "protein", "carbs", "fat", "fiber")
_DEFAULT_MODEL = "haiku"

# Types where LLM analysis adds nothing — zero calories by definition.
# NOTE: supplement is intentionally excluded — some supplements (creatine, fiber)
# have meaningful nutrition that Haiku can extract.
ZERO_CAL_TYPES = {"bodyPhoto", "weight", "bm"}


def _salvage_best_effort(entry: dict, last_result: dict | None) -> dict:
    """Last-resort fallback when all 3 Haiku attempts fail validation.

    Goal: never silent-fail with 0-cal on a meal/snack/drink entry that the
    user clearly logged. Salvage anything usable from the last (invalid) LLM
    response, fill in type-based defaults for the rest. The user can correct
    in-app; coach should mention totals are estimates. Crucially, the
    _reanalyzeRequested flag is set on this entry so the NEXT cron tick
    will retry from scratch with the same (or corrected) input.
    """
    type_defaults = {
        "meal":  {"calories": 400, "protein": 20, "carbs": 40, "fat": 15, "fiber": 4},
        "snack": {"calories": 150, "protein": 5,  "carbs": 20, "fat": 6,  "fiber": 2},
        "drink": {"calories": 100, "protein": 2,  "carbs": 15, "fat": 0,  "fiber": 0},
        "supplement": {"calories": 30,  "protein": 5, "carbs": 1, "fat": 1, "fiber": 3},
        "workout": {"calories": -200, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0},
    }
    defaults = type_defaults.get(entry.get("type"), type_defaults["meal"])
    description = (
        (last_result.get("description") if isinstance(last_result, dict) else None)
        or entry.get("notes")
        or f"{entry.get('type', 'entry').capitalize()} (estimated)"
    )
    salvaged = {**entry, **defaults}
    # Override numeric fields from last_result, but ONLY if they're plausible:
    # numeric AND non-zero. The LLM occasionally returns calories=0 for
    # entries it can't parse (e.g., empty plate photo); using that would
    # silent-fail the salvage. Default type-based estimates are better.
    if isinstance(last_result, dict):
        for k in ("calories", "protein", "carbs", "fat", "fiber"):
            v = last_result.get(k)
            if isinstance(v, (int, float)) and v > 0:
                salvaged[k] = v
    salvaged["description"] = description
    salvaged["confidence"] = "low"
    salvaged["breakdown"] = []
    salvaged["solubleFiber"] = 0.0
    salvaged["insolubleFiber"] = 0.0
    return salvaged


def _build_zero_cal_entry(entry: dict) -> dict:
    """Return a zero-macro analysis result without calling the LLM."""
    et = entry.get("type", "")
    default_desc = {
        "bodyPhoto": f"Body photo ({entry.get('subtype', 'body')})",
        "weight": f"Body weight: {entry.get('value') or entry.get('notes', '?')}",
        "bm": "Bowel movement",
    }.get(et, "Entry")
    return {
        **entry,
        "description": entry.get("description") or default_desc,
        "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0,
        "solubleFiber": 0.0, "insolubleFiber": 0.0,
        "confidence": "high", "breakdown": [],
        "_reanalyzedAt": _now_ms(),
    }


def analyze(
    entry: dict,
    profile: dict,
    photo_path: Path | None = None,
    model: str = _DEFAULT_MODEL,
) -> dict:
    """Analyze a food entry using claude -p.

    Args:
        entry:      Log entry dict (has notes, type, id, etc.)
        profile:    Loaded profile from load_profile.load_profile()
        photo_path: Path to the photo file if available.
        model:      Claude model shortname (haiku, sonnet, opus).

    Returns:
        Analyzed entry dict with calories, protein, carbs, fat, fiber, description, etc.
        On failure after retry, returns the original entry with an _analysisError key.
    """
    if entry.get("type") in ZERO_CAL_TYPES:
        return _build_zero_cal_entry(entry)

    prompt = _build_prompt(entry, profile, photo_path)

    last_violations = None
    last_result = None
    for attempt in range(3):
        result = _call_claude(prompt, model, photo_path)
        if result is None:
            continue

        violations = _validate_schema(result)
        if not violations:
            merged = {**entry, **result, "_reanalyzedAt": _now_ms()}
            return merged

        last_violations = violations
        last_result = result
        if attempt == 0:
            prompt = prompt + (
                f"\n\nPREVIOUS ATTEMPT FAILED SCHEMA VALIDATION: {violations}\n"
                "Please return a valid JSON object with all required fields."
            )
        elif attempt == 1:
            # Last-resort prompt: force best-effort with explicit instruction.
            # Common failure: vague notes ('1 serving', empty) + ambiguous photo
            # → LLM hedges or returns prose. We accept any plausible estimate
            # rather than 0-cal silent fail; user can correct via edit.
            prompt = (
                prompt
                + "\n\nLAST CHANCE: This is your final attempt. Return valid JSON "
                "matching the schema EVEN IF the photo is unclear or notes are "
                "vague. Make a reasonable best-guess estimate (use the entry "
                "type as a hint -- meals average 300-500 cal, snacks 100-200 cal, "
                "drinks 50-200 cal). Set confidence='low' to flag the guess. "
                "Required fields: description, calories, protein, carbs, fat, "
                "fiber. Numbers must be numeric (not strings). Do not return "
                "prose or markdown -- only the JSON object."
            )

    # All 3 attempts failed schema. As an absolute fallback, salvage whatever
    # we can from the last LLM result (description if it gave one, type-based
    # cal estimate). This prevents 0-cal silent fail. Mark _analysisFallback
    # so coach can flag it gently in passing.
    fallback = _salvage_best_effort(entry, last_result)
    fallback["_analysisError"] = f"schema_violations: {last_violations}" if last_violations else "no_response"
    # Set _reanalyzeRequested but NOT _reanalyzedAt — so reconcile_entries
    # treats this as needing re-analysis on the next cron tick (the
    # `reanalyzed_at > updated_at` check in reconcile fails when
    # _reanalyzedAt is missing, routing the entry back to new_to_analyze).
    fallback["_reanalyzeRequested"] = True
    return fallback


def _build_prompt(entry: dict, profile: dict, photo_path: Path | None) -> str:
    goals = profile.get("goals") or {}
    prefs = profile.get("preferences") or {}

    notes = (entry.get("notes") or entry.get("description") or "").strip()
    entry_type = entry.get("type", "food")

    # Extract context from profile (tolerate both flat and nested `dietary.*` shapes)
    dietary = prefs.get("dietary") or {}
    favorites = prefs.get("favorites") or dietary.get("favorites") or []
    daily_staples = prefs.get("dailyStaples") or prefs.get("daily_staples") or dietary.get("dailyStaples") or []
    tuna_rules = prefs.get("tunaFlavoringRules") or prefs.get("tuna_rules") or ""
    edamame_rule = prefs.get("edamameRule") or prefs.get("edamame_rule") or ""

    # Tolerate both list (favorites: ["salmon", ...]) and dict (dailyStaples: {proteinShake: {...}})
    def _as_names(v, limit=10):
        if isinstance(v, dict):
            items = list(v.values())[:limit]
            return [it.get("name", k) for k, it in zip(list(v.keys())[:limit], items) if isinstance(it, dict)] or list(v.keys())[:limit]
        if isinstance(v, list):
            return [str(x) for x in v[:limit]]
        return []

    fav_names = _as_names(favorites)
    staple_names = _as_names(daily_staples)
    favorites_str = ", ".join(fav_names) if fav_names else "none noted"
    staples_str = ", ".join(staple_names) if staple_names else "none noted"

    photo_note = ""
    if photo_path and photo_path.exists():
        photo_note = f"\nPhoto provided: {photo_path.name} — analyze visually for portion size and ingredients."

    prompt = f"""Analyze this food entry and return ONLY a JSON object (no markdown fences, no extra text).

Entry type: {entry_type}
User notes: {notes or "(none)"}
{photo_note}

User context:
- Favorites: {favorites_str}
- Daily staples: {staples_str}
{f'- Tuna flavoring rules: {tuna_rules}' if tuna_rules else ''}
{f'- Edamame note: {edamame_rule}' if edamame_rule else ''}
- IMPORTANT: Always over-count calories when uncertain. Round up.

Required JSON fields:
{{
  "description": "brief human-readable label for this entry",
  "calories": <integer, total kcal — round up when uncertain>,
  "protein": <integer, grams>,
  "carbs": <integer, grams>,
  "fat": <integer, grams>,
  "fiber": <integer, grams>,
  "confidence": "high|medium|low",
  "breakdown": [
    {{"item": "ingredient name", "grams": 0, "cal": 0, "protein": 0}}
  ]
}}

If this is not a food entry (workout, water, etc.) return the same shape with 0 for all macros
and describe what it is.
"""
    return prompt


def _call_claude(prompt: str, model: str, photo_path: Path | None) -> dict | None:
    """Invoke claude -p and return parsed dict, or None on subprocess/parse error.

    Photo handling: claude -p does NOT support inline image input directly,
    but it CAN use the Read tool to open a file at an absolute path. So when
    a photo is provided, we (1) inject the absolute path into the prompt
    with an instruction to Read it, and (2) enable the Read tool via
    --allowedTools so the subprocess can actually open the image.

    Without this, photo-only meals (e.g. notes='1 serving' + photo) silently
    fail because Haiku is asked to analyze an image it can't see.
    """
    import os
    model_flag = _resolve_model_flag(model)

    # Build the command. Always allow Read so the LLM can open photos when present.
    allowed_tools = "Read"
    cmd = (
        f"claude -p --setting-sources user --dangerously-skip-permissions "
        f"--output-format json --model {model_flag} "
        f'--allowedTools "{allowed_tools}"'
    )
    env = {**os.environ, "CLAUDECODE": ""}

    # If a photo is available, prepend an instruction with the absolute path
    # so Haiku reads it before estimating macros.
    if photo_path and photo_path.exists():
        abs_path = str(photo_path.resolve())
        prompt = (
            f"FIRST: use the Read tool to open this photo at the absolute path "
            f"below, so you can see what's in the meal. Then estimate macros "
            f"based on what you observe in the image plus the user notes.\n"
            f"Photo path: {abs_path}\n\n"
            + prompt
        )

    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
            env=env,
            shell=True,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        return parse_claude_json(result.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return None


def _validate_schema(result: dict) -> list[str]:
    """Return list of schema violations (empty = valid)."""
    violations = []
    for field in _REQUIRED_FIELDS:
        if field not in result:
            violations.append(f"missing field: {field}")
    for int_field in ("calories", "protein", "carbs", "fat", "fiber"):
        if int_field in result and not isinstance(result[int_field], (int, float)):
            violations.append(f"field {int_field} must be numeric")
    return violations


def _resolve_model_flag(model: str) -> str:
    _MODEL_MAP = {
        "haiku":  "claude-haiku-4-5-20251001",
        "sonnet": "claude-sonnet-4-6",
        "opus":   "claude-opus-4-7",
    }
    return _MODEL_MAP.get(model.lower(), model)


def _shell_quote(s: str) -> str:
    """Minimal shell quoting — wrap in single quotes, escape internal singles."""
    s = s.replace("'", "'\\''")
    return f"'{s}'"


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)
