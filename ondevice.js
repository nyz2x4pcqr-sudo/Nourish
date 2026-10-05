// === NOURISH ON THIS PHONE ===
// When the Nourish iPhone/Android app runs on its own (no PC), this file stands in for the server:
// it talks to the app's native code ("the bridge") to run AI models on the phone, download them from
// Hugging Face, and fetch recipes from the web. It is loaded after app.js and uses its helpers.

// The phone app serves its built-in copy of Nourish from these addresses.
const LOCAL_MODE = typeof location !== 'undefined' && (location.protocol === 'nourish:' || location.hostname === 'appassets.androidplatform.net');
const nativeRoot = typeof window !== 'undefined' ? window : {};

// === NATIVE BRIDGE ===
const nativePending = {};
const nativeListeners = {};
let nativeSeq = 0;

function nativeAvailable() {
    const window = nativeRoot;
    return !!((window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nourishNative) ||
        (window.NourishAndroid && window.NourishAndroid.call));
}

// Calls the app's native code. Resolves with its answer, rejects with a readable error.
function nativeCall(cmd, args = {}, { timeoutMs = 60000 } = {}) {
    if (!nativeAvailable()) return Promise.reject(new Error('This needs the Nourish phone app.'));
    const id = String(++nativeSeq);
    const started = Date.now();
    if (cmd !== 'http') logNative(`→ ${cmd}`, summarizeArgs(cmd, args));
    return new Promise((resolve, reject) => {
        const timer = timeoutMs ? setTimeout(() => {
            delete nativePending[id];
            logNative(`✗ ${cmd} timed out after ${timeoutMs} ms`, null, 'warn');
            reject(new Error('The phone took too long to answer.'));
        }, timeoutMs) : null;
        nativePending[id] = {
            resolve: v => { if (cmd !== 'http') logNative(`← ${cmd} ok (${Date.now() - started} ms)`, cmd === 'specs' || cmd === 'models' ? v : null); resolve(v); },
            reject: e => { logNative(`✗ ${cmd} failed (${Date.now() - started} ms): ${e.message}`, null, 'warn'); reject(e); },
            timer,
        };
        try {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nourishNative) {
                window.webkit.messageHandlers.nourishNative.postMessage({ id, cmd, args });
            } else {
                window.NourishAndroid.call(id, cmd, JSON.stringify(args));
            }
        } catch (e) {
            clearTimeout(timer);
            delete nativePending[id];
            reject(e);
        }
    });
}

// The native side answers with this…
nativeRoot.__nourishNativeReply = (id, ok, payload) => {
    const p = nativePending[id];
    if (!p) return;
    delete nativePending[id];
    clearTimeout(p.timer);
    if (ok) p.resolve(payload);
    else p.reject(new Error((payload && payload.message) || String(payload || 'Something went wrong on the phone')));
};
// …and reports progress (downloads, generated text) with this.
nativeRoot.__nourishNativeEvent = (name, payload) => {
    (nativeListeners[name] || []).forEach(fn => { try { fn(payload); } catch (e) { /* keep going */ } });
};
function logNative(msg, details, level = 'debug') {
    if (typeof nlog === 'function') nlog('phone', msg, details, level);
}

// What a bridge call was asked to do, without the long or secret parts.
function summarizeArgs(cmd, a) {
    if (cmd === 'generate') return { model: a.model, messages: (a.messages || []).length, chars: (a.messages || []).reduce((n, m) => n + (m.content || '').length, 0), grammar: !!a.grammar, max_tokens: a.max_tokens, n_ctx: a.n_ctx, gpu: a.gpu };
    if (cmd === 'hfToken') return { action: a.action };
    return a;
}

// Native code reports its own steps (download redirects, model loading…) as "log" events.
nativeRoot.__nourishNativeLog = (msg, level) => logNative(msg, null, level || 'info');

function nativeOn(name, fn) {
    if (!nativeListeners[name]) nativeListeners[name] = [];
    nativeListeners[name].push(fn);
}

// An HTTP request made by the phone itself (no browser CORS limits). publicOnly blocks home-network
// addresses, including after redirects, so a web page can't make the phone reach your router.
async function nativeHttp(url, { method = 'GET', headers = {}, body, form, auth, publicOnly = true, timeoutMs = 20000 } = {}) {
    let payload = body;
    if (form) {
        payload = Object.keys(form).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(form[k])).join('&');
        headers = Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers);
    } else if (body != null && typeof body !== 'string') {
        payload = JSON.stringify(body);
        headers = Object.assign({ 'Content-Type': 'application/json' }, headers);
    }
    return nativeCall('http', {
        url, method, headers, body: payload == null ? null : payload, auth: auth || null, publicOnly,
        timeoutMs, maxBytes: 4 * 1024 * 1024,
    }, { timeoutMs: timeoutMs + 5000 });
}

