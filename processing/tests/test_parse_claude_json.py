"""Tests for parse_claude_json.py"""
import json
import pytest
from lib.parse_claude_json import parse_claude_json


def _wrap(text: str) -> str:
    """Simulate claude -p --output-format json wrapper."""
    return json.dumps({"result": text})


def test_fenced_json():
    inner = {"calories": 400, "protein": 30}
    wrapped = _wrap(f"```json\n{json.dumps(inner)}\n```")
    result = parse_claude_json(wrapped)
    assert result == inner


def test_fenced_json_no_lang():
    inner = {"calories": 400}
    wrapped = _wrap(f"```\n{json.dumps(inner)}\n```")
    result = parse_claude_json(wrapped)
    assert result == inner


def test_bare_json():
    inner = {"description": "chicken salad", "calories": 350}
    wrapped = _wrap(json.dumps(inner))
    result = parse_claude_json(wrapped)
    assert result == inner


def test_bare_json_with_preamble():
    inner = {"fiber": 5}
    wrapped = _wrap(f"Here is the result: {json.dumps(inner)}")
    result = parse_claude_json(wrapped)
    assert result == inner


def test_result_already_dict():
    """When result is already a dict (non-json output mode edge case)."""
    inner = {"hello": "world"}
    wrapped = json.dumps({"result": inner})
    result = parse_claude_json(wrapped)
    assert result == inner


def test_empty_stdout_raises():
    with pytest.raises(ValueError, match="empty stdout"):
        parse_claude_json("")


def test_invalid_outer_envelope_raises():
    with pytest.raises(ValueError, match="not valid JSON"):
        parse_claude_json("not json at all")


def test_no_json_in_result_raises():
    wrapped = _wrap("I analyzed the food and it looks good to me!")
    with pytest.raises(ValueError, match="no JSON object found"):
        parse_claude_json(wrapped)


def test_fenced_with_extra_text():
    inner = {"calories": 500, "protein": 45}
    wrapped = _wrap(f"Sure! Here's my analysis:\n```json\n{json.dumps(inner)}\n```\nLet me know if you need anything else.")
    result = parse_claude_json(wrapped)
    assert result == inner


def test_nested_json():
    inner = {"breakdown": [{"item": "salmon", "grams": 150, "cal": 250}], "calories": 250}
    wrapped = _wrap(f"```json\n{json.dumps(inner)}\n```")
    result = parse_claude_json(wrapped)
    assert result["breakdown"][0]["item"] == "salmon"
