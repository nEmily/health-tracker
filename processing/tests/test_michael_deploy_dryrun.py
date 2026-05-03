"""
test_michael_deploy_dryrun.py — Structural checks for deploy and test scripts.

Does NOT execute the scripts or touch any real data.
Verifies: correct shebang, required flags, privacy constraint (no content-piping commands).
"""
import re
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2] / "tools"
DEPLOY_SCRIPT = TOOLS / "deploy-to-michael.sh"
TEST_SCRIPT = TOOLS / "test-michael-orchestrator.sh"


def test_deploy_script_exists_and_has_shebang():
    assert DEPLOY_SCRIPT.exists(), "deploy-to-michael.sh not found"
    first_line = DEPLOY_SCRIPT.read_text(encoding="utf-8").splitlines()[0]
    assert first_line.startswith("#!/"), f"missing shebang, got: {first_line!r}"


def test_deploy_script_has_yes_flag_and_confirmation():
    text = DEPLOY_SCRIPT.read_text(encoding="utf-8")
    assert "--yes" in text, "deploy script must support --yes flag"
    # Confirmation prompt must exist for the non---yes path
    assert "read" in text or "confirm" in text.lower(), \
        "deploy script must prompt for confirmation when --yes not set"
    # Must not rsync/cp tests/ or sandbox/ directories
    assert not re.search(r'\b(rsync|cp)\b.*tests/', text), \
        "deploy script must not rsync/cp the tests/ directory"


def test_test_script_privacy_safe():
    text = TEST_SCRIPT.read_text(encoding="utf-8")
    # Must have correct shebang
    assert text.splitlines()[0].startswith("#!/")
    # Must print only PASS/FAIL lines — no cat/head/tail/grep of analysis content
    forbidden = re.compile(r'\b(cat|head|tail)\b\s+.*analysis')
    assert not forbidden.search(text), \
        "test script must not pipe analysis content to terminal (cat/head/tail)"
    # Must reference T7.A and T7.B output markers
    assert "T7.A deploy:" in text
    assert "T7.B structural diff:" in text
    # Must clean up sandbox
    assert "rm -rf" in text and "SANDBOX" in text, \
        "test script must remove sandbox on exit"