async function nativeJSON(url, opts = {}) {
    const started = Date.now();
    let res;
    try {
        res = await nativeHttp(url, opts);
    } catch (e) {
        if (typeof nlog === 'function') nlog('web', `${opts.method || 'GET'} ${url.split('?')[0]} failed: ${e.message}`, null, 'warn');
        throw e;
    }
    if (typeof nlog === 'function') nlog('web', `${opts.method || 'GET'} ${url.length > 160 ? url.slice(0, 160) + '…' : url} → ${res.status} (${Date.now() - started} ms, ${(res.body || '').length} bytes)`, null, res.status >= 400 ? 'warn' : 'debug');
    let data = null;
    try { data = JSON.parse(res.body || 'null'); } catch (e) { /* not JSON */ }
    if (res.status >= 400) {
        const err = new Error((data && (data.error && (data.error.message || data.error) || data.message)) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

// === "SERVER" API, ANSWERED ON THE PHONE ===
const localJobs = {};
let localJobSeq = 0;

async function localApi(path, { method = 'GET', body } = {}) {
    const [route, query] = path.split('?');
    const params = {};
    (query || '').split('&').filter(Boolean).forEach(p => { const [k, v] = p.split('='); params[decodeURIComponent(k)] = decodeURIComponent(v || ''); });

    if (route === '/health') return { status: 'ok' };
    if (route === '/api/info') {
        const specs = await getSpecs().catch(() => null);
        return { version: (specs && specs.app_version) || '?', local: true, can_self_update: false, lan_urls: [] };
    }
    if (route === '/api/state') return {};
    if (route === '/api/models') {
        const files = await listDownloaded().catch(() => []);
        return { data: files.map(f => ({ id: f.file })) };
    }
    if (route === '/api/jobs' && method === 'POST') return { job_id: startLocalJob(body) };
    if (route.indexOf('/api/jobs/') === 0) {
        const job = localJobs[route.slice(10)];
        if (!job) { const err = new Error('That request is no longer running.'); err.status = 404; throw err; }
        if (method === 'DELETE') { cancelLocalJob(job); return { ok: true }; }
        return { status: job.status, result: job.result, detail: job.detail, status_code: job.code };
    }
    if (route === '/api/recipes/themealdb') return localTheMealDB(body);
    if (route === '/api/recipes/spoonacular') return localSpoonacular(body);
    if (route === '/api/recipes/web') return localWebSearch(body);
    if (route === '/api/recipes/import') return localImport(body);
    if (route === '/api/web/fetch') return localFetchPage(body);
    if (route === '/api/update/check') return localUpdateCheck(params.prereleases === 'true');
    // The recipe library folders on this phone (Files app → On My iPhone → Nourish on iPhone).
    if (route === '/api/library') return nativeCall('library', { op: 'list' }, { timeoutMs: 30000 });
    if (route === '/api/library/read') return nativeCall('library', { op: 'read', path: body.path }, { timeoutMs: 120000 });
    if (route === '/api/library/range') return nativeCall('library', { op: 'range', path: body.path, offset: body.offset, length: body.length }, { timeoutMs: 60000 });
    if (route === '/api/library/pdf') return nativeCall('library', { op: 'pdf', path: body.path, from: body.from || 0, count: body.count || 0, ocr: body.ocr !== false }, { timeoutMs: 180000 });
    if (route === '/api/library/open') return nativeCall('library', { op: 'open' });
    if (route === '/api/library/where') return nativeCall('library', { op: 'where' }, { timeoutMs: 10000 });
    if (route === '/api/library/add') return nativeCall('library', { op: 'add' }, { timeoutMs: 600000 });
    const err = new Error('That needs Nourish on your PC (Settings → Server & devices).');
    err.status = 501;
    throw err;
}

function startLocalJob(req) {
    const id = 'local-' + (++localJobSeq);
    const job = localJobs[id] = { status: 'running', provider: req.provider };
    const finish = (result, error, code) => {
        if (job.status !== 'running') return;
        if (error) { job.status = 'error'; job.detail = error; job.code = code; }
        else { job.status = 'done'; job.result = result; }
    };
    let run;
    if (req.provider === 'local') {
        job.genId = id;
        run = runOnDevice(req, id).then(text => ({ choices: [{ message: { content: text } }] }));
    } else if (req.provider === 'claude' || req.provider === 'openai') {
        run = callCloud(req);
    } else {
        run = Promise.reject(new Error(`${PROVIDERS[req.provider] || req.provider} runs on your PC. Pick "On this phone" or a cloud AI.`));
    }
    run.then(r => finish(r), e => finish(null, e.message || String(e), e.cancelled ? 499 : 500));
    return id;
}

function cancelLocalJob(job) {
    if (job.genId) nativeCall('cancelGenerate', { id: job.genId }).catch(() => {});
    job.status = 'error';
    job.detail = 'Cancelled';
    job.code = 499;
}

async function callCloud(req) {
    const temperature = Math.max(0, Math.min(Number(req.temperature) || 0.7, req.provider === 'claude' ? 1 : 2));
    if (req.provider === 'openai') {
        if (!req.api_key) throw new Error('Add your OpenAI API key in Settings → AI model.');
        return nativeJSON('https://api.openai.com/v1/chat/completions', {
            method: 'POST', timeoutMs: 600000, headers: { Authorization: `Bearer ${req.api_key}` },
            body: { model: req.model, messages: req.messages, max_tokens: req.max_tokens, temperature },
        });
    }
    if (!req.api_key) throw new Error('Add your Claude API key in Settings → AI model.');
    const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const body = { model: req.model, max_tokens: req.max_tokens, temperature, messages: req.messages.filter(m => m.role !== 'system') };
    if (system) body.system = system;
    return nativeJSON('https://api.anthropic.com/v1/messages', {
        method: 'POST', timeoutMs: 600000, headers: { 'x-api-key': req.api_key, 'anthropic-version': '2023-06-01' }, body,
    });
}

// === RUNNING A MODEL ON THE PHONE ===
// `manageAwake: false` when the caller (a whole plan) keeps the screen on itself.
async function runOnDevice(req, id, { manageAwake = true } = {}) {
    if (!req.model) throw new Error('Download a model first: Settings → AI model.');
    if (manageAwake && on('keep_awake')) nativeCall('keepAwake', { on: true }).catch(() => {});
    const started = Date.now();
    try {
        const res = await nativeCall('generate', {
            id, model: req.model, messages: req.messages, grammar: req.grammar || null,
            temperature: Number(req.temperature), max_tokens: req.max_tokens || 1024,
            n_ctx: Number(settings.local_ctx) || 4096, gpu: on('local_gpu'),
        }, { timeoutMs: 0 });
        if (res && res.suspended) {
            // iOS paused Nourish (in the background) mid-answer; the caller can try again later.
            const e = new Error('Paused because Nourish was in the background'); e.suspended = true; throw e;
        }
        if (res && res.cancelled) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
        const text = (res && res.text) || '';
        if (typeof nlog === 'function') nlog('ai', `${req.model}: ${text.length} characters in ${((Date.now() - started) / 1000).toFixed(1)} s${req.grammar ? ' (structured)' : ''}`, text.slice(0, 300), 'debug');
        return stripThinking(text);
    } finally {
        if (manageAwake && on('keep_awake')) nativeCall('keepAwake', { on: false }).catch(() => {});
    }
}

// Some models (Qwen 3.5, …) "think out loud" first; the person only needs the answer.
function stripThinking(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();
}

// Output formats that small models are forced to follow, so their answers always parse.
// Every text starts with a letter or digit, and every step ends with a full stop. Plans are made one
// meal per request, so each recipe has room for specific ingredients and full steps from prep to
// plating; the maximums are kept small enough that a meal always fits in MEAL_TOKENS
// (tests/ondevice.test.js checks this): an answer cut off half-way can't be used.
const PLAN_LIMITS = { nameChars: 60, itemChars: 48, minItems: 3, maxItems: 12, stepChars: 180, minSteps: 3, maxSteps: 8 };
// Budgeted at 1 character per token: models like Qwen write every digit as its own token, and a weak
// model can fill a step with numbers ("1200g, 1000g, …"); the answer must still fit, not be cut off.
const MEAL_TOKENS = 2500;  // one meal
const MEAL_ATTEMPTS = 3;   // the first try and up to 2 remakes
const MEAL_EXTRA_ATTEMPTS = 2;   // more tries while no try is usable at all (a small model can write only junk ingredients)
const L = PLAN_LIMITS;
// The fields in the order the AI writes them: the recipe first, then its time and nutrition, so it
// estimates those from what it actually wrote. servings is fixed to the number asked for.
function mealRule(servings) {
    const s = Math.max(1, Math.min(12, Math.round(Number(servings) || 1)));
    return String.raw`meal ::= "{" ws "\"name\":" ws name "," ws "\"servings\":" ws "${s}" "," ws "\"ingredients\":" ws "[" ws item ("," ws item){${L.minItems - 1},${L.maxItems - 1}} ws "]" "," ws "\"steps\":" ws "[" ws step ("," ws step){${L.minSteps - 1},${L.maxSteps - 1}} ws "]" "," ws "\"time_minutes\":" ws int "," ws "\"nutrition\":" ws "{" ws "\"calories\":" ws int "," ws "\"protein_g\":" ws int "," ws "\"carbs_g\":" ws int "," ws "\"fat_g\":" ws int ws "}" ws "}"`;
}
const GBNF_COMMON = String.raw`
name ::= "\"" [^"\\\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F] [^"\\\x7F\x00-\x1F]{2,${L.nameChars - 1}} "\""
item ::= "\"" [^"\\\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F] [^"\\\x7F\x00-\x1F,]{2,${L.itemChars - 1}} "\""
step ::= "\"" [^"\\\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F] [^"\\\x7F\x00-\x1F]{10,${L.stepChars - 2}} [.!] "\""
int ::= "0" | [1-9] [0-9]{0,3}
ws ::= [ \n]{0,2}`;
function mealGrammar(servings) { return 'root ::= meal\n' + mealRule(servings) + GBNF_COMMON; }
// Chat changes on the phone: one meal per answer, so it fits the phone's memory (4096 tokens) with the plan in the prompt.
const EDIT_TOKENS = MEAL_TOKENS + 100;
function editGrammar(servings) {
    return String.raw`root ::= "{" ws "\"changes\":" ws "[" ws change ws "]" ws "}"
change ::= "{" ws "\"day\":" ws [1-7] "," ws "\"meal\":" ws ("\"breakfast\"" | "\"lunch\"" | "\"dinner\"") "," ws "\"recipe\":" ws meal ws "}"
` + mealRule(servings) + GBNF_COMMON;
}
const GBNF_MEAL = mealGrammar(1);
const GBNF_EDIT = editGrammar(1);

const PLAN_MEALS = ['breakfast', 'lunch', 'dinner'];
const MEAL_SHARE = { breakfast: 0.25, lunch: 0.35, dinner: 0.4 };   // of the day's calories and protein
const Grocery = typeof NourishGrocery !== 'undefined' ? NourishGrocery : require('./grocery.js');
const Recipes = typeof NourishRecipes !== 'undefined' ? NourishRecipes : require('./recipes.js');
const Planner = typeof NourishPlanner !== 'undefined' ? NourishPlanner : (() => { try { return require('./planner.js'); } catch (e) { return null; } })();

// The ingredient lines in a day that are junk (see grocery.js), as [{ meal, item, reason }].
function junkRows(day) {
    const bad = [];
    PLAN_MEALS.forEach(t => {
        const meal = day && day[t];
        if (!meal) { bad.push({ meal: t, item: '(missing)', reason: 'no meal' }); return; }
        if (!completeMeal(meal)) bad.push({ meal: t, item: meal.name || '(no name)', reason: 'incomplete (cut off?)' });
        (Array.isArray(meal.ingredients) ? meal.ingredients : []).forEach(item => {
            const reason = Grocery.junkReason(item);
            if (reason) bad.push({ meal: t, item: String(item), reason });
        });
    });
    return bad;
}

// The same day without junk ingredient lines (and without an item listed twice in one meal).
function dropJunk(day) {
    PLAN_MEALS.forEach(t => {
        const meal = day && day[t];
        if (!meal || !Array.isArray(meal.ingredients)) return;
        const seen = new Set();
        meal.ingredients = meal.ingredients.filter(item => {
            const key = String(item).trim().toLowerCase();
            if (Grocery.junkReason(item) || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });
    return day;
}

// Problems inside one meal that the format can't stop: the same ingredient listed twice ("1/2 cup
// green curry paste" × 7 to fill the list) and a step naming one ingredient twice in a sentence
// ("Add 1/2 cup curry paste and 1/2 cup curry paste"). Returns a list of descriptions.
function mealProblems(meal) {
    const problems = [];
    const lines = (meal && Array.isArray(meal.ingredients)) ? meal.ingredients : [];
    const seen = {};
    lines.forEach(line => {
        const key = Grocery.ingredientKey(line);
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] === 2) problems.push(`"${key}" listed more than once`);
    });
    const names = lines.map(line => (Grocery.parseIngredient(line) || {}).name).filter(n => n && n.length > 2);
    ((meal && meal.steps) || []).forEach(step => String(step).toLowerCase().split(/[.!?;]+/).forEach(sentence => {
        names.forEach(name => {
            const count = sentence.split(name).length - 1;
            if (count >= 2) problems.push(`a step names "${name}" ${count} times`);
        });
    }));
    return problems.filter((p, i) => problems.indexOf(p) === i);
}

// A meal is only used when it's whole. An answer cut off at the length limit can still parse (the
// JSON repair keeps what's there) but lose its steps or ingredients.
function completeMeal(meal) {
    return !!(meal && meal.name && Array.isArray(meal.ingredients) && meal.ingredients.length >= 3
        && Array.isArray(meal.steps) && meal.steps.length >= 1 && meal.nutrition && typeof meal.nutrition === 'object');
}

// The meal's ingredients without repeats and with impossible amounts capped (see units.js).
// Returns the caps made, for the log.
const Units = typeof NourishUnits !== 'undefined' ? NourishUnits : require('./units.js');
function tidyMeal(meal) {
    const caps = [];
    if (!meal || !Array.isArray(meal.ingredients)) return caps;
    meal.ingredients = Grocery.dedupeIngredients(meal.ingredients).map(line => {
        const c = Units.clampIngredient(line);
        if (c.clamped) caps.push(`"${line}" → "${c.line}" (${c.clamped})`);
        return c.line;
    });
    return caps;
}

// Everything wrong with one AI-made meal: the recipe checks (recipes.js), repeated ingredients, a
// line or step that hit the format's length limit (so it was cut off), and a repeat of an earlier dish.
function allProblems(meal, type, earlier, limited, limits) {
    if (!usableMeal(meal)) return ['the answer was incomplete (cut off?)'];
    const out = (completeMeal(meal) ? [] : ['the answer was incomplete (cut off?)']).concat(mealProblems(meal), Recipes.recipeProblems(meal, { type }));
    // Breakfast is breakfast: the slot's rules (and the person's schedule) are checked in code too.
    const slot = Planner && Planner.slotProblem && PLAN_MEALS.indexOf(type) >= 0 ? Planner.slotProblem(meal, type, limits || slotLimitsFor(type, null)) : '';
    if (slot) out.push(slot);
    if (limited) {
        (meal.steps || []).forEach((s, i) => { if (String(s).length >= L.stepChars) out.push(`step ${i + 1} hit the length limit (cut off?)`); });
        meal.ingredients.forEach(s => { if (String(s).length >= L.itemChars) out.push(`"${s}" hit the length limit (cut off?)`); });
    }
    const repeat = (earlier || []).find(n => sameDish(n, meal.name));
    if (repeat) out.push(`same dish as "${repeat}"`);
    const avoided = avoidCheck() && avoidCheck()(meal);
    if (avoided) out.push(`has ${avoided}, which they avoid`);
    const badName = nameProblem(meal.name);
    if (badName) out.push(`the name is ${badName}`);
    return out.filter((p, i) => out.indexOf(p) === i);
}

// "Avocado & Spinach Pancakes" and "Spinach and Avocado Pancake" count as the same dish.
const NAME_FILLER = ['with', 'and', 'the', 'a', 'an', 'of', 'in', 'on', 'style', 'homemade', 'easy', 'quick', 'healthy', 'simple', 'classic'];
function dishWords(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w && NAME_FILLER.indexOf(w) === -1).map(w => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}
function sameDish(a, b) {
    const x = new Set(dishWords(a));
    const y = new Set(dishWords(b));
    if (!x.size || !y.size) return false;
    let both = 0;
    x.forEach(w => { if (y.has(w)) both++; });
    return both / (x.size + y.size - both) >= 0.6;
}

const CUISINES = ['Mediterranean', 'Mexican', 'Japanese', 'Indian', 'Thai', 'Middle Eastern', 'Italian', 'Korean', 'Greek', 'American', 'French', 'Vietnamese', 'Spanish', 'Moroccan'];

// The rules every recipe is written to, for every AI (phone, PC and cloud).
function recipeRules(servings) {
    const units = typeof unitSystem === 'function' && unitSystem() === 'metric' ? 'metric units (g, ml, °C), with tsp and tbsp for small amounts' : 'US kitchen units (cups, tbsp, tsp, oz, lb, °F)';
    return `Write ONE complete recipe that someone can cook from start to finish:\n` +
        `- servings: ${servings}. Ingredient amounts are for all ${servings} serving${servings > 1 ? 's' : ''}. nutrition (calories, protein_g, carbs_g, fat_g) is for ONE serving, and calories must equal protein_g×4 + carbs_g×4 + fat_g×9.\n` +
        `- ingredients: every item specific, with its amount: "8 oz boneless lamb shoulder", "1 medium zucchini", "1 tsp ground cumin", "1/2 tsp salt", "1 cup low-sodium chicken broth". ` +
        `Name the exact cut of meat, which vegetables, each spice, the salt, the oil and any liquid. Never "vegetables", "meat" or "spices". Each ingredient once.\n` +
        `- flavor: a savory dish has salt with an amount (not "to taste") and at least two real flavors (garlic, ginger, herbs, spices, citrus, vinegar, chili). Keep oil to what the dish needs.\n` +
        `- steps: ${L.minSteps + 1} to ${L.maxSteps} steps in order, from prep (cutting, measuring, preheating) to plating. Each step starts with a verb ("Dice…", "Heat…", "Simmer…") and is one or two full sentences with times and heat. ` +
        `Use every ingredient in the steps. The last step says how to serve it. No descriptions of the dish.\n` +
        `- time_minutes: the total time, prep included.\n- Use ${units}. Give each temperature once (e.g. "400°F"), not in two units.`;
}

// One meal, checked, made again (up to MEAL_ATTEMPTS in all) while it has problems. Each remake is
// told what was wrong. Returns { meal, problems, attempts, firstProblems }: the best attempt, and
// what's still wrong with it (empty when it passed). Returns null when cancelled.
// job: { type, system, ask, earlier (dish names it must not repeat), dish (remake this dish) }.
// run(messages, { grammar, maxTokens, id }) → the model's text, or null when cancelled.
async function makeMeal(job, run, h) {
    const hooks = Object.assign({ onAttempt() {}, isCancelled: () => false }, h || {});
    let best = null;
    let firstProblems = null;
    let feedback = '';
    let attempts = 0;
    // Up to MEAL_ATTEMPTS tries; while none of them is usable at all, up to MEAL_EXTRA_ATTEMPTS more,
    // so one meal a weak model can't write doesn't stop a whole plan.
    const limit = () => MEAL_ATTEMPTS + (best && usableMeal(best.meal) ? 0 : MEAL_EXTRA_ATTEMPTS);
    for (let attempt = 0; attempt < limit() && !hooks.isCancelled(); attempt++) {
        hooks.onAttempt(attempt);
        attempts++;
        const ask = job.ask + feedback;
        const text = await run([{ role: 'system', content: job.system }, { role: 'user', content: ask }],
            { grammar: job.grammar, maxTokens: MEAL_TOKENS, id: `${job.id || 'meal'}-${attempt}` });
        if (text == null) return null;
        let meal = null;
        try { meal = (typeof parseLLMJSON === 'function' ? parseLLMJSON : require('./json-repair.js').parseLLMJSON)(text); } catch (e) { meal = null; }
        if (meal && meal.recipe && !meal.name) meal = meal.recipe;
        let repairs = [];
        if (meal && typeof meal === 'object') {
            dropJunk({ [job.type]: meal });
            tidyMeal(meal);
            repairs = repairMeal(meal, job.type, job);
            if (repairs.length) logPlan(`${job.label || job.type}: fixed in code`, repairs);
        }
        const problems = allProblems(meal, job.type, job.earlier, !!job.grammar, job.limits);
        const hard = hardProblems(problems);
        if (firstProblems == null) firstProblems = problems;
        const score = mealScore(meal, hard) + (problems.length - hard.length) * 0.01;
        if (!best || score < best.score) best = { meal, problems: hard, soft: problems.filter(p => hard.indexOf(p) < 0), score };
        // Only real problems are worth another try; small ones are fixed above or lived with.
        if (!hard.length) break;
        logPlan(`${job.label || job.type}: try ${attempt + 1} of ${limit()} has ${hard.length} real problem(s)${attempt + 1 < limit() ? ', making it again' : ''}`, problems, 'warn');
        feedback = `\n\nYour last try "${(meal && meal.name) || '?'}" had these problems, so write it again without them: ${problems.slice(0, 6).join('; ')}.`;
    }
    // Nothing readable in any try (no name, no ingredients): the caller reports it. Anything else is
    // kept, however weak, and marked "may be incomplete", so one bad meal never stops a whole plan.
    if (!best || !usableMeal(best.meal)) return { meal: null, problems: (best && best.problems) || ['no answer'], attempts, firstProblems: firstProblems || [] };
    if (best.soft && best.soft.length) logPlan(`${job.label || job.type}: kept with small issues`, best.soft);
    if (best.problems.length) best.meal.incomplete = best.problems;
    else delete best.meal.incomplete;
    return { meal: best.meal, problems: best.problems, attempts, firstProblems: firstProblems || [] };
}

// === REPAIRED IN CODE, NOT REMADE ===
// A small phone model can't reliably write a whole recipe, so what's fixable is fixed here instead
// of asking again: a label for a name ("Lunch for Jeff - Day 7") becomes a real dish name, a
// description posing as a step goes, an ingredient no step uses is either worked in (seasoning,
// herbs, toppings) or dropped, too many steps are merged, a missing serving step is added, and the
// AI's own calories and macros are thrown away: they're worked out from the ingredients.
const Nutrition = typeof NourishNutrition !== 'undefined' ? NourishNutrition : (() => { try { return require('./nutrition.js'); } catch (e) { return null; } })();
const DISH_DAY_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend|today|tomorrow|tonight|day\s*\d+|week\s*\d+|#\s*\d+)\b/i;
const LABEL_WORDS = new Set(('breakfast brunch lunch dinner supper snack meal meals recipe dish dishes plate bowl morning evening midday noon night day daily of the for a an and my your our his her their special ' +
    'healthy simple easy quick power delight fuel energy boost start good great perfect tasty yummy light hearty classic box combo platter favorite favourite option idea balanced nutritious protein').split(/\s+/));
function personNames() {
    try { return String((typeof settings !== 'undefined' && settings.name) || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3); } catch (e) { return []; }
}
// Why a dish name isn't a dish name ('' when it's fine): the person's name, a day, or only label words.
function nameProblem(name, people) {
    const n = String(name || '').trim();
    if (n.length < 3) return 'no real name';
    const words = n.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    if ((people || personNames()).some(p => words.indexOf(p) >= 0)) return "a person's name, not a dish";
    if (DISH_DAY_WORDS.test(n)) return 'a day, not a dish';
    if (!words.length || words.every(w => LABEL_WORDS.has(w))) return 'a label, not a dish';
    return '';
}
const titleCase = t => String(t).replace(/\b[a-z]/g, c => c.toUpperCase());
// A plain dish name from what's in it: "Chicken and Broccoli Rice Bowl", "Spinach Feta Omelette".
function dishNameFor(meal, type) {
    const SKIP = /^(salt|pepper|black pepper|water|ice|oil|olive oil|vegetable oil|butter|garlic|sugar|flour|cooking spray)$|powder|spice|seasoning|sauce|oil|vinegar|juice|zest|flakes|broth|stock|extract/;
    const names = (meal.ingredients || []).map(l => (Grocery.parseIngredient(l) || {}).name || '')
        .map(n => n.replace(/\b(boneless|skinless|fresh|large|small|medium|chopped|diced|sliced|minced|ground|low-sodium|reduced-sodium|cooked|canned|dried|frozen|extra|virgin|plain|whole|baby|lean|unsalted|shredded|grated|crumbled|rolled|fat-free|nonfat|light)\b/g, '').replace(/\s+/g, ' ').trim())
        .filter(n => n && n.length > 2 && !SKIP.test(n));
    const protein = Planner && Planner.mainProtein ? Planner.mainProtein(meal) : null;
    const lead = protein && !/^(egg|yogurt|cottage cheese|protein powder|cheese)$/.test(protein) ? protein : (names[0] || type);
    const other = names.find(n => n.indexOf(lead) < 0 && lead.indexOf(n) < 0 && !/^(egg|eggs)$/.test(n));
    const text = `${meal.name || ''} ${(meal.ingredients || []).join(' ')} ${(meal.steps || []).join(' ')}`.toLowerCase();
    const form = /\bblend/.test(text) ? 'Smoothie' : /\boats?\b|oatmeal|porridge/.test(text) ? 'Oatmeal' : /\bcorn tortilla|\btaco/.test(text) ? 'Tacos'
        : /\btortilla|\bwrap\b/.test(text) ? 'Wrap' : /\beggs?\b/.test(text) && /\b(whisk|scramble|beat)/.test(text) ? (/omelet/.test(text) ? 'Omelette' : 'Scramble')
        : /\b(soup|broth|stock)\b/.test(text) && /simmer/.test(text) ? 'Soup' : /\b(pasta|spaghetti|penne|linguine|noodles?)\b/.test(text) ? (/noodle/.test(text) ? 'Noodles' : 'Pasta')
        : /\b(lettuce|greens|salad)\b/.test(text) && !/\bcook\b/.test(text) ? 'Salad' : /\bstir[- ]?fry/.test(text) ? 'Stir-Fry'
        : /\b(bread|toast)\b/.test(text) ? 'Toast' : /\byogh?urt\b/.test(text) ? 'Yogurt Bowl' : /\b(rice|quinoa|farro|couscous)\b/.test(text) ? 'Bowl'
        : type === 'dinner' ? 'Skillet' : 'Bowl';
    const parts = [titleCase(lead)];
    if (other && other.split(' ').length <= 2) parts.push('and', titleCase(other));
    return `${parts.join(' ')} ${form}`.replace(/\s+/g, ' ').trim();
}
const SERVES = /\b(serv(e|es|ed|ing)|plat(e|es|ed|ing)|garnish|divide|enjoy|dish up|bowls?|plates?|top (it |them |each )?with)\b/i;
const SEASONING_LINE = /salt|pepper|spice|herb|parsley|cilantro|basil|mint|dill|chive|lemon|lime|zest|sauce|vinegar|\boil\b|seeds?\b|\bnuts?\b|almond|walnut|pecan|cashew|peanut|cheese|parmesan|feta|yogh?urt|cream|honey|syrup|green onion|scallion|paprika|cumin|chil[il]|garlic|ginger|cinnamon|oregano|thyme|sesame|avocado/i;
function joinWords(list) { return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`; }
function repairMeal(meal, type, job) {
    const done = [];
    // Too little to repair (a cut-off answer): left as it is, so it's reported and asked for again.
    if (!usableMeal(meal) || meal.ingredients.length < 3 || !Array.isArray(meal.steps) || !meal.steps.length) return done;
    const np = nameProblem(meal.name);
    if (np) {
        const was = meal.name;
        meal.name = dishNameFor(meal, type);
        done.push(`renamed "${was}" (${np}) to "${meal.name}"`);
    }
    if (Array.isArray(meal.steps) && meal.steps.length) {
        // A description ("This tagine is…") isn't a step; a cut-off step stays so it's reported.
        const kept = meal.steps.filter(st => Recipes.isCutOff(st) || Recipes.isInstruction(st));
        if (kept.length && kept.length < meal.steps.length) { done.push(`removed ${meal.steps.length - kept.length} description step(s)`); meal.steps = kept; }
        const unused = Recipes.unusedIngredients(meal);
        if (unused.length) {
            const season = unused.filter(l => SEASONING_LINE.test(l));
            const drop = unused.filter(l => season.indexOf(l) < 0);
            if (drop.length && meal.ingredients.length - drop.length >= 3) { meal.ingredients = meal.ingredients.filter(l => drop.indexOf(l) < 0); done.push(`dropped unused ${drop.join(', ')}`); }
            if (season.length) {
                const names = season.map(l => (Grocery.parseIngredient(l) || {}).name || l);
                meal.steps.splice(Math.max(0, meal.steps.length - 1), 0, `Season with the ${joinWords(names)}; taste and adjust.`);
                done.push(`worked in ${names.join(', ')}`);
            }
        }
        // Too many steps for the slot: the shortest neighbours are joined (one too many is fine).
        const L = (job && job.limits) || (PLAN_MEALS.indexOf(type) >= 0 ? slotLimitsFor(type, null) : null);
        if (L && isFinite(L.steps) && meal.steps.length > L.steps + 1) {
            const before = meal.steps.length;
            while (meal.steps.length > Math.max(L.steps, 3)) {
                let at = 0, best = Infinity;
                for (let i = 0; i < meal.steps.length - 2; i++) { const len = meal.steps[i].length + meal.steps[i + 1].length; if (len < best) { best = len; at = i; } }
                meal.steps.splice(at, 2, `${meal.steps[at].replace(/[.!]\s*$/, '')}, then ${meal.steps[at + 1].charAt(0).toLowerCase()}${meal.steps[at + 1].slice(1)}`);
            }
            done.push(`joined ${before - meal.steps.length} step(s)`);
        }
        if (!meal.steps.some(st => SERVES.test(st))) { meal.steps.push('Divide between plates and serve.'); done.push('added how to serve it'); }
    }
    // The AI's calories and macros are never used: worked out from the ingredients instead.
    if (Nutrition && Array.isArray(meal.ingredients)) {
        delete meal.nutrition;
        Nutrition.settle(meal);
        meal.nutrition_from = 'ingredients';
    }
    if (!meal.category || !String(meal.category).trim()) meal.category = [type];
    // Bland: seasoned in code (salt with an amount, a couple of flavours that suit it).
    if (Planner && Planner.flavorCheck && PLAN_MEALS.indexOf(type) >= 0 && !Planner.flavorCheck(meal).ok) {
        const added = Planner.reseason(meal);
        if (added.length) { if (Nutrition) Nutrition.settle(meal); done.push(`seasoned with ${added.join(', ')}`); }
    }
    return done;
}
// Real problems are worth asking again for; anything else is fixed in code or lived with (one step
// or ingredient too many, a vague amount).
const HARD_PROBLEM = /incomplete|cut off|length limit|isn't a|is a dinner dish|too heavy|is a dessert|not a meal|needs cooking|takes about|same dish as|^only [0-2] ingredient|^no name|^no calories|which they avoid/i;
function hardProblems(problems) { return (problems || []).filter(p => HARD_PROBLEM.test(p)); }
// What the person avoids (allergies, diet, dislikes), when the app is running.
function avoidCheck() {
    try { return NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet }); } catch (e) { return null; }
}

// === SMALL JOBS FOR A SMALL MODEL ===
// What a 2B model does well: pick between a few real recipes, suggest one ingredient to swap in, or
// write one short sentence. Each answer is forced into a tiny format, so it's quick and always usable.
async function aiChoose(run, type, names) {
    if (!run || !names || names.length < 2) return 0;
    const list = names.slice(0, 5);
    const likes = typeof prefs !== 'undefined' && prefs.likes ? ` They like: ${prefs.likes}.` : '';
    const learned = (() => { try { return typeof NourishTaste !== 'undefined' && typeof tasteProfile === 'function' ? NourishTaste.guidance(tasteProfile()) : ''; } catch (e) { return ''; } })();
    const text = await run([{ role: 'system', content: 'You pick recipes for a meal plan. Reply with one number only.' },
        { role: 'user', content: `Which ${type} would this person enjoy most?${likes}${learned ? ' ' + learned : ''}\n${list.map((n, i) => `${i + 1}. ${n}`).join('\n')}\nReply with the number.` }],
    { grammar: `root ::= [1-${list.length}]`, maxTokens: 4, id: `choose-${type}` });
    const k = parseInt(String(text || '').trim(), 10);
    return k >= 1 && k <= list.length ? k - 1 : 0;
}
async function aiSubstitute(run, recipeName, avoid) {
    if (!run) return '';
    const text = await run([{ role: 'system', content: 'You are a chef. Reply with one ingredient name only (1 to 3 words), nothing else.' },
        { role: 'user', content: `In "${recipeName}", what single ingredient best replaces ${avoid} for someone who doesn't eat ${avoid}? Reply with the ingredient only.` }],
    { grammar: 'root ::= [a-z] [a-z ]{1,24}', maxTokens: 12, id: 'substitute' });
    const sub = String(text || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    return sub && sub.indexOf(String(avoid).toLowerCase().replace(/s$/, '')) < 0 ? sub : '';
}
// The output format for the one-line description. Written raw: "\x00-\x1F" must reach the model as
// those characters, not as real control characters. 0.1.10 had a plain string here, so the format
// held a NUL byte, the phone's AI read it cut short, and every description failed in 0.0 s.
// Up to 200 characters (0.1.11 allowed 140, and a sentence that ran longer was cut off there:
// "…topped with coarse.").
const DESCRIBE_GRAMMAR = String.raw`root ::= [A-Z] [^"\\\x00-\x1F]{20,200} [.!]`;
const DESCRIBE_MAX = 203;
// Words that name a food, a kind of dish or a way of cooking: a description may only use the ones
// the recipe itself has ("pan con tomate" is not a "savory pancake").
const DISH_KINDS = ['pancake', 'crepe', 'omelette', 'omelet', 'frittata', 'stew', 'soup', 'curry', 'salad', 'taco', 'burrito', 'pie', 'cake', 'bread', 'toast', 'sandwich', 'wrap', 'casserole',
    'risotto', 'pasta', 'noodle', 'dumpling', 'pizza', 'quiche', 'tart', 'muffin', 'smoothie', 'porridge', 'chili', 'flatbread', 'fritter', 'skewer', 'kebab', 'gratin', 'bake', 'burger', 'pudding'];
const COOKING = ['grill', 'roast', 'fry', 'fried', 'bake', 'baked', 'smok', 'brais', 'steam', 'poach', 'sear', 'simmer', 'char', 'toast', 'saut', 'caramel', 'blacken', 'broil', 'barbecue', 'bbq', 'slow-cook', 'pickl', 'cur'];
const GENERIC_FOOD = /^(herb|spice|seasoning|vegetable|veggie|green|flavor|flavour|aromatic|protein|grain|dish|meal|sauce|dressing|topping|garnish)$/;
let foodWordsCache = null;
function foodWords() {
    if (foodWordsCache) return foodWordsCache;
    const out = new Set(DISH_KINDS);
    const N = typeof NourishNutrition !== 'undefined' ? NourishNutrition : (typeof require === 'function' ? (() => { try { return require('./nutrition.js'); } catch (e) { return null; } })() : null);
    const foods = (N && N.FOODS) || {};
    // Food names only: words like "toasted", "smoked" or "ground" in the table's names are how
    // something is prepared, judged by COOKING instead.
    Object.keys(foods).forEach(k => [k].concat(foods[k].a || []).forEach(name => String(name).toLowerCase().split(/[^a-z]+/).forEach(w => { if (w.length >= 4 && !/(ed|ing)$/.test(w) && !/^(ground|fresh|whole|light|dark|plain|sweet|large|small|baby|mini|extra|instant|frozen|canned|reduced|lean|low|free|style|blend|mix|powder|white|black|green|yellow|brown)$/.test(w)) out.add(stem(w)); })));
    ['tomato', 'potato', 'chicken', 'beef', 'pork', 'lamb', 'fish', 'shrimp', 'salmon', 'tofu', 'egg', 'cheese', 'bean', 'lentil', 'rice', 'mushroom', 'pepper', 'onion', 'garlic', 'lemon', 'lime', 'avocado', 'corn', 'spinach', 'kale']
        .forEach(w => out.add(stem(w)));
    foodWordsCache = out;
    return out;
}
function stem(w) { return String(w).toLowerCase().replace(/(ies)$/, 'y').replace(/(oes|ches|shes|xes)$/, m => m.slice(0, -2)).replace(/([^s])s$/, '$1'); }
// Why a description can't be shown, or '' when it's fine: cut off, too long, or it mentions a food
// or a way of cooking the recipe doesn't have.
function descriptionProblem(text, meal) {
    const t = String(text || '').trim();
    if (t.length < 20) return 'too short';
    if (!/[.!]$/.test(t) || t.length >= DESCRIBE_MAX) return 'cut off';
    const last = (t.replace(/[.!]+$/, '').match(/([A-Za-z'-]+)$/) || [])[1] || '';
    if (/^(and|or|with|of|the|a|an|in|on|to|for|by|its|their|your|until|then|plus|topped|served|coarse|fine|fresh|some|into|over|from|at|as|is|are)$/i.test(last)) return 'cut off';
    if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) return 'cut off';
    const recipe = `${meal.name || ''} ${(meal.ingredients || []).join(' ')} ${(meal.steps || []).join(' ')}`.toLowerCase();
    const have = new Set(recipe.split(/[^a-z]+/).filter(Boolean).map(stem));
    const vocab = foodWords();
    const invented = t.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3).map(stem)
        .find(w => vocab.has(w) && !have.has(w) && !GENERIC_FOOD.test(w) && !recipe.includes(w));
    if (invented) return `mentions "${invented}", which isn't in the recipe`;
    const how = COOKING.find(c => t.toLowerCase().split(/[^a-z-]+/).some(w => w.startsWith(c)) && !recipe.includes(c));
    if (how) return `says it's "${how}…", which the recipe doesn't do`;
    return '';
}
// What the AI is given: the real ingredients (just the foods) and how it's cooked.
function recipeFacts(meal) {
    const foods = (meal.ingredients || []).map(l => String(l).replace(/\([^)]*\)/g, ' ').replace(/,.*$/, '')
        .replace(/^[\d\s/.½¼¾⅓⅔⅛-]+/, '').replace(/^(cups?|tbsp|tsp|tablespoons?|teaspoons?|g|kg|ml|l|oz|lbs?|pounds?|grams?|cans?|tins?|cloves?|pinch|handful|slices?|bunch|x)\b\.?\s*(of\s+)?/i, '').trim())
        .filter(x => x.length > 1).slice(0, 14);
    const method = (meal.steps || []).slice(0, 4).map(st => String(st).split(/[.!]\s/)[0]).join('. ').slice(0, 320);
    return { foods, method };
}
async function aiDescribe(run, meal) {
    if (!run || !meal) return '';
    const f = recipeFacts(meal);
    const text = await run([{ role: 'system', content: 'You write one short, appetizing sentence about a dish. Use only the ingredients and cooking methods given; never add others. No names of people or days.' },
        { role: 'user', content: `Dish: "${meal.name}"\nIngredients: ${f.foods.join(', ')}\nMethod: ${f.method}\nDescribe it in one complete sentence of at most 22 words.` }],
    { grammar: DESCRIBE_GRAMMAR, maxTokens: 90, id: 'describe' });
    const t = String(text || '').trim();
    const people = personNames();
    if (!t || people.some(p => t.toLowerCase().indexOf(p) >= 0) || DISH_DAY_WORDS.test(t)) return '';
    const problem = descriptionProblem(t, meal);
    if (problem) {
        if (typeof logPlan === 'function') logPlan(`The AI's description of "${meal.name}" wasn't used (${problem}): ${t}`, null, 'debug');
        return '';
    }
    return t;
}
// A description made from the recipe itself, for when no AI is set up or it fails: what the dish
// is (its main food first, by how much of the dish it is, then a few others) and how it's cooked.
// "Roasted beef marrow bones with crusty bread, parsley and shallots. About 35 minutes." Never the
// ingredient list: no amounts, no staples (water, salt, oil), nothing that's thrown away (a brine).
const DESC_STAPLE = /^(salt|pepper|black pepper|white pepper|water|ice|oil|olive oil|extra[- ]virgin olive oil|vegetable oil|canola oil|cooking oil|butter|sugar|flour|all[- ]purpose flour|plain flour|cooking spray|kosher salt|sea salt|coarse sea salt|flaky salt|salt and pepper|baking powder|baking soda|cornstarch|stock|broth|chicken stock|vegetable broth|chicken broth|vinegar)$/i;
const DESC_UNITS = /^(cups?|tbsps?|tbs|tsps?|rashers?|packs?|punnets?|sachets?|tablespoons?|teaspoons?|g|grams?|kg|ml|l|litres?|liters?|oz|ounces?|lbs?|pounds?|cans?|tins?|jars?|packets?|packages?|cloves?|pinch(es)?|handfuls?|slices?|thick slices?|bunch(es)?|heads?|sprigs?|stalks?|sticks?|racks?|pieces?|fillets?|gallons?|quarts?|pints?|dash(es)?|large|medium|small|whole|ears?|bags?|knobs?)\b\.?\s*/i;
const DESC_PROTEIN = /\b(chicken|beef|steak|pork|ribs|lamb|turkey|duck|fish|cod|salmon|tuna|trout|haddock|tilapia|halibut|mackerel|sardines?|shrimp|prawns?|scallops?|mussels|clams|crab|lobster|eggs?|tofu|tempeh|lentils|chickpeas|beans|oxtail|marrow|sausage|bacon|ham|chorizo|meatballs|mince|paneer|halloumi|cottage cheese|greek yogurt)\b/;
const DESC_DISH = /\b(pancakes|waffles|crepes|omelette|omelet|frittata|shakshuka|scramble|porridge|overnight oats|oatmeal|granola|parfait|smoothie bowl|smoothie|chili|chilli|stew|soup|curry|stir-fry|salad|grain bowls?|bowls?|tacos|burritos?|quesadillas?|enchiladas|wraps?|sandwich(es)?|burgers?|lasagna|lasagne|risotto|paella|pasta|noodles|fried rice|casserole|pie|tart|lassi|dip|hummus|coleslaw|slaw|chimichurri|sauce|cakes?|flan)\b/;
function descFood(line) {
    let t = String(line).toLowerCase().replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/\([^)]*\)?/g, ' ').replace(/[()]/g, ' ')
        // "200g/7oz pasta", "1kg/2lb 4oz": the second, imperial amount; "93% lean", "0%-fat".
        .replace(/\s*\/\s*[\d.½¼¾⅓⅔⅛]+\s*(?:fl\s*)?(?:oz|g|kg|lb|lbs|ml|l)\b(?:\s+[\d.½¼¾⅓⅔⅛]+\s*(?:oz|g))?/g, ' ').replace(/^\/\S*\s*/, '').replace(/\b\d+%[- ]?(?:lean|fat|fat-free)?\s*/g, '')
        .replace(/^~\s*/, '').replace(/\b(bone-in|skin-on|boneless|skinless|shell-on|head-on|fresh|large|small|medium),\s*/g, '$1 ')
        .replace(/,.*$/, '').replace(/\b(for|to) (serve|serving|garnish|the brine|frying|deep[- ]frying|fry)\b.*$/, '');
    // "2 to 4 slices", "1-2 tbs.", "1 slice or handful": the amount, whatever its shape.
    t = t.replace(/^[\d\s/.½¼¾⅓⅔⅛-]+(?:(?:to|or|-|–)\s*[\d/.½¼¾⅓⅔⅛]+\s*)?/, '').replace(/^x\s+/, '').replace(/^(?:slice|slices|piece|pieces)\s+or\s+\w+\s+/, '');
    for (let i = 0; i < 3; i++) t = t.replace(DESC_UNITS, '').replace(/^(of|a|an|heaping|heaped|level|rounded|generous|scant|good|large|small)\s+/, '');
    t = t.replace(/^(no-salt-added|low-sodium|reduced-fat|fat-free|light|lite)\s+/, '').replace(/\s+or\s+.*$/, '');
    t = t.replace(/^(fresh|freshly|chopped|sliced|diced|minced|grated|shredded|thinly|finely|roughly|boneless|skinless|bone-in|skin-on|shell-on|frozen|cooked|uncooked|dried|ground|large|medium|small|extra|plain|baby|ripe|good|quality|crusty)\s+/g, m => (/^(baby|ground|crusty|dried)\s/.test(m) ? m : ''))
        .replace(/\b(leaves|florets)\b/, m => (m === 'florets' ? m : '')).replace(/\s+(cloves?|pieces|kernels|pulp)$/, '').replace(/\s+/g, ' ').trim();
    return t;
}
function describeFromRecipe(meal) {
    if (!meal || !meal.name) return '';
    let lines = [];
    try { lines = Nutrition.calculate(meal.ingredients || [], meal.servings || 1, meal.steps).lines || []; } catch (e) { lines = []; }
    const kcalOf = new Map(lines.filter(l => !l.discarded).map(l => [l.line, l.kcal || 0]));
    let thrown = {};
    try { thrown = Nutrition.discarded ? Nutrition.discarded(meal.ingredients || [], meal.steps || []) : {}; } catch (e) { thrown = {}; }
    const seen = new Set();
    const foods = (meal.ingredients || []).map((l, i) => ({ l, i, name: descFood(l), kcal: kcalOf.get(l) || 0 }))
        .filter(x => x.name && x.name.length > 2 && !/\d|[~/]/.test(x.name) && !/^(or|and|to|plus)\b/.test(x.name) && !(x.i in thrown) && !DESC_STAPLE.test(x.name) && !(Nutrition.isHeader && Nutrition.isHeader(x.l)) && !/\b(to taste|optional)\b/i.test(x.l))
        .filter(x => { const k = x.name.replace(/s$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!foods.length) return '';
    // The main food: the one that's most of the dish (by calories), unless it's a fat or a sauce.
    // The main food: the protein that's most of the dish (chicken, fish, eggs, beans…), else whatever is.
    const byKcal = foods.slice().sort((a, b) => b.kcal - a.kcal);
    const main = byKcal.find(x => DESC_PROTEIN.test(x.name)) || byKcal.find(x => !/\b(oil|butter|cream|cheese|sauce|mayo|mayonnaise|dressing|sugar|honey|syrup)\b/.test(x.name)) || foods[0];
    const others = foods.filter(x => x !== main).sort((a, b) => b.kcal - a.kcal).slice(0, 3).map(x => x.name);
    const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0] || '';
    let how = '';
    let mins = 0;
    try {
        const prof = Planner && Planner.recipeProfile ? Planner.recipeProfile(meal) : null;
        const t = (prof && prof.techniques) || [];
        const fried = /deep[- ]?fr/i.test((meal.steps || []).join(' ')) || ((meal.ingredients || []).some(l => /\bfor (deep[- ]?)?frying\b|\bto fry\b/i.test(l)) && /\bfry\b|\bfried\b/i.test((meal.steps || []).join(' ')));
        how = t.includes('deep-fry') || fried ? 'Fried' : t.includes('roast') ? 'Roasted' : t.includes('bake') ? 'Baked' : t.includes('grill') ? 'Grilled' : t.includes('stir-fry') ? 'Stir-fried'
            : t.includes('braise') ? 'Braised' : t.includes('simmer') ? 'Simmered' : t.includes('fry') || t.includes('sauté') ? 'Pan-cooked' : prof && !prof.cooked ? 'No-cook' : '';
        mins = Number(meal.active_minutes) || Number(meal.time_minutes) || (prof && prof.minutes) || 0;
    } catch (e) { how = ''; }
    // When the name says what the dish is (pancakes, chili, a salad), that leads: "Pancakes made
    // with rolled oats, bananas, cottage cheese and eggs." Otherwise the main food and how it's cooked.
    // The dish is the last dish word ("chicken pasta salad" is a salad).
    const words = String(meal.name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+(with|and a side of|served with|on|over)\s+.*$/, '').match(new RegExp(DESC_DISH.source, 'g')) || [];
    const dish = words[words.length - 1];
    if (dish && !String(main.name).includes(dish)) {
        const all = [main.name].concat(others);
        const made = all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : all[0];
        const t2 = mins ? ` About ${mins >= 90 ? `${Math.round(mins / 60 * 2) / 2} hours` : `${Math.round(mins / 5) * 5 || mins} minutes`}.` : '';
        return `${dish.charAt(0).toUpperCase() + dish.slice(1)} made with ${made}.${t2}`.slice(0, 200);
    }
    const lead = how === 'No-cook' ? `No-cook ${main.name}` : how ? `${how} ${main.name}` : main.name.charAt(0).toUpperCase() + main.name.slice(1);
    const time = mins ? ` About ${mins >= 90 ? `${Math.round(mins / 60 * 2) / 2} hours` : `${Math.round(mins / 5) * 5 || mins} minutes`}.` : '';
    return `${lead}${list ? ` with ${list}` : ''}.${time}`.slice(0, 200);
}

// Which try to keep: a complete one before an incomplete one, then the one with the fewest problems.
function usableMeal(meal) {
    return !!(meal && typeof meal === 'object' && meal.name && Array.isArray(meal.ingredients) && meal.ingredients.length);
}
function mealScore(meal, problems) {
    return (usableMeal(meal) ? 0 : 2000) + (completeMeal(meal) ? 0 : 1000) + problems.length;
}

function logPlan(msg, details, level) {
    if (typeof nlog === 'function') nlog('plan', msg, details, level);
}

// The prompt for one meal of a plan, the same size every time: the profile, the end of the chat,
// the day's cuisine, this meal's share of the day's targets, and only the last few dish names
// (repeats of any earlier dish are caught in code: sameDish).
function servingsWanted() {
    return Math.max(1, Math.min(12, Math.round(Number(typeof settings !== 'undefined' && settings.servings) || 1)));
}
function mealFormat(servings) {
    return `{"name":"","servings":${servings},"ingredients":[""],"steps":[""],"time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}}`;
}
function mealSystem(servings) {
    return 'You are a chef writing recipes for a meal plan. Reply with ONLY raw JSON in this format, no markdown: ' + mealFormat(servings) + '\n' + recipeRules(servings) + (typeof profileText === 'function' ? '\n\nThe person:\n' + profileText({ forRecipe: true }) : '');
}
// The rules for a meal slot on a plan day (planner.js slotLimits with the person's schedule).
function slotLimitsFor(type, d) {
    const s = typeof settings !== 'undefined' ? settings : {};
    const weekday = d != null && typeof dayBase === 'function' ? (dayBase() + d) % 7 : null;
    return Planner && Planner.slotLimits ? Planner.slotLimits(s, type, weekday) : null;
}
// Why a meal can't go in this slot on this day ('' when it can).
function slotCheck(meal, type, d) {
    return meal && Planner && Planner.slotProblem && PLAN_MEALS.indexOf(type) >= 0 ? Planner.slotProblem(meal, type, slotLimitsFor(type, d)) : '';
}
// A simple built-in meal that fits the slot (planner.js QUICK_MEALS), for when the AI's meal doesn't.
function quickMealFor(type, d, taken) {
    if (!Planner || !Planner.quickMeal) return null;
    let exclude = null;
    try { exclude = NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet }); } catch (e) { /* tests */ }
    const r = Planner.quickMeal(type, slotLimitsFor(type, d), { exclude, taken: taken || [], d });
    return r ? JSON.parse(JSON.stringify(r)) : null;
}
// The slot's limits in words for the AI (they're also checked in code: allProblems).
function slotRulesText(type, d) {
    const L = slotLimitsFor(type, d);
    if (!L) return '';
    const what = { breakfast: 'a real breakfast food', lunch: 'a light, quick lunch that is easy to pack or eat fast (no roasts or baked pasta)', dinner: 'the main cooked meal of the day' }[type] || '';
    const time = L.noCook ? 'No cooking at all (no stove or oven): grab-and-go or no-cook food' : isFinite(L.minutes) ? `Ready in ${L.minutes} minutes or less` : '';
    return ` It must be ${what}.${time ? ` ${time}, at most ${L.ingredients} ingredients and ${L.steps} steps.` : ''}`;
}
function mealAsk({ type, d, cuisine, recent, conversation, dish, extra }) {
    const s = typeof settings !== 'undefined' ? settings : {};
    const split = Planner && Planner.splitOf(s);   // the person's calorie split (Settings), 25/30/45 by default
    const share = (split && split[PLAN_MEALS.indexOf(type)]) || MEAL_SHARE[type] || 0.33;
    const dayKcal = typeof dayKcalTarget === 'function' && d != null ? dayKcalTarget(d) : (Number(s.calorie_target) || 2000);
    const kcal = Math.round(dayKcal * share / 10) * 10;
    const protein = Math.round((typeof proteinTarget === 'function' ? proteinTarget() : Number(s.protein_target) || 100) * share);
    // No day number, day name or person's name anywhere a small model could copy into the dish's name.
    return `${conversation ? conversation + '\n\n' : ''}${dish ? `Write the full recipe for "${dish}", a ${type}` : `Make one ${type} recipe`}` +
        `${cuisine && !dish ? `. Cuisine: ${cuisine}` : ''}. Give it a real dish name that says what it is (like "Lemon Garlic Salmon with Rice"), never a label like "${type[0].toUpperCase() + type.slice(1)} of the Day". Aim for about ${kcal} kcal and ${protein} g protein per serving.${slotRulesText(type, d)}` +
        `${recent && recent.length ? ` Make it different from: ${recent.join(', ')}.` : ''}${extra ? ' ' + extra : ''}${guidanceFor({ type, d, cuisine, dish })} Return only the JSON for this one recipe.`;
}
// What the app adds to every meal request (app.js mealGuidance): time limits for the slot, what the
// person has shown they like, notes from their cookbooks. Empty when there's nothing to add.
function guidanceFor(meal) {
    try { const g = typeof mealGuidance === 'function' ? mealGuidance(meal) : ''; return g ? ' ' + g : ''; } catch (e) { return ''; }
}

// The model call for a plan on this phone: forced into the meal format.
function phoneRunner(h) {
    return (msgs, { grammar, maxTokens, id }) => runPlanStep(msgs, grammar, maxTokens, `plan-${id}`, h);
}

// A 7-day plan, one meal at a time (small phone models do far better with one recipe per request,
// and every AI gets room for a whole recipe this way). `state` is the plan so far ({ days, current,
// cuisineOffset, stats }) and is saved after every meal (hooks.save), so a plan interrupted at day 5
// lunch continues at day 5 lunch. `run` makes one model call (phoneRunner by default; app.js passes
// one for the PC and cloud AIs).
async function generatePlanOnDevice(messages, hooks, state, run) {
    const h = Object.assign({ onDay() {}, onMeal() {}, onStatus() {}, isCancelled: () => false, save() {}, totalDays: 7 }, hooks || {});
    const st = state || {};
    st.days = st.days || [];
    st.stats = st.stats || [];
    if (st.cuisineOffset == null) st.cuisineOffset = Math.floor(Math.random() * CUISINES.length);
    const onPhone = !run;
    run = run || phoneRunner(h);
    const conversation = messages.filter(m => m.role !== 'system').slice(-8).map(m => `${m.role === 'user' ? 'They said' : 'You said'}: ${m.content}`).join('\n').slice(-1200);
    const servings = servingsWanted();
    const system = mealSystem(servings);
    const grammar = onPhone ? mealGrammar(servings) : null;
    const usedNames = extra => st.days.reduce((all, day) => all.concat(PLAN_MEALS.map(t => day && day[t] && day[t].name).filter(Boolean)), []).concat(extra || []);

    for (let d = st.days.length; d < h.totalDays; d++) {
        if (h.isCancelled()) break;
        if (onPhone) await coolDownIfHot(d, h, st);
        h.onDay(d);
        const cuisine = CUISINES[(st.cuisineOffset + d) % CUISINES.length];
        if (!st.current || st.current.day !== d) st.current = { day: d, meals: {}, started: Date.now(), stat: { day: d + 1, thermal: st.lastThermal || '?', promptChars: 0, attempts: 0, firstTryProblems: 0, remade: 0, incomplete: 0, seconds: 0 } };
        const day = st.current.meals;
        const stat = st.current.stat;
        for (const type of PLAN_MEALS) {
            if (day[type]) continue;   // made before the app was closed
            if (h.isCancelled()) break;
            const todays = PLAN_MEALS.map(t => day[t] && day[t].name).filter(Boolean);
            const ask = mealAsk({ type, d, cuisine, recent: usedNames(todays).slice(-4), conversation });
            stat.promptChars = Math.max(stat.promptChars, system.length + ask.length);
            const r = await makeMeal({ type, system, ask, grammar, earlier: usedNames(todays), id: `${d}-${type}`, label: `Day ${d + 1} ${type}`, limits: slotLimitsFor(type, d) }, run,
                { onAttempt: a => h.onMeal(d, type, a), isCancelled: h.isCancelled });
            if (!r) break;   // cancelled
            if (!r.meal) throw new Error(`The AI couldn't write Day ${d + 1} ${type} (${r.problems.slice(0, 2).join('; ')}). Try again, or try another model.`);
            // Breakfast is breakfast: a meal that still breaks the slot's rules after the retries
            // never reaches the plan; a simple built-in one that fits takes its place.
            const misfit = slotCheck(r.meal, type, d);
            const quick = misfit ? quickMealFor(type, d, usedNames(todays)) : null;
            if (quick) logPlan(`Day ${d + 1} ${type}: "${r.meal.name}" ${misfit}; used "${quick.name}" instead`, null, 'warn');
            day[type] = quick || r.meal;
            stat.attempts += r.attempts;
            stat.firstTryProblems += r.firstProblems.length;
            if (r.attempts > 1) stat.remade++;
            if (r.problems.length) stat.incomplete++;
            logPlan(`Day ${d + 1} ${type}: "${r.meal.name}" after ${r.attempts} tr${r.attempts === 1 ? 'y' : 'ies'}${r.problems.length ? `, may be incomplete: ${r.problems.join('; ')}` : ', all checks passed'}`);
            h.save(st);
        }
        if (PLAN_MEALS.some(t => !day[t])) break;   // cancelled part-way through the day
        stat.seconds = Math.round((Date.now() - st.current.started) / 100) / 10;
        st.days.push(day);
        st.stats.push(stat);
        st.current = null;
        logPlan(`Day ${d + 1} done in ${stat.seconds} s: ${stat.attempts} model calls, problems on first tries ${stat.firstTryProblems}, meals remade ${stat.remade}, may be incomplete ${stat.incomplete}, thermal ${stat.thermal}`,
            PLAN_MEALS.map(t => day[t] && day[t].name));
        h.save(st);
    }
    return { days: st.days, stats: st.stats };
}

// === RECIPES FROM TEXT (imported pages, captions, pasted text, screenshots) ===
// The AI copies the recipe out of the text; it doesn't write one. On the phone the answer is forced
// into this format, sized so the source text (IMPORT_TEXT_CHARS) and the longest answer
// (IMPORT_TOKENS) fit the phone's 4096-token memory (tests/ondevice.test.js checks the answer side).
const IMPORT_LIMITS = { nameChars: 100, itemChars: 72, maxItems: 14, stepChars: 170, maxSteps: 9 };
const IMPORT_TOKENS = 3100;      // at 1 character per token, like MEAL_TOKENS
const IMPORT_TEXT_CHARS = 2400;  // ~600 tokens of English
const IMPORT_FORMAT = '{"found":true,"name":"","servings":0,"ingredients":[""],"steps":[""],"time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"nutrition_estimated":false}';
function importGrammar() {
    const I = IMPORT_LIMITS;
    return String.raw`root ::= "{" ws "\"found\":" ws ("false" ws "}" | "true" "," ws recipe)
recipe ::= "\"name\":" ws name "," ws "\"servings\":" ws int "," ws "\"ingredients\":" ws "[" ws item ("," ws item){0,${I.maxItems - 1}} ws "]" "," ws "\"steps\":" ws "[" ws step ("," ws step){0,${I.maxSteps - 1}} ws "]" "," ws "\"time_minutes\":" ws int "," ws "\"nutrition\":" ws nutrition "," ws "\"nutrition_estimated\":" ws ("true" | "false") ws "}"
nutrition ::= "{" ws "\"calories\":" ws int "," ws "\"protein_g\":" ws int "," ws "\"carbs_g\":" ws int "," ws "\"fat_g\":" ws int ws "}"
name ::= "\"" [^"\\\x7F\x00-\x1F]{3,${I.nameChars}} "\""
item ::= "\"" [^"\\\x7F\x00-\x1F]{2,${I.itemChars}} "\""
step ::= "\"" [^"\\\x7F\x00-\x1F]{5,${I.stepChars}} "\""
int ::= "0" | [1-9] [0-9]{0,3}
ws ::= [ \n]{0,2}`;
}
function nutritionGrammar() {
    return String.raw`root ::= "{" ws "\"servings\":" ws int "," ws "\"calories\":" ws int "," ws "\"protein_g\":" ws int "," ws "\"carbs_g\":" ws int "," ws "\"fat_g\":" ws int ws "}"
int ::= "0" | [1-9] [0-9]{0,3}
ws ::= [ \n]{0,2}`;
}

function parseAnswer(text) {
    try { return (typeof parseLLMJSON === 'function' ? parseLLMJSON : require('./json-repair.js').parseLLMJSON)(text); } catch (e) { return null; }
}
const toLines = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
    .map(x => (typeof x === 'string' ? x : (x && (x.text || x.name)) || '')).map(x => String(x).replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);

// The recipe in `text`, or null when the text has none. ask(messages, { grammar, maxTokens }) makes
// the model call (the app's chosen AI). image: { type, data (base64) } for a screenshot, sent to a
// cloud AI that can see images (Claude, OpenAI).
async function extractRecipe(text, { url = '', site = '', kind = 'page', image = null, provider = '' } = {}, ask, { onPhone = false } = {}) {
    const source = String(text || '').slice(0, onPhone ? IMPORT_TEXT_CHARS : 15000);
    const system = 'You copy recipes out of text into JSON. Use ONLY what the text says: copy every ingredient with its amount, and every step in order. ' +
        'You may tidy the wording, split long steps and leave out chatter, but never invent ingredients, amounts or steps. ' +
        'If there is no recipe (no ingredient list, or no way to make it), answer {"found":false}. ' +
        'servings and time_minutes: from the text, or your best estimate. nutrition is per serving: copy it if the text gives it; ' +
        'otherwise estimate it, make calories equal protein_g×4 + carbs_g×4 + fat_g×9, and set nutrition_estimated to true. ' +
        'Reply with ONLY raw JSON in this format: ' + IMPORT_FORMAT;
    const label = { page: 'Text of the web page', caption: 'Text of the post', paste: 'Text the person pasted', screenshot: 'Text read from a screenshot' }[kind] || 'Text';
    const intro = `${site || url ? `Source: ${[site, url].filter(Boolean).join(' – ')}\n\n` : ''}`;
    let content = image ? `${intro}The recipe is in this screenshot.${source ? `\n\nText read from it:\n"""\n${source}\n"""` : ''}` : `${intro}${label}:\n"""\n${source}\n"""`;
    if (image) {
        content = provider === 'claude'
            ? [{ type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } }, { type: 'text', text: content }]
            : [{ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } }, { type: 'text', text: content }];
    }
    const answer = await ask([{ role: 'system', content: system }, { role: 'user', content }], { grammar: onPhone ? importGrammar() : null, maxTokens: IMPORT_TOKENS });
    if (answer == null) return null;
    let r = parseAnswer(answer);
    if (r && r.recipe && !r.name) r = Object.assign({ found: r.found }, r.recipe);
    if (!r || r.found === false || !r.name) return null;
    const ingredients = toLines(r.ingredients);
    const steps = toLines(r.steps);
    if (!ingredients.length && !steps.length) return null;
    const n = r.nutrition && typeof r.nutrition === 'object' ? r.nutrition : null;
    const recipe = {
        name: String(r.name).trim().slice(0, 150), servings: Number(r.servings) >= 1 && Number(r.servings) <= 50 ? Math.round(Number(r.servings)) : null,
        ingredients, steps, time_minutes: Number(r.time_minutes) > 0 && Number(r.time_minutes) < 2880 ? Math.round(Number(r.time_minutes)) : null,
        nutrition: n && Number(n.calories) > 0 ? { calories: Number(n.calories), protein_g: Number(n.protein_g) || 0, carbs_g: Number(n.carbs_g) || 0, fat_g: Number(n.fat_g) || 0 } : null,
        nutrition_estimated: !!(n && r.nutrition_estimated !== false),
    };
    if (recipe.nutrition && recipe.nutrition_estimated && !Recipes.macrosMatch(recipe.nutrition)) Recipes.fixCalories(recipe);
    return recipe;
}

