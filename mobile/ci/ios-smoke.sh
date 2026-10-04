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

echo "== 1b. Recipe folders: created on first launch, each with a Read me, file sharing on"
for f in "Recipe Books" "My Recipes"; do
  [ -f "$DATA/Documents/$f/Read me.txt" ] || fail "folder $f (with its Read me) wasn't created on first launch"
done
ls -la "$DATA/Documents" "$DATA/Documents/Recipe Books"
probe "return JSON.stringify(await nativeCall('library', { op: 'where' }));" 60
python3 -c "
import json; r = json.load(open('$PROBE')); assert r['ok'], r; v = json.loads(r['value'])
assert v['fileSharing'] and v['foldersMade'], v
print('Recipe folders:', v['folder'], '| file sharing on | path', v['path'])" || fail "recipe folders not set up for the Files app"

echo "== 1c. Recipe books in the Recipe Books folder (a PDF and an EPUB, names with spaces and brackets) are opened, their recipes saved in the recipe database"
RB="$DATA/Documents/Recipe Books"
(cd "$GITHUB_WORKSPACE" 2>/dev/null || cd ../..; node tools/make-sample-epub.js "$RB/Easy Mornings (2nd ed) – Recetas.epub" && node tools/make-sample-pdf.js "$RB/Puerto Rican Cookery (Sample).pdf")
printf 'kindle' > "$RB/Old book.azw3"
# A scanned cookbook: pages that are only pictures (no text in the PDF), an older layout (capital
# titles, lettered ingredient groups, numbered steps, two recipes on a page) and a page in two
# columns. The pictures are drawn in the app's own web view; the PDF is put together here.
probe "const pages = [
    { cols: false, lines: ['OLD ISLAND COOKERY', '', 'ARROZ CON GANDULES', '(Rice with Pigeon Peas)', '(8 servings)', 'A', '1/4 pound salt pork, diced', '1 tablespoon annatto oil', 'B', '1 onion, chopped', '2 cups pigeon peas', '3 cups rice', '4 cups water',
      '1. In a caldero, brown the salt pork in the annatto oil.', '2. Add the ingredients in B and bring to a boil.', '3. Cover and cook over low heat for 30 minutes.', '',
      'SOPA DE PLATANO', '(Plantain Soup)', '2 green plantains', '6 cups chicken stock', '1 teaspoon salt', '1. Grate the plantains and stir into the boiling stock.', '2. Simmer for 20 minutes, stirring often, and serve hot.'] },
    { cols: true, title: ['TOSTONES', '(Twice-Fried Plantains)'], left: ['3 green plantains', '4 cups water', '1 tablespoon salt', '2 cups vegetable oil'],
      right: ['1. Peel the plantains and cut into', 'slices one inch thick.', '2. Soak the slices in the salted', 'water for 15 minutes and drain.', '3. Fry for 7 minutes, flatten each', 'slice and fry again until golden.'] }];
  const out = [];
  for (const p of pages) {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111'; g.font = '30px Georgia';
    if (!p.cols) p.lines.forEach((t, i) => g.fillText(t, 90, 110 + i * 56));
    else { p.title.forEach((t, i) => g.fillText(t, 420, 110 + i * 56)); p.left.forEach((t, i) => g.fillText(t, 90, 300 + i * 56)); p.right.forEach((t, i) => g.fillText(t, 660, 300 + i * 56)); }
    out.push(c.toDataURL('image/jpeg', 0.85).replace(/^data:[^,]*,/, ''));
  }
  return JSON.stringify(out);" 60
python3 - "$PROBE" "$RB/Old Island Cookery (scanned).pdf" <<'PY' || fail "couldn't make the scanned sample PDF"
import base64, json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
jpegs = [base64.b64decode(x) for x in json.loads(r["value"])]
objs = []
def add(b): objs.append(b); return len(objs)
kids = []
pages_id = 1 + len(jpegs) * 3
for j in jpegs:
    img = add(b"<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % len(j) + j + b"\nendstream")
    draw = b"q 595 0 0 842 0 0 cm /Im0 Do Q"
    content = add(b"<< /Length %d >>\nstream\n" % len(draw) + draw + b"\nendstream")
    kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << /XObject << /Im0 %d 0 R >> >> >>" % (pages_id, content, img)))
assert add(b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % len(kids)) == pages_id
cat = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
out = bytearray(b"%PDF-1.4\n"); offs = []
for i, o in enumerate(objs):
    offs.append(len(out)); out += b"%d 0 obj\n" % (i + 1) + o + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, x)
