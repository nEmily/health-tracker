#!/usr/bin/env bash
# sync-plugin-scripts.sh — Mirror processing/* into coach-plugin/scripts/
# Run after editing any of: process-day.bat, process-day.sh, watcher.ps1, watcher.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

FILES=(
  "process-day.bat"
  "process-day.sh"
  "watcher.ps1"
  "watcher.sh"
)

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

drift=0
for f in "${FILES[@]}"; do
  src="$REPO/processing/$f"
  dst="$REPO/coach-plugin/scripts/$f"
  if ! diff -q "$src" "$dst" >/dev/null 2>&1; then
    drift=1
    echo "DRIFT: coach-plugin/scripts/$f differs from processing/$f"
    [[ $CHECK_ONLY -eq 0 ]] && cp "$src" "$dst"
  fi
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  [[ $drift -eq 0 ]] && echo "All in sync."
  exit $drift
else
  echo "Synced."
fi