// Nutrition per serving for a recipe that came without it, marked as an estimate.
async function estimateNutrition(recipe, ask, { onPhone = false } = {}) {
    const answer = await ask([
        { role: 'system', content: 'You estimate nutrition. Reply with ONLY raw JSON: {"servings":0,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}. ' +
            'Values are per serving. calories must equal protein_g×4 + carbs_g×4 + fat_g×9. servings: as given, or your best estimate.' },
        { role: 'user', content: `Recipe: ${recipe.name}${recipe.servings ? `\nServings: ${recipe.servings}` : ''}\nIngredients:\n${(recipe.ingredients || []).slice(0, 30).join('\n')}` },
    ], { grammar: onPhone ? nutritionGrammar() : null, maxTokens: 200 });
    const r = answer == null ? null : parseAnswer(answer);
    if (!r || !(Number(r.calories) > 0)) return null;
    const nutrition = { calories: Number(r.calories), protein_g: Number(r.protein_g) || 0, carbs_g: Number(r.carbs_g) || 0, fat_g: Number(r.fat_g) || 0 };
    if (!Recipes.macrosMatch(nutrition)) nutrition.calories = Math.round(Recipes.macroCalories(nutrition));
    return { nutrition, servings: Number(r.servings) >= 1 && Number(r.servings) <= 50 ? Math.round(Number(r.servings)) : null };
}

