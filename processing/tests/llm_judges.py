"""
llm_judges.py — LLM-based evaluation judges for T13 (voice fidelity) and T17 (persona consistency).

Both judges:
- Read coach-plugin/agents/coach.md lines 50-104 (the "Coach — Soul" section) for calibration
- Build a focused prompt embedding the soul + inputs
- Call claude -p --model sonnet --output-format json (or return stub when COACH_STUB_LLM=1)
- Parse result via lib.parse_claude_json

stdlib only (subprocess, json, re, os, sys, pathlib).
"""

from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_COACH_MD = _REPO_ROOT / "coach-plugin" / "agents" / "coach.md"
_PROCESSING_DIR = Path(__file__).resolve().parent.parent
if str(_PROCESSING_DIR) not in sys.path:
    sys.path.insert(0, str(_PROCESSING_DIR))

from lib.parse_claude_json import parse_claude_json  # noqa: E402

_STUB_LLM = os.environ.get("COACH_STUB_LLM") == "1"

_SOUL_CACHE: str | None = None


def _load_coach_soul() -> str:
    global _SOUL_CACHE
    if _SOUL_CACHE is not None:
        return _SOUL_CACHE
    if not _COACH_MD.exists():
        return "(Coach soul not found — agent.md missing)"
    lines = _COACH_MD.read_text(encoding="utf-8").splitlines()
    soul_lines: list[str] = []
    in_soul = False
    for i, line in enumerate(lines):
        lineno = i + 1
        if lineno < 50:
            continue
        if lineno > 104:
            break
        if lineno == 50:
            in_soul = True
        if in_soul:
            soul_lines.append(line)
    _SOUL_CACHE = "\n".join(soul_lines)
    return _SOUL_CACHE


def _call_claude_raw(prompt: str):
    """Call claude -p --model sonnet --output-format json and return parsed inner value.

    Returns the parsed inner JSON (may be list or dict).
    """
    proc = subprocess.run(
        ["claude", "-p", "--model", "claude-sonnet-4-6", "--output-format", "json"],
        input=prompt,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude returned {proc.returncode}: {proc.stderr[:500]}")

    import json as _json
    try:
        envelope = _json.loads(proc.stdout)
    except _json.JSONDecodeError:
        raise RuntimeError(f"claude output is not valid JSON: {proc.stdout[:200]}")

    if not isinstance(envelope, dict):
        raise RuntimeError(f"claude envelope is not a dict: {type(envelope).__name__}")

    result_text = envelope.get("result", "")
    if isinstance(result_text, (list, dict)):
        return result_text

    if isinstance(result_text, str):
        result_text = result_text.strip()
        # Strip fences if present
        import re as _re
        m = _re.search(r'```(?:json)?\s*([\s\S]+?)\s*```', result_text)
        if m:
            result_text = m.group(1).strip()
        return _json.loads(result_text)

    raise RuntimeError(f"Cannot parse claude result: {str(result_text)[:200]}")


def voice_fidelity_judge(pairs: list[dict]) -> list[dict]:
    """Evaluate side-by-side coach response pairs for voice fidelity (T13).

    Args:
        pairs: list of dicts, each with:
            - pair: int (1-based index)
            - original: str (canonical/current Coach response)
            - orchestrator: str (new orchestrator's response)
            - context: dict with date, user_message, totals (for grounding the evaluation)

    Returns:
        list of dicts, each with:
            - pair: int
            - winner: "A" (original better) | "B" (orchestrator better) | "tie" | "both bad"
            - rationale: str
            - score: 1-5 (5=B clearly better)
    """
    if _STUB_LLM:
        return [
            {
                "pair": p.get("pair", i + 1),
                "winner": "tie",
                "rationale": "(stub mode — LLM not called)",
                "score": 3,
            }
            for i, p in enumerate(pairs)
        ]

    if not pairs:
        return []

    soul = _load_coach_soul()

    pairs_text = "\n\n".join(
        f"--- Pair {p.get('pair', i+1)} ---\n"
        f"Context: {json.dumps(p.get('context', {}), indent=2)}\n"
        f"Response A (current/original):\n{p.get('original', '')}\n\n"
        f"Response B (orchestrator):\n{p.get('orchestrator', '')}"
        for i, p in enumerate(pairs)
    )

    prompt = f"""You are evaluating coach responses for voice fidelity.

CALIBRATION — Coach Soul (the canonical voice spec):
{soul}

TASK:
For each pair below, decide which response better matches Coach's voice as defined above.
- A = original/current response
- B = orchestrator's response
- Avoid prefer-newer bias: if B sounds more generic or AI-like, A wins.
- "both bad" if neither sounds like Coach.

{pairs_text}

OUTPUT JSON (array):
[
  {{
    "pair": 1,
    "winner": "A" | "B" | "tie" | "both bad",
    "rationale": "1-2 sentences",
    "score": 1-5
  }},
  ...
]

Respond with ONLY the JSON array, no other text.
"""

    try:
        raw = _call_claude_raw(prompt)
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            inner = raw.get("result") or raw.get("pairs") or []
            return inner if isinstance(inner, list) else []
        return []
    except Exception as exc:
        return [
            {
                "pair": p.get("pair", i + 1),
                "winner": "tie",
                "rationale": f"(judge error: {exc})",
                "score": 3,
            }
            for i, p in enumerate(pairs)
        ]


def persona_consistency_judge(responses: list[str]) -> dict:
    """Evaluate persona consistency across multiple coach responses (T17).

    Args:
        responses: list of coach response strings from different days (same user/coach)

    Returns:
        dict with:
            - score: 1-5 (5=very consistent)
            - drifted_dimensions: list[str] (which dimensions drifted)
            - drift_examples: list[str] (specific examples)
            - summary: str
    """
    if _STUB_LLM:
        return {
            "score": 5,
            "drifted_dimensions": [],
            "drift_examples": [],
            "summary": "(stub mode — LLM not called)",
        }

    soul = _load_coach_soul()

    responses_text = "\n\n".join(
        f"Response {i+1}:\n{r}" for i, r in enumerate(responses)
    )

    prompt = f"""You are evaluating persona consistency across multiple coach responses.

CALIBRATION — Coach Soul (the canonical voice spec):
{soul}

TASK:
Given these {len(responses)} coach responses written by the same coach for the same user on different days,
rate persona consistency 1-5 (5=very consistent).

Check these dimensions:
- Tone register (casual vs formal)
- Sentence length distribution
- Specificity (numbers vs vague language)
- Use of historical references
- Humor/dryness level
- Adherence to soul traits (data-grounded, forward-looking, no corporate-wellness speak)

{responses_text}

OUTPUT JSON:
{{
  "score": <1-5>,
  "drifted_dimensions": ["list of dimensions that drifted, if any"],
  "drift_examples": ["specific quote from a response that shows drift"],
  "summary": "1-2 sentences"
}}

Respond with ONLY the JSON object, no other text.
"""

    try:
        raw = _call_claude_raw(prompt)
        if isinstance(raw, dict) and "score" in raw:
            return raw
        return {"score": 3, "drifted_dimensions": [], "drift_examples": [], "summary": "(unexpected format)"}
    except Exception as exc:
        return {
            "score": 3,
            "drifted_dimensions": [],
            "drift_examples": [],
            "summary": f"(judge error: {exc})",
        }
