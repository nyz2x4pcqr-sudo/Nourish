#!/bin/bash
# Builds Nourish for the iOS simulator, launches it (connect screen, then connected to the
# Nourish server running on this Mac) and saves screenshots.
set -eux
mkdir -p shots
xcodebuild -project Nourish.xcodeproj -target Nourish -configuration Debug -sdk iphonesimulator \
  SYMROOT="$PWD/build-sim" CODE_SIGNING_ALLOWED=NO build -quiet
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
phones = [d for runtime, ds in devices.items() if 'iOS' in runtime for d in ds if d['name'].startswith('iPhone')]
print(phones[-1]['udid'])")
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" build-sim/Debug-iphonesimulator/Nourish.app
xcrun simctl launch "$UDID" io.github.nourish.app
sleep 10
xcrun simctl io "$UDID" screenshot shots/ios-1-connect.png
xcrun simctl terminate "$UDID" io.github.nourish.app
xcrun simctl launch "$UDID" io.github.nourish.app -server_url http://127.0.0.1:8000/
sleep 15
xcrun simctl io "$UDID" screenshot shots/ios-2-app.png
xcrun simctl spawn "$UDID" launchctl list | grep -q io.github.nourish.app || { echo "The app is not running"; exit 1; }
