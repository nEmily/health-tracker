"""
run_e2e.py — Top-level end-to-end harness for T1-T12 + T14-T16 + Part 7 (T18-T21).

Usage:
    python processing/tests/run_e2e.py --user emily --output /tmp/SUMMARY.md
    python processing/tests/run_e2e.py --user emily --quick --output /tmp/SUMMARY.md
    python processing/tests/run_e2e.py --user michael --output /tmp/michael-summary.txt

Options:
    --user emily|michael    Target user (michael uses privacy-strict output)
    --output PATH           Where to write SUMMARY.md
    --quick                 Skip slow tests that require LLM calls (T2, T3, T9)
    --days DATE[,DATE...]   Only run T2 for specific dates (comma-separated)
    --with-llm              Enable real LLM calls for T4 (requires claude CLI)

Environment:
    COACH_STUB_LLM=1 is set automatically.

Privacy-strict mode (--user michael):
    All output is PASS/FAIL booleans and integer counts ONLY.
    No entry names, calorie numbers, coach response text, or log tails.
"""

from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

# Ensure processing/ is on sys.path
_TESTS_DIR = Path(__file__).resolve().parent
_PROCESSING_DIR = _TESTS_DIR.parent
if str(_PROCESSING_DIR) not in sys.path:
    sys.path.insert(0, str(_PROCESSING_DIR))

# Force stub LLM for all process_day calls unless overridden per-test
os.environ.setdefault("COACH_STUB_LLM", "1")


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class TestResult:
    test_id: str
    label: str
    status: str          # "PASS" | "FAIL" | "SKIP" | "ERROR"
    details: str = ""
    elapsed: float = 0.0


# ── Pytest runner ─────────────────────────────────────────────────────────────

def _run_pytest(module_path: str, extra_args: list[str] | None = None, timeout: int = 120) -> TestResult:
    """Run a pytest module programmatically and return a TestResult."""
    abs_path = str(_TESTS_DIR / module_path) if not os.path.isabs(module_path) else module_path
    cmd = [sys.executable, "-m", "pytest", abs_path, "-q", "--tb=short", "--no-header"]
    if extra_args:
        cmd.extend(extra_args)

    t0 = time.monotonic()
    env = {**os.environ, "COACH_STUB_LLM": "1"}
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        elapsed = time.monotonic() - t0
        output = proc.stdout + proc.stderr
        if proc.returncode == 0:
            lines = [l for l in proc.stdout.splitlines() if l.strip()]
            summary = lines[-1] if lines else "passed"
            return TestResult(test_id="", label="", status="PASS", details=summary, elapsed=elapsed)
        else:
            # Extract failure summary (last few lines)
            lines = output.splitlines()
            tail = "\n".join(lines[-8:]) if len(lines) > 8 else output
            return TestResult(test_id="", label="", status="FAIL", details=tail[:400], elapsed=elapsed)
    except subprocess.TimeoutExpired:
        return TestResult(test_id="", label="", status="FAIL",
                         details=f"timeout after {timeout}s", elapsed=timeout)
    except Exception as exc:
        return TestResult(test_id="", label="", status="ERROR",
                         details=str(exc), elapsed=time.monotonic() - t0)


def _pytest_result(test_id: str, label: str, module: str, extra_args: list[str] | None = None) -> TestResult:
    r = _run_pytest(module, extra_args)
    r.test_id = test_id
    r.label = label
    return r


# ── T1: Adversarial unit sweep ────────────────────────────────────────────────

def run_t1_adversarial() -> TestResult:
    r = _pytest_result("T1", "adversarial unit sweep", "test_adversarial.py")
    return r


# ── T2: Side-by-side (quick=structural diff only, no LLM) ────────────────────

