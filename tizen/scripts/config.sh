#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-apply}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIZEN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_FILE="$TIZEN_DIR/js/config.local.js"

if [[ "$MODE" == "clean" ]]; then
  rm -f "$OUT_FILE"
  echo "Removed $OUT_FILE"
  exit 0
fi

FILTER_API_BASE_URL="${FILTER_API_BASE_URL:-https://incredible-reena-mysysadmin-92a1a6a5.koyeb.app}"

js_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  printf "%s" "$value"
}

cat > "$OUT_FILE" <<EOF_LOCAL
window.YTK2_CONFIG = Object.assign({}, window.YTK2_CONFIG || {}, {
  FILTER_API_BASE_URL: '$(js_escape "$FILTER_API_BASE_URL")'
});
EOF_LOCAL

echo "Generated $OUT_FILE from environment variables."
