#!/bin/bash
# Runs inside the Android emulator job. Checks, with screenshots:
#  1. first launch shows the built-in Nourish (no PC needed);
#  2. connecting to a Nourish server (the host = 10.0.2.2 from the emulator) shows the PC's copy;
#  3. the app's own on-device AI engine runs a real model and writes a valid day of meals.
set -ux
mkdir -p shots
fail() { echo "SMOKE TEST FAILED: $*"; tail -n 40 server.log; adb logcat -d > shots/android-logcat.txt; exit 1; }
screen_text() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb exec-out cat /sdcard/ui.xml | grep -o 'text="[^"]*"' | sed 's/text="//;s/"$//' | grep -v '^$' | tr '\n' '|'; }
# The emulator's screen reader can come back empty while the page is still settling (slower
# runners), so keep reading for up to 60 s before deciding the text isn't there.
wait_for_text() {
  for i in $(seq 1 12); do
    TEXT=$(screen_text); echo "On screen (try $i): $TEXT"
    echo "$TEXT" | grep -qE "$1" && return 0
    sleep 5
  done
  return 1
}
APP=io.github.nourish.app

adb install -r Nourish.apk || fail "install"
adb logcat -c
echo "== 1. First launch: Nourish on the phone, no PC"
BEFORE=$(wc -l < server.log)
adb shell am start -W -n $APP/io.github.nourish.MainActivity
wait_for_text "No meal plan yet|Generate Meal Plan" || fail "built-in app not shown"
adb exec-out screencap -p > shots/android-1-local.png
[ "$(tail -n +"$((BEFORE + 1))" server.log | grep -c 'GET /app.js')" = "0" ] || fail "phone-only mode loaded the app from the PC"

echo "== 2. Connected to the Nourish server"
adb shell am force-stop $APP
BEFORE=$(wc -l < server.log)
adb shell am start -W -n $APP/io.github.nourish.MainActivity --es server_url http://10.0.2.2:8000/
wait_for_text "No meal plan yet|Generate Meal Plan|TODAY|Today" || fail "Nourish app not shown"
sleep 3
adb exec-out screencap -p > shots/android-2-pc.png
NEW=$(tail -n +"$((BEFORE + 1))" server.log); echo "Server saw:"; echo "$NEW" | grep -oE '"(GET|POST) [^"]*"' | sort | uniq -c
echo "$NEW" | grep -q '"GET /app.js' || fail "app.js never loaded"
echo "$NEW" | grep -q '"GET /api/info' || fail "the app's JavaScript never called the server"

echo "== 3. On-device AI: a real model, the app's engine and the app's meal format"
adb shell am force-stop $APP
adb push day.gbnf /data/local/tmp/day.gbnf >/dev/null || fail "push grammar"
adb shell run-as $APP sh -c "'mkdir -p files/models && cp /data/local/tmp/day.gbnf files/models/'" || fail "copy grammar into the app"
adb logcat -c
# The app downloads the model from Hugging Face itself (following its redirects), then runs it.
adb shell am start -W -n $APP/io.github.nourish.MainActivity --ez local true --es selftest_model test-model.gguf --es selftest_grammar day.gbnf \
  --es selftest_download_url "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf?download=true" \
  --el selftest_download_size 105454432
RESULT=""
# The emulator has no fast maths instructions, so even a tiny model takes minutes here.
for i in $(seq 1 150); do
  RESULT=$(adb logcat -d -s Nourish:* | grep -E "NOURISH_SELFTEST_(OK|FAIL)" | head -n 1)
  [ -n "$RESULT" ] && break
  sleep 5
done
adb logcat -d -s Nourish:* | grep -E "Download|NOURISH_DOWNLOAD" | head -n 20
adb logcat -d -s Nourish:* | grep -q NOURISH_DOWNLOAD_OK || fail "model download through the app failed"
echo "$RESULT" | cut -c1-600
echo "$RESULT" | grep -q NOURISH_SELFTEST_OK || fail "on-device generation failed or timed out"
echo "$RESULT" | sed 's/.*NOURISH_SELFTEST_OK //' > shots/android-selftest.json
python3 - <<'PY' || fail "the model's day of meals is not valid"
import json
result = json.load(open("shots/android-selftest.json"))
day = json.loads(result["text"])
for meal in ("breakfast", "lunch", "dinner"):
    m = day[meal]
    assert m["name"] and m["ingredients"] and m["steps"] and "calories" in m["nutrition"], meal
print("Valid day of meals in", result["ms"], "ms:", [day[m]["name"] for m in ("breakfast", "lunch", "dinner")])
PY
adb exec-out screencap -p > shots/android-3-after-ai.png

adb logcat -d > shots/android-logcat.txt
grep -q "FATAL EXCEPTION" shots/android-logcat.txt && { grep -A 20 "FATAL EXCEPTION" shots/android-logcat.txt; fail "crash"; }
adb shell pidof $APP || fail "app not running"
echo "SMOKE TEST PASSED"
