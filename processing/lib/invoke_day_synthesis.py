"""
invoke_day_synthesis.py — The holistic synthesis call (Sonnet, single call per day).

Sees the full day: entries, totals, goals, coach messages, 7-day history.
Returns coachResponses, highlights, concerns, mealPlan (nullable), regimen (nullable).

LLM calls: YES (one Sonnet call per day).
"""

from __future__ import annotations
import json
import subprocess
import time
from pathlib import Path
from lib.parse_claude_json import parse_claude_json

_DEFAULT_MODEL = "sonnet"
_OUTPUT_SCHEMA = {
    "coachResponses": "list of {id, timestamp, respondsTo: [msgId,...], text} — ONE entry per batch; replyTo: respondsTo[0] emitted for backward compat",
    "highlights": "list of strings",
    "concerns": "list of strings",
    "mealPlan": "null OR {source, days: [...]}",
    "regimen": "null OR {weeklySchedule: [...]}",
    "plan_decision_reason": "string",
}


def synthesize(
    date: str,
    profile: dict,
    totals: dict,
    goals_block: dict,
    all_entries: list,
    coach_messages: list,
    recent_history: list,
    plan_triggered: bool,
    model: str = _DEFAULT_MODEL,
    grounding_feedback: str = "",
    unanswered_messages: list | None = None,
) -> dict:
    """Run the holistic day synthesis.

    Returns dict with keys:
        coachResponses, highlights, concerns, mealPlan, regimen, plan_decision_reason

    grounding_feedback: if non-empty, appended to the prompt as a correction instruction.
    unanswered_messages: [{id, timestamp, text}, ...] — user messages with no coach reply yet.
        When provided, the model generates ONE batched coachResponse with respondsTo: [all_ids].
        When None, falls back to legacy per-message behavior.

    On failure after retry, raises RuntimeError.
    """
    prompt = _build_synthesis_prompt(
        date, profile, totals, goals_block, all_entries,
        coach_messages, recent_history, plan_triggered,
        unanswered_messages=unanswered_messages,
    )
    if grounding_feedback:
        prompt += f"\n\nGROUNDING CORRECTION REQUIRED: {grounding_feedback}"

    last_error = None
    for attempt in range(2):
        result = _call_claude(prompt, model)
        if result is None:
            last_error = "claude -p returned no output"
            continue

        violations = _validate_synthesis_schema(result)
        if not violations:
            return _normalize_synthesis(result)

        last_error = f"schema violations: {violations}"
        if attempt == 0:
            prompt = prompt + f"\n\nPREVIOUS ATTEMPT SCHEMA VIOLATIONS: {violations}\nReturn a valid JSON object matching the required schema exactly."

    raise RuntimeError(f"Day synthesis failed after 2 attempts: {last_error}")


