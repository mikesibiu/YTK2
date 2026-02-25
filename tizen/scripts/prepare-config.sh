#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIZEN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_FILE="$TIZEN_DIR/js/config.local.js"

: "${YOUTUBE_API_KEY:?YOUTUBE_API_KEY must be set in environment}"

FILTER_API_BASE_URL="${FILTER_API_BASE_URL:-https://ytk2.farace.net}"
PARENT_PIN="${PARENT_PIN:-1967}"

js_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  printf "%s" "$value"
}

cat > "$OUT_FILE" <<EOF_LOCAL
window.YTK2_CONFIG = Object.assign({}, window.YTK2_CONFIG || {}, {
  FILTER_API_BASE_URL: '$(js_escape "$FILTER_API_BASE_URL")',
  YOUTUBE_API_KEY: '$(js_escape "$YOUTUBE_API_KEY")',
  PARENT_PIN: '$(js_escape "$PARENT_PIN")'
});
EOF_LOCAL

echo "Generated $OUT_FILE from environment variables."
