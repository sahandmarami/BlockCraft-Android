#!/bin/bash
# Publish BlockCraft v3.0.0 to GitHub (BlockCraft-Android main + releases, mirror release on BlockCraft-Godot)
set -e
ROOT=/home/z/my-project
TK=$(cat "$ROOT/.ghtoken")
WORK=/tmp/bc-publish
BRANCH=main

echo "[1] clone fresh worktrees"
rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"
git -c advice.detachedHead=false clone --depth 1 "https://x-access-token:$TK@github.com/sahandmarami/BlockCraft-Android.git" bc-android > /dev/null 2>&1
git -c advice.detachedHead=false clone --depth 1 "https://x-access-token:$TK@github.com/sahandmarami/BlockCraft-Godot.git" bc-godot > /dev/null 2>&1

echo "[2] sync game source into BlockCraft-Android"
cd "$WORK/bc-android"
git rm -r --cached . > /dev/null 2>&1 || true
find . -mindepth 1 -maxdepth 1 ! -name '.git' ! -name '.gitignore' ! -name 'README.md' ! -name 'LICENSE' -exec rm -rf {} + 2>/dev/null || true
# copy game source
rsync -a \
  --exclude node_modules --exclude .next --exclude out \
  --exclude android-sdk --exclude keystores --exclude .ghtoken \
  --exclude tool-results --exclude upload --exclude download \
  --exclude skills --exclude examples --exclude mini-services --exclude tests \
  --exclude prisma --exclude db --exclude .env --exclude dev.log --exclude server.log \
  --exclude .zscripts --exclude '.git*' --exclude 'bun.lock' --exclude '*.log' \
  /home/z/my-project/src /home/z/my-project/public /home/z/my-project/scripts \
  /home/z/my-project/android /home/z/my-project/package.json /home/z/my-project/tsconfig.json \
  /home/z/my-project/next.config.ts /home/z/my-project/tailwind.config.ts /home/z/my-project/postcss.config.mjs \
  /home/z/my-project/components.json /home/z/my-project/eslint.config.mjs \
  "$WORK/bc-android/"
cp /home/z/my-project/.gitignore.repo "$WORK/bc-android/.gitignore"
cp /home/z/my-project/README.md /home/z/my-project/LICENSE "$WORK/bc-android/"
rm -rf "$WORK/bc-android/android/build"

echo "[3] commit + push BlockCraft-Android"
cd "$WORK/bc-android"
git add -A
git -c user.name="sahandmarami" -c user.email="sahandmarami@users.noreply.github.com" \
  commit -m "BlockCraft v3.0.0 — MC-style D-pad, survival inventory (block drops), more animals, graphics polish" > /dev/null
git push origin HEAD:main > /dev/null 2>&1 && echo "pushed main OK"

echo "[4] source zip"
cd "$WORK/bc-android"
git archive --format=zip -o "$WORK/BlockCraft-Source-v3.0.0.zip" HEAD

echo "[5] release v3.0.0 on BlockCraft-Android"
API=https://api.github.com
AUTH="Authorization: Bearer $TK"
REL=$(curl -sS -X POST -H "$AUTH" -H "Accept: application/vnd.github+json" \
  "$API/repos/sahandmarami/BlockCraft-Android/releases" \
  -d '{"tag_name":"v3.0.0","target_commitish":"main","name":"BlockCraft v3.0.0 — کنترل ماینکرافتی + مقادیر بلوک + حیوانات بیشتر","body":"## تازه‌های نسخه ۳\n\n- 🎮 **کنترل ماینکرافتی:** دی‌پد ۸جهته (مثل ماینکرافت موبایل) — جای جوی‌استیک قبلی. جهت‌ها تست شده و درست است.\n- 🧱 **مکانیزم بلوک مثل بازی اصلی:** شکستن بلوک = جمع‌آوری آن (چمن→خاک، سنگ→سنگ‌فرش)؛ گذاشتن یکی کم می‌کند؛ استک ۶۴تایی.\n- 🐑 **حیوانات بیشتر:** گوسفند/گاو/خوک/مرغ (تا ۱۴) نزدیک‌تر به بازیکن ظاهر می‌شوند + زامبی شب (تا ۶).\n- ✋ دست خالی با بازوی شخصیت، 🌄 تکسچرهای بهتر (لبه چمن، آب، برگ).\n\n## نصب\n\n⚠️ **اول نسخه قبلی را Uninstall کنید** (امضای جدید — آپدیت روی نسخه قبل ممکن نیست).\n\nفایل `BlockCraft-v3.0.0.apk` را دانلود و نصب کنید. بازی کاملاً آفلاین است.\n\n- حداقل اندروید ۷.۰\n- روی گوشی ضعیف: تنظیمات ← فاصله دید ← نزدیک\n\n## سورس و امضا\n\n- سورس کامل: `BlockCraft-Source-v3.0.0.zip` (وب + پوسته اندروید)\n- Keystore برای نسخه‌های بعدی: `blockcraft.keystore` — رمز: `blockcraft2025`\n\nMIT License — ساخته‌شده با Three.js + WebView، همه گرافیک/صدا رویه‌ای.","draft":false,"prerelease":false}')
