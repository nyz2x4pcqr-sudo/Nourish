#!/bin/bash
# Runs inside the Android emulator job: installs the APK, checks the connect screen and the
# connected app (Nourish server on the host = 10.0.2.2 from the emulator), saves screenshots.
# Fails unless the screens really show Nourish and the server saw the app load.
set -ux
mkdir -p shots
fail() { echo "SMOKE TEST FAILED: $*"; tail -n 40 server.log; exit 1; }
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

adb install -r Nourish.apk || fail "install"
adb logcat -c
echo "== 1. First launch: the connect screen"
adb shell am start -W -n io.github.nourish.app/io.github.nourish.MainActivity
wait_for_text "Connect to Nourish" || fail "connect screen not shown"
adb exec-out screencap -p > shots/android-1-connect.png

echo "== 2. Connected to the Nourish server"
adb shell am force-stop io.github.nourish.app
BEFORE=$(wc -l < server.log)
adb shell am start -W -n io.github.nourish.app/io.github.nourish.MainActivity --es server_url http://10.0.2.2:8000/
wait_for_text "No meal plan yet|Generate Meal Plan|TODAY|Today" || fail "Nourish app not shown"
sleep 3
adb exec-out screencap -p > shots/android-2-app.png
NEW=$(tail -n +"$((BEFORE + 1))" server.log); echo "Server saw:"; echo "$NEW" | grep -oE '"(GET|POST) [^"]*"' | sort | uniq -c
echo "$NEW" | grep -q '"GET /app.js' || fail "app.js never loaded"
echo "$NEW" | grep -q '"GET /api/info' || fail "the app's JavaScript never called the server"

adb logcat -d > shots/android-logcat.txt
grep -q "FATAL EXCEPTION" shots/android-logcat.txt && { grep -A 20 "FATAL EXCEPTION" shots/android-logcat.txt; fail "crash"; }
adb shell pidof io.github.nourish.app || fail "app not running"
echo "SMOKE TEST PASSED"
