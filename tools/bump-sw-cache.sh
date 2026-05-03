#!/usr/bin/env bash
# Bump CACHE_NAME in pwa/sw.js to the current git short rev (or a timestamp fallback).
# Run this before pushing to main so iOS picks up service worker changes on the next
# two-tap update cycle. Idempotent: running twice produces no diff after the first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SW="$REPO_ROOT/pwa/sw.js"

rev=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%s)

sed -i.bak "s/^const CACHE_NAME = .*;$/const CACHE_NAME = 'health-tracker-${rev}';/" "$SW"
rm -f "${SW}.bak"

echo "CACHE_NAME set to health-tracker-${rev} in pwa/sw.js"