// One model call for a plan. Returns the text, or null when cancelled. When iOS paused Nourish in
// the background mid-answer, waits until Nourish is on screen again and asks again.
async function runPlanStep(msgs, grammar, maxTokens, id, h) {
    for (;;) {
        const req = await buildAIRequest(msgs, { maxTokens });
        req.grammar = grammar;
        try {
            return await runOnDevice(req, id + '-' + Date.now(), { manageAwake: false });
        } catch (e) {
            if (e.cancelled) return null;
            if (!e.suspended) throw e;
            nlog('plan', 'iOS paused Nourish in the background; this step continues when Nourish is open again', null, 'warn');
            h.onStatus('Paused: open Nourish to continue');
            await untilVisible();
            if (h.isCancelled()) return null;
        }
    }
}

function untilVisible() {
    return new Promise(resolve => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') return setTimeout(resolve, 500);
        const back = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', back); setTimeout(resolve, 500); } };
        document.addEventListener('visibilitychange', back);
    });
}

// Before each day: at "serious" the phone throttles hard, so wait 20 s; at "critical", stop (the plan
// so far is kept and continues later).
async function coolDownIfHot(d, h, st) {
    const specs = await nativeCall('specs', {}, { timeoutMs: 10000 }).catch(() => null);
    const thermal = (specs && specs.thermal) || '?';
    st.lastThermal = thermal;
    nlog('plan', `Before day ${d + 1}: thermal ${thermal}`);
    if (thermal === 'critical') {
        const e = new Error(`Your phone is too hot to keep going. The plan is saved at day ${d} of ${h.totalDays}; it continues by itself once the phone cools down (keep Nourish open).`);
        e.paused = true;
        throw e;
    }
    if (thermal === 'serious') {
        h.onStatus('Cooling down… (the phone is hot)');
        nlog('plan', 'Thermal "serious": pausing 20 s so the phone can cool down', null, 'warn');
        for (let i = 0; i < 20 && !h.isCancelled(); i++) await new Promise(r => setTimeout(r, 1000));
    }
}

