#!/bin/bash
# Builds Nourish for the iOS simulator and checks, with screenshots:
#  1. first launch runs the built-in app on the phone (no PC), with the native bridge working;
#  2. what the app saves survives a restart;
#  3. connecting to a Nourish server shows the PC's copy;
#  4. a real model downloads from Hugging Face through the app (stopped part-way and continued), byte-checked;
#  5. it runs through the app's JavaScript → bridge → llama.cpp and writes a valid day of meals;
#  6. the app's own Generate Plan makes a whole 7-day plan with it.
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

echo "== 4. Download a real model from Hugging Face through the app: stop it part-way, continue, check the file"
probe "const file = 'test-model.gguf', want = 105454432;
  const url = 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf';
  const next = pred => new Promise((ok, bad) => nativeOn('download', e => {
    if (e.file !== file) return;
    if (pred(e)) ok(e); else if (e.state === 'error') bad(new Error(e.error));
  }));
  const first = next(e => (e.state === 'running' && e.received > 0) || e.state === 'done');
  await nativeCall('download', { url, file, size: want, auth: 'hf' });
  let final = await first, stoppedAt = null;
  if (final.state !== 'done') {
    const stopped = next(e => e.state === 'cancelled');
    await nativeCall('cancelDownload', { file });
    stoppedAt = (await stopped).received;
    const done = next(e => e.state === 'done');
    await nativeCall('download', { url, file, size: want, auth: 'hf' });
    final = await done;
  }
  const models = (await nativeCall('models', {})).files;
  const log = activityLog.filter(l => l.msg.includes(file)).map(l => l.level + ' ' + l.msg);
  return JSON.stringify({ final, stoppedAt, models, log });" 600
python3 - "$PROBE" <<'PY' || fail "model download through the app failed"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
want = 105454432
assert v["final"]["state"] == "done" and v["final"]["received"] == want, v["final"]
on_disk = [m["size"] for m in v["models"] if m["file"] == "test-model.gguf"]
assert on_disk == [want], ("file on disk", on_disk)
assert v["stoppedAt"] and 0 < v["stoppedAt"] < want, ("never stopped part-way", v["stoppedAt"])
assert any("continuing from" in l for l in v["log"]), "the second download did not continue from where it stopped"
print(f"Stopped at {v['stoppedAt']} bytes, continued, and the file on disk is exactly {on_disk[0]} bytes")
PY

echo "== 4b. Download check, then LiquidAI/LFM2.5-230M-GGUF step by step (16 MB pieces) through the app, byte-checked, then run it"
probe "const repo = 'LiquidAI/LFM2.5-230M-GGUF', file = 'LFM2.5-230M-Q4_K_M.gguf';
  const tree = await nativeJSON('https://huggingface.co/api/models/' + repo + '/tree/main');
  const entry = tree.find(f => f.path === file); if (!entry) throw new Error('not in the repo: ' + file);
  const want = (entry.lfs && entry.lfs.size) || entry.size;
  const check = await nativeCall('downloadCheck', { url: 'https://huggingface.co/' + repo + '/resolve/main/' + file }, { timeoutMs: 120000 });
  const done = new Promise((ok, bad) => nativeOn('download', e => {
    if (e.file !== file) return;
    if (e.state === 'done') ok(e); else if (e.state === 'error' || e.state === 'cancelled') bad(new Error(e.error || e.state));
  }));
  await nativeCall('download', { url: 'https://huggingface.co/' + repo + '/resolve/main/' + file, file, size: want, auth: 'hf', mode: 'chunked' });
  const e = await done;
  const models = (await nativeCall('models', {})).files;
  const gen = await nativeCall('generate', { model: file, temperature: 0.2, max_tokens: 24, n_ctx: 1024, gpu: false,
    messages: [{ role: 'user', content: 'Name one breakfast food.' }] }, { timeoutMs: 0 });
  const log = activityLog.filter(l => l.msg.includes(file) || l.msg.includes('Download session') || l.area === 'phone').map(l => l.level + ' ' + l.msg);
  return JSON.stringify({ want, check, e, models, gen, log });" 900
python3 - "$PROBE" <<'PY' || fail "LFM2.5-230M download through the app failed"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
want = v["want"]; assert want > 100_000_000, want
assert v["e"]["state"] == "done" and v["e"]["received"] == want, v["e"]
on_disk = [m["size"] for m in v["models"] if m["file"] == "LFM2.5-230M-Q4_K_M.gguf"]
assert on_disk == [want], ("file on disk", on_disk, "expected", want)
c = v["check"]; print("Download check:", json.dumps(c))
assert c["get_bytes"] == 1048576 and c["get_status"] == 206, ("bare URLSession 1 MB GET", c)
assert any("step-by-step download" in l for l in v["log"]), "expected the step-by-step download"
assert any("first piece OK (HTTP 206" in l for l in v["log"]), "no 206 for the first piece"
print(f"LFM2.5-230M: {on_disk[0]} bytes on disk, exactly the size Hugging Face lists")
text = v["gen"]["text"]; print("LFM2.5-230M says:", repr(text))
assert text.strip(), "LFM2.5-230M produced no text"

PY

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

echo "== 6. A whole 7-day meal plan made on the phone, through the app's own Generate Plan code"
probe "Object.assign(settings, { active_provider: 'local', local_model: 'test-model.gguf', local_ctx: '2048', local_gpu: 'off' });
  await runPlanJob({ kind: 'plan', origin: 'sheet', messages: [{ role: 'system', content: planSystemPrompt() },
    { role: 'user', content: 'Goal: eat balanced. Likes: anything. Avoids: nothing. Generate the 7-day meal plan JSON.' }] });
  return JSON.stringify({ days: daysData, log: activityLog.filter(l => l.area === 'plan').map(l => l.level + ' ' + l.msg) });" 2400
python3 - "$PROBE" <<'PY' || fail "the on-device 7-day plan is not valid"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
assert len(v["days"]) == 7, ("days", len(v["days"]))
for i, day in enumerate(v["days"]):
    for meal in ("breakfast", "lunch", "dinner"):
        m = day[meal]; assert m["name"] and m["ingredients"] and m["steps"] and "calories" in m["nutrition"], (i, meal)
for i, day in enumerate(v["days"]):
    print(f"Day {i + 1}:", " | ".join(day[m]["name"] for m in ("breakfast", "lunch", "dinner")))
PY
cp "$PROBE" shots/ios-plan-probe.json
xcrun simctl io "$UDID" screenshot shots/ios-4-plan.png
xcrun simctl io "$UDID" screenshot shots/ios-3-after-ai.png
echo "SMOKE TEST PASSED"
