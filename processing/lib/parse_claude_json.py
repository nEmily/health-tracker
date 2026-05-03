"""
parse_claude_json.py — Extract JSON from claude -p --output-format json output.

claude -p wraps the model's text in a JSON envelope: {"result": "...text..."}
The text itself often contains ```json fences. This module handles all cases.

NO LLM calls. Pure stdlib.
"""

from __future__ import annotations
import json
import re

_FENCED_RE = re.compile(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```')
_BARE_OBJ_RE = re.compile(r'\{[\s\S]*\}')


def parse_claude_json(stdout: str) -> dict:
    """Parse claude -p --output-format json output.

    Handles:
      - Fenced JSON:  result contains ```json { ... } ```
      - Bare JSON:    result is a bare { ... } object
      - Double-wrap:  result is itself a JSON string (edge case)

    Raises ValueError with truncated context if no valid JSON can be extracted.
    """
    if not stdout or not stdout.strip():
        raise ValueError("empty stdout from claude -p")

    # Step 1: unwrap the outer envelope
    try:
        wrapper = json.loads(stdout)
    except json.JSONDecodeError as exc:
        snippet = stdout[:200].replace("\n", "\\n")
        raise ValueError(f"outer claude -p envelope is not valid JSON: {snippet!r}") from exc

    if not isinstance(wrapper, dict):
        raise ValueError(f"claude -p envelope is not a dict: {type(wrapper).__name__}")

    text = wrapper.get("result", "")
    if not isinstance(text, str):
        # Occasionally result is already a dict (non-json output mode)
        if isinstance(text, dict):
            return text
        raise ValueError(f"result field is not a string: {type(text).__name__}")

    # Step 2: try fenced extraction first (most common)
    m = _FENCED_RE.search(text)
    if m:
        candidate = m.group(1)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass  # fall through to bare extraction

    # Step 3: bare {...} extraction (greedy from last { to last })
    m = _BARE_OBJ_RE.search(text)
    if m:
        candidate = m.group(0)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    snippet = text[:200].replace("\n", "\\n")
    raise ValueError(f"no JSON object found in claude result: {snippet!r}")
