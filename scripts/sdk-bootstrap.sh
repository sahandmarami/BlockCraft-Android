#!/bin/bash
# Android SDK bootstrap (background): cmdline-tools + platform-34 + build-tools 34.0.0
set -e
SDK=/home/z/my-project/android-sdk
mkdir -p "$SDK/dl"
cd "$SDK/dl"
echo "[1] downloading cmdline-tools..." >> "$SDK/install.log"
curl -sS -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
echo "[2] unzip..." >> "$SDK/install.log"
mkdir -p "$SDK/cmdline-tools"
unzip -q -o cmdtools.zip -d "$SDK/cmdline-tools"
mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest" 2>/dev/null || true
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"
echo "[3] licenses..." >> "$SDK/install.log"
yes | "$SDKM" --sdk_root="$SDK" --licenses > /dev/null 2>&1 || true
echo "[4] installing platform + build-tools..." >> "$SDK/install.log"
yes | "$SDKM" --sdk_root="$SDK" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1
echo "[5] done" >> "$SDK/install.log"
ls "$SDK/build-tools/34.0.0/" | head -20 >> "$SDK/install.log"