open(sys.argv[2], "wb").write(out); print("Scanned sample PDF:", len(out), "bytes,", len(jpegs), "pages of pictures")
PY
probe "localStorage.removeItem(LIBRARY_KEY); libraryIndexCache = null;
  await new Promise(r => { const t = setInterval(() => { if (recipeDBReady) { clearInterval(t); r(); } }, 200); });
  await indexLibrary();
  const idx = libraryIndex().files || {};
  return JSON.stringify({ db: recipeDB.backend.kind, count: recipeDB.count(), books: recipeDB.books().map(b => b.title + ': ' + b.count),
    files: Object.keys(idx).map(f => f + ' → ' + libraryFileStatus(f)), recipes: recipeDB.all().map(r => r.name + ' | ' + r.source_name),
    kindle: (idx['Recipe Books/Old book.azw3'] || {}).note || '', errors: libraryState.notes,
    tostones: (recipeDB.all().find(r => /Tostones/.test(r.name)) || {}).steps || [] });" 300
python3 - "$PROBE" <<'PY' || fail "the phone couldn't read the recipe books"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("Recipe database:", v["db"], "|", v["count"], "recipes"); print("\n".join(v["files"])); print("\n".join(v["recipes"]))
assert v["count"] > 0, v
names = " ".join(v["recipes"])
assert "Spinach & Feta Omelette | From your book: Easy Mornings & Evenings" in names, "EPUB not read"
assert "Arroz con Pollo" in names and "Habichuelas Guisadas" in names, "PDF not read"
scanned = [f for f in v["files"] if "scanned" in f]
print("Scanned PDF:", scanned)
assert scanned and "scanned pages read" in scanned[0], "the scanned PDF wasn't read with text recognition"
for dish in ("Arroz con Gandules", "Sopa de Platano", "Tostones"):
    assert dish in names, ("not found in the scanned PDF", dish)
assert not any("/private" in f or f.startswith("/") for f in v["files"]), "a path still starts wrong"
assert "Kindle" in v["kindle"], v
print("Tostones steps (a page in two columns, read column by column):", v["tostones"])
assert len(v["tostones"]) == 3 and "Peel the plantains" in v["tostones"][0], v["tostones"]
PY
echo "== 1d. After a restart the book recipes are still there, and the books aren't read again"
probe "await new Promise(r => { const t = setInterval(() => { if (recipeDBReady) { clearInterval(t); r(); } }, 200); });
  const before = activityLog.length; await indexLibrary();
  return JSON.stringify({ count: recipeDB.count(), plan: libraryRecipes().length, saved: activityLog.slice(before).filter(l => /Saved \\d+ recipe/.test(l.msg)).length });" 120
python3 - "$PROBE" <<'PY' || fail "the book recipes didn't survive a restart"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"]); print(v)
assert v["count"] >= 5 and v["plan"] >= 4 and v["saved"] == 0, v
PY
rm -f "$RB/Easy Mornings (2nd ed) – Recetas.epub" "$RB/Puerto Rican Cookery (Sample).pdf" "$RB/Old book.azw3" "$RB/Old Island Cookery (scanned).pdf"

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

echo "== 5b. A one-line description with the description format (0.1.10: it failed in 0.0 s every time)"
probe "const r = await nativeCall('generate', { model: 'test-model.gguf', grammar: DESCRIBE_GRAMMAR, temperature: 0.7, max_tokens: 90, n_ctx: 2048, gpu: false,
  messages: [{ role: 'system', content: 'You write one short, appetizing sentence about a dish.' }, { role: 'user', content: 'Describe Lemon Chicken Traybake (made with chicken thighs, potatoes, lemon, garlic) in one sentence of at most 20 words.' }] }, { timeoutMs: 0 });
  const meal = { name: 'Lemon Chicken Traybake', time_minutes: 45, ingredients: ['8 chicken thighs', '500 g new potatoes', '1 lemon', '3 garlic cloves'], steps: ['Roast everything for 40 minutes.'] };
  return JSON.stringify({ text: r.text, fallback: describeFromRecipe(meal), problem: descriptionProblem(r.text, meal) });" 180
python3 - "$PROBE" <<'PY' || fail "the phone's AI couldn't write a description"
import json, sys, re
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"]); t = v["text"].strip()
print("Description from the phone's AI:", t); print("Description made from the recipe:", v["fallback"])
print("Would it be shown?", "yes" if not v["problem"] else "no, " + v["problem"] + " (the one made from the recipe is shown instead)")
assert re.match(r'^[A-Z][^"\\]{20,200}[.!]$', t), t
assert v["fallback"], v
PY

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
# Saved days are kept, except a meal the app swapped and said why in the log: it repeated an earlier
# one (no repeats, since 0.1.9) or it didn't suit its slot ("isn't a dinner", since 0.1.8). The tiny
# test model often writes the same dish again, or a wrap for dinner.
swapped = [l for l in v["log"] if "; replaced by" in l]
for d_new, d_old in zip(v["days"], saved):
    for t in ("breakfast", "lunch", "dinner"):
        if d_new[t]["name"] != d_old[t]["name"]:
            assert any(f'"{d_old[t]["name"]}"' in l and f'"{d_new[t]["name"]}"' in l for l in swapped), ("saved day changed with no reason in the log", d_old[t]["name"], d_new[t]["name"])
