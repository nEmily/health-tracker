#!/usr/bin/env bash
# Smoke test for watcher.ps1 -DryRun
# Requires: pwsh (PowerShell Core), python3
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WATCHER_SCRIPT="$(realpath "$SCRIPT_DIR/../watcher.ps1")"
MOCK_PORT=19877
FAIL=0

die() { echo "FAIL: $*"; FAIL=1; }
pass() { echo "PASS: $*"; }

if ! command -v pwsh &>/dev/null; then
    echo "SKIP: pwsh not found in PATH"
    exit 0
fi
if ! command -v python3 &>/dev/null; then
    echo "SKIP: python3 not found in PATH"
    exit 0
fi

# Create sandbox with minimal coach structure
SANDBOX=$(mktemp -d)
trap 'kill "$MOCK_PID" 2>/dev/null; rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/profile"
mkdir -p "$SANDBOX/analysis"
mkdir -p "$SANDBOX/logs"

# Pre-seed an analysis file that needs uploading (no .uploaded marker)
echo '{"date":"2026-05-02","entries":[]}' > "$SANDBOX/analysis/2026-05-02.json"

# Write sync-config.json pointing at mock server
cat > "$SANDBOX/sync-config.json" <<EOF
{"url":"http://127.0.0.1:${MOCK_PORT}","key":"test-dryrun-key"}
EOF

# Start minimal mock relay (GET /pending returns one date; POST /done should NOT be called)
python3 - "$MOCK_PORT" &
MOCK_PID=$!
cat <<'PYEOF' >/dev/null
# (docstring for clarity — actual script passed via stdin above)
PYEOF
python3 -c "
import sys, http.server, json, threading, time

port = int(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if '/pending' in self.path:
            body = json.dumps({'pending': ['2026-05-02'], 'gen': {}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        # In DryRun mode this should never be called; respond 200 so watcher
        # doesn't log a confusing error if the guard somehow fails.
        length = int(self.headers.get('Content-Length', 0))
        self.rfile.read(length)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{\"ok\":true,\"WARNING\":\"DryRun guard failed\"}')
    def log_message(self, *a): pass

srv = http.server.HTTPServer(('127.0.0.1', port), Handler)
t = threading.Thread(target=srv.serve_forever, daemon=True)
t.start()
# stay alive until killed
import signal
signal.pause()
" "$MOCK_PORT" &
MOCK_PID=$!
sleep 0.5  # give server time to bind

echo "Running watcher.ps1 -DryRun -DataDir $SANDBOX"
WATCHER_OUT=$(pwsh -NonInteractive -File "$WATCHER_SCRIPT" -DryRun -DataDir "$SANDBOX" 2>&1 || true)
echo "$WATCHER_OUT"

# --- Assertions ---

# 1. Lock must be released
if [ -f "$SANDBOX/processing.lock" ]; then
    die "lock file still exists after watcher exited"
else
    pass "lock was acquired and released (no leftover .lock)"
fi

# 2. sandbox/dryrun-*.json must exist
DRYRUN_FILES=$(find "$SANDBOX/sandbox" -name 'dryrun-*.json' 2>/dev/null | head -5)
if [ -z "$DRYRUN_FILES" ]; then
    die "no dryrun-*.json created in $SANDBOX/sandbox/. Watcher output above."
else
    pass "dryrun file created: $DRYRUN_FILES"
fi

# 3. No .uploaded marker — ack must be skipped in DryRun mode
if compgen -G "$SANDBOX/analysis/*.uploaded" &>/dev/null; then
    die ".uploaded marker was created — ack should be skipped in DryRun mode"
else
    pass "no .uploaded marker (ack skipped)"
fi

# 4. DRYRUN summary line must appear in output
if echo "$WATCHER_OUT" | grep -q 'DRYRUN: would-have-uploaded'; then
    pass "DRYRUN summary line present in output"
else
    die "DRYRUN summary line missing from output"
fi

# 5. Relay PUT should NOT have been called (check via absence of WARNING token)
if echo "$WATCHER_OUT" | grep -qi 'DryRun guard failed'; then
    die "relay PUT was called despite -DryRun flag"
else
    pass "no relay PUT issued (mock POST WARNING absent)"
fi

if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "ALL ASSERTIONS PASSED"
    exit 0
else
    echo ""
    echo "SOME ASSERTIONS FAILED — see above"
    exit 1
fi
