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

# Launches the app with a JavaScript probe and waits (up to $2 s) for its result. With a third
# argument "retry", a launch that gives no answer is tried once more: right after a slow simulator
# start (seen on a busy CI machine: 3:42 to boot, waiting on the system app) the first launch can stall.
probe() {
  for attempt in 1 2; do
    rm -f "$PROBE"
    xcrun simctl terminate "$UDID" $APP 2>/dev/null || true
    xcrun simctl launch "$UDID" $APP -mode local -js_probe "$1"
    { set +x; } 2>/dev/null   # waiting quietly keeps the log readable
    for i in $(seq 1 "$2"); do [ -f "$PROBE" ] && break; sleep 1; done
    set -x
    [ -f "$PROBE" ] && break
    [ "${3:-}" = retry ] && [ $attempt = 1 ] || break
    echo "No answer after $2 s; launching the app once more"
  done
  [ -f "$PROBE" ] || fail "no answer from the app's probe"
  cat "$PROBE" | cut -c1-800; echo
}

# Same, without waiting for the result.
start_probe() {
  rm -f "$PROBE"
  xcrun simctl terminate "$UDID" $APP 2>/dev/null || true
  xcrun simctl launch "$UDID" $APP -mode local -js_probe "$1"
}

echo "== 1. First launch: Nourish on the phone, no PC"
BEFORE=$(wc -l < "$LOG")
probe "localStorage.setItem('probe_saved', 'kept'); const s = await getSpecs(); return JSON.stringify({ local: LOCAL_MODE, native: nativeAvailable(), title: document.title, specs: s });" 180 retry
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
probe "const r = await nativeCall('generate', { model: 'test-model.gguf', grammar: mealGrammar(2), temperature: 0.7, max_tokens: MEAL_TOKENS, n_ctx: 4096, gpu: false,
  messages: [{ role: 'system', content: mealSystem(2) }, { role: 'user', content: mealAsk({ type: 'dinner', d: 0, cuisine: 'Moroccan' }) }] }, { timeoutMs: 0 });
  const models = await nativeCall('models', {}); return JSON.stringify({ text: r.text, models: models.files });" 300
python3 - "$PROBE" <<'PY' || fail "the model's meal is not valid"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"]); m = json.loads(v["text"])
assert m["name"] and m["servings"] == 2 and len(m["ingredients"]) >= 3 and len(m["steps"]) >= 3 and "calories" in m["nutrition"], m
assert all(s.rstrip().endswith((".", "!")) for s in m["steps"]), m["steps"]
assert any(f["file"] == "test-model.gguf" for f in v["models"]), v["models"]
print("Valid meal in the app's format:", m["name"], "-", len(m["ingredients"]), "ingredients,", len(m["steps"]), "steps")
PY
cp "$PROBE" shots/ios-ai-probe.json

echo "== 6a. A 7-day plan on the phone through the app's own Generate Plan code; the app is killed after day 2"
probe "Object.assign(settings, { active_provider: 'local', local_model: 'test-model.gguf', local_ctx: '4096', local_gpu: 'off' }); changed('settings');
  runPlanJob({ kind: 'plan', origin: 'sheet', messages: [{ role: 'system', content: planSystemPrompt() },
    { role: 'user', content: 'Goal: eat balanced. Likes: anything. Avoids: nothing. Generate the 7-day meal plan JSON.' }] });
  await new Promise(r => { const t = setInterval(() => { const s = JSON.parse(localStorage.getItem('nourish_plan_progress') || '{}'); if ((s.days || []).length >= 2 || s.failed) { clearInterval(t); r(); } }, 300); });
  const s = JSON.parse(localStorage.getItem('nourish_plan_progress') || '{}');
  if (s.failed) throw new Error('The plan stopped: ' + s.failed + ' | ' + activityLog.filter(l => l.area === 'plan').slice(-12).map(l => l.level + ' ' + l.msg).join(' | '));
  return JSON.stringify(s);" 2700
python3 -c "
import json; r = json.load(open('$PROBE')); assert r['ok'], r; s = json.loads(r['value'])
json.dump(s['days'][:2], open('saved-days.json', 'w')); print('Saved before the kill:', len(s['days']), 'days')" || fail "the plan wasn't saved day by day"
sleep 3   # let WebKit write localStorage to disk

