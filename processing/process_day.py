"""
process_day.py — Top-level orchestrator for the health-coaching pipeline.

Replaces ~60% of the monolith prompt with deterministic code.
Two LLM calls:
  1. Per-photo entry analysis (Haiku, parallel, up to 3 workers)
  2. Holistic day synthesis (Sonnet, single call)

Usage:
  python process_day.py --date 2026-05-01 --data-dir ~/coach --extract-dir /tmp/extract
  python process_day.py --date 2026-05-01 --data-dir ~/coach --extract-dir /tmp/extract --dry-run
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Ensure processing/ is on sys.path for lib/* imports
_PROCESSING_DIR = Path(__file__).resolve().parent
if str(_PROCESSING_DIR) not in sys.path:
    sys.path.insert(0, str(_PROCESSING_DIR))

from lib.load_profile import load_profile
from lib.apply_goal_updates import apply_goal_updates
from lib.weight_typo import detect as detect_weight_typo
from lib.reconcile_entries import reconcile
from lib.invoke_entry_analyzer import analyze as analyze_entry
from lib.fiber_split import estimate_split_inplace
from lib.compute_totals import compute as compute_totals
from lib.compute_goals_block import compute as compute_goals_block
from lib.compute_streaks import compute as compute_streaks
from lib.invoke_day_synthesis import synthesize
from lib.data_grounding import validate_grounding
from lib.build_pwa_profile_echo import build as build_pwa_profile_echo
from lib.validate_schema import validate as validate_schema
from lib.append_conversations import append as append_conversations

# Set COACH_STUB_LLM=1 to bypass all LLM calls (for tests/dry runs without claude CLI)
_STUB_LLM = os.environ.get("COACH_STUB_LLM") == "1"

if _STUB_LLM:
    def analyze_entry(entry, profile, photo_path=None, **_):  # noqa: F811
        return {**entry, "calories": 0, "protein": 0, "carbs": 0, "fat": 0,
                "fiber": 0, "description": entry.get("notes") or entry.get("type", "stubbed"),
                "confidence": "low"}

    def synthesize(**_):  # noqa: F811
        return {"coachResponses": [], "highlights": [], "concerns": [],
                "mealPlan": None, "regimen": None, "plan_decision_reason": "stub"}


def main(
    date: str,
    data_dir: Path,
    extract_dir: Path,
    backup_dir: Path | None = None,
    dry_run: bool = False,
) -> dict:
    """Run the full processing pipeline for a single date.

    Returns the final analysis dict.
    Raises SystemExit(1) on validation failure.
    """
    t_start = time.monotonic()
    print(f"[process_day] Starting pipeline for {date}", flush=True)

    # ── DETERMINISTIC LAYER 1 ─────────────────────────────────────────────────
    try:
        profile = load_profile(data_dir, extract_dir)
    except FileNotFoundError as exc:
        print(f"[process_day] ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)

    print(f"[process_day] Profile loaded. Goals: calories={profile['goals'].get('calories')}, "
          f"protein={profile['goals'].get('protein')}", flush=True)

    if not dry_run:
        n_updates = apply_goal_updates(data_dir, extract_dir)
        if n_updates:
            print(f"[process_day] Applied {n_updates} goal update(s)", flush=True)
            # Reload profile after goal updates
            profile = load_profile(data_dir, extract_dir)

    try:
        log_data = _read_log_json(extract_dir, date)
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as exc:
        print(f"[process_day] ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)

    print(f"[process_day] Log loaded: {len(log_data.get('entries', []))} entries", flush=True)

    # Weight typo detection
    weight_entry = _extract_weight(log_data)
    weight_result = None
    if weight_entry is not None:
        recent_weights = _load_recent_weights(data_dir, date, days=5)
        weight_result = detect_weight_typo(weight_entry, recent_weights)
        if weight_result.get("corrected"):
            print(f"[process_day] Weight correction: {weight_result['correction_note']}", flush=True)

    # Entry reconciliation
    existing_analysis = _read_existing_analysis(data_dir, date)
    existing_entries = existing_analysis.get("entries", []) if existing_analysis else []
    new_entries, kept_entries = reconcile(log_data.get("entries", []), existing_entries)
    print(f"[process_day] Reconciliation: {len(new_entries)} new, {len(kept_entries)} kept", flush=True)

    # ── ENTRY ANALYSIS (parallel, Haiku) ─────────────────────────────────────
    analyzed_new: list[dict] = []
    if new_entries:
        print(f"[process_day] Analyzing {len(new_entries)} entries (Haiku, max 3 parallel)...", flush=True)
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_to_entry = {
                executor.submit(analyze_entry, entry, profile, _find_photos(entry, extract_dir)): entry
                for entry in new_entries
            }
            for future in as_completed(future_to_entry):
                result = future.result()
                analyzed_new.append(result)
    else:
        print("[process_day] No new entries to analyze", flush=True)

    # ── DETERMINISTIC LAYER 2 ─────────────────────────────────────────────────
    all_entries = analyzed_new + kept_entries

    # Auto-grow knownProducts from any label-photo uploads. If user
    # uploaded a photo of a nutrition-facts panel, Haiku set isLabel:true
    # and labelData; we persist the product to preferences so future entries
    # match it deterministically.
    if not dry_run and analyzed_new:
        try:
            from lib.learn_known_products import learn_from_analyzed_entries
            n_learned = learn_from_analyzed_entries(analyzed_new, data_dir)
            if n_learned:
                print(f"[process_day] Learned {n_learned} new product(s) from labels", flush=True)
                # Reload profile so downstream synthesis sees the new products
                profile = load_profile(data_dir, extract_dir)
        except Exception as exc:
            print(f"[process_day] WARN: label learning failed: {exc}", flush=True)

    # Detect and mark duplicates (one meal logged as 2+ entries via separate
    # photos). Marked entries are zeroed in totals; coach can still see them.
    try:
        from lib.dedupe_meals import apply_duplicate_marks
        n_dupes = apply_duplicate_marks(all_entries)
        if n_dupes:
            print(f"[process_day] Marked {n_dupes} duplicate entry/entries (one meal logged twice)", flush=True)
    except Exception as exc:
        print(f"[process_day] WARN: dedupe_meals failed: {exc}", flush=True)

    estimate_split_inplace(all_entries)
    totals = compute_totals(all_entries)
    print(f"[process_day] Totals: {totals}", flush=True)

    goals_block = compute_goals_block(totals, profile)
    streaks = compute_streaks(data_dir, date, totals)
    pwa_profile_data = build_pwa_profile_echo(profile, profile.get("_phone_pwa_profile"))

    plan_should_trigger = _plan_triggered(profile, existing_analysis, totals)

    # Load recent history for synthesis context
    recent_history = _load_recent_history(data_dir, date, days=7)

    # ── HOLISTIC SYNTHESIS (Sonnet, single call) ──────────────────────────────
    # PWA emits coachChat: null when there are no chat messages (not missing key).
    # dict.get("k", default) returns None for an explicit null, not the default,
    # so we need an explicit None-check, not a default arg.
    all_chat = log_data.get("coachChat") or []
    unanswered_messages = _compute_unanswered(all_chat, existing_analysis)
    print(
        f"[process_day] Coach messages: {len(all_chat)} total, "
        f"{len(unanswered_messages)} unanswered",
        flush=True,
    )

    print("[process_day] Running day synthesis (Sonnet)...", flush=True)
    synthesis = synthesize(
        date=date,
        profile=profile,
        totals=totals,
        goals_block=goals_block,
        all_entries=all_entries,
        coach_messages=all_chat,
        recent_history=recent_history,
        plan_triggered=plan_should_trigger,
        unanswered_messages=unanswered_messages,
    )
    print(f"[process_day] Synthesis done: {len(synthesis['coachResponses'])} responses, "
          f"{len(synthesis['highlights'])} highlights", flush=True)

    # ── DATA GROUNDING VALIDATION ─────────────────────────────────────────────
    synthesis = _run_grounding_validation(
        synthesis, all_entries, totals, profile, date,
        plan_triggered=plan_should_trigger,
        coach_messages=(log_data.get("coachChat") or []),
        recent_history=recent_history,
        goals_block=goals_block,
    )

    # ── ASSEMBLE OUTPUT ───────────────────────────────────────────────────────
    output = _assemble_analysis(
        date=date,
        entries=all_entries,
        totals=totals,
        goals_block=goals_block,
        streaks=streaks,
        synthesis=synthesis,
        pwa_profile=pwa_profile_data,
        weight_result=weight_result,
    )

    # Chat immutability rule (Part 7.1): coachResponses entries are append-only.
    # Once written, never modified by future cron runs.
    #
    # Build the canonical set of pre-existing responses from TWO sources:
    #   1. The day's analysis JSON (if present)
    #   2. conversations.md (always-on append-only log) — backstop for when
    #      the analysis file was deleted/corrupted/lost. Without this, ANY
    #      reprocessing that runs without the prior analysis silently loses
    #      previously-delivered coach messages.
    existing_responses: list[dict] = []
    if existing_analysis:
        existing_responses = list(existing_analysis.get("coachResponses") or [])
    # Only fall back to conversations.md if the analysis JSON has no
    # responses (file missing or wiped). Otherwise the analysis is the
    # truth and we don't want to re-inject older variants from conv.md
    # that might have accumulated across many synth runs.
    if not existing_responses:
        try:
            from lib.restore_chat_history import load_coach_responses_for_date
            existing_responses = list(load_coach_responses_for_date(data_dir, date))
            if existing_responses:
                print(
                    f"[process_day] Restored {len(existing_responses)} responses from conversations.md "
                    f"(analysis JSON had none for {date})",
                    flush=True,
                )
        except Exception as exc:
            print(f"[process_day] WARN: conversations.md restore failed: {exc}", flush=True)

    if existing_responses:
        output["coachResponses"] = _merge_coach_responses(
            existing=existing_responses,
            new=output["coachResponses"],
        )

    # ── SCHEMA VALIDATION ─────────────────────────────────────────────────────
    ok, violations = validate_schema(output)
    if not violations:
        print("[process_day] Schema validation passed", flush=True)
    else:
        print(f"[process_day] Schema violations: {violations}", flush=True)
        if not ok:
            sys.exit(1)

    # ── WRITE OUTPUT ──────────────────────────────────────────────────────────
    if not dry_run:
        analysis_path = data_dir / "analysis" / f"{date}.json"
        _atomic_write(analysis_path, output)
        print(f"[process_day] Wrote {analysis_path}", flush=True)

        append_conversations(
            data_dir,
            (log_data.get("coachChat") or []),
            output["coachResponses"],  # use merged list (existing + new)
            date=date,                  # CRITICAL: append to the day being
                                        # processed, not "today" — fixes
                                        # reprocess-old-date misrouting.
        )
    else:
        print("[process_day] DRY RUN — no files written", flush=True)

    elapsed = time.monotonic() - t_start
    print(f"[process_day] Pipeline complete in {elapsed:.1f}s", flush=True)
    return output


# ── Helpers ───────────────────────────────────────────────────────────────────

def _read_log_json(extract_dir: Path, date: str) -> dict:
    """Read the log.json from the extracted ZIP.

    Raises FileNotFoundError if no log file is found (empty or missing extract dir).
    Raises json.JSONDecodeError if the file exists but contains invalid JSON.
    """
    candidates = [
        # Standard PWA upload ZIP layout: daily/{date}/log.json (most common in production)
        extract_dir / "daily" / date / "log.json",
        # Legacy / test fixtures
        extract_dir / f"{date}.json",
        extract_dir / "log.json",
        extract_dir / "data" / f"{date}.json",
        extract_dir / "data" / "log.json",
        # Nested case some ZIPs produce: daily/{date}/daily/{date}/log.json
        extract_dir / "daily" / date / "daily" / date / "log.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            with open(candidate, encoding="utf-8") as f:
                return json.load(f)
    candidates_str = ", ".join(str(c.name) for c in candidates[:2])
    raise FileNotFoundError(
        f"No log.json found in extract_dir {extract_dir}. "
        f"Expected one of: {candidates_str}"
    )


def _read_existing_analysis(data_dir: Path, date: str) -> dict | None:
    path = data_dir / "analysis" / f"{date}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _extract_weight(log_data: dict) -> float | None:
    """Extract weight value from log entries if present."""
    for entry in log_data.get("entries", []):
        if entry.get("type", "").lower() in ("weight", "body_weight"):
            val = entry.get("value") or entry.get("weight")
            if isinstance(val, (int, float)):
                return float(val)
    return None


def _load_recent_weights(data_dir: Path, current_date: str, days: int = 5) -> list[float]:
    """Load weight values from the last N days of analysis files."""
    weights = []
    analysis_dir = data_dir / "analysis"
    if not analysis_dir.exists():
        return weights

    import re
    files = sorted(
        [f for f in analysis_dir.glob("*.json") if re.match(r'^\d{4}-\d{2}-\d{2}$', f.stem)],
        key=lambda f: f.stem,
        reverse=True,
    )

    for f in files:
        if f.stem >= current_date:
            continue
        if len(weights) >= days:
            break
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
            weight = data.get("weight") or data.get("totals", {}).get("weight")
            if isinstance(weight, (int, float)):
                weights.append(float(weight))
        except (json.JSONDecodeError, OSError):
            continue

    return list(reversed(weights))


def _find_photos(entry: dict, extract_dir: Path) -> list[Path]:
    """Locate ALL photo files for an entry. Returns a list (possibly empty).

    Multi-photo per entry: PWA names them daily/{date}/photos/{entry.id}.jpg,
    {entry.id}_2.jpg, {entry.id}_3.jpg, etc. (single-photo entries have just
    {entry.id}.jpg, no suffix). Without finding all of them, Haiku only sees
    the first photo even if the user uploaded 3 views of the same meal --
    classic cause of mis-estimated calories.
    """
    if not entry.get("photo"):
        return []
    photo_id = entry.get("photoId") or entry.get("photo_id") or entry.get("id")
    if not photo_id:
        return []
    date = entry.get("date")
    search_dirs: list[Path] = []
    if date:
        search_dirs.append(extract_dir / "daily" / date / "photos")
    search_dirs.append(extract_dir / "photos")  # legacy / test fixture layout

    found: list[Path] = []
    for d in search_dirs:
        if not d.exists():
            continue
        # First photo: {id}.{ext}; additional: {id}_2.{ext}, {id}_3.{ext}, ...
        # Cap at 12 to avoid pathological loops.
        for n in range(1, 13):
            suffix = "" if n == 1 else f"_{n}"
            for ext in (".jpg", ".jpeg", ".png", ".heic"):
                candidate = d / f"{photo_id}{suffix}{ext}"
                if candidate.exists():
                    found.append(candidate)
                    break
            else:
                # No file with this index in this dir; try next dir or stop
                if n == 1:
                    continue  # base photo not in this dir, try next dir
                break  # no more numbered photos in this dir
        if found:
            return found  # use first dir that has anything
    return found


def _find_photo(entry: dict, extract_dir: Path) -> Path | None:
    """Back-compat single-photo wrapper for legacy callers (tests etc.)."""
    photos = _find_photos(entry, extract_dir)
    return photos[0] if photos else None


def _plan_triggered(profile: dict, existing_analysis: dict | None, totals: dict) -> bool:
    """Decide if a plan should be generated/refreshed."""
    if existing_analysis is None:
        return True  # First run of the day

    meal_plan = existing_analysis.get("mealPlan")
    if meal_plan is None:
        return True

    # Don't overwrite a coach-session plan
    source = (meal_plan.get("source") or "").lower()
    if "coach-session" in source:
        return False

    # Regenerate if plan is stale (no days or >3 days old)
    plan_date = meal_plan.get("generatedDate") or meal_plan.get("date") or ""
    if not plan_date:
        return True

    return False


def _load_recent_history(data_dir: Path, current_date: str, days: int = 7) -> list[dict]:
    """Load summarized history from last N analysis files."""
    history = []
    analysis_dir = data_dir / "analysis"
    if not analysis_dir.exists():
        return history

    import re
    files = sorted(
        [f for f in analysis_dir.glob("*.json") if re.match(r'^\d{4}-\d{2}-\d{2}$', f.stem)],
        key=lambda f: f.stem,
        reverse=True,
    )

    for f in files:
        if f.stem >= current_date:
            continue
        if len(history) >= days:
            break
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
            t = data.get("totals") or {}
            history.append({
                "date": f.stem,
                "calories": t.get("calories"),
                "protein": t.get("protein"),
                "fiber": t.get("fiber"),
                "weight": data.get("weight"),
            })
        except (json.JSONDecodeError, OSError):
            continue

    return list(reversed(history))


def _run_grounding_validation(
    synthesis: dict,
    all_entries: list,
    totals: dict,
    profile: dict,
    date: str,
    **synthesis_kwargs,
) -> dict:
    """Validate synthesis output references only today's data.

    On violation: retry synthesis once with grounding feedback appended.
    If still failing: strip sentences containing the violating entity and proceed.
    """
    grounding = validate_grounding(synthesis, all_entries, totals, profile)

    if grounding["ok"]:
        if grounding.get("warnings"):
            for w in grounding["warnings"]:
                print(f"[process_day] GROUNDING WARN: {w}", flush=True)
        return synthesis

    for v in grounding["violations"]:
        print(f"[process_day] GROUNDING VIOLATION: {v}", flush=True)

    # Retry synthesis once with grounding feedback injected
    print("[process_day] Retrying synthesis with grounding feedback...", flush=True)
    try:
        retry_synthesis = synthesize(
            date=date,
            profile=profile,
            totals=totals,
            goals_block=synthesis_kwargs.get("goals_block", {}),
            all_entries=all_entries,
            coach_messages=synthesis_kwargs.get("coach_messages", []),
            recent_history=synthesis_kwargs.get("recent_history", []),
            plan_triggered=synthesis_kwargs.get("plan_triggered", False),
            grounding_feedback=grounding["suggested_retry_feedback"],
        )
        retry_grounding = validate_grounding(retry_synthesis, all_entries, totals, profile)
        if retry_grounding["ok"]:
            print("[process_day] Grounding retry succeeded.", flush=True)
            return retry_synthesis
        for v in retry_grounding["violations"]:
            print(f"[process_day] GROUNDING RETRY VIOLATION: {v}", flush=True)
        synthesis = retry_synthesis
        grounding = retry_grounding
    except Exception as e:
        print(f"[process_day] Grounding retry failed: {e}", flush=True)

    # Fallback: strip sentences containing violating entities
    synthesis = _strip_grounding_violations(synthesis, grounding["violations"])
    print("[process_day] Applied naive sentence stripping for unresolved grounding violations.", flush=True)
    return synthesis


def _strip_grounding_violations(synthesis: dict, violations: list[str]) -> dict:
    """Remove sentences from synthesis text that contain flagged entity names."""
    import re as _re

    # Extract entity names from violation messages
    entities = []
    for v in violations:
        m = _re.search(r"'([^']+)'", v)
        if m:
            entities.append(_re.escape(m.group(1)))

    if not entities:
        return synthesis

    pattern = _re.compile(
        r'[^.!?]*(?:' + "|".join(entities) + r')[^.!?]*[.!?]?',
        _re.IGNORECASE,
    )

    def _strip(text: str) -> str:
        return pattern.sub("", text).strip()

    result = dict(synthesis)
    result["highlights"] = [_strip(h) for h in synthesis.get("highlights") or [] if _strip(h)]
    result["concerns"] = [_strip(c) for c in synthesis.get("concerns") or [] if _strip(c)]
    result["coachResponses"] = [
        {**resp, "text": _strip(resp.get("text", ""))}
        for resp in synthesis.get("coachResponses") or []
    ]
    return result


def _assemble_analysis(
    date, entries, totals, goals_block, streaks, synthesis, pwa_profile, weight_result
) -> dict:
    output: dict = {
        "date": date,
        "entries": entries,
        "totals": totals,
        "goals": goals_block,
        "streaks": streaks,
        "highlights": synthesis["highlights"],
        "concerns": synthesis["concerns"],
        "coachResponses": synthesis["coachResponses"],
        "planDecisionReason": synthesis["plan_decision_reason"],
        "pwaProfile": pwa_profile,
        "generatedAt": int(time.time() * 1000),
    }
    if synthesis.get("mealPlan"):
        output["mealPlan"] = synthesis["mealPlan"]
    if synthesis.get("regimen"):
        output["regimen"] = synthesis["regimen"]
    if weight_result:
        output["weight"] = weight_result["value"]
        if weight_result.get("corrected"):
            output["weightCorrectionNote"] = weight_result["correction_note"]
    return output


def _compute_unanswered(
    all_chat: list[dict], existing_analysis: dict | None
) -> list[dict]:
    """Filter user messages to those without an existing coach response.

    Without this, every cron tick re-responds to already-answered messages.
    The merge step dedups by response.id, but each cron tick generates fresh
    response ids, so id-based dedup never fires. The real dedup key is the
    message id being responded to (in respondsTo[] or legacy replyTo scalar).

    Returns the subset of all_chat whose id does not appear in any existing
    response's respondsTo/replyTo. Order preserved.
    """
    if not all_chat:
        return []
    already_responded_ids: set[str] = set()
    for r in ((existing_analysis or {}).get("coachResponses") or []):
        rt = r.get("respondsTo")
        if isinstance(rt, list):
            already_responded_ids.update(x for x in rt if x)
        elif r.get("replyTo"):
            already_responded_ids.add(r["replyTo"])
    return [m for m in all_chat if m.get("id") not in already_responded_ids]


def _merge_coach_responses(existing: list[dict], new: list[dict]) -> list[dict]:
    """Merge new coach responses while preserving all existing ones.

    Hard rules (CLAUDE.md Key Principles #8 and #9):
      - Existing entries are NEVER modified, removed, or rewritten. Once a
        response was synced to the phone, the user has read it; any later
        edit is rewriting history she remembers.
      - New entries that try to respond to a message id ALREADY answered by
        an existing response are dropped (not appended). Otherwise we end
        up with N coach responses to the same user message — the
        duplicate-response bug class.
      - Only genuinely-new responses (covering at least one msg id NOT yet
        answered) are appended.
    """
    # Build set of msg ids already answered by existing responses
    answered_msg_ids: set[str] = set()
    for r in existing:
        rt = r.get("respondsTo")
        if isinstance(rt, list):
            answered_msg_ids.update(x for x in rt if x)
        elif r.get("replyTo"):
            answered_msg_ids.add(r["replyTo"])

    existing_ids = {r["id"] for r in existing if "id" in r}
    merged = list(existing)
    for resp in new:
        rid = resp.get("id")
        # Drop if same response id already exists (idempotency)
        if rid is not None and rid in existing_ids:
            continue
        # Drop if every message this response targets has already been
        # answered by some existing response. Without this guard, repeated
        # synth runs that incorrectly treat already-answered messages as
        # "unanswered" produce duplicate-response storms.
        new_targets = resp.get("respondsTo") or (
            [resp["replyTo"]] if resp.get("replyTo") else []
        )
        if new_targets and all(t in answered_msg_ids for t in new_targets):
            continue
        merged.append(resp)
    return merged


def _atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Health coach daily processing pipeline")
    parser.add_argument("--date", required=True, help="Date to process (YYYY-MM-DD)")
    parser.add_argument("--data-dir", required=True, help="Path to user data directory")
    parser.add_argument("--extract-dir", required=True, help="Path to extracted ZIP directory")
    parser.add_argument("--backup-dir", help="Optional backup directory")
    parser.add_argument("--dry-run", action="store_true", help="Skip all file writes")
    args = parser.parse_args()

    main(
        date=args.date,
        data_dir=Path(args.data_dir).expanduser(),
        extract_dir=Path(args.extract_dir).expanduser(),
        backup_dir=Path(args.backup_dir).expanduser() if args.backup_dir else None,
        dry_run=args.dry_run,
    )