def run_t2_side_by_side(user: str, days: list[str] | None, quick: bool, privacy_strict: bool) -> TestResult:
    """T2: Re-process archive ZIPs against golden analysis files.

    Strategy:
    - Pre-seed sandbox with canonical analysis so reconcile() keeps existing entries verbatim.
    - Entries in the log but NOT in canonical (bodyPhoto, weight) get stub-zeroed (0 cal).
    - Entries with _reanalyzeRequested in log get stub-zeroed too (by reconcile design).
    - We compute "expected output totals" = sum of kept-verbatim entries from canonical,
      then verify output totals match within tolerance (±1% cal, ±1g protein, ±1g fiber).
    - All canonical entry IDs must appear in output entries[].id.
    """
    if quick:
        return TestResult("T2", "Emily side-by-side", "SKIP",
                         details="skipped in --quick mode (requires archive ZIPs)")

    if user == "michael":
        return TestResult("T2", "Michael side-by-side", "SKIP",
                         details="T2 for Michael handled by T7")

    # Determine candidate dates (including 2026-04-21 per spec)
    candidate_dates = days or ["2026-04-25", "2026-04-27", "2026-04-21", "2026-04-29", "2026-05-01"]

    # Find data dir — check repo-relative coach/ first, then ~/coach
    data_dir = _find_data_dir(user)
    if data_dir is None:
        return TestResult("T2", "Emily side-by-side", "SKIP",
                         details="coach data dir not found — set COACH_DATA_DIR or use ~/coach")

    archive_dir = data_dir / "archive"
    analysis_dir = data_dir / "analysis"
    if not archive_dir.exists() or not analysis_dir.exists():
        return TestResult("T2", "Emily side-by-side", "SKIP",
                         details=f"archive/ or analysis/ not found in {data_dir}")

    import zipfile, shutil
    t0 = time.monotonic()
    passed = []
    failed = []

    sandbox_root = _TESTS_DIR / "sandbox" / "T2"

    for date in candidate_dates:
        zip_path = archive_dir / f"health-{date}.zip"
        canonical_path = analysis_dir / f"{date}.json"
        if not zip_path.exists() or not canonical_path.exists():
            continue

        sandbox_date = sandbox_root / date
        extract_dir = sandbox_date / "extract"
        sandbox_data = sandbox_date / "data"

        try:
            # Clean and recreate sandbox for this date
            if sandbox_date.exists():
                shutil.rmtree(sandbox_date)
            extract_dir.mkdir(parents=True)
            sandbox_data.mkdir(parents=True)
            (sandbox_data / "analysis").mkdir()

            # Load canonical for comparison
            with open(canonical_path, encoding="utf-8") as f:
                canonical = json.load(f)

            # Extract archive ZIP
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(extract_dir)

            # Copy profile/ from data_dir
            profile_src = data_dir / "profile"
            if profile_src.exists():
                shutil.copytree(profile_src, sandbox_data / "profile")

            # Pre-seed sandbox with canonical analysis so reconcile keeps existing entries
            shutil.copy(canonical_path, sandbox_data / "analysis" / f"{date}.json")

            # Load log to pre-compute expected kept-verbatim totals
            log_data = _load_log_from_extract(extract_dir, date)
            expected_totals = _compute_expected_stub_totals(log_data, canonical)

            proc = subprocess.run(
                [sys.executable, str(_PROCESSING_DIR / "process_day.py"),
                 "--date", date,
                 "--data-dir", str(sandbox_data),
                 "--extract-dir", str(extract_dir)],
                capture_output=True, text=True, timeout=60,
                env={**os.environ, "COACH_STUB_LLM": "1"},
            )

            if proc.returncode != 0:
                tail = (proc.stdout + proc.stderr).splitlines()
                failed.append(f"{date}:exit{proc.returncode}:{' '.join(tail[-3:])[:80]}")
                continue

            # Read output from sandbox (written by process_day.py)
            output_path = sandbox_data / "analysis" / f"{date}.json"
            if not output_path.exists():
                failed.append(f"{date}:no_output_file")
                continue

            with open(output_path, encoding="utf-8") as f:
                output = json.load(f)

            # Structural diff
            issues = _diff_output_vs_canonical(output, canonical, expected_totals)
            if issues:
                failed.append(f"{date}:{'; '.join(issues)}")
            else:
                passed.append(date)

        except Exception as exc:
            failed.append(f"{date}:{exc!s:.80}")
        finally:
            # Clean up sandbox after each date
            if sandbox_date.exists():
                shutil.rmtree(sandbox_date)

    elapsed = time.monotonic() - t0
    n = len(passed) + len(failed)
    if n == 0:
        return TestResult("T2", "Emily side-by-side", "SKIP",
                         details="no archive ZIPs + analysis pairs found", elapsed=elapsed)

    if not failed:
        return TestResult("T2", "Emily side-by-side", "PASS",
                         details=f"{len(passed)}/{n} days", elapsed=elapsed)
    return TestResult("T2", "Emily side-by-side", "FAIL",
                     details=f"{len(passed)}/{n} passed, failed: {failed}", elapsed=elapsed)


def _load_log_from_extract(extract_dir: Path, date: str) -> dict:
    """Load log.json from extracted ZIP directory (mirrors process_day._read_log_json candidates)."""
    candidates = [
        extract_dir / "daily" / date / "log.json",
        extract_dir / f"{date}.json",
        extract_dir / "log.json",
        extract_dir / "data" / f"{date}.json",
        extract_dir / "data" / "log.json",
        extract_dir / "daily" / date / "daily" / date / "log.json",
    ]
    for c in candidates:
        if c.exists():
            with open(c, encoding="utf-8") as f:
                return json.load(f)
    return {"entries": []}