def _build_synthesis_prompt(
    date, profile, totals, goals_block, all_entries,
    coach_messages, recent_history, plan_triggered,
    unanswered_messages=None,
) -> str:
    prefs = profile.get("preferences") or {}
    coaching_tone = prefs.get("coachingTone") or prefs.get("coaching_tone") or {}

    soul_text = _load_coach_soul()
    tone_rules = _format_tone_rules(coaching_tone)
    history_summary = _format_history(recent_history)
    entries_summary = _summarize_entries(all_entries)
    weight_block = _format_weight_block(all_entries, profile)
    messages_str = json.dumps(coach_messages or [], ensure_ascii=False)
    totals_str = json.dumps(totals, ensure_ascii=False)
    goals_str = json.dumps(goals_block, ensure_ascii=False)

    plan_instruction = ""
    if plan_triggered:
        plan_instruction = (
            "\nPLAN TRIGGERED: Generate or refresh a 3-day meal plan and weekly workout regimen.\n"
            "\n"
            "mealPlan SCHEMA (use EXACTLY this shape — no variations):\n"
            '{\n'
            '  \"source\": \"phase-2-processing\",\n'
            '  \"generated\": \"YYYY-MM-DD\",  // ISO date string, NOT epoch ms\n'
            '  \"days\": [\n'
            '    {\n'
            '      \"day\": 1,\n'
            '      \"date\": \"YYYY-MM-DD\",\n'
            '      \"totals\": {\"calories\": <int>, \"protein\": <int>, \"fat\": <int>, \"fiber\": <int>},\n'
            '      \"meals\": {\n'
            '        \"breakfast\": {\"name\": \"...\", \"calories\": <int>, \"protein\": <int>, \"fat\": <int>, \"fiber\": <int>, \"prep_time\": \"X min\", \"ingredients\": [\"...\"]},\n'
            '        \"lunch\": {...same shape},\n'
            '        \"dinner\": {...},\n'
            '        \"snack\": {...}\n'
            '      }\n'
            '    },\n'
            '    ...3 days total\n'
            '  ]\n'
            '}\n'
            "Use the dict-keyed-by-meal-type shape EXACTLY. Do NOT use a list of meals.\n"
            "\n"
            "regimen SCHEMA (use EXACTLY this shape):\n"
            '{\n'
            '  \"source\": \"phase-2-processing\",\n'
            '  \"generated\": \"YYYY-MM-DD\",\n'
            '  \"phase\": \"<recomp/cut/maintenance>\",\n'
            '  \"focus\": \"<one-line summary>\",\n'
            '  \"weeklySchedule\": [\n'
            '    {\n'
            '      \"day\": \"monday\",  // lowercase day name\n'
            '      \"type\": \"strength|cardio|active_recovery|rest\",\n'
            '      \"focus\": \"...\",\n'
            '      \"duration_min\": <int>,\n'
            '      \"description\": \"...\",  // shown on rest days\n'
            '      \"exercises\": [{\"name\": \"...\", \"sets\": <int>, \"reps\": \"<range>\", \"note\": \"...\"}]\n'
            '    },\n'
            '    ...one entry per day of the week (7 entries)\n'
            '  ]\n'
            '}\n'
            "Use camelCase 'weeklySchedule' (NOT weekly_schedule, NOT days, NOT weeklyStructure). "
            "Day name is lowercase ('monday' not 'Monday' or 'mon')."
        )
    else:
        plan_instruction = "\nPLAN NOT TRIGGERED: Set mealPlan and regimen to null."

    if unanswered_messages is not None:
        unanswered_str = json.dumps(unanswered_messages, ensure_ascii=False)
        coach_response_schema = (
            '{"id": "coach_resp_<epoch_ms>", "timestamp": <ms epoch int>, '
            '"respondsTo": ["<id1>", "<id2>", ...], '
            '"text": "<coach reply, 30-400 chars, no em-dashes, no smart quotes>"}'
        )
        coach_response_rules = (
            "- coachResponses: generate EXACTLY ONE entry covering all unanswered messages.\n"
            "  respondsTo must contain ALL message ids from unansweredMessages.\n"
            "  If messages cover different topics, address each in 1-2 sentences within one reply.\n"
            "  If they form a stream on one topic, treat them as one question.\n"
            "  If unansweredMessages is empty, return empty array []."
        )
        unanswered_section = f"\nUNANSWERED MESSAGES (generate ONE response covering all):\n{unanswered_str}\n"
    else:
        coach_response_schema = (
            '{"replyTo": "<exact user message id>", '
            '"text": "<coach reply, 30-400 chars, no em-dashes, no smart quotes>", '
            '"timestamp": <ms epoch int>}'
        )
        coach_response_rules = (
            "- coachResponses: one entry per coach message. If no messages, return empty array."
        )
        unanswered_section = ""

    prompt = f"""You are a health coach. Analyze today's data and return ONLY a JSON object (no markdown, no extra text).

COACH SOUL (your voice and character):
{soul_text}

USER TONE RULES (apply these on top of your SOUL):
{tone_rules}

=== TODAY'S DATA (the day you are analyzing) ===
DATE: {date}

TODAY'S TOTALS:
{totals_str}

GOALS STATUS:
{goals_str}

TODAY'S ENTRIES (the ONLY entries that belong to today):
{entries_summary}

TODAY'S WEIGHT:
{weight_block}

COACH MESSAGES (conversation history):
{messages_str}
{unanswered_section}
=== RECENT HISTORY (for TREND awareness only -- NEVER attribute these to today's macros) ===
Each line is a one-line summary: DATE: cal=X protein=Y fiber=Z [weight=W] [key_event]
{history_summary}

=== AVAILABLE TOOLS ===
You have Read, Glob, and Grep available. Use them when historical context
beyond the 7-day window above would meaningfully improve a coach response.
Examples of when to dig:
  - User references something from "a few weeks ago" -> grep conversations.md
  - User asks "did I do this before?" -> glob analysis files, read a few
  - You want to verify a profile setting -> read coach/profile/*.json
  - User cites a specific past meal/workout -> grep analysis/*.json for it
The conversations.md file at coach/conversations.md is your full chat
history with the user — append-only, never overwritten.

=== INSTRUCTIONS ===
- highlights, concerns, and coachResponses MUST describe TODAY'S behavior only (date: {date})
- The entries listed in TODAY'S DATA above are the complete and authoritative list of what happened today
- When referencing recent history, USE EXPLICIT TEMPORAL MARKERS: "yesterday's sablefish", "earlier this week", "Tuesday's workout", "last week's trend"
- Bare references to foods or entities NOT in today's entries are FORBIDDEN -- always add a temporal marker
- Numerical claims (calories, protein, etc.) must be supported by today's totals above
- Never say a food was "today's" unless it appears in TODAY'S ENTRIES above
{plan_instruction}

REQUIRED OUTPUT SCHEMA (return this exact JSON structure):
{{
  "coachResponses": [
    {coach_response_schema}
  ],
  "highlights": ["<positive observation, max 120 chars each>"],
  "concerns": ["<actionable concern, max 120 chars each>"],
  "goalUpdates": null,
  "mealPlan": null,
  "regimen": null,
  "plan_decision_reason": "<fresh-day|coach-session-preserved|not-stale|plan-requested>"
}}

GOAL UPDATES FROM CHAT:
If the user EXPLICITLY asks to change a goal in chat (e.g. "bump my
calories to 1000", "change my protein target to 100g", "set water to 80oz"),
emit a goalUpdates object alongside your coach response. This is the only
way coach can persist a goal change from chat — without this, the change
won't stick.

Schema for goalUpdates (deep-merge patch onto profile/goals.json):
{{
  "calories": {{"daily": <int>}},  // for "bump cals to N"
  "macros": {{
    "protein": {{"target": <int>}},  // for "set protein to N"
    "fat": {{"floor": <int>}}
  }},
  "water_oz": <int>,                  // for "water target N oz"
  "fiber": {{"daily_g": <int>}}
}}

Only include fields the user actually asked to change. If goalUpdates is
non-null, your coach response should CONFIRM the change (e.g. "Updated --
calorie target is 1000 going forward") instead of telling the user to go
to Settings. The orchestrator applies the patch atomically AFTER your
response is written.

If the user did NOT ask for a goal change, set goalUpdates to null.

RULES:
{coach_response_rules}
- highlights: 0-2 NOTEWORTHY positive observations. Be selective. Skip unless
  the user did something they wouldn't be doing routinely. Examples of what
  NOT to highlight: daily weight reading (she weighs every day), routine
  supplement intake (psyllium, creatine, collagen are daily staples), basic
  hydration logging. Examples of what DOES warrant a highlight: protein
  density on a low-cal meal, hitting a streak milestone, a meal that beat
  the goal, a workout completed, an unusually clean macro day. If nothing
  exceeded the baseline, return an empty array. Do not pad highlights to
  fill space -- empty is fine on a routine day.
- concerns: 0-2 actionable items. Skip if day looks good.
- No em-dashes (—). No smart quotes (''""). Use plain ASCII.
- Over-count calories when uncertain.
- Never address user as babe, honey, sweetie, or girl.
- You CANNOT directly update goals, settings, or profile. If the user asks
  to change a calorie target, protein goal, or any setting in chat, do NOT
  say "got it, that's the new target" -- that is a lie because the system
  does not persist chat-driven settings changes. Instead, acknowledge the
  intent and tell them to update it via the Settings tab. Example:
  user: "bump my calories to 1000"
  bad:  "Got it, 1000 is the new target."
  good: "Open Settings and edit your calorie goal to 1000 -- I can't update
        it from chat. I'll work with whatever's saved there."
- If any entry shows [!! ANALYSIS FAILED ...] in TODAY'S ENTRIES, today's
  totals are undercounted. Mention the gap in passing if relevant ("a
  couple meal photos are still being analyzed, real intake is likely
  higher") but DO NOT tell the user to retry or edit anything -- the
  system handles retries automatically. Do NOT give calorie-deficit
  advice as if totals are complete when entries failed.
"""
    return prompt


