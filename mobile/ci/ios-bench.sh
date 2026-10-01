#!/bin/bash
# Compares phone models on the same meal-plan prompt, through the app's own plan code, in the iOS
# simulator: seconds per day, prompt size, junk ingredient lines (first try) and repeated dishes.
# The simulator runs models on the Mac's processor (no Metal), so the seconds are slower than on an
# iPhone; compare models with each other, not with a phone.
set -eu
DAYS=${BENCH_DAYS:-3}
APP=io.github.nourish.app
fail() { echo "BENCH FAILED: $*"; exit 1; }

xcodebuild -project Nourish.xcodeproj -target Nourish -configuration Debug -sdk iphonesimulator \
  SYMROOT="$PWD/build-sim" CODE_SIGNING_ALLOWED=NO build -quiet
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
phones = [d for runtime, ds in sorted(devices.items()) if 'iOS' in runtime for d in ds if d['name'].startswith('iPhone')]
print(phones[-1]['udid'])")
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" build-sim/Debug-iphonesimulator/Nourish.app
DATA=$(xcrun simctl get_app_container "$UDID" $APP data)
PROBE="$DATA/Documents/probe.json"
probe() {
  rm -f "$PROBE"
  xcrun simctl terminate "$UDID" $APP 2>/dev/null || true
  xcrun simctl launch "$UDID" $APP -mode local -js_probe "$1" >/dev/null
  for i in $(seq 1 "$2"); do [ -f "$PROBE" ] && break; sleep 1; done
  [ -f "$PROBE" ] || fail "no answer from the app"
}

mkdir -p bench
for SPEC in "unsloth/Qwen3.5-2B-GGUF Qwen3.5-2B-Q4_K_M.gguf" "LiquidAI/LFM2.5-2.6B-GGUF LFM2.5-2.6B-Q4_K_M.gguf"; do
  set -- $SPEC; REPO=$1; FILE=$2
  echo "== $FILE: download through the app"
  probe "const tree = await nativeJSON('https://huggingface.co/api/models/$REPO/tree/main');
    const entry = tree.find(f => f.path === '$FILE'); const want = (entry.lfs && entry.lfs.size) || entry.size;
    const done = new Promise((ok, bad) => nativeOn('download', e => { if (e.file !== '$FILE') return; if (e.state === 'done') ok(e); else if (e.state === 'error') bad(new Error(e.error)); }));
    await nativeCall('download', { url: 'https://huggingface.co/$REPO/resolve/main/$FILE', file: '$FILE', size: want, auth: 'hf' });
    return JSON.stringify(await done);" 1800
  python3 -c "import json; r = json.load(open('$PROBE')); assert r['ok'], r; print('downloaded', json.loads(r['value'])['received'], 'bytes')"
  echo "== $FILE: $DAYS days with the app's plan code"
  probe "Object.assign(settings, { active_provider: 'local', local_model: '$FILE', local_ctx: '4096', local_gpu: 'off' });
    const t0 = Date.now();
    const r = await generatePlanOnDevice([{ role: 'user', content: 'Goal: eat balanced. Likes: anything. Avoids: nothing.' }], { totalDays: $DAYS }, {});
    const lines = r.days.reduce((n, d) => n + ['breakfast', 'lunch', 'dinner'].reduce((m, t) => m + ((d[t] && d[t].ingredients) || []).length, 0), 0);
    return JSON.stringify({ model: '$FILE', stats: r.stats, lines, total: (Date.now() - t0) / 1000, names: r.days.map(d => [d.breakfast.name, d.lunch.name, d.dinner.name]) });" 5400
  cp "$PROBE" "bench/$FILE.json"
  python3 - "$PROBE" <<'PY'
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print(f"{v['model']}: {v['total']:.0f} s for {len(v['stats'])} days")
for s in v["stats"]:
    print(f"  day {s['day']}: {s['seconds']} s, prompt {s['promptChars']} chars, junk lines (first try) {s['junkRows']}, made again {s['retried']}, repeats replaced {s['repeatsFixed']}")
junk = sum(s["junkRows"] for s in v["stats"])
print(f"  junk-line rate (first tries): {junk} of {junk + v['lines']} lines = {100 * junk / max(1, junk + v['lines']):.1f}%")
for i, n in enumerate(v["names"]): print(f"  Day {i + 1}: " + " | ".join(n))
PY
  # free the simulator's disk for the next model
  probe "await nativeCall('deleteModel', { file: '$FILE' }); return 'ok';" 60
done
