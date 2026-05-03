#!/usr/bin/env bash
# deploy-to-michael.sh — Sync orchestrator code into ~/michael-coach/processing/
# Does NOT copy tests/, sandbox/, or any profile/personal data.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/processing"
DEST="$HOME/michael-coach/processing"

YES=0
for arg in "$@"; do
  [[ "$arg" == "--yes" ]] && YES=1
done

if [[ $YES -eq 0 ]]; then
  echo "This will deploy orchestrator code to: $DEST"
  echo "Files to copy:"
  echo "  processing/lib/*.py"
  echo "  processing/process_day.py"
  echo "  processing/process-day-prompt.md"
  echo "  processing/plan-prompt.md"
  echo "  processing/watcher.ps1"
  echo "  processing/watcher.sh"
  read -r -p "Continue? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

if [[ ! -d "$DEST" ]]; then
  echo "ERROR: $DEST does not exist. Is michael-coach set up?" >&2
  exit 1
fi

count=0

if command -v rsync &>/dev/null; then
  mkdir -p "$DEST/lib"
  rsync -avh "$SRC/lib/"*.py "$DEST/lib/"
  rsync -avh "$SRC/process_day.py" "$DEST/process_day.py"
  rsync -avh "$SRC/process-day-prompt.md" "$DEST/process-day-prompt.md"
  rsync -avh "$SRC/plan-prompt.md" "$DEST/plan-prompt.md"
  rsync -avh "$SRC/watcher.ps1" "$DEST/watcher.ps1"
  rsync -avh "$SRC/watcher.sh" "$DEST/watcher.sh"
  # Count deployed files
  count=$(rsync -avn "$SRC/lib/"*.py "$SRC/process_day.py" "$SRC/process-day-prompt.md" "$SRC/plan-prompt.md" "$SRC/watcher.ps1" "$SRC/watcher.sh" "$DEST/" 2>/dev/null | grep -c '^>' || true)
  # Fallback: count by listing
  count=$(find "$DEST/lib" -name "*.py" | wc -l)
  count=$((count + 5))  # process_day.py + 2 prompts + 2 watchers
else
  mkdir -p "$DEST/lib"
  cp -v "$SRC/lib/"*.py "$DEST/lib/"
  cp -v "$SRC/process_day.py" "$DEST/process_day.py"
  cp -v "$SRC/process-day-prompt.md" "$DEST/process-day-prompt.md"
  cp -v "$SRC/plan-prompt.md" "$DEST/plan-prompt.md"
  cp -v "$SRC/watcher.ps1" "$DEST/watcher.ps1"
  cp -v "$SRC/watcher.sh" "$DEST/watcher.sh"
  count=$(find "$DEST/lib" -name "*.py" | wc -l)
  count=$((count + 5))
fi

echo ""
echo "Deployed $count files to michael-coach"
