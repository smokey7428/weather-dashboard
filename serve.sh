#!/bin/bash
# Serve the Weather Dashboard over HTTPS so it can be installed as a PWA
# (and so geolocation + service worker work on your phone).
#
#   ./serve.sh
#
# Starts a local web server + a free Cloudflare quick tunnel, waits until
# the public https:// URL is reachable, then prints it. Open that URL on
# your phone (any network) and tap Install.
# Press Ctrl+C to stop.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8765}"

command -v cloudflared >/dev/null 2>&1 || { echo "cloudflared not found. Run: brew install cloudflared"; exit 1; }

HTTP_PID=""; CF_PID=""
cleanup() {
  [[ -n "$CF_PID" ]] && kill "$CF_PID" 2>/dev/null || true
  [[ -n "$HTTP_PID" ]] && kill "$HTTP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "→ Serving $DIR on http://localhost:$PORT"
python3 -m http.server "$PORT" --directory "$DIR" >/dev/null 2>&1 &
HTTP_PID=$!
sleep 1

LOG="$(mktemp -t wxcf)"
echo "→ Starting HTTPS tunnel (free, account-less)…"
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 120); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1 || true)
  if [ -n "$URL" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/index.html" || echo 000)" = "200" ]; then
    break
  fi
  sleep 0.5
done

echo
if [ -z "$URL" ]; then
  echo "✗ Could not establish the tunnel. See $LOG"
  exit 1
fi

cat <<EOF
════════════════════════════════════════════════════════════════════
  Weather Dashboard is LIVE over HTTPS:

      $URL

  On your OnePlus 13 (Chrome, any network):
    1. Open the URL above.
    2. A menu appears near the address bar, or use ⋮ → "Install app"
       / "Add to Home screen".
    3. Tap Install — it's now a full-screen app that works offline.

  Keep this terminal window open while using the app.
  Press Ctrl+C here to shut everything down.
════════════════════════════════════════════════════════════════════
EOF

wait "$CF_PID"