// === RECIPES WITHOUT THE PC ===
async function localTheMealDB(body) {
    const terms = String(body.query || 'chicken').split(',').map(t => t.trim()).filter(Boolean).slice(0, 5);
    const meals = [];
    const seen = new Set();
    for (const term of terms.length ? terms : ['chicken']) {
        const data = await nativeJSON(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(term)}`);
        ((data && data.meals) || []).forEach(m => { if (!seen.has(m.idMeal)) { seen.add(m.idMeal); meals.push(m); } });
    }
    const avoid = String(body.exclude || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    return { meals: meals.filter(m => !avoid.some(a => JSON.stringify(m).toLowerCase().indexOf(a) >= 0)).slice(0, body.number || 21) };
}

async function localSpoonacular(body) {
    const key = settings.spoonacular_api_key;
    if (!key) throw new Error('Spoonacular needs a free API key. Add it in Settings → Advanced → Recipe sources & keys.');
    const q = { query: String(body.query || 'chicken').split(',')[0].trim() || 'chicken', excludeIngredients: body.exclude || '', number: body.number || 21,
        addRecipeInformation: 'true', addRecipeNutrition: 'true', fillIngredients: 'true' };
    if (body.diet) q.diet = body.diet;
    if (body.intolerances) q.intolerances = body.intolerances;
    if (body.max_ready_time) q.maxReadyTime = body.max_ready_time;
    const qs = Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
    return nativeJSON(`https://api.spoonacular.com/recipes/complexSearch?${qs}`, { headers: { 'x-api-key': key } });
}

const SKIP_HOSTS = ['youtube.com', 'pinterest.', 'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'amazon.'];
const WEB_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Nourish meal planner; +https://github.com/nyz2x4pcqr-sudo/Nourish)', 'Accept-Language': 'en' };

async function webSearchUrls(query, count) {
    let urls = [];
    if (settings.web_engine === 'brave' && settings.brave_api_key) {
        const res = await nativeHttp(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}`,
            { headers: { 'X-Subscription-Token': settings.brave_api_key, Accept: 'application/json' } });
        if (res.status === 401 || res.status === 403 || res.status === 422) throw new Error('Brave Search rejected the API key. Check it in Settings → Advanced → Recipe sources & keys.');
        if (res.status === 429) throw new Error('Brave Search rate limit reached. Try again in a minute.');
        if (res.status >= 400) throw new Error(`Brave Search returned ${res.status}`);
        const data = JSON.parse(res.body || '{}');
        urls = ((data.web && data.web.results) || []).map(r => r.url);
    } else {
        const res = await nativeHttp('https://html.duckduckgo.com/html/', { method: 'POST', form: { q: query }, headers: Object.assign({ Referer: 'https://html.duckduckgo.com/' }, WEB_HEADERS) });
        if (res.status === 202 || res.status === 403 || res.status === 429) throw new Error('DuckDuckGo is limiting searches right now. Wait a few minutes, or add a free Brave Search key in Settings.');
        if (res.status >= 400) throw new Error(`DuckDuckGo returned ${res.status}`);
        const doc = new DOMParser().parseFromString(res.body || '', 'text/html');
        urls = Array.prototype.map.call(doc.querySelectorAll('a.result__a'), a => {
            let href = a.getAttribute('href') || '';
            const m = href.match(/[?&]uddg=([^&]+)/);
            if (m) href = decodeURIComponent(m[1]);
            return href.indexOf('//') === 0 ? 'https:' + href : href;
        });
    }
    const out = [];
    for (const u of urls) {
        let host = '';
        try { host = new URL(u).hostname.toLowerCase(); } catch (e) { continue; }
        if (!host || SKIP_HOSTS.some(s => host.indexOf(s) >= 0) || out.indexOf(u) >= 0) continue;
        out.push(u);
    }
    return out.slice(0, count);
}

// Reading recipe pages lives in importer.js (NourishImport); the web search uses the same code.
function parseRecipePage(html, url) {
    const recipe = NourishImport.structuredRecipe(new DOMParser().parseFromString(html, 'text/html'), url);
    if (!recipe) return null;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* keep empty */ }
    return Object.assign(recipe, { source_url: url, source_name: host });
}

async function fetchRecipe(url) {
    const res = await nativeHttp(url, { headers: WEB_HEADERS, timeoutMs: 15000 });
    if (res.status >= 400) throw new Error(`The page returned HTTP ${res.status}`);
    const recipe = parseRecipePage(res.body || '', res.url || url);
    if (!recipe) throw new Error('No recipe was found on that page (it needs to be a single recipe, not a list or a video).');
    return recipe;
}

async function localWebSearch(body) {
    const number = Math.max(1, Math.min(body.number || 7, 21));
    const exclude = String(body.exclude || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    const urls = await webSearchUrls(body.query, Math.max(number * 2, 10));
    if (!urls.length) throw new Error('The web search found nothing. Try different foods.');
    const results = [];
    for (let i = 0; i < urls.length; i += 4) {   // a few pages at a time, gentle on the phone
        const batch = await Promise.allSettled(urls.slice(i, i + 4).map(fetchRecipe));
        batch.forEach(r => { if (r.status === 'fulfilled') results.push(r.value); });
    }
    const names = new Set();
    const recipes = results.filter(r => {
        const text = (r.name + ' ' + r.ingredients.join(' ')).toLowerCase();
        if (names.has(r.name.toLowerCase()) || exclude.some(w => text.indexOf(w) >= 0)) return false;
        names.add(r.name.toLowerCase());
        return true;
    });
    return { recipes: recipes.slice(0, number), pages_checked: urls.length };
}

// A page for the recipe importer (importer.js), as a phone browser would get it.
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};
async function localFetchPage(body) {
    let url = String(body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const res = await nativeHttp(url, { headers: body.browser === false ? WEB_HEADERS : BROWSER_HEADERS, timeoutMs: 20000 });
    return { status: res.status, url: res.url || url, body: res.body || '' };
}

async function localImport(body) {
    let url = String(body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return fetchRecipe(url);
}

async function localUpdateCheck(prereleases) {
    const specs = await getSpecs().catch(() => null);
    const current = (specs && specs.app_version) || '0';
    const list = await nativeJSON('https://api.github.com/repos/nyz2x4pcqr-sudo/Nourish/releases?per_page=10', { headers: { Accept: 'application/vnd.github+json' } });
    return pickUpdate(list, current, prereleases);
}

// GitHub lists the newest release first. Version numbers were reset (0.7.0 was followed by 0.1.7),
// so "newer" means published later: an update is offered when this version's own release is
// further down the list. A version that was never released compares by number.
function pickUpdate(list, current, prereleases) {
    const releases = (list || []).filter(r => !r.draft && (prereleases || !r.prerelease));
    const rel = releases[0];
    if (!rel) return { current, update_available: false };
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const base = v => String(v).replace(/^v/, '').split('-')[0];
    const mine = releases.findIndex(r => base(r.tag_name) === base(current));
    const update = mine >= 0 ? mine > 0 : compareVersions(latest, current) > 0;
    return { current, latest, update_available: update, notes: rel.body || '', url: rel.html_url, can_install: false };
}

// "0.3.0-pre-alpha" < "0.3.0-beta" < "0.3.0"
function compareVersions(a, b) {
    const parse = v => {
        const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)(?:\.?(\d+))?)?/i) || [];
        const stage = { pre: 0, alpha: 1, beta: 2, rc: 3 }[(m[4] || '').toLowerCase()];
        return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0), m[4] ? (stage == null ? 0 : stage) : 9, Number(m[5] || 0)];
    };
    const x = parse(a), y = parse(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
}

// === THE PHONE ITSELF ===
let specsCache = null;
async function getSpecs(refresh = false) {
    if (!specsCache || refresh) {
        specsCache = await nativeCall('specs', {}, { timeoutMs: 10000 });
        if (typeof nlog === 'function') {
            nlog('phone', `${specsCache.device}: ${formatBytes(specsCache.ram)} RAM, app may use ${formatBytes(specsCache.usable)} → model budget ${formatBytes(memoryBudget(specsCache))}; ${formatBytes(specsCache.disk_free)} free; ${specsCache.thermal}; ${specsCache.os}`);
            if (specsCache.environment) nlog('phone', specsCache.environment);
        }
    }
    return specsCache;
}

const GB = 1024 * 1024 * 1024;
function formatBytes(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < 0) return '?';   // size not known (yet)
    if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
    if (n >= 1048576) return `${Math.round(n / 1048576)} MB`;
    return n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '0 MB';
}

// How much memory a model may use: what the system actually allows this app (this includes
// a raised limit, e.g. LiveContainer with more RAM), leaving room for the app itself.
function memoryBudget(specs) {
    const ram = specs.ram || 4 * GB;
    let budget = specs.usable && specs.usable > 0 ? specs.usable : ram * 0.5;
    if (specs.platform === 'android') budget = Math.min(budget, ram * 0.6);
    return Math.max(budget - 350 * 1048576, 256 * 1048576);
}

// Rough memory bandwidth (GB/s), which is what limits how fast a phone runs a model.
function bandwidthGBs(specs) {
    const ram = (specs.ram || 0) / GB;
    if (specs.simulator) return 20;
    if (specs.platform === 'ios') return ram >= 7.5 ? 55 : ram >= 5.5 ? 40 : 28;
    return ram >= 11 ? 50 : ram >= 7.5 ? 38 : ram >= 5.5 ? 26 : 15;
}

// Memory needed while running: the file, the conversation memory for ~4k words, and working space.
function memoryNeeded(size, params) {
    const p = params || Math.max(0.5, size / (0.6 * GB));
    return size + p * 0.12 * GB + 300 * 1048576;
}

// Rates one model for this phone. Returns { fit: 'good' | 'tight' | 'too-big', tokPerSec, warm, ... }.
function assessModel(model, specs) {
    const budget = memoryBudget(specs);
    const need = memoryNeeded(model.size, model.params);
    const fit = need <= budget * 0.75 ? 'good' : need <= budget ? 'tight' : 'too-big';
    const tokPerSec = Math.max(1, bandwidthGBs(specs) * 0.55 / (model.size / GB));
    const warm = fit === 'tight' || model.size > 3.2 * GB || specs.thermal === 'serious' || specs.thermal === 'critical';
    const noDisk = specs.disk_free != null && model.size * 1.05 > specs.disk_free && !isDownloaded(model.file);
    // A 7-day plan is about 7 × 800 words of output, plus reading each request.
    const planMinutes = Math.max(1, Math.round((5600 / tokPerSec + 7 * 600 / (tokPerSec * 6)) / 60));
    // Comfort matters: a model that barely fits or runs hot is ranked well below one that fits easily.
    const score = (model.quality || 4) - (fit === 'tight' ? 3 : 0) - (warm ? 1.5 : 0) + Math.min(tokPerSec, 30) / 15;
    return { fit, need, budget, tokPerSec, warm, noDisk, planMinutes, score };
}

// The personal top-5 list: the best models that fit this phone, with tags.
function rankModels(specs, models) {
    models = models || [];
    const rated = models.map(m => Object.assign({}, m, { a: assessModel(m, specs) }));
    const fits = rated.filter(m => m.a.fit !== 'too-big').sort((x, y) => y.a.score - x.a.score);
    const top = fits.slice(0, 5);
    const tooBig = rated.filter(m => m.a.fit === 'too-big').sort((x, y) => x.size - y.size);
    if (top.length) {
        const best = top.reduce((b, m) => (m.quality > b.quality ? m : b), top[0]);
        const fastest = top.reduce((b, m) => (m.a.tokPerSec > b.a.tokPerSec ? m : b), top[0]);
        top.forEach(m => {
            m.tags = [];
            if (m === top[0]) m.tags.push(['Recommended', 'accent']);
            if (m === best && m !== top[0] && m.quality > top[0].quality + 0.5) m.tags.push(['Best quality', 'accent']);
            if (m === fastest && m.a.tokPerSec > top[0].a.tokPerSec * 1.3) m.tags.push(['Fastest', '']);
            if (m.a.fit === 'tight') m.tags.push(['Uses most memory', 'warn']);
            if (m.a.warm) m.tags.push(['May get warm', 'warn']);
            else if (m.size < 1.3 * GB) m.tags.push(['Runs cool', '']);
        });
    }
    return { top, more: fits.slice(5), tooBig };
}

// === LIVE: ASK HUGGING FACE WHICH MODELS ARE BEST FOR THIS PHONE ===
// 1. Ask Hugging Face for popular and trending chat models in the GGUF format phones can run.
// 2. Drop ones that aren't for chatting (code, embeddings…), copies of the same model, and any that are
//    clearly too big for the memory this phone allows.
// 3. Look up the real file sizes of the best candidates and pick the largest-quality version that fits.
// 4. Score by capability (size), how new and how popular it is, speed on this phone and heat.
const HF_API = 'https://huggingface.co/api/models';
const HF_PUBLISHERS = ['unsloth', 'bartowski', 'lmstudio-community', 'ggml-org', 'Qwen'];
const HF_SKIP = /omni|agent|computer-?use|\bgui\b|ui-mate|ui-tars|fara\d|tool-?call|function-?call|coder|code-|embed|rerank|guard|abliterat|uncensor|nsfw|roleplay|\brp\b|[-_]base\b|base-gguf|\bmtp\b|draft|math|ocr|tts|audio|speech|whisper|[-_]vl\b|[-_]vl[-_]|vision|reward|heretic|merge|test|tiny-random|\d{2,}b-a\d/i;
const QUANT_ORDER = ['Q4_K_M', 'Q4_K_S', 'IQ4_XS', 'IQ4_NL', 'Q4_0', 'Q3_K_L', 'Q3_K_M', 'IQ3_M', 'Q3_K_S'];
const KNOWN_GOOD = /qwen-?3|qwen2\.5|gemma-?[34]|llama-?3\.[123]|phi-?4|smollm|granite-?4|lfm2|mistral|ministral/i;
// Measured with Nourish's own plan code (mobile/ci/ios-bench.sh, same prompt, 3 days each, iOS
// simulator, 2026-10-01): Qwen3.5-2B 1445 s vs LFM2.5-2.6B 1704 s, 0% junk lines for both, and
// Qwen's file is 0.4 GB smaller. Models that did better in that test get a small lift.
const PLAN_TESTED = [[/qwen3\.5-2b\b/i, 1.2]];
function planTestedBonus(id) {
    const hit = PLAN_TESTED.find(([re]) => re.test(id));
    return hit ? hit[1] : 0;
}
// Reasoning-style models "think" at length before answering: slow and hot on a phone.
const THINKERS = /distill|reason|thinking|\br1\b|mimo/i;
const LIVE_CACHE_KEY = 'nourish_hf_top_v3';   // bumped when the ranking rules change, so old lists aren't reused
const LIVE_CACHE_MS = 12 * 60 * 60 * 1000;

function paramsFromName(name) {
    const m = String(name).match(/(?:^|[-_ ])e?(\d+(?:\.\d+)?)\s*([bm])(?![a-z])/i);
    if (!m) return null;
    return m[2].toLowerCase() === 'm' ? Number(m[1]) / 1000 : Number(m[1]);
}

// Rough "how capable" from size: 0.5B ≈ 1, 1B ≈ 3, 2B ≈ 5, 4B ≈ 7.4, 8B ≈ 9.6 (capped).
function capability(params) {
    return Math.max(1, Math.min(9.5, 3 + 2.2 * Math.log2(Math.max(params, 0.3))));
}

function recencyBonus(date) {
    const t = Date.parse(date || '');
    if (!t) return 0;
    const months = (Date.now() - t) / (30 * 864e5);
    return months < 6 ? 1.5 : months < 12 ? 1 : months < 24 ? 0.4 : 0;
}

function baseKey(r) {
    const tag = (r.tags || []).filter(t => /^base_model:/.test(t)).map(t => t.replace(/^base_model:(quantized:|finetune:)?/, ''))[0];
    const name = (tag || r.id).split('/').pop().toLowerCase();
    return name.replace(/[-_.]?gguf$/, '').replace(/[-_.](qat|q\d|i?mat).*$/, '');
}

// "bartowski/google_gemma-3-4b-it-GGUF" -> "gemma-3-4b-it"
function prettyModelName(id) {
    const name = id.split('/').pop().replace(/[-_.]?GGUF$/i, '');
    // Re-uploaders like bartowski put the original publisher in front: "google_gemma-…".
    const cut = name.indexOf('_');
    return cut > 0 && /^(bartowski|lmstudio-community|mradermacher)\//i.test(id) ? name.slice(cut + 1) : name;
}

function pickQuant(files, params, specs) {
    const ggufs = (files || [])
        .filter(f => f && f.type !== 'directory' && /\.gguf$/i.test(f.path) && !/mmproj|-\d{5}-of-\d{5}|\//i.test(f.path))
        .map(f => ({ file: f.path, size: (f.lfs && f.lfs.size) || f.size }));
    for (const want of ['good', 'tight']) {
        for (const q of QUANT_ORDER) {
            const re = new RegExp('(^|[-_.])' + q + '([-_.]|$)', 'i');
            const f = ggufs.find(g => re.test(g.file.replace(/\.gguf$/i, '')));
            if (f && f.size && assessModel({ size: f.size, params }, specs).fit === want) return Object.assign(f, { quant: q });
        }
    }
    return null;
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]).catch(() => null); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

function compactCount(n) {
    n = Number(n) || 0;
    return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
}

function mlog(msg, details, level) {
    if (typeof nlog === 'function') nlog('models', msg, details, level || 'info');
}

async function discoverModels(specs, { fetchJSON = url => nativeJSON(url, { auth: 'hf' }), force = false } = {}) {
    const budget = memoryBudget(specs);
    const bucket = Math.round(budget / GB * 2) / 2;
    mlog(`Building the model list for ${specs.device || 'this phone'}: budget ${formatBytes(budget)}${force ? ' (refresh)' : ''}`);
    try { localStorage.removeItem('nourish_hf_top'); localStorage.removeItem('nourish_hf_top_v2'); } catch (e) { /* older lists (older ranking rules) */ }
    if (!force) {
        try {
            const cached = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || 'null');
            if (cached && cached.bucket === bucket && Date.now() - cached.at < LIVE_CACHE_MS && cached.models.length) {
                mlog(`Using the list from ${Math.round((Date.now() - cached.at) / 60000)} min ago (${cached.models.length} models). Tap Refresh to ask Hugging Face again.`);
                return cached;
            }
        } catch (e) { /* no cache */ }
    }
    const q = 'filter=gguf&filter=conversational&direction=-1&full=false';
    const lists = await Promise.all([
        fetchJSON(`${HF_API}?${q}&sort=downloads&limit=100`),
        fetchJSON(`${HF_API}?${q}&sort=trendingScore&limit=60`).catch(() => []),
    ].concat(HF_PUBLISHERS.map(a => fetchJSON(`${HF_API}?${q}&author=${a}&sort=downloads&limit=40`).catch(() => []))));
    // Biggest model worth looking at: about what fits in this phone's memory at 4-bit.
    const maxParams = budget / (0.62 * GB);
    const seen = {};
    const skipped = { unsuitable: 0, littleKnown: 0, tooBig: 0, gatedOrPrivate: 0 };
    let total = 0;
    lists.forEach(list => (Array.isArray(list) ? list : []).forEach(r => {
        total++;
        // Skip private, gated, unsuitable and little-known uploads (fewer than 2,000 downloads).
        if (!r || !r.id) return;
        if (r.private || r.gated) { skipped.gatedOrPrivate++; return; }
        if (HF_SKIP.test(r.id)) { skipped.unsuitable++; return; }
        if ((r.downloads || 0) < 2000) { skipped.littleKnown++; return; }
        const params = paramsFromName(r.id);
        if (params && params > maxParams * 1.15) { skipped.tooBig++; return; }
        const key = baseKey(r);
        const entry = { id: r.id, params, downloads: r.downloads || 0, likes: r.likes || 0, created: r.lastModified || r.createdAt, key };
        if (!seen[key] || entry.downloads > seen[key].downloads) seen[key] = entry;
    }));
    const scored = Object.keys(seen).map(k => seen[k]).map(r => Object.assign(r, {
        pre: recencyBonus(r.created) + Math.log10(r.downloads + 10) / 2 + (KNOWN_GOOD.test(r.id) ? 1.5 : 0) - (THINKERS.test(r.id) ? 1 : 0),
    })).sort((a, b) => b.pre - a.pre);
    // Look at every size band, not just the biggest models: small phones need small models, and
    // a model that only barely fits is rarely the best choice.
    const bands = [0.3, 0.55, 0.8, 1.15].map(() => []);
    scored.forEach(r => {
        const est = (r.params || 3) * 0.62 * GB / budget;
        const band = est <= 0.3 ? 0 : est <= 0.55 ? 1 : est <= 0.8 ? 2 : 3;
        if (bands[band].length < [5, 5, 4, 3][band]) bands[band].push(r);
    });
    const pre = bands.reduce((a, b) => a.concat(b), []);
    mlog(`Hugging Face returned ${total} results (${lists.map(l => (Array.isArray(l) ? l.length : 'error')).join(' + ')}); ${Object.keys(seen).length} different models kept`,
        { skipped, biggestWorthChecking: `${maxParams.toFixed(1)}B parameters` });
    mlog(`Checking file sizes for ${pre.length} candidates`, bands.map((b, i) => `${['small', 'medium', 'large', 'very large'][i]}: ${b.map(r => r.id).join(', ') || '—'}`).join('\n'), 'debug');
    if (!pre.length) throw new Error('Hugging Face returned no suitable models.');

    const picked = await mapLimit(pre, 4, async r => {
        let tree;
        try {
            tree = await fetchJSON(`${HF_API}/${r.id}/tree/main`);
        } catch (e) {
            mlog(`${r.id}: couldn't list files (${e.message})`, null, 'warn');
            return null;
        }
        const f = pickQuant(tree, r.params, specs);
        if (!f) { mlog(`${r.id}: no version fits this phone`, null, 'debug'); return null; }
        mlog(`${r.id}: ${f.file} (${formatBytes(f.size)}, ${f.quant})`, null, 'debug');
        const params = r.params || Math.max(0.3, f.size / (0.6 * GB));
        return {
            id: 'hf:' + r.id + '/' + f.file, name: prettyModelName(r.id), repo: r.id, file: f.file, size: f.size, params,
            // Squeezed versions (3-bit) lose quality; proven chat families and newer models gain.
            quality: Math.min(10, capability(params) + recencyBonus(r.created) + (KNOWN_GOOD.test(r.id) ? 1 : -0.5)
                - (THINKERS.test(r.id) ? 1 : 0) - (params < 0.5 ? 2 : 0) - ({ Q4_K_S: 0.2, IQ4_XS: 0.3, IQ4_NL: 0.3, Q4_0: 0.4, Q3_K_L: 1, Q3_K_M: 1.2, IQ3_M: 1.3, Q3_K_S: 1.5 }[f.quant] || 0)
                + Math.log10(r.downloads + 10) / 6 + planTestedBonus(r.id)),
            blurb: `${compactCount(r.downloads)} downloads${r.created ? ' · ' + new Date(r.created).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''} · ${f.quant}`,
            live: true,
        };
    });
    const models = picked.filter(Boolean);
    if (!models.length) throw new Error('None of the models found on Hugging Face fit this phone.');
    const top = rankModels(specs, models).top;
    mlog(`Top ${top.length} for this phone: ${top.map((m, i) => `${i + 1}. ${m.name} (${formatBytes(m.size)}, ${m.a.fit}${m.tags.length ? ', ' + m.tags.map(t => t[0]).join('/') : ''})`).join('; ')}`);
    const result = { at: Date.now(), bucket, models };
    try { localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(result)); } catch (e) { /* not cached */ }
    return result;
}

