"""
data_grounding.py — Validates synthesis output only references today's entries.

Catches hallucination artifacts where the LLM blends yesterday's (or older)
entities into today's analysis without explicit temporal markers.

stdlib only: re, json (no third-party deps).
"""

from __future__ import annotations
import re

_COMMON_FOODS = frozenset({
    "salmon", "sablefish", "chicken", "beef", "pork", "shrimp", "edamame",
    "avocado", "broccoli", "eggs", "tuna", "kimchi", "rice", "oats", "chia",
    "psyllium", "tofu", "lentils", "beans",
})

_TEMPORAL_PATTERNS: list[re.Pattern] = [
    re.compile(
        r'\b(yesterday|earlier|last|this|previous)\s+'
        r'(week|month|year|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(yesterday'?s|last night|earlier today|this morning|"
        r"earlier this week|over the (?:week|weekend))\b",
        re.IGNORECASE,
    ),
    re.compile(r'\b\d{4}-\d{2}-\d{2}\b'),
    re.compile(r'\b\d+\s+days?\s+ago\b', re.IGNORECASE),
]

_NUMERICAL_PATTERN = re.compile(
    r'\b(\d+(?:\.\d+)?)\s*(g|cal|oz|lbs|kcal|calories|grams)\b',
    re.IGNORECASE,
)


def validate_grounding(
    synthesis_output: dict,
    today_entries: list,
    today_totals: dict,
    profile: dict,
) -> dict:
    """Check that synthesis output only references foods present in today's entries
    (or uses explicit temporal markers for anything from other days).

    Returns:
        {
            "ok": bool,
            "violations": list[str],
            "warnings": list[str],
            "suggested_retry_feedback": str,
        }
    """
    entity_keywords = _build_entity_keyword_set(profile)
    texts_to_check = _extract_texts(synthesis_output)

    violations: list[str] = []
    warnings: list[str] = []

    for text in texts_to_check:
        text_lower = text.lower()
        for entity in entity_keywords:
            if entity not in text_lower:
                continue
            # Entity is referenced — is it in today's entries?
            if _entity_in_today(entity, today_entries):
                continue  # PASS
            # Not in today: scan ±80 chars of context for a temporal marker
            if _has_temporal_marker_near(text, entity):
                continue  # PASS (explicitly marked as historical)
            violations.append(
                f"'{entity}' referenced without temporal marker and not in today's entries"
            )

    # Numerical grounding — warnings only, never fail
    for text in texts_to_check:
        for match in _NUMERICAL_PATTERN.finditer(text):
            number = float(match.group(1))
            unit = match.group(2).lower()
            if not _number_grounded(number, unit, today_totals, today_entries):
                warnings.append(
                    f"Numerical claim {match.group(0)!r} not found in today's totals/entries (±5%)"
                )

    retry_feedback = _build_retry_feedback(violations)

    return {
        "ok": len(violations) == 0,
        "violations": violations,
        "warnings": warnings,
        "suggested_retry_feedback": retry_feedback,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _build_entity_keyword_set(profile: dict) -> set[str]:
    """Union of hardcoded common foods + profile favorites + daily staples."""
    entities: set[str] = set(_COMMON_FOODS)
    prefs = profile.get("preferences") or {}
    dietary = prefs.get("dietary") or {}

    for key in ("favorites", "dailyStaples", "daily_staples"):
        items = dietary.get(key) or []
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, str) and item.strip():
                entities.add(item.strip().lower())
            elif isinstance(item, dict):
                name = item.get("name") or item.get("food") or ""
                if isinstance(name, str) and name.strip():
                    entities.add(name.strip().lower())

    return entities


def _entity_in_today(entity: str, today_entries: list) -> bool:
    """Return True if entity appears in any of today's entry name/notes/description."""
    entity_lower = entity.lower()
    for entry in today_entries:
        for field in ("name", "notes", "description"):
            val = entry.get(field)
            if isinstance(val, str) and entity_lower in val.lower():
                return True
    return False


def _extract_texts(synthesis_output: dict) -> list[str]:
    """Pull all text strings from highlights, concerns, and coachResponses."""
    texts: list[str] = []
    for item in synthesis_output.get("highlights") or []:
        if isinstance(item, str):
            texts.append(item)
    for item in synthesis_output.get("concerns") or []:
        if isinstance(item, str):
            texts.append(item)
    for resp in synthesis_output.get("coachResponses") or []:
        if isinstance(resp, dict):
            text = resp.get("text") or ""
            if text:
                texts.append(text)
    return texts


def _has_temporal_marker_near(text: str, entity: str) -> bool:
    """Check if a temporal marker exists within ±80 chars of the entity mention."""
    text_lower = text.lower()
    entity_lower = entity.lower()
    idx = text_lower.find(entity_lower)
    while idx != -1:
        start = max(0, idx - 80)
        end = min(len(text), idx + len(entity) + 80)
        context = text[start:end]
        for pattern in _TEMPORAL_PATTERNS:
            if pattern.search(context):
                return True
        idx = text_lower.find(entity_lower, idx + 1)
    return False


def _number_grounded(
    number: float,
    unit: str,
    today_totals: dict,
    today_entries: list,
) -> bool:
    """Return True if number appears in today's totals or entry macros (±5%)."""
    tolerance = 0.05

    for val in today_totals.values():
        if isinstance(val, (int, float)) and float(val) != 0:
            if abs(number - float(val)) / float(val) <= tolerance:
                return True

    for entry in today_entries:
        for key in ("calories", "protein", "fat", "fiber", "carbs", "value"):
            val = entry.get(key)
            if isinstance(val, (int, float)) and float(val) != 0:
                if abs(number - float(val)) / float(val) <= tolerance:
                    return True

    return False


def _build_retry_feedback(violations: list[str]) -> str:
    if not violations:
        return ""
    parts = []
    for v in violations:
        m = re.search(r"'([^']+)'", v)
        if m:
            entity = m.group(1)
            parts.append(
                f"You referenced '{entity}' which is not in today's entries. "
                f"Either remove the reference or add a temporal marker like "
                f"\"yesterday's {entity}\" or \"earlier this week's {entity}\"."
            )
    return " ".join(parts)