def _load_coach_soul() -> str:
    """Load the Coach Soul section from coach-plugin/agents/coach.md.

    Extracts everything between '# Coach — Soul' and the next top-level '#' heading.
    Falls back to a compact inline version if the file is unavailable.
    """
    coach_md = Path(__file__).resolve().parent.parent.parent / "coach-plugin" / "agents" / "coach.md"
    try:
        text = coach_md.read_text(encoding="utf-8")
    except OSError:
        return (
            "You are Coach. Data-grounded, direct, never preachy. "
            "Reference actual logs. Short and punchy. Specific numbers."
        )

    lines = text.splitlines()
    in_soul = False
    soul_lines: list[str] = []
    for line in lines:
        if line.strip() == "# Coach — Soul":
            in_soul = True
            soul_lines.append(line)
            continue
        if in_soul:
            if line.startswith("# ") and soul_lines:
                break
            soul_lines.append(line)

    if not soul_lines:
        return "You are Coach. Direct, data-grounded. Reference actual logs. Specific numbers."
    return "\n".join(soul_lines).strip()


def _format_tone_rules(coaching_tone: dict) -> str:
    """Format the user's coaching tone rules as a bullet list."""
    if not coaching_tone:
        return "- Direct and data-driven. Celebrate effort. No wellness jargon."
    rules = coaching_tone.get("rules")
    if isinstance(rules, list) and rules:
        return "\n".join(f"- {r}" for r in rules)
    return "- Direct and data-driven. Celebrate effort. No wellness jargon."