// === DOWNLOADS ===
let downloadedFiles = [];
const downloads = {};    // file -> { received, total, state, error }

async function listDownloaded() {
    const res = await nativeCall('models', {});
    downloadedFiles = (res && res.files) || [];
    return downloadedFiles;
}
function isDownloaded(file) {
    return downloadedFiles.some(f => f.file === file);
}

nativeOn('download', ev => {
    if (!ev || !ev.file) return;
    const prev = downloads[ev.file];
    const pctNow = ev.total ? Math.floor(ev.received / ev.total * 10) : 0;
    if (!prev || prev.state !== ev.state || ev.state !== 'running') {
        nlog('download', `${ev.file}: ${ev.state}${ev.error ? ' — ' + ev.error : ''} (${formatBytes(ev.received)} of ${formatBytes(ev.total)})`, null, ev.state === 'error' ? 'error' : 'info');
    } else if (prev.total && Math.floor(prev.received / prev.total * 10) !== pctNow) {
        nlog('download', `${ev.file}: ${pctNow * 10}% (${formatBytes(ev.received)})`, null, 'debug');
    }
    downloads[ev.file] = ev;
    const bar = document.getElementById('dl-' + cssId(ev.file));
    if (bar && ev.state === 'running') {
        const pct = ev.total ? Math.round(ev.received / ev.total * 100) : 0;
        bar.querySelector('.progress-fill').style.width = pct + '%';
        bar.querySelector('.progress-label').textContent = ev.received > 0
            ? `Downloading… ${pct}% · ${formatBytes(ev.received)} of ${formatBytes(ev.total)}`
            : `Starting… waiting for the download server (stops after 30 s if nothing arrives)`;
        return;
    }
    if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') {
        if (ev.state === 'error') showToast(`Download failed: ${ev.error || 'unknown error'}`);
        if (ev.state === 'done') {
            showToast('Model downloaded ✓', false);
            if (!settings.local_model) setSetting('local_model', ev.file, { quiet: true });
        }
        listDownloaded().then(() => { if (settingsPage === 'ai') renderSettings(); });
    }
});

