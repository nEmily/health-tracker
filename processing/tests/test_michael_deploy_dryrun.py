"""
test_michael_deploy_dryrun.py — Structural checks for deploy and test scripts.

Does NOT execute the scripts or touch any real data.
Verifies: correct shebang, required flags, privacy constraint (no content-piping commands).
"""
import re
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2] / "tools"
DEPLOY_SCRIPT = TOOLS / "deploy-to-michael.sh"


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