def _format_history(recent_history: list) -> str:
    if not recent_history:
        return "(no recent history)"
    lines = []
    for day in recent_history[:7]:
        d = day.get("date", "")
        cal = day.get("calories", "?")
        prot = day.get("protein", "?")
        fiber = day.get("fiber", "?")
        w = day.get("weight", "")
        weight_str = f" weight={w}" if w else ""
        lines.append(f"  {d}: cal={cal} protein={prot} fiber={fiber}{weight_str}")
    return "\n".join(lines)


def _format_weight_block(all_entries: list, profile: dict) -> str:
    """Surface today's weight prominently for the synthesis prompt.

    Why: 2026-05-03 production bug had coach repeating "97 lbs" anchor across
    7 responses while user actually weighed in at 95.3 today. Weight entry was
    in all_entries but buried as "95.3 lbs: 0 cal, 0g protein" among 12 entries
    and the LLM anchored on the user's "97" wording instead of today's data.
    Today's weight must be unambiguous in the prompt.
    """
    today_weight = None
    for e in all_entries or []:
        if e.get("type") == "weight":
            v = e.get("weight_value")
            if v is None:
                # Try parsing from notes (e.g. "95.3 lbs")
                import re
                notes = e.get("notes") or ""
                m = re.search(r"(\d+\.?\d*)", notes)
                if m:
                    try:
                        v = float(m.group(1))
                    except ValueError:
                        v = None
            if v is not None:
                unit = e.get("weight_unit") or "lbs"
                today_weight = f"{v} {unit}"
                break

    stats = (profile or {}).get("currentStats") or {}
    weight_stats = stats.get("weight") or {}
    last_reading = weight_stats.get("current_lbs")
    trend_7d = weight_stats.get("trend_7d") or {}
    delta_7d = trend_7d.get("delta")

    lines = []
    if today_weight:
        lines.append(f"  Today (logged): {today_weight} -- this is THE current weight; anchor advice on this")
    elif last_reading is not None:
        lines.append(f"  No weight logged today. Last reading: {last_reading} lbs")
    else:
        lines.append("  No weight data available")

    if delta_7d is not None:
        direction = "down" if delta_7d < 0 else ("up" if delta_7d > 0 else "flat")
        lines.append(f"  7-day trend: {direction} {abs(delta_7d):.1f} lbs")

    return "\n".join(lines)


def _summarize_entries(entries: list) -> str:
    if not entries:
        return "(no entries)"
    lines = []
    for e in entries:
        desc = e.get("description") or e.get("notes") or e.get("type", "entry")
        cal = e.get("calories", 0)
        prot = e.get("protein", 0)
        # Flag entries that failed Haiku analysis so synthesis knows totals
        # are undercounted and can address the gap. Without this, coach gave
        # advice on 565 cal when 2 unanalyzed photo meals could be 200-500
        # additional cal.
        suffix = ""
        if e.get("_analysisError"):
            suffix = "  [!! ANALYSIS FAILED -- not counted in totals; ask user to retry or describe]"
        lines.append(f"  - {desc}: {cal} cal, {prot}g protein{suffix}")
    return "\n".join(lines)