function cssId(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function startDownload(model) {
    const specs = await getSpecs(true);
    if (specs.disk_free != null && model.size * 1.05 > specs.disk_free) {
        showToast(`Not enough free storage: needs ${formatBytes(model.size)}, ${formatBytes(specs.disk_free)} free.`);
        return;
    }
    if (model.size > 1.5 * GB && !confirm(`Download ${model.name} (${formatBytes(model.size)})? Use Wi-Fi: it's a big file.`)) return;
    nlog('download', `Starting ${model.repo}/${model.file} (${formatBytes(model.size)}); ${formatBytes(specs.disk_free)} free`);
    downloads[model.file] = { file: model.file, received: 0, total: model.size, state: 'running' };
    renderSettings();
    try {
        await nativeCall('download', {
            url: `https://huggingface.co/${model.repo}/resolve/main/${encodeURIComponent(model.file)}`,
            file: model.file, size: model.size, auth: 'hf',
        });
    } catch (e) {
        downloads[model.file] = { state: 'error', error: e.message };
        showToast(e.message);
        renderSettings();
    }
}

async function deleteModel(file) {
    if (!confirm(`Delete ${file} from this phone?`)) return;
    await nativeCall('deleteModel', { file });
    if (settings.local_model === file) setSetting('local_model', '', { quiet: true });
    await listDownloaded();
    renderSettings();
    showToast('Model deleted', false);
}

// === HUGGING FACE ACCOUNT AND SEARCH ===
let hfUser = null;       // { name } when signed in
let hfSearch = { query: '', results: null, error: '', busy: false, repo: null, files: null };

async function refreshHfUser() {
    try {
        const status = await nativeCall('hfToken', { action: 'status' });
        if (!status || !status.set) { hfUser = null; return; }
        const me = await nativeJSON('https://huggingface.co/api/whoami-v2', { auth: 'hf' });
        hfUser = { name: (me && (me.name || me.fullname)) || 'signed in' };
    } catch (e) {
        hfUser = { name: '', error: e.status === 401 ? 'The saved token was rejected. Sign in again.' : e.message };
    }
}

async function hfSignIn(token) {
    token = String(token || '').trim();
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(token)) { showToast('That doesn\'t look like a Hugging Face token (it starts with "hf_").'); return; }
    await nativeCall('hfToken', { action: 'set', token });
    await refreshHfUser();
    if (hfUser && hfUser.error) {
        await nativeCall('hfToken', { action: 'clear' });
        showToast(hfUser.error);
        hfUser = null;
    } else {
        showToast(`Signed in to Hugging Face as ${hfUser.name}`, false);
    }
    renderSettings();
}

async function hfSignOut() {
    await nativeCall('hfToken', { action: 'clear' });
    hfUser = null;
    renderSettings();
}

async function runHfSearch(query) {
    hfSearch = { query, results: null, error: '', busy: true, repo: null, files: null };
    renderSettings();
    try {
        const list = await nativeJSON(`https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=20`, { auth: 'hf' });
        hfSearch.results = (list || []).map(r => ({ id: r.id || r.modelId, downloads: r.downloads, likes: r.likes, gated: r.gated }));
    } catch (e) {
        hfSearch.error = e.message;
    }
    hfSearch.busy = false;
    renderSettings();
}