echo "== 6b. Relaunch: the plan continues by itself from the saved day"
probe "await new Promise(r => { const t = setInterval(() => { const p = JSON.parse(localStorage.getItem('nourish_plan_progress') || 'null'); if ((!planJob && daysData.length === 7 && !p) || (p && p.failed)) { clearInterval(t); r(); } }, 1000); });
  const p = JSON.parse(localStorage.getItem('nourish_plan_progress') || 'null');
  if (p && p.failed) throw new Error('The plan stopped: ' + p.failed + ' | ' + activityLog.filter(l => l.area === 'plan').slice(-12).map(l => l.level + ' ' + l.msg).join(' | '));
  return JSON.stringify({ days: daysData, log: activityLog.filter(l => l.area === 'plan').map(l => l.level + ' ' + l.msg) });" 3600
python3 - "$PROBE" <<'PY' || fail "the plan didn't continue correctly after the app was killed"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
assert len(v["days"]) == 7, ("days", len(v["days"]))
saved = json.load(open("saved-days.json"))
assert [d["breakfast"]["name"] for d in v["days"][:len(saved)]] == [d["breakfast"]["name"] for d in saved], "saved days changed"
assert any("Found a plan stopped at day" in l for l in v["log"]), "no resume in the log"
junk = ("ingredients", "steps", "name", "nutrition", "description")
for i, day in enumerate(v["days"]):
    for meal in ("breakfast", "lunch", "dinner"):
        m = day[meal]; assert m["name"] and m["steps"] and "calories" in m["nutrition"] and m["servings"] >= 1, (i, meal)
        for item in m["ingredients"]:
            assert item.strip().lower() not in junk and not item.lower().startswith(("use ", "description of ")) and item.count(",") <= 2, ("junk got through", item)
    print(f"Day {i + 1}:", " | ".join(day[m]["name"] for m in ("breakfast", "lunch", "dinner")))
flagged = sum(1 for d in v["days"] for t in ("breakfast", "lunch", "dinner") if d[t].get("incomplete"))
print(f"Meals marked 'may be incomplete' (expected with this tiny test model): {flagged} of 21")
print("Resumed after the kill at day", len(saved) + 1, "and kept the first", len(saved), "days")
PY
cp "$PROBE" shots/ios-plan-probe.json

echo "== 6c. In the background part-way through a plan: the time iOS gives (logged), then the plan is finished"
# simctl can't reliably bring a running app back to the front (earlier runs kept logging "in the
# background" after "simctl launch"), so after 45 s away the app is reopened the way iOS would after
# closing it: the plan continues from its last saved day.
start_probe "localStorage.removeItem('nourish_plan_progress');
  runPlanJob({ kind: 'plan', origin: 'sheet', messages: [{ role: 'system', content: planSystemPrompt() },
    { role: 'user', content: 'Goal: eat balanced. Generate the 7-day meal plan JSON.' }] });
  return 'started';"
for i in $(seq 1 120); do [ -f "$PROBE" ] && break; sleep 1; done
sleep 20
echo "-- sending Nourish to the background for 45 s"
xcrun simctl launch "$UDID" com.apple.Preferences
sleep 45
sleep 3   # let WebKit write localStorage (the plan and the activity log) to disk
echo "-- reopening Nourish; the plan should continue from its saved day"
probe "await new Promise(r => { const t = setInterval(() => { const p = JSON.parse(localStorage.getItem('nourish_plan_progress') || 'null'); if ((!planJob && daysData.length === 7 && !p) || (p && p.failed)) { clearInterval(t); r(); } }, 1000); });
  const p = JSON.parse(localStorage.getItem('nourish_plan_progress') || 'null');
  if (p && p.failed) throw new Error('The plan stopped: ' + p.failed + ' | ' + activityLog.filter(l => l.area === 'plan').slice(-12).map(l => l.level + ' ' + l.msg).join(' | '));
  return JSON.stringify({ days: daysData.length, log: activityLog.filter(l => /background|Background|paused|Paused|Found a plan|Day [0-9] done|Screen stays/.test(l.msg)).map(l => new Date(l.t).toISOString().slice(11, 19) + ' ' + l.level + ' ' + l.msg) });" 3600