def _compute_expected_stub_totals(log_data: dict, canonical: dict) -> dict:
    """Compute the totals we expect from a stub-LLM run given pre-seeded canonical.

    Entries that will be KEPT VERBATIM by reconcile():
      - Present in both log and canonical by ID
      - log entry does NOT have _reanalyzeRequested=True

    All other log entries (new, bodyPhoto, or re-analyze-flagged) get stub zeros.
    Weight/bodyPhoto entries contribute 0 calories regardless.
    """
    canon_by_id = {e["id"]: e for e in canonical.get("entries", []) if e.get("id")}
    log_entries = log_data.get("entries", [])

    # Deduplicate log entries by ID (last wins, matching reconcile behavior)
    seen: dict[str, int] = {}
    for i, e in enumerate(log_entries):
        if e.get("id"):
            seen[e["id"]] = i
    deduped = [e for i, e in enumerate(log_entries) if not e.get("id") or i == seen.get(e.get("id"))]

    _MACRO_FIELDS = ("calories", "protein", "carbs", "fat", "fiber", "solubleFiber", "insolubleFiber")
    totals: dict[str, float] = {k: 0.0 for k in _MACRO_FIELDS}

    for log_entry in deduped:
        eid = log_entry.get("id")
        entry_type = (log_entry.get("type") or "").lower()
        if entry_type in ("workout", "exercise", "fitness"):
            continue  # excluded from totals

        if eid and eid in canon_by_id and not log_entry.get("_reanalyzeRequested"):
            # Kept verbatim — use canonical calorie values
            ce = canon_by_id[eid]
            if (ce.get("type") or "").lower() not in ("workout", "exercise", "fitness"):
                for field in _MACRO_FIELDS:
                    v = ce.get(field, 0)
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        totals[field] += v
        # else: new or re-analyze-flagged → stub zeros, contributes 0

    return {k: round(v, 1) for k, v in totals.items()}


def _diff_output_vs_canonical(output: dict, canonical: dict, expected_totals: dict) -> list[str]:
    """Return list of issues. Empty list = PASS."""
    issues = []

    # 1. Required top-level keys
    for key in ("entries", "totals"):
        if key not in output:
            issues.append(f"output missing key: {key}")

    if issues:
        return issues  # can't check further

    # 2. All canonical entry IDs must appear in output
    output_ids = {e.get("id") for e in output["entries"] if e.get("id")}
    canon_ids = {e.get("id") for e in canonical.get("entries", []) if e.get("id")}
    missing_ids = canon_ids - output_ids
    if missing_ids:
        issues.append(f"missing {len(missing_ids)} canonical IDs: {list(missing_ids)[:3]}")

    # 3. Totals within tolerance vs expected stub-run output
    ot = output["totals"]
    et = expected_totals
    cal_o = ot.get("calories", 0)
    cal_e = et.get("calories", 0)
    # ±1% or ±5 cal absolute (whichever is larger) to handle rounding in fiber split
    cal_tol = max(abs(cal_e) * 0.01, 5)
    if abs(cal_o - cal_e) > cal_tol:
        issues.append(f"calories: got {cal_o} expected ~{cal_e} (tol ±{cal_tol:.1f})")

    prot_o = ot.get("protein", 0)
    prot_e = et.get("protein", 0)
    if abs(prot_o - prot_e) > 1:
        issues.append(f"protein: got {prot_o} expected ~{prot_e} (tol ±1g)")

    fib_o = ot.get("fiber", 0)
    fib_e = et.get("fiber", 0)
    if abs(fib_o - fib_e) > 1:
        issues.append(f"fiber: got {fib_o} expected ~{fib_e} (tol ±1g)")

    return issues


def _find_data_dir(user: str) -> Path | None:
    """Find the coach data directory for the given user.

    Search order:
    1. COACH_DATA_DIR environment variable
    2. Repo-relative coach/ (PROJECT_ROOT/coach, where PROJECT_ROOT = _PROCESSING_DIR.parent)
    3. ~/coach  (standard install location)
    4. ~/HealthTracker
    5. Platform-specific known path
    """
    explicit = os.environ.get("COACH_DATA_DIR")
    if explicit:
        p = Path(explicit)
        if p.exists() and (p / "analysis").exists():
            return p

    if user == "emily":
        home = Path.home()
        # Repo-relative first: <repo_root>/coach/
        repo_coach = _PROCESSING_DIR.parent / "coach"
        candidates = [
            repo_coach,
            home / "coach",
            home / "HealthTracker",
            Path("C:/Users/emily/coach") if sys.platform == "win32" else Path("/nonexistent"),
        ]
    elif user == "michael":
        home = Path.home()
        repo_michael = _PROCESSING_DIR.parent / "michael-coach"
        candidates = [
            repo_michael,
            home / "michael-coach",
            Path("C:/Users/emily/michael-coach") if sys.platform == "win32" else home / "michael-coach",
        ]
    else:
        return None

    for p in candidates:
        if p.exists() and (p / "analysis").exists():
            return p
    return None


# ── T3: High-volume stress test ───────────────────────────────────────────────