def _call_claude(prompt: str, model: str) -> dict | None:
    """Invoke claude -p as a subprocess.

    Why these flags:
      --setting-sources user — skip project/local settings so this subprocess
        does NOT inherit the coach-plugin agent pin (which would restrict tools
        and trigger Coach startup-read behavior).
      --dangerously-skip-permissions — non-interactive; never prompt.
      stdin pipe — avoid Windows cmd.exe quoting hell on prompts with quotes.
      CLAUDECODE="" env — defensive: prevent inheriting a parent value that
        could short-circuit claude (matches what process-day.sh used to do).
    """
    import os
    model_flag = _resolve_model_flag(model)
    # Use shell=True for cross-platform command resolution (claude is .cmd on Windows).
    # Pass prompt via stdin to avoid shell quoting issues with embedded quotes/newlines.
    # Give synthesis Read+Glob+Grep so it can pull longer-term context when
    # the prompt-supplied 7-day recent_history isn't enough. Sonnet can read
    # conversations.md, profile/*.json/*.md, weekly summaries, etc.
    # No Write/Edit/Bash — synthesis must remain non-mutating; the
    # orchestrator owns all file writes.
    cmd = (
        f"claude -p --setting-sources user --dangerously-skip-permissions "
        f"--output-format json --model {model_flag} "
        f'--allowedTools "Read Glob Grep"'
    )
    env = {**os.environ, "CLAUDECODE": ""}

    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            env=env,
            shell=True,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        return parse_claude_json(result.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return None


def _validate_synthesis_schema(result: dict) -> list[str]:
    violations = []
    required = ("coachResponses", "highlights", "concerns", "plan_decision_reason")
    for field in required:
        if field not in result:
            violations.append(f"missing field: {field}")
    if "coachResponses" in result and not isinstance(result["coachResponses"], list):
        violations.append("coachResponses must be a list")
    if "highlights" in result and not isinstance(result["highlights"], list):
        violations.append("highlights must be a list")
    if "concerns" in result and not isinstance(result["concerns"], list):
        violations.append("concerns must be a list")
    return violations


def _normalize_coach_responses(entries: list) -> list:
    """Normalize each coachResponse entry to the new schema.

    - Ensures respondsTo is always an array (migrates old replyTo: scalar)
    - Emits replyTo: respondsTo[0] for backward compat with old phone clients
    - OVERRIDES LLM-supplied timestamp with actual synthesis time. The LLM
      tends to fabricate plausible-looking chat times (e.g. 17:00 on the dot)
      that don't reflect when the response was actually generated. We use
      server-side time so chronological sort on the phone reflects reality.
    """
    now_ms = int(time.time() * 1000)
    result = []
    for i, e in enumerate(entries):
        responds_to = e.get("respondsTo")
        if not isinstance(responds_to, list):
            reply_to = e.get("replyTo")
            responds_to = [reply_to] if reply_to else []

        # Always use actual synthesis time; +i ms preserves stable order if the
        # LLM emits multiple responses (rare with batched-mode but possible).
        ts = now_ms + i
        entry_id = e.get("id") or f"coach_resp_{ts}"

        normalized = {
            "id": entry_id,
            "timestamp": ts,
            "respondsTo": responds_to,
            "text": e.get("text", ""),
        }
        # Backward compat: emit replyTo for first id so old clients still match
        if responds_to:
            normalized["replyTo"] = responds_to[0]

        result.append(normalized)
    return result


def _normalize_synthesis(result: dict) -> dict:
    gu = result.get("goalUpdates")
    if not isinstance(gu, dict) or not gu:
        gu = None
    return {
        "coachResponses": _normalize_coach_responses(result.get("coachResponses") or []),
        "highlights": result.get("highlights") or [],
        "concerns": result.get("concerns") or [],
        "goalUpdates": gu,
        "mealPlan": result.get("mealPlan"),
        "regimen": result.get("regimen"),
        "plan_decision_reason": result.get("plan_decision_reason", ""),
    }


def _resolve_model_flag(model: str) -> str:
    _MODEL_MAP = {
        "haiku":  "claude-haiku-4-5-20251001",
        "sonnet": "claude-sonnet-4-6",
        "opus":   "claude-opus-4-7",
    }
    return _MODEL_MAP.get(model.lower(), model)
