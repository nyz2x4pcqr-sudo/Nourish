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
    return new Promise((resolve, reject) => {
        const timer = timeoutMs ? setTimeout(() => {
            delete nativePending[id];
            reject(new Error('The phone took too long to answer.'));
        }, timeoutMs) : null;
        nativePending[id] = { resolve, reject, timer };
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
    const res = await nativeHttp(url, opts);
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
    if (route === '/api/update/check') return localUpdateCheck(params.prereleases === 'true');
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
async function runOnDevice(req, id) {
    if (!req.model) throw new Error('Download a model first: Settings → AI model.');
    if (on('keep_awake')) nativeCall('keepAwake', { on: true }).catch(() => {});
    try {
        const res = await nativeCall('generate', {
            id, model: req.model, messages: req.messages, grammar: req.grammar || null,
            temperature: Number(req.temperature), max_tokens: req.max_tokens || 1024,
            n_ctx: Number(settings.local_ctx) || 4096, gpu: on('local_gpu'),
        }, { timeoutMs: 0 });
        if (res && res.cancelled) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
        return stripThinking((res && res.text) || '');
    } finally {
        if (on('keep_awake')) nativeCall('keepAwake', { on: false }).catch(() => {});
    }
}

// Some models (Qwen 3.5, …) "think out loud" first; the person only needs the answer.
function stripThinking(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();
}

// Output formats that small models are forced to follow, so their answers always parse.
const GBNF_COMMON = String.raw`
meal ::= "{" ws "\"name\":" ws str "," ws "\"time_minutes\":" ws int "," ws "\"nutrition\":" ws "{" ws "\"calories\":" ws int "," ws "\"protein_g\":" ws int "," ws "\"carbs_g\":" ws int "," ws "\"fat_g\":" ws int ws "}" "," ws "\"ingredients\":" ws "[" ws str ("," ws str){1,7} ws "]" "," ws "\"steps\":" ws "[" ws str ("," ws str){1,4} ws "]" ws "}"
str ::= "\"" [^"\\\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F] [^"\\\x7F\x00-\x1F]{1,89} "\""
int ::= "0" | [1-9] [0-9]{0,3}
ws ::= [ \n]{0,2}`;
const GBNF_DAY = String.raw`root ::= "{" ws "\"breakfast\":" ws meal "," ws "\"lunch\":" ws meal "," ws "\"dinner\":" ws meal ws "}"` + GBNF_COMMON;
const GBNF_EDIT = String.raw`root ::= "{" ws "\"changes\":" ws "[" ws change ("," ws change){0,6} ws "]" ws "}"
change ::= "{" ws "\"day\":" ws [1-7] "," ws "\"meal\":" ws ("\"breakfast\"" | "\"lunch\"" | "\"dinner\"") "," ws "\"recipe\":" ws meal ws "}"` + GBNF_COMMON;

// Small phone models do far better one day at a time than with a whole week in one go.
async function generatePlanOnDevice(messages, onDay, isCancelled) {
    const conversation = messages.filter(m => m.role !== 'system').slice(-8).map(m => `${m.role === 'user' ? 'They said' : 'You said'}: ${m.content}`).join('\n').slice(-2500);
    const system = 'You are a meal-planning chef. Plan ONE day of meals as JSON: breakfast, lunch and dinner, each with name, time_minutes, nutrition (calories, protein_g, carbs_g, fat_g for one serving), ingredients with quantities and short steps. ' +
        'Use real, appetising dish names. Spread the daily calorie and protein targets over the three meals.\n\nThe person:\n' + profileText();
    const days = [];
    const used = [];
    for (let d = 0; d < 7; d++) {
        if (isCancelled()) break;
        onDay(d);
        const req = await buildAIRequest([
            { role: 'system', content: system },
            { role: 'user', content: `${conversation}\n\nPlan Day ${d + 1} (${dayName(d)}).${used.length ? ' Already planned this week (do not repeat): ' + used.join(', ') + '.' : ''} Return only the JSON for this day.` },
        ], { maxTokens: 1100 });
        req.grammar = GBNF_DAY;
        let text;
        try {
            text = await runOnDevice(req, 'plan-day-' + d + '-' + Date.now());
        } catch (e) {
            if (e.cancelled && days.length) break;   // keep the days already made
            throw e;
        }
        const day = parseLLMJSON(text);
        days.push(day);
        MEAL_TYPES.forEach(t => { if (day && day[t] && day[t].name) used.push(day[t].name); });
    }
    return { days };
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
    if (!key) throw new Error('Spoonacular needs a free API key. Add it in Settings → Recipe sources.');
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
        if (res.status === 401 || res.status === 403 || res.status === 422) throw new Error('Brave Search rejected the API key. Check it in Settings → Recipe sources.');
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

function cleanText(text) {
    const doc = new DOMParser().parseFromString('<body>' + String(text == null ? '' : text) + '</body>', 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function isoMinutes(iso) {
    const m = String(iso || '').trim().toUpperCase().match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
    if (!m || !(m[1] || m[2] || m[3])) return null;
    return (Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) || null;
}

function firstNumber(v) {
    const m = String(v == null ? '' : v).replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
}

function recipeSteps(instr) {
    if (typeof instr === 'string') {
        const text = instr.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n');
        return cleanTextKeepLines(text).replace(/\.\s+(?=[A-Z])/g, '.\n').split(/\n+/).map(s => s.trim()).filter(s => s.length > 3);
    }
    const out = [];
    (Array.isArray(instr) ? instr : []).forEach(item => {
        if (typeof item === 'string') out.push(cleanText(item));
        else if (item && item.itemListElement) out.push.apply(out, recipeSteps(item.itemListElement));
        else if (item) out.push(cleanText(item.text || item.name));
    });
    return out.filter(Boolean);
}

function cleanTextKeepLines(text) {
    return String(text).split('\n').map(cleanText).join('\n');
}

function findRecipeNode(data) {
    if (Array.isArray(data)) {
        for (const item of data) { const f = findRecipeNode(item); if (f) return f; }
    } else if (data && typeof data === 'object') {
        const t = data['@type'];
        if (t === 'Recipe' || (Array.isArray(t) && t.indexOf('Recipe') >= 0)) return data;
        for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
            if (data[key]) { const f = findRecipeNode(data[key]); if (f) return f; }
        }
    }
    return null;
}

// Reads the schema.org Recipe that most recipe sites embed for search engines.
function parseRecipePage(html, url) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let recipe = null;
    Array.prototype.some.call(doc.querySelectorAll('script[type="application/ld+json" i]'), s => {
        const raw = (s.textContent || '').trim();
        let data = null;
        try { data = JSON.parse(raw); } catch (e) {
            try { data = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]+/g, ' ')); } catch (e2) { return false; }
        }
        recipe = findRecipeNode(data);
        return !!recipe;
    });
    if (!recipe || !recipe.name) return null;
    const ingredients = (recipe.recipeIngredient || recipe.ingredients || []).map(cleanText).filter(Boolean);
    const steps = recipeSteps(recipe.recipeInstructions);
    if (!ingredients.length && !steps.length) return null;
    const total = isoMinutes(recipe.totalTime) || ((isoMinutes(recipe.prepTime) || 0) + (isoMinutes(recipe.cookTime) || 0)) || null;
    const n = recipe.nutrition && typeof recipe.nutrition === 'object' ? recipe.nutrition : {};
    const nutrition = { calories: firstNumber(n.calories), protein_g: firstNumber(n.proteinContent), carbs_g: firstNumber(n.carbohydrateContent), fat_g: firstNumber(n.fatContent) };
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* keep empty */ }
    return {
        name: cleanText(recipe.name).slice(0, 150), time_minutes: total,
        nutrition: Object.keys(nutrition).some(k => nutrition[k] != null) ? nutrition : null,
        ingredients: ingredients.slice(0, 40), steps: steps.slice(0, 30), source_url: url, source_name: host,
    };
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

