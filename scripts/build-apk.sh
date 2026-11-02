#!/bin/bash
# Build BlockCraft v3.0.0 APK (offline WebView wrapper around the static web export)
set -e
ROOT=/home/z/my-project
SDK=$ROOT/android-sdk
BT=$SDK/build-tools/34.0.0
PLAT=$SDK/platforms/android-34/android.jar
SRC=$ROOT/android
OUT=$SRC/build
KS=$ROOT/keystores/blockcraft.keystore
KPASS=blockcraft2025
APK_OUT=$ROOT/download/BlockCraft-v3.0.0.apk

echo "[1] assets: static export -> www"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$SRC/app/src/main/assets"
rm -rf "$SRC/app/src/main/assets/www"
cp -r "$ROOT/out" "$SRC/app/src/main/assets/www"

echo "[2] aapt2 compile"
"$BT/aapt2" compile --dir "$SRC/app/src/main/res" -o "$OUT/res.zip"

echo "[3] aapt2 link"
"$BT/aapt2" link -o "$OUT/base.apk" \
  -I "$PLAT" \
  --manifest "$SRC/app/src/main/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 300 --version-name 3.0.0 \
  -A "$SRC/app/src/main/assets" \
  --java "$OUT/gen" \
  --auto-add-overlay \
  "$OUT/res.zip"

echo "[4] javac (ecj)"
java -jar "$SDK/dl/ecj.jar" -source 8 -target 8 -nowarn \
  -classpath "$PLAT" \
  -d "$OUT/classes" \
  "$SRC/app/src/main/java/com/sahandmarami/blockcraft/MainActivity.java" \
  "$OUT/gen/com/sahandmarami/blockcraft/R.java" 2>&1 | grep -v "^$" | head -5 || true

echo "[5] d8"
"$BT/d8" --release --min-api 24 --lib "$PLAT" \
  --output "$OUT/dex" \
  $(find "$OUT/classes" -name "*.class")

echo "[6] package dex"
cd "$OUT/dex"
zip -q "$OUT/base.apk" classes.dex

echo "[7] zipalign"
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "[8] keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias blockcraft \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KPASS" -keypass "$KPASS" \
    -dname "CN=BlockCraft, OU=Game, O=sahandmarami, C=IR"
fi

echo "[9] sign"
mkdir -p "$ROOT/download"
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KPASS" --key-pass "pass:$KPASS" \
  --out "$APK_OUT" "$OUT/aligned.apk"

echo "[10] verify"
"$BT/apksigner" verify --print-certs "$APK_OUT" | head -5
ls -la "$APK_OUT"
echo "DONE: $APK_OUT"
