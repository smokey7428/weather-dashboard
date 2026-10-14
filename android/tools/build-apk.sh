#!/bin/bash
# Builds the APK with the toolchain installed by tools/bootstrap-toolchain.sh.
#
# Usage:
#   ./build-apk.sh              -> release APK (signed, share this one)
#   ./build-apk.sh debug        -> debug APK
#   ./build-apk.sh clean        -> wipe build outputs
#
# The web app is copied into the APK's assets automatically on every build, so
# there is never a stale copy of the UI inside a shipped APK.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(dirname "$HERE")"

export JAVA_HOME="${JAVA_HOME:-$HOME/Library/Android/jdk17/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "error: no JDK at $JAVA_HOME" >&2
  echo "run tools/bootstrap-toolchain.sh, or set JAVA_HOME" >&2
  exit 1
fi
if [ ! -d "$ANDROID_HOME/platforms" ]; then
  echo "error: no Android SDK at $ANDROID_HOME" >&2
  echo "run tools/bootstrap-toolchain.sh, or set ANDROID_HOME" >&2
  exit 1
fi

# The SDK location is normally read from local.properties; fall back to the
# environment if that file is absent (e.g. on a fresh clone or in CI).
if [ ! -f "$ANDROID_DIR/local.properties" ]; then
  echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
fi

cd "$ANDROID_DIR"

case "${1:-release}" in
  release)
    if [ ! -f keystore.properties ]; then
      echo "note: keystore.properties is missing, so the APK will be UNSIGNED"
      echo "      and Android will refuse to install it."
      echo "      run tools/make-keystore.sh first."
      echo
    fi
    ./gradlew assembleRelease
    echo
    echo "APK: app/build/outputs/apk/release/"
    ls -la app/build/outputs/apk/release/ 2>/dev/null || true
    ;;
  debug)
    ./gradlew assembleDebug
    echo
    echo "APK: app/build/outputs/apk/debug/"
    ls -la app/build/outputs/apk/debug/ 2>/dev/null || true
    ;;
  clean)
    ./gradlew clean
    ;;
  *)
    ./gradlew "$@"
    ;;
esac
