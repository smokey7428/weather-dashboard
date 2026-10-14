#!/bin/bash
# Installs a self-contained Android toolchain into ~/Library/Android (no sudo).
# JDK 17 (Temurin) + Android command-line tools + SDK packages.
set -euo pipefail

BASE="$HOME/Library/Android"
DL="$BASE/dl"
JDK_DIR="$BASE/jdk17"
SDK_DIR="$BASE/sdk"
CMDLINE_VER=13114758

mkdir -p "$DL" "$JDK_DIR" "$SDK_DIR/cmdline-tools"

log() { echo "[bootstrap] $*"; }

if [ ! -x "$JDK_DIR/Contents/Home/bin/javac" ]; then
  log "downloading Temurin JDK 17..."
  curl -fL --retry 3 -o "$DL/jdk17.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
  log "extracting JDK..."
  mkdir -p "$BASE/jdk17.tmp"
  rm -rf "$BASE/jdk17.tmp"/* 2>/dev/null || true
  tar xzf "$DL/jdk17.tar.gz" -C "$BASE/jdk17.tmp"
  INNER=$(find "$BASE/jdk17.tmp" -maxdepth 1 -mindepth 1 -type d | head -1)
  rm -rf "$JDK_DIR"
  mv "$INNER" "$JDK_DIR"
  rmdir "$BASE/jdk17.tmp" 2>/dev/null || true
  rm -f "$DL/jdk17.tar.gz"
else
  log "JDK already present."
fi

export JAVA_HOME="$JDK_DIR/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
log "java: $(java -version 2>&1 | head -1)"

if [ ! -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "downloading Android command-line tools..."
  curl -fL --retry 3 -o "$DL/cmdline-tools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-mac-${CMDLINE_VER}_latest.zip"
  log "extracting command-line tools..."
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mkdir -p "$SDK_DIR/cmdline-tools/tmp"
  unzip -q -o "$DL/cmdline-tools.zip" -d "$SDK_DIR/cmdline-tools/tmp"
  mv "$SDK_DIR/cmdline-tools/tmp/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rmdir "$SDK_DIR/cmdline-tools/tmp"
  rm -f "$DL/cmdline-tools.zip"
else
  log "command-line tools already present."
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
SDKMANAGER="$SDK_DIR/cmdline-tools/latest/bin/sdkmanager"

log "accepting licenses..."
yes | "$SDKMANAGER" --sdk_root="$SDK_DIR" --licenses > "$DL/licenses.log" 2>&1 || true

log "installing SDK packages (this is the slow part)..."
"$SDKMANAGER" --sdk_root="$SDK_DIR" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  > "$DL/sdkmanager.log" 2>&1

log "installed packages:"
"$SDKMANAGER" --sdk_root="$SDK_DIR" --list_installed 2>/dev/null | tail -20

log "DONE"
log "JAVA_HOME=$JDK_DIR/Contents/Home"
log "ANDROID_HOME=$SDK_DIR"
