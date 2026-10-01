#!/bin/bash
# Runs inside the Android emulator job: installs the APK, checks the connect screen and the
# connected app (Nourish server on the host = 10.0.2.2 from the emulator), saves screenshots.
set -ux
mkdir -p shots
adb install -r Nourish.apk
adb logcat -c
adb shell am start -W -n io.github.nourish.app/io.github.nourish.MainActivity
sleep 12
adb exec-out screencap -p > shots/android-1-connect.png
adb shell am force-stop io.github.nourish.app
adb shell am start -W -n io.github.nourish.app/io.github.nourish.MainActivity --es server_url http://10.0.2.2:8000/
sleep 20
adb exec-out screencap -p > shots/android-2-app.png
adb logcat -d > shots/android-logcat.txt
if grep -q "FATAL EXCEPTION" shots/android-logcat.txt; then
  echo "The app crashed:"; grep -A 20 "FATAL EXCEPTION" shots/android-logcat.txt; exit 1
fi
adb shell pidof io.github.nourish.app || { echo "The app is not running"; exit 1; }