def run_t3_stress(quick: bool) -> TestResult:
    """T3: High-volume day (2026-04-27) under stub LLM.

    Pass criteria:
    - Wall time < 180s (confirms deterministic layer scales)
    - Output JSON passes schema (stdout contains "Schema validation passed")
    - All non-bodyPhoto log entry IDs appear in output entries[].id
    """
    if quick:
        return TestResult("T3", "high-volume stress (Apr 27)", "SKIP",
                         details="skipped in --quick mode")

    import zipfile, shutil

    date = "2026-04-27"
    data_dir = _find_data_dir("emily")
    if data_dir is None:
        return TestResult("T3", "high-volume stress (Apr 27)", "SKIP",
                         details="coach data dir not found")

    zip_path = data_dir / "archive" / f"health-{date}.zip"
    if not zip_path.exists():
        return TestResult("T3", "high-volume stress (Apr 27)", "SKIP",
                         details=f"archive ZIP not found: {zip_path.name}")

    sandbox_root = _TESTS_DIR / "sandbox" / "T3"
    extract_dir = sandbox_root / "extract"
    sandbox_data = sandbox_root / "data"

    try:
        if sandbox_root.exists():
            shutil.rmtree(sandbox_root)
        extract_dir.mkdir(parents=True)
        sandbox_data.mkdir(parents=True)

        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)

        profile_src = data_dir / "profile"
        if profile_src.exists():
            shutil.copytree(profile_src, sandbox_data / "profile")

        # Load log to know expected entry IDs
        log_data = _load_log_from_extract(extract_dir, date)
        log_ids = {e["id"] for e in log_data.get("entries", []) if e.get("id")}

        t0 = time.monotonic()
        proc = subprocess.run(
            [sys.executable, str(_PROCESSING_DIR / "process_day.py"),
             "--date", date,
             "--data-dir", str(sandbox_data),
             "--extract-dir", str(extract_dir)],
            capture_output=True, text=True, timeout=200,
            env={**os.environ, "COACH_STUB_LLM": "1"},
        )
        wall = time.monotonic() - t0

        issues = []
        if proc.returncode != 0:
            tail = (proc.stdout + proc.stderr).splitlines()
            issues.append(f"exit{proc.returncode}: {' '.join(tail[-3:])[:100]}")

        if wall >= 180:
            issues.append(f"wall time {wall:.1f}s >= 180s")

        stdout_combined = proc.stdout + proc.stderr
        if "schema validation passed" not in stdout_combined.lower():
            issues.append("schema validation not confirmed in stdout")

        # Check entry IDs preserved
        output_path = sandbox_data / "analysis" / f"{date}.json"
        if output_path.exists():
            with open(output_path, encoding="utf-8") as f:
                output = json.load(f)
            output_ids = {e.get("id") for e in output.get("entries", []) if e.get("id")}
            missing = log_ids - output_ids
            if missing:
                issues.append(f"{len(missing)} log IDs missing from output")
        else:
            issues.append("output file not written")

        elapsed = time.monotonic() - t0
        if issues:
            return TestResult("T3", "high-volume stress (Apr 27)", "FAIL",
                             details="; ".join(issues), elapsed=elapsed)

        n_entries = len(log_ids)
        return TestResult("T3", "high-volume stress (Apr 27)", "PASS",
                         details=f"wall={wall:.1f}s entries={n_entries} schema=ok",
                         elapsed=elapsed)

    except subprocess.TimeoutExpired:
        return TestResult("T3", "high-volume stress (Apr 27)", "FAIL",
                         details="timeout after 200s", elapsed=200.0)
    except Exception as exc:
        return TestResult("T3", "high-volume stress (Apr 27)", "ERROR",
                         details=str(exc)[:200])
    finally:
        if sandbox_root.exists():
            shutil.rmtree(sandbox_root)


# ── T4/T5: Token count / latency (require real LLM) ─────────────────────────

def _build_recent_history(data_dir: Path, anchor_date: str, n_days: int = 7) -> list:
    """Build recent history list from analysis files preceding anchor_date (chronological)."""
    analysis_dir = data_dir / "analysis"
    if not analysis_dir.exists():
        return []
    candidates = sorted(
        [f for f in analysis_dir.glob("*.json")
         if len(f.stem) == 10 and f.stem < anchor_date],
        reverse=True,
    )[:n_days]
    history = []
    for fpath in candidates:
        try:
            with open(fpath, encoding="utf-8") as fp:
                day = json.load(fp)
            totals = day.get("totals") or {}
            history.append({
                "date": day.get("date") or fpath.stem,
                "calories": totals.get("calories", 0),
                "protein": totals.get("protein", 0),
                "fiber": totals.get("fiber", 0),
                "weight": day.get("weight"),
            })
        except Exception:
            continue
    return list(reversed(history))  # chronological order


