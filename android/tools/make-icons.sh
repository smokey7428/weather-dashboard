#!/bin/bash
# Generates the launcher icon set from the web app's icon-512.png, so the app
# and the website always show the same icon.
#
# Produces legacy square icons for every density plus an adaptive icon
# (API 26+), which is what modern launchers expect. The adaptive foreground is
# padded to ~66% so it survives the circular/squircle masks launchers apply.
#
# Usage: ./make-icons.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(dirname "$HERE")"
REPO_DIR="$(dirname "$ANDROID_DIR")"
RES="$ANDROID_DIR/app/src/main/res"
SRC="$REPO_DIR/icon-512.png"

[ -f "$SRC" ] || { echo "error: $SRC not found" >&2; exit 1; }
command -v sips >/dev/null || { echo "error: sips not found (macOS only)" >&2; exit 1; }

BG_COLOR="0B1220"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# density -> legacy icon size in px
DENSITIES=(mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192)

for entry in "${DENSITIES[@]}"; do
  name="${entry%%:*}"
  size="${entry##*:}"
  dir="$RES/mipmap-$name"
  mkdir -p "$dir"
  sips -z "$size" "$size" "$SRC" --out "$dir/ic_launcher.png" >/dev/null 2>&1
  echo "  mipmap-$name/ic_launcher.png (${size}x${size})"
done

# adaptive icon foreground: full canvas is 108dp, content should sit within the
# inner ~72dp, so scale the artwork to ~66% of the canvas and pad the rest.
ADAPTIVE=(mdpi:108:71 hdpi:162:107 xhdpi:216:142 xxhdpi:324:214 xxxhdpi:432:285)
for entry in "${ADAPTIVE[@]}"; do
  name="$(echo "$entry" | cut -d: -f1)"
  canvas="$(echo "$entry" | cut -d: -f2)"
  inner="$(echo "$entry" | cut -d: -f3)"
  dir="$RES/mipmap-$name"
  mkdir -p "$dir"
  sips -z "$inner" "$inner" "$SRC" --out "$TMP/fg-$name.png" >/dev/null 2>&1
  sips -p "$canvas" "$canvas" --padColor "$BG_COLOR" \
    "$TMP/fg-$name.png" --out "$dir/ic_launcher_foreground.png" >/dev/null 2>&1 2>&1
  echo "  mipmap-$name/ic_launcher_foreground.png (${canvas}x${canvas}, artwork ${inner}px)"
done

mkdir -p "$RES/mipmap-anydpi-v26"
cat > "$RES/mipmap-anydpi-v26/ic_launcher.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
EOF
echo "  mipmap-anydpi-v26/ic_launcher.xml (adaptive)"