RELID=$(echo "$REL" | grep -m1 '"id"' | grep -o '[0-9]*')
echo "release id: $RELID"

upload() {
  local file=$1 name=$2 ctype=$3
  for i in 1 2 3; do
    code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
      -H "$AUTH" -H "Content-Type: $ctype" \
      --data-binary @"$file" \
      "https://uploads.github.com/repos/sahandmarami/BlockCraft-Android/releases/$RELID/assets?name=$name")
    echo "upload $name → $code"
    [ "$code" = "201" ] && break
    sleep 2
  done
}
upload "$ROOT/download/BlockCraft-v3.0.0.apk" "BlockCraft-v3.0.0.apk" "application/vnd.android.package-archive"
upload "$WORK/BlockCraft-Source-v3.0.0.zip" "BlockCraft-Source-v3.0.0.zip" "application/zip"
upload "$ROOT/keystores/blockcraft.keystore" "blockcraft.keystore" "application/octet-stream"

echo "[6] mirror release on BlockCraft-Godot"
cd "$WORK/bc-godot"
git rm -r --cached . > /dev/null 2>&1 || true
cat > README.md << 'EOF'
# BlockCraft — نسخه Godot بازنشسته شد

نسخه Godot (v2.0) به دلیل مشکلات کنترل و گرافیک **کنار گذاشته شد**.

👉 نسخه جدید **v3.0.0** (کنترل ماینکرافتی، مقادیر بلوک، حیوانات بیشتر) در مخزن
[BlockCraft-Android](https://github.com/sahandmarami/BlockCraft-Android/releases/tag/v3.0.0) منتشر شده است.
EOF
git add README.md
git -c user.name="sahandmarami" -c user.email="sahandmarami@users.noreply.github.com" \
  commit -m "v3.0.0 replaces the Godot version → see BlockCraft-Android" > /dev/null || echo "nothing to commit"
git push origin HEAD:main > /dev/null 2>&1 && echo "pushed godot-repo README OK" || echo "godot push skipped"

GREL=$(curl -sS -X POST -H "$AUTH" -H "Accept: application/vnd.github+json" \
  "$API/repos/sahandmarami/BlockCraft-Godot/releases" \
  -d '{"tag_name":"v3.0.0-webview","target_commitish":"main","name":"v3.0.0 — نسخه جدید در BlockCraft-Android","body":"نسخه Godot بازنشسته شد. نسخه جدید (کنترل ماینکرافتی + مقادیر بلوک + حیوانات) اینجاست:\n\nhttps://github.com/sahandmarami/BlockCraft-Android/releases/tag/v3.0.0\n\nفایل APK همین‌جا هم ضمیمه شده تا راحت باشد.","draft":false,"prerelease":false}')
GRELID=$(echo "$GREL" | grep -m1 '"id"' | grep -o '[0-9]*')
echo "godot release id: $GRELID"
if [ -n "$GRELID" ]; then
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "$AUTH" -H "Content-Type: application/vnd.android.package-archive" \
    --data-binary @"$ROOT/download/BlockCraft-v3.0.0.apk" \
    "https://uploads.github.com/repos/sahandmarami/BlockCraft-Godot/releases/$GRELID/assets?name=BlockCraft-v3.0.0.apk")
  echo "godot mirror upload → $code"
fi

echo "[7] verify anonymous download"
sleep 2
code=$(curl -sS -o /dev/null -w "%{http_code}" -L "https://github.com/sahandmarami/BlockCraft-Android/releases/download/v3.0.0/BlockCraft-v3.0.0.apk")
echo "anonymous download check → $code"
echo "PUBLISH DONE"