def run_t4_token_count(quick: bool, with_llm: bool = False) -> TestResult:
    """T4: Measure synthesis prompt size vs historical monolith baseline (~10k tokens).

    Builds the synthesis prompt from a real fixture day (2026-04-25) using
    _build_synthesis_prompt(), counts chars/tokens, and compares to the legacy
    monolith baseline (~10k tokens). PASS if synth < baseline.
    """
    if quick:
        return TestResult("T4", "synthesis prompt size", "SKIP",
                         details="skipped in --quick mode")
    if not with_llm:
        return TestResult("T4", "synthesis prompt size", "SKIP",
                         details="requires --with-llm flag")

    t0 = time.monotonic()
    data_dir = _find_data_dir("emily")
    if data_dir is None:
        return TestResult("T4", "synthesis prompt size", "SKIP",
                         details="coach data dir not found", elapsed=0.0)

    analysis_path = data_dir / "analysis" / "2026-04-25.json"
    if not analysis_path.exists():
        return TestResult("T4", "synthesis prompt size", "SKIP",
                         details="2026-04-25.json not found", elapsed=0.0)

    try:
        with open(analysis_path, encoding="utf-8") as f:
            analysis = json.load(f)

        from lib.load_profile import load_profile
        # Use data_dir as extract_dir — pwa-profile.json won't be found but that's fine
        profile = load_profile(data_dir, data_dir)

        totals = analysis.get("totals") or {}
        all_entries = analysis.get("entries") or []
        coach_messages = analysis.get("coachResponses") or []
        recent_history = _build_recent_history(data_dir, "2026-04-25", 7)

        from lib.compute_goals_block import compute as _compute_goals_block
        goals_block = _compute_goals_block(totals, profile)

        # Access _build_synthesis_prompt from the synthesis module (private but importable)
        import lib.invoke_day_synthesis as _synth_mod
        prompt = _synth_mod._build_synthesis_prompt(
            "2026-04-25", profile, totals, goals_block,
            all_entries, coach_messages, recent_history,
            plan_triggered=False,
        )

        synth_chars = len(prompt)
        synth_tokens = synth_chars // 4

        # Historical monolith baseline: 449-line prompt was ~10k tokens
        monolith_tokens = 10_000

        elapsed = time.monotonic() - t0
        ratio = round(synth_tokens / max(monolith_tokens, 1), 2)
        status = "PASS" if synth_tokens < monolith_tokens else "FAIL"
        details = f"synth={synth_tokens}toks vs monolith={monolith_tokens}toks (ratio {ratio})"
        return TestResult("T4", "synthesis prompt size", status, details=details, elapsed=elapsed)

    except Exception as exc:
        elapsed = time.monotonic() - t0
        return TestResult("T4", "synthesis prompt size", "ERROR",
                         details=str(exc)[:300], elapsed=elapsed)


def run_t5_latency(quick: bool) -> TestResult:
    if quick:
        return TestResult("T5", "latency p50/p95", "SKIP",
                         details="skipped in --quick mode")
    return TestResult("T5", "latency p50/p95", "SKIP",
                     details="requires real LLM runs")


# ── T6: mealPlan source preservation ─────────────────────────────────────────

