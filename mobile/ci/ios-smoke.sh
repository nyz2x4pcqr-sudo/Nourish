#!/bin/bash
# Builds Nourish for the iOS simulator and checks, with screenshots:
#  1. first launch runs the built-in app on the phone (no PC), with the native bridge working;
#  2. what the app saves survives a restart;
#  3. connecting to a Nourish server shows the PC's copy;
#  4. a real model runs through the app's JavaScript → bridge → llama.cpp and writes a valid day of meals.
set -eux
mkdir -p shots
LOG="$GITHUB_WORKSPACE/server.log"
APP=io.github.nourish.app
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
DATA=$(xcrun simctl get_app_container "$UDID" $APP data)
PROBE="$DATA/Documents/probe.json"

# Launches the app with a JavaScript probe and waits (up to $2 s) for its result.
probe() {
  rm -f "$PROBE"
  xcrun simctl terminate "$UDID" $APP 2>/dev/null || true
  xcrun simctl launch "$UDID" $APP -mode local -js_probe "$1"
  for i in $(seq 1 "$2"); do [ -f "$PROBE" ] && break; sleep 1; done
  [ -f "$PROBE" ] || fail "no answer from the app's probe"
  cat "$PROBE" | cut -c1-800; echo
}

echo "== 1. First launch: Nourish on the phone, no PC"
BEFORE=$(wc -l < "$LOG")
probe "localStorage.setItem('probe_saved', 'kept'); const s = await getSpecs(); return JSON.stringify({ local: LOCAL_MODE, native: nativeAvailable(), title: document.title, specs: s });" 60
python3 -c "
import json; r = json.load(open('$PROBE')); assert r['ok'], r; v = json.loads(r['value'])
assert v['local'] and v['native'], v; assert v['specs']['ram'] > 0 and v['specs']['platform'] == 'ios', v
print('Built-in app with native bridge; phone:', v['specs']['device'], v['specs']['ram'] // 2**20, 'MB RAM')" || fail "built-in app or bridge not working"
sleep 2; xcrun simctl io "$UDID" screenshot shots/ios-1-local.png
[ "$(tail -n +"$((BEFORE + 1))" "$LOG" | grep -c 'GET /app.js')" = "0" ] || fail "phone-only mode loaded the app from the PC"

echo "== 2. Saved data survives a restart"
probe "return localStorage.getItem('probe_saved');" 60
python3 -c "import json; r = json.load(open('$PROBE')); assert r['value'] == 'kept', r" || fail "localStorage was not kept"

echo "== 3. Connected to the Nourish server"
xcrun simctl terminate "$UDID" $APP || true
BEFORE=$(wc -l < "$LOG")
xcrun simctl launch "$UDID" $APP -mode server -server_url http://127.0.0.1:8000/
# The app asks for /api/info after it has synced with the PC; wait for it (up to 60 s) rather than guessing.
for i in $(seq 1 60); do tail -n +"$((BEFORE + 1))" "$LOG" | grep -q '"GET /api/info' && break; sleep 1; done
sleep 2
xcrun simctl io "$UDID" screenshot shots/ios-2-pc.png
NEW=$(tail -n +"$((BEFORE + 1))" "$LOG"); echo "Server saw:"; echo "$NEW" | grep -oE '"(GET|POST) [^"]*"' | sort | uniq -c || true
echo "$NEW" | grep -q '"GET /app.js' || fail "app.js never loaded"
echo "$NEW" | grep -q '"GET /api/info' || fail "the app's JavaScript never called the server"

echo "== 4. Download a real model from Hugging Face through the app (following its redirects)"
probe "const done = new Promise((ok, bad) => nativeOn('download', e => {
    if (e.file !== 'test-model.gguf') return;
    if (e.state === 'done') ok(e); else if (e.state === 'error' || e.state === 'cancelled') bad(new Error(e.error || e.state));
  }));
  await nativeCall('download', { url: 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf?download=true',
    file: 'test-model.gguf', size: 105454432, auth: 'hf' });
  const e = await done; return JSON.stringify(e);" 300
python3 -c "
import json; r = json.load(open('$PROBE')); assert r['ok'], r; e = json.loads(r['value'])
assert e['state'] == 'done' and e['received'] == 105454432, e
print('Downloaded through the app:', e['received'], 'bytes')" || fail "model download through the app failed"

echo "== 5. On-device AI through the app's own code"
probe "const r = await nativeCall('generate', { model: 'test-model.gguf', grammar: GBNF_DAY, temperature: 0.7, max_tokens: 900, n_ctx: 2048, gpu: false,
  messages: [{ role: 'system', content: 'You are a meal-planning chef. Reply with JSON only.' }, { role: 'user', content: 'Plan Day 1 (Monday): breakfast, lunch and dinner.' }] }, { timeoutMs: 0 });
  const models = await nativeCall('models', {}); return JSON.stringify({ text: r.text, models: models.files });" 300
python3 - "$PROBE" <<'PY' || fail "the model's day of meals is not valid"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"]); day = json.loads(v["text"])
for meal in ("breakfast", "lunch", "dinner"):
    m = day[meal]; assert m["name"] and m["ingredients"] and m["steps"] and "calories" in m["nutrition"], meal
assert any(f["file"] == "test-model.gguf" for f in v["models"]), v["models"]
print("Valid day of meals:", [day[m]["name"] for m in ("breakfast", "lunch", "dinner")])
PY
cp "$PROBE" shots/ios-ai-probe.json
xcrun simctl io "$UDID" screenshot shots/ios-3-after-ai.png
echo "SMOKE TEST PASSED"