python3 - "$PROBE" <<'PY' || fail "the plan didn't finish after a trip to the background"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
assert v["days"] == 7, v["days"]
print("Background-time lines:", sum("background" in l.lower() for l in v["log"]))
PY

echo "== 6d. The default Generate (real recipes first, the phone's AI fills gaps): time for 7 days (not a pass/fail check: it needs the live recipe sites)"
probe "localStorage.removeItem('nourish_plan_progress'); const t0 = Date.now();
  const finished = await Promise.race([runSmartPlan('', '').then(() => true), new Promise(r => setTimeout(() => r(false), 480000))]);
  if (!finished) { localPlanCancelled = true; }
  const lines = activityLog.filter(l => l.area === 'plan').slice(-8).map(l => l.msg);
  return JSON.stringify({ finished, seconds: Math.round((Date.now() - t0) / 1000), days: daysData.map(d => ({ kcal: Math.round(NourishPlanner.dayTotals(d).kcal),
    meals: MEAL_TYPES.map(t => d[t] ? d[t].name + ' (' + (d[t].source_name || (d[t].library_path ? 'library' : 'AI')) + ')' : '-') })), log: lines });" 560
python3 - "$PROBE" <<'PY' || echo "(timing step skipped: $?)"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
for i, d in enumerate(v["days"]): print(f"Day {i + 1}: {d['kcal']} kcal |", " | ".join(d["meals"]))
print(f"AUTOMATIC 7-DAY PLAN ON THE SIMULATOR: {v['seconds']} s" + ("" if v["finished"] else " (stopped at the 8-minute limit; see the "Found ... recipes in ... s" line for the search time)"))
PY

echo "== 7. Screen headers stay below the status bar on all five tabs"
probe "const out = [];
  const probeEl = document.createElement('div'); probeEl.style.cssText = 'position:fixed;top:0;height:var(--safe-top)'; document.body.appendChild(probeEl);
  const safeTop = probeEl.getBoundingClientRect().height;
  for (const tab of ['today', 'plan', 'chat', 'grocery', 'settings']) {
    document.querySelector('.tab[data-tab=\"' + tab + '\"]').click();
    await new Promise(r => setTimeout(r, 500)); window.scrollTo(0, 0);
    const header = document.querySelector('.screen.active .screen-header');
    out.push({ tab, headerTop: Math.round(header.getBoundingClientRect().top), safeTop });
  }
  return JSON.stringify(out);" 120
xcrun simctl io "$UDID" screenshot shots/ios-5-settings-header.png
python3 - "$PROBE" <<'PY' || fail "a screen header overlaps the status bar"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
rows = json.loads(r["value"])
for row in rows: print(f"{row['tab']}: header top {row['headerTop']} px, status bar {row['safeTop']} px")
assert rows[0]["safeTop"] > 20, "the simulator should report a status bar height"
assert all(row["headerTop"] >= row["safeTop"] for row in rows)
PY
xcrun simctl io "$UDID" screenshot shots/ios-4-plan.png
xcrun simctl io "$UDID" screenshot shots/ios-3-after-ai.png

echo "== 8. A screenshot of a recipe is read on the phone (Apple Vision), the way the importer sends it"
probe "const c = document.createElement('canvas'); c.width = 900; c.height = 520; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000'; g.font = '40px Helvetica';
  ['Weeknight Red Lentil Dal', 'Ingredients', '1 cup red lentils', '2 cloves garlic', '1 tsp turmeric', 'Simmer for 20 minutes'].forEach((t, i) => g.fillText(t, 40, 70 + i * 75));
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const img = await imageForReading(new File([blob], 'shot.png', { type: 'image/png' }));
  const read = await nativeCall('ocr', { image: img.data }, { timeoutMs: 60000 });
  return JSON.stringify(read);" 120
python3 - "$PROBE" <<'PY2' || fail "the phone couldn't read the text in a picture"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"]); text = v["text"].lower()
print("Read", v["lines"], "lines:", v["text"].replace("\n", " | "))
for word in ("lentil", "garlic", "turmeric", "ingredients"):
    assert word in text, ("missing", word)
PY2
echo "SMOKE TEST PASSED"
