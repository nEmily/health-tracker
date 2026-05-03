"""
load_profile.py — Load and merge user profile from data_dir and extract_dir.

Reads:
  data_dir/profile/goals.json          (canonical, required)
  data_dir/profile/preferences.json    (optional)
  data_dir/profile/regimen.json        (optional)
  data_dir/profile/identity.md         (optional, raw text)
  data_dir/profile/current-stats.json  (optional)
  extract_dir/profile/pwa-profile.json (optional, phone-only echo)

DEPRECATED (explicitly NOT read): bio.txt, measurements.json

Returns a merged dict with a _ownership key documenting which file owns each section.
Calls goals_resolver.resolve() on goals before returning.

NO LLM calls. Pure Python / stdlib.
"""

from __future__ import annotations
import json
from pathlib import Path
from lib import goals_resolver


def load_profile(data_dir: Path, extract_dir: Path) -> dict:
    """Load and merge user profile.

    Args:
        data_dir:    Path to the user's canonical data directory.
        extract_dir: Path to the extracted ZIP from the phone upload.

    Returns:
        Merged profile dict with _ownership annotations.

    Raises:
        FileNotFoundError: if data_dir/profile/goals.json is missing.
    """
    profile: dict = {}
    ownership: dict[str, str] = {}

    # ── Required: goals ──────────────────────────────────────────────────────
    goals_path = data_dir / "profile" / "goals.json"
    if not goals_path.exists():
        raise FileNotFoundError(f"Required goals.json not found: {goals_path}")

    raw_goals = _read_json(goals_path)
    profile["goals"] = goals_resolver.resolve(raw_goals)
    profile["_raw_goals"] = raw_goals
    ownership["goals"] = str(goals_path)

    # ── Optional: preferences ────────────────────────────────────────────────
    prefs_path = data_dir / "profile" / "preferences.json"
    if prefs_path.exists():
        profile["preferences"] = _read_json(prefs_path)
        ownership["preferences"] = str(prefs_path)
    else:
        profile["preferences"] = {}

    # ── Optional: regimen ────────────────────────────────────────────────────
    regimen_path = data_dir / "profile" / "regimen.json"
    if regimen_path.exists():
        profile["regimen"] = _read_json(regimen_path)
        ownership["regimen"] = str(regimen_path)
    else:
        profile["regimen"] = None

    # ── Optional: identity.md (raw text) ─────────────────────────────────────
    identity_path = data_dir / "profile" / "identity.md"
    if identity_path.exists():
        profile["identity"] = identity_path.read_text(encoding="utf-8")
        ownership["identity"] = str(identity_path)
    else:
        profile["identity"] = None

    # ── Optional: current-stats.json ─────────────────────────────────────────
    stats_path = data_dir / "profile" / "current-stats.json"
    if stats_path.exists():
        profile["currentStats"] = _read_json(stats_path)
        ownership["currentStats"] = str(stats_path)
    else:
        profile["currentStats"] = None

    # ── Optional: phone pwa-profile.json (supplements, bodyPhotoTypes, etc.) ─
    pwa_profile_path = extract_dir / "profile" / "pwa-profile.json"
    if pwa_profile_path.exists():
        pwa_profile = _read_json(pwa_profile_path)
        profile["_phone_pwa_profile"] = pwa_profile
        ownership["_phone_pwa_profile"] = str(pwa_profile_path)

        # Phone-only sections that the processing side doesn't own
        for phone_only_key in ("supplements", "bodyPhotoTypes", "moreOptions"):
            if phone_only_key in pwa_profile:
                profile[phone_only_key] = pwa_profile[phone_only_key]
                ownership[phone_only_key] = str(pwa_profile_path)

        # Phone preferences overlay (data_dir prefs take precedence on conflict)
        phone_prefs = pwa_profile.get("preferences") or {}
        if phone_prefs:
            merged_prefs = {**phone_prefs, **profile["preferences"]}
            profile["preferences"] = merged_prefs
    else:
        profile["_phone_pwa_profile"] = None

    profile["_ownership"] = ownership
    return profile


def _read_json(path: Path) -> dict:
    # utf-8-sig strips UTF-8 BOM if present; behaves identically to utf-8 otherwise
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)