async function localImport(body) {
    let url = String(body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return fetchRecipe(url);
}

async function localUpdateCheck(prereleases) {
    const specs = await getSpecs().catch(() => null);
    const current = (specs && specs.app_version) || '0';
    const list = await nativeJSON('https://api.github.com/repos/nyz2x4pcqr-sudo/Nourish/releases?per_page=10', { headers: { Accept: 'application/vnd.github+json' } });
    const rel = (list || []).filter(r => !r.draft && (prereleases || !r.prerelease))[0];
    if (!rel) return { current, update_available: false };
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    return { current, latest, update_available: compareVersions(latest, current) > 0, notes: rel.body || '', url: rel.html_url, can_install: false };
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
    if (!specsCache || refresh) specsCache = await nativeCall('specs', {}, { timeoutMs: 10000 });
    return specsCache;
}

const GB = 1024 * 1024 * 1024;
function formatBytes(n) {
    if (!Number.isFinite(n)) return '—';
    return n >= GB ? `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`;
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

// Curated starting points: real files on Hugging Face, all downloadable without an account.
// quality: 1–10, how well it follows recipes and the plan format in our tests and published results.
const MODEL_CATALOG = [
    { id: 'qwen35-08b', name: 'Qwen 3.5 0.8B', repo: 'unsloth/Qwen3.5-0.8B-GGUF', file: 'Qwen3.5-0.8B-Q4_K_M.gguf', size: 532517120, params: 0.8, quality: 3, blurb: 'Tiny and quick. Simple meals; may repeat itself.' },
    { id: 'llama32-1b', name: 'Llama 3.2 1B', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', size: 807694464, params: 1.2, quality: 3.5, blurb: 'Small, fast, runs on almost any phone.' },
    { id: 'qwen25-15b', name: 'Qwen 2.5 1.5B', repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf', size: 986048768, params: 1.5, quality: 4.5, blurb: 'Good balance for older phones.' },
    { id: 'qwen35-2b', name: 'Qwen 3.5 2B', repo: 'unsloth/Qwen3.5-2B-GGUF', file: 'Qwen3.5-2B-Q4_K_M.gguf', size: 1280835840, params: 2, quality: 5.5, blurb: 'Quick, with sensible, varied meals.' },
    { id: 'llama32-3b', name: 'Llama 3.2 3B', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', size: 2019377696, params: 3.2, quality: 6, blurb: 'Reliable all-rounder.' },
    { id: 'qwen3-4b-2507', name: 'Qwen 3 4B Instruct', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', size: 2497281120, params: 4, quality: 7.5, blurb: 'Great recipes and chat; answers straight away.' },
    { id: 'qwen35-4b', name: 'Qwen 3.5 4B', repo: 'unsloth/Qwen3.5-4B-GGUF', file: 'Qwen3.5-4B-Q4_K_M.gguf', size: 2740937888, params: 4, quality: 7.5, blurb: 'Newer and smart; thinks before chat answers, so replies take longer.' },
    { id: 'gemma4-e2b', name: 'Gemma 4 E2B', repo: 'unsloth/gemma-4-E2B-it-GGUF', file: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 3106738272, params: 2.3, quality: 6.5, blurb: "Google's phone-sized model. Fast for its size." },
    { id: 'gemma4-e4b', name: 'Gemma 4 E4B', repo: 'unsloth/gemma-4-E4B-it-GGUF', file: 'gemma-4-E4B-it-Q4_K_M.gguf', size: 4977171584, params: 4.5, quality: 8, blurb: "Google's best phone model. Excellent food knowledge." },
    { id: 'qwen35-9b', name: 'Qwen 3.5 9B', repo: 'unsloth/Qwen3.5-9B-GGUF', file: 'Qwen3.5-9B-Q4_K_M.gguf', size: 5680522464, params: 9, quality: 9, blurb: 'Closest to a PC model. For phones with lots of memory.' },
];

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
function rankModels(specs, models = MODEL_CATALOG) {
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
// Reasoning-style models "think" at length before answering: slow and hot on a phone.
const THINKERS = /distill|reason|thinking|\br1\b|mimo/i;
const LIVE_CACHE_KEY = 'nourish_hf_top';
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

async function discoverModels(specs, { fetchJSON = url => nativeJSON(url, { auth: 'hf' }), force = false } = {}) {
    const budget = memoryBudget(specs);
    const bucket = Math.round(budget / GB * 2) / 2;
    if (!force) {
        try {
            const cached = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || 'null');
            if (cached && cached.bucket === bucket && Date.now() - cached.at < LIVE_CACHE_MS && cached.models.length) return cached;
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
    lists.forEach(list => (Array.isArray(list) ? list : []).forEach(r => {
        // Skip private, gated, unsuitable and little-known uploads (fewer than 2,000 downloads).
        if (!r || !r.id || r.private || r.gated || HF_SKIP.test(r.id) || (r.downloads || 0) < 2000) return;
        const params = paramsFromName(r.id);
        if (params && params > maxParams * 1.15) return;
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
    if (!pre.length) throw new Error('Hugging Face returned no suitable models.');

    const picked = await mapLimit(pre, 4, async r => {
        const tree = await fetchJSON(`${HF_API}/${r.id}/tree/main`);
        const f = pickQuant(tree, r.params, specs);
        if (!f) return null;
        const params = r.params || Math.max(0.3, f.size / (0.6 * GB));
        return {
            id: 'hf:' + r.id + '/' + f.file, name: prettyModelName(r.id), repo: r.id, file: f.file, size: f.size, params,
            // Squeezed versions (3-bit) lose quality; proven chat families and newer models gain.
            quality: Math.min(10, capability(params) + recencyBonus(r.created) + (KNOWN_GOOD.test(r.id) ? 1 : -0.5)
                - (THINKERS.test(r.id) ? 1 : 0) - (params < 0.5 ? 2 : 0) - ({ Q4_K_S: 0.2, IQ4_XS: 0.3, IQ4_NL: 0.3, Q4_0: 0.4, Q3_K_L: 1, Q3_K_M: 1.2, IQ3_M: 1.3, Q3_K_S: 1.5 }[f.quant] || 0)
                + Math.log10(r.downloads + 10) / 6),
            blurb: `${compactCount(r.downloads)} downloads${r.created ? ' · ' + new Date(r.created).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''} · ${f.quant}`,
            live: true,
        };
    });
    const models = picked.filter(Boolean);
    // Hugging Face's lists change daily; if few fit this phone, add Nourish's tested picks that do.
    const fitting = models.filter(m => assessModel(m, specs).fit !== 'too-big');
    if (fitting.length < 5) {
        MODEL_CATALOG.filter(c => assessModel(c, specs).fit !== 'too-big' && !models.some(m => baseKey({ id: m.repo }) === baseKey({ id: c.repo })))
            .slice(0, 5 - fitting.length).forEach(c => models.push(Object.assign({}, c, { blurb: c.blurb + ' (Nourish pick)' })));
    }
    if (!models.length) throw new Error('None of the models found on Hugging Face fit this phone.');
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
    downloads[ev.file] = ev;
    const bar = document.getElementById('dl-' + cssId(ev.file));
    if (bar && ev.state === 'running') {
        const pct = ev.total ? Math.round(ev.received / ev.total * 100) : 0;
        bar.querySelector('.progress-fill').style.width = pct + '%';
        bar.querySelector('.progress-label').textContent = `Downloading… ${pct}% · ${formatBytes(ev.received)} of ${formatBytes(ev.total)}`;
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
    downloads[model.file] = { file: model.file, received: 0, total: model.size, state: 'running' };
    renderSettings();
    try {
        await nativeCall('download', {
            url: `https://huggingface.co/${model.repo}/resolve/main/${encodeURIComponent(model.file)}?download=true`,
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
        .catch(e => { ondeviceState.liveError = e.message; })
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
    // The live list from Hugging Face; the built-in list only while it loads or when offline.
    const live = ondeviceState.live && ondeviceState.live.models.length ? ondeviceState.live : null;
    const ranked = rankModels(specs, live ? live.models : MODEL_CATALOG);
    const sourceNote = ondeviceState.liveBusy
        ? 'Checking Hugging Face for the best models for this phone…'
        : live
            ? `Live from Hugging Face · ${new Date(live.at).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`
            : `Couldn't reach Hugging Face${ondeviceState.liveError ? ' (' + ondeviceState.liveError + ')' : ''}, so this is Nourish's built-in list.`;
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
            ondeviceState.liveBusy ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => loadLiveModels(true) }, 'Refresh')),
        ranked.top.length
            ? h('div', { class: 'model-list' }, ranked.top.map(m => modelCard(m, specs)))
            : h('p', { class: 'settings-note', text: 'None of the listed models fit in the memory this phone allows. Try searching for a smaller one below, or use a cloud AI.' }),
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
    module.exports = { discoverModels, pickQuant, paramsFromName, baseKey, prettyModelName, parseRecipePage, isoMinutes, compareVersions, rankModels, assessModel, memoryBudget, MODEL_CATALOG, stripThinking, GBNF_DAY, GBNF_EDIT, recipeSteps };
}
