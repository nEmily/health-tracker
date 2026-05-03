"""
Tests for run_e2e.py harness.

Verifies that the harness runs in --quick mode, produces a valid summary file,
and contains the expected test rows.
"""

from __future__ import annotations
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

_PROCESSING = Path(__file__).resolve().parent.parent
_TESTS = Path(__file__).resolve().parent
_HARNESS = _TESTS / "run_e2e.py"


def _run_quick(extra_args: list[str] | None = None) -> tuple[int, str, str, Path]:
    """Run the harness with --quick and return (returncode, stdout, stderr, summary_path)."""
    import os
    with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f:
        summary_path = Path(f.name)

    cmd = [sys.executable, str(_HARNESS), "--user", "emily", "--quick",
           "--output", str(summary_path)]
    if extra_args:
        cmd.extend(extra_args)

    env = dict(os.environ)
    env["COACH_STUB_LLM"] = "1"

    proc = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL, text=True, timeout=120, env=env,
    )
    return proc.returncode, proc.stdout, proc.stderr, summary_path


# ── Test 1: harness runs without crashing ─────────────────────────────────────

def test_harness_exits_without_crash():
    """Harness must exit 0 or 1 (non-crash exit codes)."""
    rc, stdout, stderr, summary = _run_quick()
    assert rc in (0, 1), (
        f"Harness crashed with unexpected exit code {rc}.\n"
        f"stdout: {stdout[:400]}\nstderr: {stderr[:400]}"
    )


# ── Test 2: summary file is created ──────────────────────────────────────────

def test_summary_file_created():
    """SUMMARY.md must be created at the output path."""
    rc, stdout, stderr, summary = _run_quick()
    assert summary.exists(), f"Summary file not created at {summary}"
    content = summary.read_text(encoding="utf-8")
    assert len(content) > 100, "Summary file is suspiciously short"


# ── Test 3: summary contains expected test rows ───────────────────────────────

def test_summary_contains_expected_test_ids():
    """Summary must contain rows for the key tests T1, T14, T15, T18, T19, T20, T21."""
    rc, stdout, stderr, summary = _run_quick()
    content = summary.read_text(encoding="utf-8")

    expected_ids = ["T1", "T14", "T15", "T18", "T19", "T20", "T21"]
    missing = [tid for tid in expected_ids if tid not in content]
    assert not missing, f"Summary missing test IDs: {missing}\nContent:\n{content[:800]}"


# ── Test 4: PASS/FAIL/SKIP markers all present ────────────────────────────────

def test_summary_has_status_markers():
    """Summary must contain at least one PASS or SKIP marker (FAIL is optional in quick)."""
    rc, stdout, stderr, summary = _run_quick()
    content = summary.read_text(encoding="utf-8")
    assert "PASS" in content or "SKIP" in content, \
        f"Summary has neither PASS nor SKIP:\n{content[:800]}"


# ── Test 5: section headers present ─────────────────────────────────────────

def test_summary_sections_present():
    """Summary must have the three expected section headers."""
    rc, stdout, stderr, summary = _run_quick()
    content = summary.read_text(encoding="utf-8")
    assert "Engineering correctness" in content
    assert "User-mindset" in content
    assert "Critical user-facing" in content


# ── Test 6: T13/T17 are SKIP in --quick mode ────────────────────────────────

def test_llm_judge_tests_skipped_in_quick():
    """T13 and T17 must show SKIP in --quick mode (LLM judge, requires --with-llm)."""
    rc, stdout, stderr, summary = _run_quick()
    content = summary.read_text(encoding="utf-8")
    # T13 and T17 may appear anywhere in summary
    if "T13" in content:
        t13_line = next((l for l in content.splitlines() if l.startswith("T13")), "")
        assert "SKIP" in t13_line, f"T13 should be SKIP in --quick mode: {t13_line!r}"
    if "T17" in content:
        t17_line = next((l for l in content.splitlines() if l.startswith("T17")), "")
        assert "SKIP" in t17_line, f"T17 should be SKIP in --quick mode: {t17_line!r}"


# ── Test 7: privacy-strict mode produces no calorie numbers in failure details

def test_privacy_strict_strips_calorie_numbers():
    """In michael mode, failure details must not contain raw calorie numbers."""
    with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f:
        summary_path = Path(f.name)

    import os
    cmd = [sys.executable, str(_HARNESS), "--user", "michael", "--quick",
           "--output", str(summary_path)]

    env = dict(os.environ)
    env["COACH_STUB_LLM"] = "1"
    proc = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL, text=True, timeout=60, env=env,
    )
    # May skip if michael data not found — that's fine
    if summary_path.exists():
        content = summary_path.read_text(encoding="utf-8")
        import re
        # No 4+ digit numbers that look like calorie values in details
        calorie_matches = re.findall(r'\b(1[0-9]{3}|[2-9][0-9]{3})\s*cal\b', content)
        assert not calorie_matches, \
            f"Privacy violation: calorie numbers found in michael summary: {calorie_matches}"
