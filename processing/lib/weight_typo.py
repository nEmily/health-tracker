"""
weight_typo.py — Detect obvious weight-entry typos from process-day-prompt.md rules.

Rules implemented:
  1. Missing decimal: value is ~10x larger than recent median (e.g. 1012 entered instead of 101.2)
  2. Impossible values: weight < 50 lbs or > 500 lbs

Does NOT auto-correct normal fluctuations (day-to-day variation of ±5 lbs is normal).
NO LLM calls. Pure Python.
"""

from __future__ import annotations
import statistics


def detect(today_value: float, last_5_days: list[float]) -> dict:
    """Detect weight typos.

    Args:
        today_value: Weight entered today (lbs).
        last_5_days: Up to 5 recent daily weights in chronological order (oldest first).
                     May be empty.

    Returns dict with:
        value         — corrected value (or original if no correction)
        unit          — always "lbs"
        raw_value     — original input
        corrected     — True if a correction was applied
        correction_note — human-readable explanation, or None
    """
    result = {
        "value": today_value,
        "unit": "lbs",
        "raw_value": today_value,
        "corrected": False,
        "correction_note": None,
    }

    # Rule 1: impossible range
    if today_value < 50 or today_value > 500:
        # Attempt decimal-shift correction only if we have a reference
        corrected = _try_decimal_shift(today_value, last_5_days)
        if corrected is not None:
            result["value"] = corrected
            result["corrected"] = True
            result["correction_note"] = (
                f"Impossible value {today_value} lbs corrected to {corrected} lbs "
                f"(likely missing decimal point)"
            )
        else:
            result["correction_note"] = (
                f"Impossible value {today_value} lbs — please verify"
            )
        return result

    # Rule 2: 10x range check against recent median
    if last_5_days:
        valid_recent = [v for v in last_5_days if isinstance(v, (int, float)) and 50 <= v <= 500]
        if valid_recent:
            median = statistics.median(valid_recent)
            if median > 0 and today_value / median > 8:
                # Looks like missing decimal — e.g. 1012 vs 101.2
                corrected = today_value / 10
                if abs(corrected - median) / median < 0.15:
                    result["value"] = corrected
                    result["corrected"] = True
                    result["correction_note"] = (
                        f"Value {today_value} appears to be missing a decimal — "
                        f"corrected to {corrected} lbs based on recent trend ({median:.1f} lbs)"
                    )

    return result


def _try_decimal_shift(value: float, reference_days: list[float]) -> float | None:
    """Return value/10 if it's plausible given recent data, else None."""
    if not reference_days:
        return None
    valid = [v for v in reference_days if isinstance(v, (int, float)) and 50 <= v <= 500]
    if not valid:
        return None
    median = statistics.median(valid)
    shifted = value / 10
    if 50 <= shifted <= 500 and abs(shifted - median) / median < 0.15:
        return shifted
    return None