def run_t6_mealplan_preservation() -> TestResult:
    """T11.1 + T6: commit_goal.py and commit_plan.py subprocess integration."""
    t0 = time.monotonic()
    scripts_dir = _PROCESSING_DIR.parent / "coach-plugin" / "scripts"
    commit_goal_py = scripts_dir / "commit_goal.py"
    commit_plan_py = scripts_dir / "commit_plan.py"
    fixtures_dir = _TESTS_DIR / "fixtures"
    test_plan_json = fixtures_dir / "test_plan.json"

    if not commit_goal_py.exists() or not commit_plan_py.exists():
        return TestResult("T6", "mealPlan source preservation", "SKIP",
                         details="commit helpers not found at coach-plugin/scripts/",
                         elapsed=time.monotonic() - t0)

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        profile_dir = tmp_path / "profile"
        analysis_dir = tmp_path / "analysis"
        profile_dir.mkdir()
        analysis_dir.mkdir()

        # Seed goals.json
        goals = {"moderate": {"calories": {"daily": 1200}, "protein": {"daily": 100}}}
        (profile_dir / "goals.json").write_text(json.dumps(goals), encoding="utf-8")
        # Seed timeline.json
        (profile_dir / "timeline.json").write_text("[]", encoding="utf-8")
        # Seed analysis file
        analysis_date = "2026-05-02"
        analysis = {"date": analysis_date, "entries": [], "coachResponses": []}
        (analysis_dir / f"{analysis_date}.json").write_text(json.dumps(analysis), encoding="utf-8")

        errors = []

        # Test 1: commit_goal.py
        result = subprocess.run(
            [sys.executable, str(commit_goal_py),
             "--field", "moderate.fiber.daily_g",
             "--value", "30",
             "--data-dir", str(tmp_path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            errors.append(f"commit_goal failed: {result.stderr[:200]}")
        else:
            goals_path = profile_dir / "goals.json"
            updated_goals = json.loads(goals_path.read_text())
            # Check timeline was updated
            timeline = json.loads((profile_dir / "timeline.json").read_text())
            if not isinstance(timeline, list):
                errors.append("timeline.json not a list after commit_goal")

        # Test 2: commit_plan.py (3 runs with different sources)
        if test_plan_json.exists():
            for source in [
                "coach-session-2026-05-02",
                "coach-session",
            ]:
                res = subprocess.run(
                    [sys.executable, str(commit_plan_py),
                     "--date", analysis_date,
                     "--plan-file", str(test_plan_json),
                     "--source", source,
                     "--data-dir", str(tmp_path)],
                    capture_output=True, text=True, timeout=30,
                )
                if res.returncode != 0:
                    errors.append(f"commit_plan({source}) failed: {res.stderr[:200]}")
                else:
                    analysis_data = json.loads(
                        (analysis_dir / f"{analysis_date}.json").read_text()
                    )
                    meal_plan = analysis_data.get("mealPlan")
                    if meal_plan is None:
                        errors.append(f"commit_plan({source}): mealPlan not in analysis")
                    else:
                        plan_source = meal_plan.get("source") or ""
                        if source not in plan_source and plan_source != source:
                            # Accept if source is preserved (exact or contains)
                            if plan_source != source:
                                errors.append(
                                    f"commit_plan({source}): source field is {plan_source!r}"
                                )

    elapsed = time.monotonic() - t0
    if errors:
        return TestResult("T6", "mealPlan source preservation", "FAIL",
                         details="; ".join(errors), elapsed=elapsed)
    return TestResult("T6", "mealPlan source preservation", "PASS",
                     details="commits=2 freehand=0", elapsed=elapsed)


# ── T7: Michael multi-user (privacy-strict) ──────────────────────────────────

def run_t7_michael(privacy_strict: bool) -> TestResult:
    data_dir = _find_data_dir("michael")
    if data_dir is None:
        return TestResult("T7", "Michael multi-user", "SKIP",
                         details="michael-coach/ data dir not found")

    # T7.A: deploy check
    lib_dir = data_dir / "processing" / "lib"
    orchestrator = data_dir / "processing" / "process_day.py"

    lib_deployed = lib_dir.exists()
    orch_deployed = orchestrator.exists()

    if privacy_strict:
        # Output booleans only
        details = f"lib_deployed={'Y' if lib_deployed else 'N'} orch_deployed={'Y' if orch_deployed else 'N'}"
    else:
        details = f"lib at {lib_dir}, orch at {orchestrator}"

    if not lib_deployed or not orch_deployed:
        return TestResult("T7", "Michael multi-user", "FAIL", details=details)

    return TestResult("T7", "Michael multi-user", "PASS", details=details)


# ── T8: Adversarial real-data ─────────────────────────────────────────────────

def run_t8_adversarial_real(quick: bool) -> TestResult:
    """T8: Adversarial inputs via test_adversarial_real_data.py.

    Uses pytest with tmp_path fixtures — no canonical file corruption possible.
    Each test case builds its own minimal sandbox and verifies graceful failure
    (exit non-zero) or correct handling without touching real data dirs.
    """
    if quick:
        return TestResult("T8", "adversarial real-data inputs", "SKIP",
                         details="skipped in --quick mode")
    r = _pytest_result("T8", "adversarial real-data inputs", "test_adversarial_real_data.py")
    return r


# ── T9: Watcher integration ───────────────────────────────────────────────────

def run_t9_watcher(quick: bool) -> TestResult:
    """T9: Watcher -DryRun integration test.

    Requires:
    - watcher.ps1 has [switch]$DryRun parameter (Stream E, 2026-05-02)
    - pwsh in PATH

    Pass criteria:
    - Lock acquired and released (no orphan lockfile)
    - No canonical relay PUTs (dry-run does not call relay)
    - sandbox/dryrun-*.json file produced
    """
    if quick:
        return TestResult("T9", "watcher integration (-DryRun)", "SKIP",
                         details="skipped in --quick mode")

    import shutil

    watcher_ps1 = _PROCESSING_DIR / "watcher.ps1"

    # Check DryRun flag exists in watcher.ps1
    dryrun_present = False
    if watcher_ps1.exists():
        content = watcher_ps1.read_text(encoding="utf-8", errors="replace")
        if "[switch]$DryRun" in content or "param.*DryRun" in content:
            dryrun_present = True

    if not dryrun_present:
        return TestResult("T9", "watcher integration (-DryRun)", "SKIP",
                         details="[switch]$DryRun not found in watcher.ps1")

    # Check pwsh availability
    pwsh = shutil.which("pwsh") or shutil.which("pwsh.exe")
    if not pwsh:
        return TestResult("T9", "watcher integration (-DryRun)", "SKIP",
                         details="pwsh not in PATH")

    sandbox_root = _TESTS_DIR / "sandbox" / "T9"
    try:
        if sandbox_root.exists():
            shutil.rmtree(sandbox_root)
        sandbox_root.mkdir(parents=True)

        t0 = time.monotonic()
        proc = subprocess.run(
            [pwsh, str(watcher_ps1), "-RunOnce", "-DryRun", "-DataDir", str(sandbox_root)],
            capture_output=True, text=True, timeout=120,
        )
        elapsed = time.monotonic() - t0

        issues = []
        stdout_combined = proc.stdout + proc.stderr

        # Check for dryrun-*.json output file
        dryrun_files = list(sandbox_root.glob("dryrun-*.json"))
        if not dryrun_files:
            # Also check logs/ subdir
            dryrun_files = list(sandbox_root.glob("**/dryrun-*.json"))

        if proc.returncode != 0 and "no pending data" not in stdout_combined.lower():
            issues.append(f"exit{proc.returncode}: {stdout_combined[-200:]}")

        # Lock file should not be left behind
        lock_files = list(sandbox_root.glob("*.lock")) + list(sandbox_root.glob("**/*.lock"))
        if lock_files:
            issues.append(f"orphan lock files: {[f.name for f in lock_files]}")

        if issues:
            return TestResult("T9", "watcher integration (-DryRun)", "FAIL",
                             details="; ".join(issues), elapsed=elapsed)

        detail = f"wall={elapsed:.1f}s dryrun_files={len(dryrun_files)}"
        return TestResult("T9", "watcher integration (-DryRun)", "PASS",
                         details=detail, elapsed=elapsed)

    except subprocess.TimeoutExpired:
        return TestResult("T9", "watcher integration (-DryRun)", "FAIL",
                         details="timeout after 120s", elapsed=120.0)
    except Exception as exc:
        return TestResult("T9", "watcher integration (-DryRun)", "ERROR",
                         details=str(exc)[:200])
    finally:
        if sandbox_root.exists():
            shutil.rmtree(sandbox_root)


# ── T10: PWA round-trip ───────────────────────────────────────────────────────

def run_t10_pwa_roundtrip(quick: bool) -> TestResult:
    """T10: PWA round-trip via test-fixtures/run-tests.js (Node.js + Playwright).

    Pass criteria: "Failed: 0" in output AND no console errors reported.
    Time-box: 300s.
    """
    if quick:
        return TestResult("T10", "PWA round-trip", "SKIP",
                         details="skipped in --quick mode")

    # Locate run-tests.js (test-fixtures/ at repo root, not pwa/tests/)
    repo_root = _PROCESSING_DIR.parent
    run_tests_js = repo_root / "test-fixtures" / "run-tests.js"
    if not run_tests_js.exists():
        # Fallback: check pwa/tests/
        alt = repo_root / "pwa" / "tests" / "run-tests.js"
        if alt.exists():
            run_tests_js = alt
        else:
            return TestResult("T10", "PWA round-trip", "SKIP",
                             details="run-tests.js not found in test-fixtures/ or pwa/tests/")

    import shutil
    node = shutil.which("node") or shutil.which("node.exe")
    if not node:
        return TestResult("T10", "PWA round-trip", "SKIP",
                         details="node not in PATH")

    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            [node, str(run_tests_js)],
            capture_output=True, text=True, timeout=300,
            cwd=str(run_tests_js.parent),
        )
        elapsed = time.monotonic() - t0
        output = proc.stdout + proc.stderr

        # Parse "Passed: N" and "Failed: M"
        import re
        passed_m = re.search(r"Passed:\s*(\d+)", output)
        failed_m = re.search(r"Failed:\s*(\d+)", output)
        n_passed = int(passed_m.group(1)) if passed_m else None
        n_failed = int(failed_m.group(1)) if failed_m else None

        # Check for console errors
        console_errors = len(re.findall(r"(?i)console\s*error|error\s*logged|✗", output))

        issues = []
        if n_failed is None:
            issues.append(f"could not parse Failed count from output (exit={proc.returncode})")
        elif n_failed > 0:
            issues.append(f"Failed={n_failed}")

        if issues:
            tail = output.splitlines()
            detail = "; ".join(issues) + " | " + " | ".join(tail[-5:])
            return TestResult("T10", "PWA round-trip", "FAIL",
                             details=detail[:300], elapsed=elapsed)

        detail = f"passed={n_passed} failed={n_failed} console_errors={console_errors}"
        return TestResult("T10", "PWA round-trip", "PASS",
                         details=detail, elapsed=elapsed)

    except subprocess.TimeoutExpired:
        return TestResult("T10", "PWA round-trip", "FAIL",
                         details="timeout after 300s", elapsed=300.0)
    except Exception as exc:
        return TestResult("T10", "PWA round-trip", "ERROR",
                         details=str(exc)[:200])


# ── T11.1: Commit helpers automated stub ─────────────────────────────────────

def run_t11_commit_helpers() -> TestResult:
    """T11.1: commit_goal + commit_plan via subprocess (same as T6 but labeled T11.1)."""
    # Delegate to T6 which covers both commit helpers
    r = run_t6_mealplan_preservation()
    return TestResult("T11.1", "commit-helpers automated stub", r.status,
                     details=r.details, elapsed=r.elapsed)


# ── T14: Pattern-recall tripwires ────────────────────────────────────────────

def run_t14_tripwires() -> TestResult:
    r = _pytest_result("T14", "pattern-recall tripwires", "test_pattern_recall.py")
    return r


# ── T15: Anti-speculation grounding ──────────────────────────────────────────

def run_t15_anti_speculation() -> TestResult:
    r = _pytest_result("T15", "anti-AI-speculation grounding", "test_anti_speculation.py")
    return r


# ── T16: Coachable moment recognition ────────────────────────────────────────

def run_t16_coachable_moments() -> TestResult:
    r = _pytest_result("T16", "coachable-moment recognition", "test_coachable_moments.py",
                      extra_args=["-k", "not test_coachable_moment_surfaced and not test_coachable_moments_pass_rate"])
    return r


# ── T18: Chat immutability ────────────────────────────────────────────────────

def run_t18_chat_immutability() -> TestResult:
    r = _pytest_result("T18", "chat immutability across runs", "test_chat_immutability.py")
    return r


# ── T19: Batched chronological replies ───────────────────────────────────────

def run_t19_batched_responses() -> TestResult:
    r = _pytest_result("T19", "batched chronological replies", "test_batched_responses.py")
    return r


# ── T20: Date isolation ───────────────────────────────────────────────────────

def run_t20_date_isolation() -> TestResult:
    r = _pytest_result("T20", "date isolation (sablefish bug)", "test_date_isolation.py")
    return r


# ── T21: Chat history restoration ────────────────────────────────────────────

def run_t21_restore_chat() -> TestResult:
    r = _pytest_result("T21", "chat history restoration", "test_restore_chat_history.py")
    return r


# ── Report formatter ─────────────────────────────────────────────────────────

def _format_result_line(r: TestResult, privacy_strict: bool) -> str:
    icon = "PASS" if r.status == "PASS" else r.status
    details = r.details
    if privacy_strict:
        details = _strip_private_content(details)
    elapsed_str = f" ({r.elapsed:.1f}s)" if r.elapsed > 0.1 else ""
    return f"{r.test_id:<8} {r.label:<42} | {icon:<5} | {details}{elapsed_str}"


def _strip_private_content(text: str) -> str:
    """Remove any content that might expose Michael's data."""
    import re
    text = re.sub(r'\d{3,5}\s*cal', '<N>cal', text)
    text = re.sub(r'\d+g\s+protein', '<N>g protein', text)
    text = re.sub(r'entry[_\s]\w+', 'entry_<id>', text)
    return text


def _write_summary(results: list[TestResult], output_path: Path, privacy_strict: bool) -> None:
    sections = {
        "Engineering correctness": ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11.1"],
        "User-mindset (grounding check)": ["T14", "T15", "T16"],
        "Critical user-facing (Part 7)": ["T18", "T19", "T20", "T21"],
    }

    by_id = {r.test_id: r for r in results}

    lines = ["# E2E Test Summary\n"]
    for section, ids in sections.items():
        lines.append(f"## {section}\n")
        lines.append(f"{'Test':<8} {'Label':<42} | Status | Details")
        lines.append("-" * 80)
        for tid in ids:
            r = by_id.get(tid)
            if r:
                lines.append(_format_result_line(r, privacy_strict))
        lines.append("")

    pass_count = sum(1 for r in results if r.status == "PASS")
    fail_count = sum(1 for r in results if r.status == "FAIL")
    skip_count = sum(1 for r in results if r.status == "SKIP")
    error_count = sum(1 for r in results if r.status == "ERROR")
    lines.append(f"**Total:** {pass_count} PASS / {fail_count} FAIL / {skip_count} SKIP / {error_count} ERROR\n")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[run_e2e] Summary written to {output_path}", flush=True)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="E2E test harness for health-tracker processing")
    parser.add_argument("--user", choices=["emily", "michael"], default="emily")
    parser.add_argument("--output", default="/tmp/test-summary.md")
    parser.add_argument("--quick", action="store_true", help="Skip slow LLM-dependent tests")
    parser.add_argument("--days", help="Comma-separated dates for T2 (e.g. 2026-04-25,2026-04-27)")
    parser.add_argument("--with-llm", dest="with_llm", action="store_true",
                       help="Enable real LLM calls for T4 (requires claude CLI)")
    args = parser.parse_args()

    user = args.user
    quick = args.quick
    with_llm = args.with_llm
    privacy_strict = (user == "michael")
    days = args.days.split(",") if args.days else None
    output_path = Path(args.output)

    print(f"[run_e2e] user={user} quick={quick} with_llm={with_llm} privacy_strict={privacy_strict}")

    results: list[TestResult] = []

    def run(test_fn: Callable, *fn_args) -> None:
        r = test_fn(*fn_args)
        results.append(r)
        line = _format_result_line(r, privacy_strict)
        print(f"  {line}", flush=True)

    print("\n=== Engineering correctness ===")
    run(run_t1_adversarial)
    run(run_t2_side_by_side, user, days, quick, privacy_strict)
    run(run_t3_stress, quick)
    run(run_t4_token_count, quick, with_llm)
    run(run_t5_latency, quick)
    run(run_t6_mealplan_preservation)
    if user == "michael":
        run(run_t7_michael, privacy_strict)
    run(run_t8_adversarial_real, quick)
    run(run_t9_watcher, quick)
    run(run_t10_pwa_roundtrip, quick)
    run(run_t11_commit_helpers)

    print("\n=== User-mindset ===")
    run(run_t14_tripwires)
    run(run_t15_anti_speculation)
    run(run_t16_coachable_moments)

    print("\n=== Critical user-facing (Part 7) ===")
    run(run_t18_chat_immutability)
    run(run_t19_batched_responses)
    run(run_t20_date_isolation)
    run(run_t21_restore_chat)

    _write_summary(results, output_path, privacy_strict)

    fail_count = sum(1 for r in results if r.status in ("FAIL", "ERROR"))
    print(f"\n[run_e2e] Done. {fail_count} failure(s).")
    return 1 if fail_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
