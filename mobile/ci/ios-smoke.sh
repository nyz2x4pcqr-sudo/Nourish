#!/bin/bash
# Builds Nourish for the iOS simulator, launches it (connect screen, then connected to the
# Nourish server running on this Mac) and saves screenshots. Fails unless the server saw the
# app load Nourish and its JavaScript run.
set -eux
mkdir -p shots
LOG="$GITHUB_WORKSPACE/server.log"
fail() { echo "SMOKE TEST FAILED: $*"; tail -n 40 "$LOG"; exit 1; }

echo "== Building for the simulator"
xcodebuild -project Nourish.xcodeproj -target Nourish -configuration Debug -sdk iphonesimulator \
  SYMROOT="$PWD/build-sim" CODE_SIGNING_ALLOWED=NO build -quiet
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
phones = [d for runtime, ds in sorted(devices.items()) if 'iOS' in runtime for d in ds if d['name'].startswith('iPhone')]
print(phones[-1]['udid'])")
echo "== Booting simulator $UDID"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
echo "== Installing"
xcrun simctl install "$UDID" build-sim/Debug-iphonesimulator/Nourish.app

echo "== 1. First launch: the connect screen"
xcrun simctl launch "$UDID" io.github.nourish.app
sleep 10
xcrun simctl io "$UDID" screenshot shots/ios-1-connect.png
xcrun simctl terminate "$UDID" io.github.nourish.app || true

echo "== 2. Connected to the Nourish server"
BEFORE=$(wc -l < "$LOG")
xcrun simctl launch "$UDID" io.github.nourish.app -server_url http://127.0.0.1:8000/
sleep 15
xcrun simctl io "$UDID" screenshot shots/ios-2-app.png
NEW=$(tail -n +"$((BEFORE + 1))" "$LOG"); echo "Server saw:"; echo "$NEW" | grep -oE '"(GET|POST) [^"]*"' | sort | uniq -c || true
echo "$NEW" | grep -q '"GET /app.js' || fail "app.js never loaded"
echo "$NEW" | grep -q '"GET /api/info' || fail "the app's JavaScript never called the server"
echo "SMOKE TEST PASSED"
