#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIZEN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_FILE="$TIZEN_DIR/js/config.local.js"

rm -f "$OUT_FILE"
echo "Removed $OUT_FILE"
