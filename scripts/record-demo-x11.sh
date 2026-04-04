#!/usr/bin/env bash
set -euo pipefail
# Records an xterm on Xvfb to docs/demo-quote.mp4 (requires: xterm Xvfb ffmpeg, built dist/).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${1:-$ROOT/docs/demo-quote.mp4}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
DIM="${DIM:-1280x720}"
RECORD_SEC="${RECORD_SEC:-130}"

if [[ ! -f "$ROOT/dist/cli.js" ]]; then
  echo "Run npm run build first." >&2
  exit 1
fi
if [[ ! -f "$ROOT/demo-part.step" ]]; then
  echo "Missing demo-part.step in repo root." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

Xvfb ":${DISPLAY_NUM}" -screen 0 "${DIM}x24" >/tmp/xvfb-demo.log 2>&1 &
XVFB_PID=$!

cleanup() {
  kill "$XTERM_PID" 2>/dev/null || true
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 1
export DISPLAY=":${DISPLAY_NUM}"

xterm -display "$DISPLAY" -geometry 132x36+0+0 \
  -bg "#002b36" -fg "#93a1a1" -cr "#cb4b16" \
  -fa "DejaVu Sans Mono" -fs 11 \
  -e bash -c '
set -e
cd "'"$ROOT"'"
echo "=== Quoteget demo: Hubs instant quote (demo-part.step) ==="
echo
echo "$ node dist/cli.js ./demo-part.step --vendors hubs --json"
echo
node dist/cli.js ./demo-part.step --vendors hubs --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for row in data:
    print(json.dumps(row, indent=2))
"
echo
echo "(keeping terminal open while recording finishes…)"
while true; do sleep 60; done
' &
XTERM_PID=$!

sleep 2

ffmpeg -y -nostdin -f x11grab -framerate 12 -video_size "$DIM" -i "${DISPLAY}.0" \
  -codec:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p \
  -t "$RECORD_SEC" "$OUT" >/tmp/ffmpeg-demo.log 2>&1

trap - EXIT
cleanup
wait "$XVFB_PID" 2>/dev/null || true

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
