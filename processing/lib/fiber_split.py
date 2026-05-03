"""
fiber_split.py — Soluble/insoluble fiber estimation from entry descriptions.

Uses a keyword lookup table. Mutates entries in-place adding
`solubleFiber` and `insolubleFiber` keys.

Ratios are (soluble_fraction, insoluble_fraction):
  psyllium       0.70 / 0.30
  chia           0.15 / 0.85
  oats           0.50 / 0.50
  edamame inner  0.35 / 0.65
  edamame pods   0.10 / 0.90
  artichoke      0.40 / 0.60
  broccoli       0.30 / 0.70
  leafy greens   0.20 / 0.80
  fruit whole    0.30 / 0.70
  vegetable skins 0.15 / 0.85

Default fallback for unknown: 0.25 / 0.75

NO LLM calls. Pure Python.
"""

from __future__ import annotations
import re

# (sol_fraction, insol_fraction, regex_pattern)
_RULES: list[tuple[float, float, re.Pattern]] = [
    (0.70, 0.30, re.compile(r'\bpsyllium\b', re.I)),
    (0.15, 0.85, re.compile(r'\bchia\b', re.I)),
    (0.50, 0.50, re.compile(r'\boats?\b|\boatmeal\b|\brolled oats?\b', re.I)),
    # edamame pods must come before inner; inner uses negative lookahead to avoid double-match
    (0.10, 0.90, re.compile(r'\bedamame\s+pods?\b|\bpod\s+edamame\b', re.I)),
    (0.35, 0.65, re.compile(r'\bedamame\b(?!\s+pods?)', re.I)),
    (0.40, 0.60, re.compile(r'\bartichoke\b', re.I)),
    (0.30, 0.70, re.compile(r'\bbroccoli\b', re.I)),
    (0.20, 0.80, re.compile(
        r'\bspinach\b|\bkale\b|\blettuce\b|\barugula\b|\bgreens?\b|\bcollard\b|\bchard\b', re.I
    )),
    (0.30, 0.70, re.compile(
        r'\bapple\b|\bpear\b|\bberry\b|\bberries\b|\bbanana\b|\borange\b|\bgrape\b|\bfruit\b', re.I
    )),
    (0.15, 0.85, re.compile(r'\bskin\b|\bpeel\b|\bvegetable\b|\bveggies?\b', re.I)),
]

_DEFAULT_SOL = 0.25
_DEFAULT_INSOL = 0.75


def estimate_split_inplace(entries: list[dict]) -> None:
    """Add solubleFiber and insolubleFiber keys to each entry with fiber > 0.

    Skips workout entries (type == 'workout') and entries with fiber == 0 or missing.
    For entries that match multiple rules, each rule gets equal fiber weight.
    """
    for entry in entries:
        fiber = entry.get("fiber", 0) or 0
        if fiber <= 0:
            entry.setdefault("solubleFiber", 0.0)
            entry.setdefault("insolubleFiber", 0.0)
            continue

        description = (
            entry.get("description", "")
            or entry.get("notes", "")
            or entry.get("name", "")
            or ""
        )

        matched_rules = [
            (sol, insol)
            for sol, insol, pattern in _RULES
            if pattern.search(description)
        ]

        if matched_rules:
            # Average the matched rules' ratios (each matched ingredient contributes equally)
            avg_sol = sum(r[0] for r in matched_rules) / len(matched_rules)
            avg_insol = sum(r[1] for r in matched_rules) / len(matched_rules)
        else:
            avg_sol = _DEFAULT_SOL
            avg_insol = _DEFAULT_INSOL

        entry["solubleFiber"] = round(fiber * avg_sol, 1)
        entry["insolubleFiber"] = round(fiber * avg_insol, 1)
