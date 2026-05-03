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
    prompt = _build_prompt(entry, profile, photo_path)

    for attempt in range(2):
        result = _call_claude(prompt, model, photo_path)
        if result is None:
            continue

        violations = _validate_schema(result)
        if not violations:
            # Merge analyzed fields back onto original entry
            merged = {**entry, **result, "_reanalyzedAt": _now_ms()}
            return merged

        if attempt == 0:
            # First attempt failed schema — retry with violation feedback appended
            prompt = prompt + f"\n\nPREVIOUS ATTEMPT FAILED SCHEMA VALIDATION: {violations}\nPlease return a valid JSON object with all required fields."

    # Both attempts failed — return original with error annotation
    return {**entry, "_analysisError": "schema validation failed after retry"}


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

    Uses stdin (not shell-quoted arg) and --setting-sources user to avoid
    inheriting the coach-plugin agent pin which would restrict tools and
    trigger Coach startup behavior. CLAUDECODE="" defensive against parent env.
    """
    import os
    model_flag = _resolve_model_flag(model)
    # Use shell=True for cross-platform command resolution (claude is .cmd on Windows).
    # Pass prompt via stdin to avoid shell quoting issues with embedded quotes/newlines.
    cmd = (
        f"claude -p --setting-sources user --dangerously-skip-permissions "
        f"--output-format json --model {model_flag}"
    )
    env = {**os.environ, "CLAUDECODE": ""}

    if photo_path and photo_path.exists():
        # claude -p currently does not have a --file flag for photos — the prompt
        # already mentions the filename; actual image analysis requires the API.
        pass

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
