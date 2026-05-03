"""
tone_validator.py — Rule-based coach tone checker.

NO LLM calls. Pure Python / stdlib regex.

Usage:
    result = validate("Great progress today! You hit 98g protein.")
    # -> {"ok": True, "violations": []}

    result = validate("Listen to your body!", context={"is_target_question": True})
    # -> {"ok": False, "violations": ["banned phrase: 'listen to your body'",
    #                                  "no numeric value in target question response"]}
"""

from __future__ import annotations
import re

# ---------------------------------------------------------------------------
# Banned phrases — case-insensitive substring match
# ---------------------------------------------------------------------------

_BANNED_PHRASES: list[str] = [
    "don't overthink it",
    "don't worry about it",
    "trust the process",
    "listen to your body",
    "carbs are the enemy",
    "hormones love this",
    "clean eating",
    "calories in calories out",
    "your body will thank you",
    "nourish your body",
    "mindful eating",
    "everything in moderation",
]

# ---------------------------------------------------------------------------
# Banned address terms — only when used as direct address (vocative)
# Pattern: term at start of text, after sentence-ending punct, or before/after comma.
# ---------------------------------------------------------------------------

_ADDRESS_TERMS = ["babe", "honey", "sweetie", "girl"]

def _build_address_pattern() -> re.Pattern:
    alts = "|".join(re.escape(t) for t in _ADDRESS_TERMS)
    return re.compile(
        r"""
        (?:
            (?:^|(?<=[.!?])\s+)         # start of text / new sentence
            (?:""" + alts + r""")
            (?=\s*[,!\s]|$)             # followed by comma, space, or end
        |
            ,\s*                        # after comma (trailing vocative)
            (?:""" + alts + r""")
            (?=\s*[,!.]?\s*$)           # at or near end of sentence
        |
            (?:""" + alts + r""")
            \s*,                        # before comma (leading vocative mid-text)
        )
        """,
        re.IGNORECASE | re.VERBOSE,
    )

_ADDRESS_RE = _build_address_pattern()

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_banned_phrases() -> list[str]:
    return list(_BANNED_PHRASES)


def is_banned_phrase(text: str) -> bool:
    """Return True if text contains any banned phrase."""
    lower = text.lower()
    return any(phrase in lower for phrase in _BANNED_PHRASES)


def validate(text: str, context: dict | None = None) -> dict:
    """Validate coach response tone.

    Returns {"ok": bool, "violations": list[str]}.

    Length violations (outside 30–500 chars) are included in violations but
    do not affect `ok` on their own — ok=False only when non-length violations exist.
    """
    violations: list[str] = []
    context = context or {}

    # --- Banned phrases ---
    lower = text.lower()
    for phrase in _BANNED_PHRASES:
        if phrase in lower:
            violations.append(f"banned phrase: '{phrase}'")

    # --- Banned address terms ---
    for m in _ADDRESS_RE.finditer(text):
        term = m.group(0).strip().strip(",").strip()
        violations.append(f"banned address term: '{term.lower()}'")

    # --- Digit check for target questions ---
    if context.get("is_target_question"):
        if not re.search(r"\d", text):
            violations.append("no numeric value in target question response")

    # --- Length check (soft — doesn't drive ok) ---
    length_violations: list[str] = []
    n = len(text)
    if n < 30:
        length_violations.append(f"response too short ({n} chars, min 30)")
    elif n > 500:
        length_violations.append(f"response too long ({n} chars, max 500)")

    all_violations = violations + length_violations
    ok = len(violations) == 0  # only hard violations affect ok

    return {"ok": ok, "violations": all_violations}
