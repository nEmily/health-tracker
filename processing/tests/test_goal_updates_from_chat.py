"""Test that synthesis can emit goalUpdates and orchestrator applies them.

User has been asking 'bump my calories to 1000' for 6 days. Coach has been
responding 'go to Settings' because synthesis had no way to actually persist
goal changes. This adds the structured emit path.
"""
import json
import sys
from pathlib import Path
from lib.invoke_day_synthesis import _normalize_synthesis


def test_normalize_keeps_goal_updates_when_dict():
    raw = {
        "coachResponses": [],
        "highlights": [],
        "concerns": [],
        "goalUpdates": {"calories": {"daily": 1000}},
    }
    out = _normalize_synthesis(raw)
    assert out["goalUpdates"] == {"calories": {"daily": 1000}}


def test_normalize_strips_empty_goal_updates():
    """Empty dict or None should normalize to None — synthesis without goal
    update intent should not trigger commit_goal."""
    for empty in [{}, None]:
        out = _normalize_synthesis({"goalUpdates": empty})
        assert out["goalUpdates"] is None


def test_normalize_strips_non_dict():
    """Defensive: if LLM emits goalUpdates as a string or list, treat as None."""
    for bad in ["nothing", ["calories", 1000], 42]:
        out = _normalize_synthesis({"goalUpdates": bad})
        assert out["goalUpdates"] is None


def test_commit_goal_applies_to_real_file(tmp_path):
    """Round-trip: deep-merge patch into goals.json, verify timeline event."""
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    goals_path = profile_dir / "goals.json"
    goals_path.write_text(json.dumps({
        "calories": {"daily": 900},
        "macros": {"protein": {"target": 85}},
        "fiber": {"daily_g": 25},
    }), encoding="utf-8")

    repo_root = Path(__file__).resolve().parent.parent.parent
    plugin_scripts = repo_root / "coach-plugin" / "scripts"
    sys.path.insert(0, str(plugin_scripts))
    from commit_goal import commit_goal

    commit_goal({"calories": {"daily": 1000}}, tmp_path)

    after = json.loads(goals_path.read_text(encoding="utf-8"))
    assert after["calories"]["daily"] == 1000
    # Other fields preserved
    assert after["macros"]["protein"]["target"] == 85
    assert after["fiber"]["daily_g"] == 25

    # Timeline event written
    timeline_path = tmp_path / "profile" / "timeline.json"
    assert timeline_path.exists()
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    assert isinstance(timeline, list)
    assert len(timeline) >= 1
    last = timeline[-1]
    assert "calories" in str(last)


def test_commit_goal_idempotent(tmp_path):
    """Applying the same patch twice should produce identical state both times."""
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    goals_path = profile_dir / "goals.json"
    goals_path.write_text(json.dumps({"calories": {"daily": 900}}), encoding="utf-8")

    repo_root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(repo_root / "coach-plugin" / "scripts"))
    from commit_goal import commit_goal

    commit_goal({"calories": {"daily": 1000}}, tmp_path)
    state1 = json.loads(goals_path.read_text(encoding="utf-8"))
    commit_goal({"calories": {"daily": 1000}}, tmp_path)
    state2 = json.loads(goals_path.read_text(encoding="utf-8"))
    assert state1 == state2