names = [d[t]["name"].strip().lower() for d in v["days"] for t in ("breakfast", "lunch", "dinner")]
assert len(names) == len(set(names)), ("a meal is repeated in the finished plan", sorted(n for n in set(names) if names.count(n) > 1))
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
    meals: MEAL_TYPES.map(t => d[t] ? d[t].name + ' (' + (d[t].builtin ? 'Nourish recipe' : d[t].source_name || (d[t].library_path ? 'library' : 'AI')) + ')' : '-') })), log: lines,
    share: (() => { const all = daysData.flatMap(d => MEAL_TYPES.map(t => d[t]).filter(Boolean)); return { meals: all.length, builtin: all.filter(m => m.builtin).length, web: all.filter(m => !m.builtin && /^https?:/.test(m.source_url || '')).length }; })(),
    split: planSourceSplit(daysData), library: libraryStats() });" 560
python3 - "$PROBE" <<'PY' || echo "(timing step skipped: $?)"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
v = json.loads(r["value"])
print("\n".join(v["log"]))
for i, d in enumerate(v["days"]): print(f"Day {i + 1}: {d['kcal']} kcal |", " | ".join(d["meals"]))
print(f"AUTOMATIC 7-DAY PLAN ON THE SIMULATOR: {v['seconds']} s" + ("" if v["finished"] else " (stopped at the 8-minute limit; see the 'Found ... recipes in ... s' line for the search time)"))
sh = v["share"]; print(f"SHARE OF THE PLAN: {sh['web']} of {sh['meals']} meals from recipe websites, {sh['builtin']} Nourish recipes, {sh['meals'] - sh['web'] - sh['builtin']} other (library/AI)")
sp = v["split"]; print(f"SPLIT: web {sp['web']}, books {sp['books']}, Nourish recipes {sp['builtin']}, AI {sp['ai']} | per source: {sp['perSource']}")
print("MOST FROM ONE SOURCE:", max(sp["perSource"].values()) if sp["perSource"] else 0)
lib = v["library"]; print(f"WEB LIBRARY AFTER ONE PLAN: {lib['total']} recipes (breakfast {lib['perMeal']['breakfast']}, lunch {lib['perMeal']['lunch']}, dinner {lib['perMeal']['dinner']})")
PY

echo "== 6d2. The web library grows: three 'Refresh recipes now' rounds (not pass/fail: needs the live sites)"
probe "const out = [];
  for (let i = 0; i < 3; i++) { await refreshRecipeLibrary({ manual: true }); const s = libraryStats(); out.push({ total: s.total, perMeal: s.perMeal, sources: Object.keys(s.perSource).length }); }
  out.push({ perSource: libraryStats().perSource });
  return JSON.stringify(out);" 420
python3 - "$PROBE" <<'PY' || echo "(library growth step skipped)"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
rows = json.loads(r["value"])
for i, row in enumerate(rows[:-1]): print(f"After refresh {i + 1}: {row['total']} web recipes (breakfast {row['perMeal']['breakfast']}, lunch {row['perMeal']['lunch']}, dinner {row['perMeal']['dinner']}) from {row['sources']} sites")
print("Per site:", ", ".join(f"{k} {v}" for k, v in sorted(rows[-1]["perSource"].items(), key=lambda x: -x[1])))
PY

echo "== 6e. Every recipe site, tried from inside the iPhone app (its own way of fetching pages): not pass/fail, sites change"
probe "const rows = [];
  for (const site of NourishSources.SITES.filter(s => s.status === 'ok')) {
    const store = {}; const t0 = Date.now();
    const o = Object.assign(finderOptions('', ''), { enabled: id => id === site.id, days: 7, limits: { seconds: 20, searches: 4, pages: 4, parallel: 2 },
      cache: { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } }, trace: () => {}, log: () => {} });
    let res = null, err = '';
    try { res = await NourishFinder.findRecipes(o); } catch (e) { err = e.message; }
    const f = store.nourish_source_failures ? (JSON.parse(store.nourish_source_failures)[site.id] || {}) : {};
    rows.push({ id: site.id, recipes: res ? res.stats.recipes : 0, pages: res ? res.stats.pages : 0, seconds: Math.round((Date.now() - t0) / 1000), why: err || f.why || '', blocked: !!f.blocked });
  }
  return JSON.stringify(rows);" 900
python3 - "$PROBE" <<'PY' || echo "(site table skipped)"
import json, sys
r = json.load(open(sys.argv[1])); assert r["ok"], r
print("SITES FROM THE IPHONE APP (simulator on a cloud Mac, so a datacenter address, not a phone network):")
for row in json.loads(r["value"]):
    print(f"  {row['id']:<18} {row['recipes']:>3} recipes from {row['pages']:>2} pages in {row['seconds']:>3} s" + (f"  FAILED: {row['why']}{' (refuses the app)' if row['blocked'] else ''}" if row['why'] else ""))
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
