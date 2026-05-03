#!/usr/bin/env bash
# test-michael-orchestrator.sh — T7.A + T7.B: sandbox diff of michael's orchestrator output
# PRIVACY: no content from Michael's data is printed — only counts and field names.
set -euo pipefail

MICHAEL_DIR="$HOME/michael-coach"
SANDBOX="/tmp/michael-test-sandbox"

cleanup() {
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

# --- T7.A: confirm environment ---
if [[ ! -d "$MICHAEL_DIR" ]]; then
  echo "T7.A deploy: FAIL (~/michael-coach not found)"
  exit 1
fi
if [[ ! -d "$MICHAEL_DIR/analysis" ]]; then
  echo "T7.A deploy: FAIL (~/michael-coach/analysis/ not found)"
  exit 1
fi
if [[ ! -f "$MICHAEL_DIR/sync-config.json" ]]; then
  echo "T7.A deploy: FAIL (~/michael-coach/sync-config.json not found)"
  exit 1
fi
if [[ ! -f "$MICHAEL_DIR/processing/process_day.py" ]]; then
  echo "T7.A deploy: FAIL (process_day.py not deployed)"
  exit 1
fi
echo "T7.A deploy: PASS"

# --- Pick most recent date with both archive ZIP and analysis file ---
# Only print the chosen date — no content revealed.
CHOSEN_DATE=""
if [[ -d "$MICHAEL_DIR/archive" ]]; then
  while IFS= read -r zip_path; do
    base="$(basename "$zip_path" .zip)"
    date_part="$(echo "$base" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
    if [[ -n "$date_part" && -f "$MICHAEL_DIR/analysis/${date_part}.json" ]]; then
      CHOSEN_DATE="$date_part"
      break
    fi
  done < <(find "$MICHAEL_DIR/archive" -name "*.zip" | sort -r)
fi

if [[ -z "$CHOSEN_DATE" ]]; then
  echo "T7.B structural diff: FAIL (no date found with both ZIP and analysis)"
  exit 1
fi

# --- Create sandbox (no content printed) ---
rm -rf "$SANDBOX"
cp -r "$MICHAEL_DIR" "$SANDBOX"

SANDBOX_EXTRACT="$SANDBOX/incoming/extracted"
mkdir -p "$SANDBOX_EXTRACT"

# --- Run process_day.py in dry-run mode inside sandbox ---
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" &>/dev/null; then
  PYTHON=python
fi

"$PYTHON" "$SANDBOX/processing/process_day.py" \
  --date "$CHOSEN_DATE" \
  --data-dir "$SANDBOX" \
  --extract-dir "$SANDBOX_EXTRACT" \
  --dry-run \
  >/dev/null 2>&1 || {
    echo "T7.B structural diff: FAIL (process_day.py exited non-zero)"
    exit 1
  }

# --- Structural diff via Python (privacy-bounded: counts and field names only) ---
export _T7_DATE="$CHOSEN_DATE"
export _T7_SANDBOX="$SANDBOX"
export _T7_CANONICAL="$MICHAEL_DIR"

"$PYTHON" - <<'PYEOF'
import json, sys, os, importlib.util, pathlib

date       = os.environ["_T7_DATE"]
sandbox    = os.environ["_T7_SANDBOX"]
canonical  = os.environ["_T7_CANONICAL"]

new_path    = os.path.join(sandbox,   "analysis", f"{date}.json")
canon_path  = os.path.join(canonical, "analysis", f"{date}.json")

def fail(field):
    print(f"T7.B structural diff: FAIL field={field}")
    sys.exit(1)

try:
    with open(new_path) as f:
        new_out = json.load(f)
    with open(canon_path) as f:
        canon = json.load(f)
except Exception:
    fail("load_json")

# 1. All canonical entry IDs present (count only — no IDs printed)
canon_ids = {e["id"] for e in canon.get("entries", []) if "id" in e}
new_ids   = {e["id"] for e in new_out.get("entries", []) if "id" in e}
missing_count = len(canon_ids - new_ids)
if missing_count > 0:
    fail(f"entries.ids")

# 2. totals.calories within 1%
c_cal = float(canon.get("totals", {}).get("calories") or 0)
n_cal = float(new_out.get("totals", {}).get("calories") or 0)
if c_cal > 0 and abs(n_cal - c_cal) / c_cal > 0.01:
    fail("totals.calories")

# 3. totals.protein within 1g
c_pro = float(canon.get("totals", {}).get("protein") or 0)
n_pro = float(new_out.get("totals", {}).get("protein") or 0)
if abs(n_pro - c_pro) > 1:
    fail("totals.protein")

# 4. totals.fiber within 1g
c_fib = float(canon.get("totals", {}).get("fiber") or 0)
n_fib = float(new_out.get("totals", {}).get("fiber") or 0)
if abs(n_fib - c_fib) > 1:
    fail("totals.fiber")

# 5. Schema validation (load from sandbox so it uses the deployed version)
proc_dir = pathlib.Path(sandbox) / "processing"
spec = importlib.util.spec_from_file_location(
    "validate_schema", proc_dir / "lib" / "validate_schema.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ok, violations = mod.validate(new_out)
if not ok:
    # Only reveal the field path prefix, not the value
    field_hint = violations[0].split(":")[0] if violations else "unknown"
    fail(f"schema.{field_hint}")

print("T7.B structural diff: PASS")
PYEOF
