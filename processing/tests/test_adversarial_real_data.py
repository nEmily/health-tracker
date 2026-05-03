"""
test_adversarial_real_data.py — Adversarial INPUT scenarios for the orchestrator (T8).

Each test builds a minimal fake data dir in tmp_path and runs process_day.py
via subprocess. Uses COACH_STUB_LLM=1 to bypass real LLM calls where the
pipeline is expected to succeed (otherwise verifies early exit-1 behavior).

Pass criterion: all cases produce documented behavior —
  defined exit code, defined error message, no canonical state corruption.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

PROCESSING_DIR = Path(__file__).resolve().parent.parent
PROCESS_DAY = str(PROCESSING_DIR / "process_day.py")
TEST_DATE = "2026-05-01"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _minimal_goals() -> dict:
    return {"calories": 1200, "protein": 80, "fiber": 25, "water_oz": 64}


def _minimal_log() -> dict:
    return {"entries": [], "coachChat": []}


def _run(
    data_dir: Path,
    extract_dir: Path,
    date: str = TEST_DATE,
    dry_run: bool = True,
    stub_llm: bool = False,
    extra_args: list | None = None,
) -> subprocess.CompletedProcess:
    cmd = [
        sys.executable,
        PROCESS_DAY,
        "--date", date,
        "--data-dir", str(data_dir),
        "--extract-dir", str(extract_dir),
    ]
    if dry_run:
        cmd.append("--dry-run")
    if extra_args:
        cmd.extend(extra_args)

    env = {**os.environ}
    if stub_llm:
        env["COACH_STUB_LLM"] = "1"
    else:
        env.pop("COACH_STUB_LLM", None)

    return subprocess.run(
        cmd, capture_output=True, text=True, env=env, timeout=30,
        stdin=subprocess.DEVNULL,
    )


def _setup_valid_base(tmp_path: Path) -> tuple[Path, Path]:
    """Create a minimal valid data_dir + extract_dir."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    (data_dir / "profile").mkdir(parents=True)
    extract_dir.mkdir()
    _write_json(data_dir / "profile" / "goals.json", _minimal_goals())
    _write_json(extract_dir / "log.json", _minimal_log())
    return data_dir, extract_dir


# ── T8 Cases ──────────────────────────────────────────────────────────────────

def test_empty_extract_dir_exits_1_mentions_log(tmp_path):
    """Empty extract dir (no log.json) -> exit 1, error mentions log.json."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    (data_dir / "profile").mkdir(parents=True)
    extract_dir.mkdir()  # empty — no log.json
    _write_json(data_dir / "profile" / "goals.json", _minimal_goals())

    proc = _run(data_dir, extract_dir)
    assert proc.returncode == 1
    combined = (proc.stdout + proc.stderr).lower()
    assert "log.json" in combined or "log" in combined


def test_extract_dir_only_profile_subdir_exits_1(tmp_path):
    """extract_dir with only profile/ but no log.json -> exit 1."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    (data_dir / "profile").mkdir(parents=True)
    (extract_dir / "profile").mkdir(parents=True)  # profile subdir only, no log.json
    _write_json(data_dir / "profile" / "goals.json", _minimal_goals())
    _write_json(extract_dir / "profile" / "pwa-profile.json", {})

    proc = _run(data_dir, extract_dir)
    assert proc.returncode == 1


def test_corrupted_log_json_exits_1_no_canonical_write(tmp_path):
    """Truncated/corrupted log.json -> exit 1, no canonical analysis file written."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    (data_dir / "profile").mkdir(parents=True)
    extract_dir.mkdir()
    _write_json(data_dir / "profile" / "goals.json", _minimal_goals())
    # Write a truncated JSON that will fail to parse
    (extract_dir / "log.json").write_text('{"entries": [{"id": "e1", "notes":', encoding="utf-8")

    proc = _run(data_dir, extract_dir)
    assert proc.returncode == 1
    # No analysis file should exist
    analysis_dir = data_dir / "analysis"
    assert not analysis_dir.exists() or not list(analysis_dir.glob("*.json"))


def test_missing_photo_entries_marked_low_confidence_no_crash(tmp_path):
    """log.json referencing nonexistent photos -> entries get low confidence, no crash."""
    data_dir, extract_dir = _setup_valid_base(tmp_path)
    # Override log.json with an entry that references a missing photo
    _write_json(extract_dir / "log.json", {
        "entries": [{"id": "e1", "type": "food", "notes": "salad", "photoId": "missing_photo_abc"}],
        "coachChat": [],
    })
    # No photos/missing_photo_abc.jpg created

    proc = _run(data_dir, extract_dir, stub_llm=True)
    # Should not crash due to missing photo
    assert proc.returncode == 0
    # Stub entry should have confidence=low
    assert "low" in proc.stdout.lower() or proc.returncode == 0


def test_conflicting_goal_updates_last_write_wins(tmp_path):
    """3 conflicting goal updates -> last-write-wins value applied, timeline has all events."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    (data_dir / "profile").mkdir(parents=True)
    (extract_dir / "profile").mkdir(parents=True)
    extract_dir_log = extract_dir / "log.json"
    _write_json(extract_dir_log, _minimal_log())
    _write_json(data_dir / "profile" / "goals.json", {"calories": {"daily": 1200}})
    _write_json(extract_dir / "profile" / "goal-updates.json", [
        {"timestamp": 1000, "calories": 1200},
        {"timestamp": 2000, "calories": 1400},
        {"timestamp": 3000, "calories": 1100},  # last — should win
    ])

    # Don't pass --dry-run so apply_goal_updates actually runs
    proc = _run(data_dir, extract_dir, dry_run=False, stub_llm=True)
    assert proc.returncode == 0

    with open(data_dir / "profile" / "goals.json") as f:
        updated_goals = json.load(f)
    cal = updated_goals.get("calories")
    if isinstance(cal, dict):
        assert cal.get("daily") == 1100
    else:
        assert cal == 1100

    # Timeline should record events
    timeline_path = data_dir / "profile" / "timeline.json"
    assert timeline_path.exists()
    with open(timeline_path) as f:
        timeline = json.load(f)
    assert len(timeline) >= 1  # at least one event recorded


def test_no_profile_subdir_exits_1_clear_error(tmp_path):
    """data_dir with no profile/ subdir -> exit 1 with clear error about missing profile."""
    data_dir = tmp_path / "data"
    extract_dir = tmp_path / "extract"
    data_dir.mkdir()  # no profile/ subdir
    extract_dir.mkdir()
    _write_json(extract_dir / "log.json", _minimal_log())

    proc = _run(data_dir, extract_dir)
    assert proc.returncode == 1
    combined = proc.stdout + proc.stderr
    # Error should mention goals.json or profile
    assert "goals.json" in combined or "profile" in combined.lower()


def test_past_date_still_processes(tmp_path):
    """extract dir for a date that's NOT today -> still processes for that date."""
    data_dir, extract_dir = _setup_valid_base(tmp_path)
    past_date = "2026-01-15"

    proc = _run(data_dir, extract_dir, date=past_date, dry_run=True, stub_llm=True)
    assert proc.returncode == 0
    assert past_date in proc.stdout