async function openHfRepo(id) {
    hfSearch.repo = { id };
    hfSearch.files = null;
    hfSearch.busy = true;
    renderSettings();
    try {
        const [info, tree] = await Promise.all([
            nativeJSON(`https://huggingface.co/api/models/${id}`, { auth: 'hf' }).catch(() => ({})),
            nativeJSON(`https://huggingface.co/api/models/${id}/tree/main`, { auth: 'hf' }),
        ]);
        hfSearch.repo.gated = info && info.gated;
        hfSearch.files = (tree || [])
            .filter(f => f.type === 'file' && /\.gguf$/i.test(f.path) && !/mmproj|-\d{5}-of-\d{5}/i.test(f.path) && f.path.indexOf('/') < 0)
            .map(f => ({ file: f.path, size: (f.lfs && f.lfs.size) || f.size }))
            .sort((a, b) => a.size - b.size);
    } catch (e) {
        hfSearch.error = e.message;
    }
    hfSearch.busy = false;
    renderSettings();
}

function guessParams(name, size) {
    const m = String(name).match(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/);
    return m ? Number(m[1]) : size / (0.6 * GB);
}

// === SETTINGS: THE "ON THIS PHONE" SECTION ===
function fitChip(a) {
    if (a.fit === 'too-big') return h('span', { class: 'chip warn', text: 'Too big for this phone' });
    if (a.noDisk) return h('span', { class: 'chip warn', text: 'Not enough storage' });
    return null;
}

function modelCard(m, specs) {
    const a = m.a || assessModel(m, specs);
    const have = isDownloaded(m.file);
    const active = settings.local_model === m.file;
    const dl = downloads[m.file];
    const busy = dl && dl.state === 'running';
    const pct = busy && dl.total ? Math.round(dl.received / dl.total * 100) : 0;
    return h('div', { class: 'model-card' + (active ? ' active' : '') },
        h('div', { class: 'model-head' },
            h('div', { class: 'model-title' },
                h('div', { class: 'settings-label', text: m.name }),
                h('div', { class: 'settings-hint', text: `${formatBytes(m.size)} · ≈${Math.round(a.tokPerSec)} words/s · 7-day plan ≈ ${a.planMinutes} min` })),
            active ? h('span', { class: 'chip accent' }, icon('i-check'), 'In use') : null),
        m.blurb ? h('p', { class: 'model-blurb', text: m.blurb }) : null,
        h('div', { class: 'model-tags' },
            (m.tags || []).map(([t, kind]) => h('span', { class: 'chip ' + kind, text: t })),
            have ? h('span', { class: 'chip', text: 'Downloaded' }) : null,
            fitChip(a)),
        busy ? h('div', { class: 'model-progress', id: 'dl-' + cssId(m.file) },
            h('div', { class: 'progress-label', text: `Downloading… ${pct}%` }),
            h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill', style: `width:${pct}%` })),
            h('button', { type: 'button', class: 'link-btn', onclick: () => nativeCall('cancelDownload', { file: m.file }).catch(() => {}) }, 'Cancel')) : null,
        busy ? null : h('div', { class: 'model-actions' },
            have
                ? [active ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { setSetting('local_model', m.file); renderSettings(); } }, 'Use this model'),
                    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => deleteModel(m.file) }, icon('i-trash'), 'Delete')]
                : h('button', {
                    type: 'button', class: 'btn ' + (a.fit === 'too-big' || a.noDisk ? 'btn-secondary' : 'btn-primary'),
                    onclick: () => {
                        if (a.fit === 'too-big' && !confirm('This model probably needs more memory than this phone allows, so it may crash or be very slow. Download anyway?')) return;
                        startDownload(m);
                    },
                }, icon('i-update'), `Download · ${formatBytes(m.size)}`)));
}

function deviceSummary(specs) {
    const budget = memoryBudget(specs);
    const thermal = { nominal: 'Cool', fair: 'Warm', serious: 'Hot — let it cool down', critical: 'Too hot' }[specs.thermal] || '—';
    return [
        ...settingsGroup('This phone', [
            infoRow('Device', specs.device || specs.model_id || '—'),
            infoRow('Memory', `${formatBytes(specs.ram)} (AI can use ≈ ${formatBytes(budget)})`),
            infoRow('Free storage', formatBytes(specs.disk_free)),
            infoRow('Temperature', thermal),
        ], specs.usable && specs.ram && specs.usable > specs.ram * 0.6
            ? 'This app is allowed more memory than usual (for example through LiveContainer), so bigger models are listed.'
            : 'The list below is ranked for this phone. A different phone gets a different list.'),
    ];
}

let ondeviceState = { specs: null, error: '', loading: false, showTooBig: false, live: null, liveError: '', liveBusy: false };

function loadLiveModels(force) {
    if (!ondeviceState.specs || ondeviceState.liveBusy) return;
    ondeviceState.liveBusy = true;
    ondeviceState.liveError = '';
    if (settingsPage === 'ai') renderSettings();
    discoverModels(ondeviceState.specs, { force })
        .then(r => { ondeviceState.live = r; })
        .catch(e => { ondeviceState.liveError = e.message; if (typeof nlog === 'function') nlog('models', `Couldn't build the list: ${e.message}`, e.stack, 'error'); })
        .then(() => { ondeviceState.liveBusy = false; if (settingsPage === 'ai') renderSettings(); });
}

function renderOnDeviceSection() {
    const box = h('div', { id: 'onDeviceSection' });
    if (!nativeAvailable()) {
        setChildren(box, settingsGroup('On this phone', [infoRow('Not available', 'needs the phone app')]));
        return box;
    }
    if (!ondeviceState.specs && !ondeviceState.loading) {
        ondeviceState.loading = true;
        Promise.all([getSpecs(true), listDownloaded(), refreshHfUser()])
            .then(([specs]) => { ondeviceState.specs = specs; })
            .catch(e => { ondeviceState.error = e.message; })
            .then(() => { ondeviceState.loading = false; if (settingsPage === 'ai') renderSettings(); loadLiveModels(false); });
    }
    const specs = ondeviceState.specs;
    if (!specs) {
        setChildren(box, h('p', { class: 'settings-note', text: ondeviceState.error || 'Checking this phone…' }));
        return box;
    }
    // The list is always built live from Hugging Face for this phone; there is no built-in list.
    const live = ondeviceState.live && ondeviceState.live.models.length ? ondeviceState.live : null;
    const ranked = rankModels(specs, live ? live.models : []);
    const sourceNote = ondeviceState.liveBusy
        ? 'Asking Hugging Face for the best models for this phone…'
        : live
            ? `Live from Hugging Face · ${new Date(live.at).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`
            : `Couldn't reach Hugging Face${ondeviceState.liveError ? ' (' + ondeviceState.liveError + ')' : ''}. Check the internet connection and tap Retry.`;
    const hfInput = h('input', { type: 'password', class: 'settings-input', placeholder: 'hf_…', autocomplete: 'off', 'aria-label': 'Hugging Face token' });
    const searchInput = h('input', { type: 'search', class: 'settings-input', placeholder: 'e.g. qwen, llama, gemma', value: hfSearch.query, 'aria-label': 'Search Hugging Face',
        onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) runHfSearch(e.target.value.trim()); } });

    const searchBody = [];
    if (hfSearch.busy) searchBody.push(h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'Searching…' })));
    if (hfSearch.error) searchBody.push(h('div', { class: 'settings-row settings-result error', text: hfSearch.error }));
    if (hfSearch.repo && hfSearch.files) {
        searchBody.push(h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => { hfSearch.repo = null; hfSearch.files = null; renderSettings(); } },
            icon('i-back'), h('span', { class: 'settings-label', text: hfSearch.repo.id })));
        if (hfSearch.repo.gated && !hfUser) searchBody.push(h('div', { class: 'settings-row settings-result error', text: 'This model needs a Hugging Face account: sign in below and accept its licence on huggingface.co first.' }));
        if (!hfSearch.files.length) searchBody.push(h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'No single-file GGUF models in this repository.' })));
        hfSearch.files.forEach(f => {
            const m = { name: f.file.replace(/\.gguf$/i, ''), repo: hfSearch.repo.id, file: f.file, size: f.size, params: guessParams(hfSearch.repo.id + ' ' + f.file, f.size), quality: 5 };
            m.a = assessModel(m, specs);
            m.tags = m.a.fit === 'tight' ? [['Uses most memory', 'warn']] : [];
            if (m.a.warm && m.a.fit !== 'too-big') m.tags.push(['May get warm', 'warn']);
            searchBody.push(h('div', { class: 'settings-row settings-row-stack' }, modelCard(m, specs)));
        });
    } else if (hfSearch.results) {
        if (!hfSearch.results.length) searchBody.push(h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'Nothing found.' })));
        hfSearch.results.forEach(r => searchBody.push(h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => openHfRepo(r.id) },
            h('span', { class: 'settings-label' }, r.id, h('span', { class: 'settings-hint', text: `${(r.downloads || 0).toLocaleString()} downloads${r.gated ? ' · needs sign-in' : ''}` })),
            icon('i-chevron', 'chev'))));
    }

    setChildren(box,
        deviceSummary(specs),
        h('div', { class: 'settings-group-label', text: 'Your top 5 for this phone' }),
        h('div', { class: 'live-note' },
            ondeviceState.liveBusy ? h('span', { class: 'job-bar-spinner', 'aria-hidden': 'true' }) : icon(live ? 'i-globe' : 'i-book'),
            h('span', { text: sourceNote }),
            ondeviceState.liveBusy ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => loadLiveModels(true) }, live ? 'Refresh' : 'Retry')),
        ranked.top.length
            ? h('div', { class: 'model-list' }, ranked.top.map(m => modelCard(m, specs)))
            : h('p', { class: 'settings-note', text: ondeviceState.liveBusy ? 'Building your list…' : live ? 'None of the models found fit in the memory this phone allows. Try searching for a smaller one below, or use a cloud AI.' : 'No list yet.' }),
        ranked.more.length || ranked.tooBig.length ? h('button', { type: 'button', class: 'link-btn', onclick: () => { ondeviceState.showTooBig = !ondeviceState.showTooBig; renderSettings(); } },
            ondeviceState.showTooBig ? 'Hide other models' : `Show ${ranked.more.length + ranked.tooBig.length} other models`) : null,
        ondeviceState.showTooBig ? h('div', { class: 'model-list' }, ranked.more.concat(ranked.tooBig).map(m => modelCard(m, specs))) : null,
        downloadedFiles.length ? settingsGroup('Downloaded on this phone', downloadedFiles.map(f => h('div', { class: 'settings-row' },
            h('span', { class: 'settings-label' }, f.file.replace(/\.gguf$/i, ''), h('span', { class: 'settings-hint', text: formatBytes(f.size) + (settings.local_model === f.file ? ' · in use' : '') })),
            h('span', { class: 'header-actions' },
                settings.local_model === f.file ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => { setSetting('local_model', f.file); renderSettings(); } }, 'Use'),
                h('button', { type: 'button', class: 'link-btn', style: 'color: var(--danger)', onclick: () => deleteModel(f.file) }, 'Delete')))),
            `${formatBytes(downloadedFiles.reduce((n, f) => n + (f.size || 0), 0))} used by models.`) : null,
        settingsGroup('Search Hugging Face', [
            h('div', { class: 'settings-row' }, searchInput,
                h('button', { type: 'button', class: 'icon-btn accent', 'aria-label': 'Search', onclick: () => { if (searchInput.value.trim()) runHfSearch(searchInput.value.trim()); } }, icon('i-globe'))),
            searchBody,
        ], 'Any GGUF model works. Each file shows whether it fits this phone. Q4_K_M files are a good balance of size and quality.'),
        settingsGroup('Hugging Face account', hfUser && !hfUser.error
            ? [infoRow('Signed in', hfUser.name), settingsButton('Sign out', hfSignOut, 'danger')]
            : [settingsRow('Access token', hfInput, { tag: 'div' }),
                settingsButton('Sign in', () => hfSignIn(hfInput.value)),
                h('a', { class: 'settings-row settings-button', href: 'https://huggingface.co/settings/tokens', target: '_blank', rel: 'noopener' }, 'Get a free token (Read access)')],
        'Optional. Signing in lets you download gated models (some Llama and Gemma versions need you to accept their licence on huggingface.co first). The token stays on this phone.'),
        settingsGroup('Running models', [
            settingsToggle('local_gpu', 'Use the graphics chip', { hint: 'Much faster. Turn off only if a model crashes.' }),
            settingsToggle('keep_awake', 'Keep the screen on while cooking', { hint: 'The phone pauses the AI when it locks' }),
            settingsRow('Memory for chat', settingsSelect('local_ctx', { 2048: 'Small (2k)', 4096: 'Normal (4k)', 8192: 'Large (8k, more memory)' })),
        ], 'Plans are made one day at a time so small models stay accurate and the phone stays cooler.'),
    );
    return box;
}

// === SWITCHING BETWEEN "THIS PHONE" AND "MY PC" ===
function switchToPc() {
    nativeCall('setMode', { mode: 'server' }).catch(e => showToast(e.message));
}
function switchToPhone() {
    if (!confirm('Use Nourish on this phone only? Your plan, settings and chat here start fresh (your PC keeps its own copy).')) return;
    nativeCall('setMode', { mode: 'local' }).catch(e => showToast(e.message));
}

if (typeof module !== 'undefined') {
    module.exports = { DESCRIBE_GRAMMAR, describeFromRecipe, descriptionProblem, recipeFacts, repairMeal, nameProblem, dishNameFor, hardProblems, aiChoose, aiSubstitute, aiDescribe, slotLimitsFor, slotRulesText, slotCheck, quickMealFor, allProblems, IMPORT_LIMITS, IMPORT_TOKENS, IMPORT_TEXT_CHARS, importGrammar, nutritionGrammar, extractRecipe, estimateNutrition, PLAN_LIMITS, MEAL_TOKENS, MEAL_ATTEMPTS, MEAL_EXTRA_ATTEMPTS, EDIT_TOKENS, mealGrammar, editGrammar, makeMeal, allProblems, recipeRules, mealAsk, mealSystem, mealFormat, servingsWanted, completeMeal, mealProblems, tidyMeal, junkRows, dropJunk, sameDish, dishWords, generatePlanOnDevice, GBNF_MEAL, discoverModels, pickQuant, paramsFromName, baseKey, prettyModelName, compareVersions, pickUpdate, rankModels, assessModel, memoryBudget, stripThinking, GBNF_EDIT };
}
