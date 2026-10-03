// === CONFIG ===
// The Nourish server serves this page, so API calls go back to wherever the page came from
// (any port: NOURISH_PORT can change it). Opened as a file, fall back to the default server.
const API_BASE = location.protocol === 'file:' ? 'http://localhost:8000' : '';

// True inside the Nourish Android/iOS app (it adds "NourishApp" to the browser's user agent).
const IN_PHONE_APP = /\bNourishApp\//.test(navigator.userAgent);

const SVG_NS = 'http://www.w3.org/2000/svg';
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', 'snack-1': 'Snack', 'snack-2': 'Snack', 'snack-3': 'Snack' };
const MEAL_ICONS = { breakfast: 'i-sunrise', lunch: 'i-sun', dinner: 'i-moon', 'snack-1': 'i-leaf', 'snack-2': 'i-leaf', 'snack-3': 'i-leaf' };
const isSnackSlot = t => /^snack-\d$/.test(t);
// A plan day's meal in a slot: breakfast, lunch, dinner, or snack-1… (day.snacks).
function slotMeal(day, t) { return !day ? null : isSnackSlot(t) ? (day.snacks || [])[Number(t.slice(6)) - 1] || null : day[t] || null; }
// Every [slot, meal] of a day, in order: breakfast, lunch, dinner, then snacks.
function daySlots(day) { return NourishLog.slotsOf(day); }
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PROVIDERS = { local: 'On this phone', lmstudio: 'LM Studio (local)', ollama: 'Ollama (local)', claude: 'Claude', openai: 'OpenAI' };
// Phone-only mode (see ondevice.js) offers on-device AI and cloud AIs; on a PC, the PC's own AIs.
const isLocalMode = () => typeof LOCAL_MODE !== 'undefined' && LOCAL_MODE;
function availableProviders() {
    const keys = isLocalMode() ? ['local', 'claude', 'openai'] : ['lmstudio', 'ollama', 'claude', 'openai'];
    return Object.fromEntries(keys.map(k => [k, PROVIDERS[k]]));
}
const MODEL_SUGGESTIONS = {
    claude: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    openai: ['gpt-4o-mini', 'gpt-4o'],
};
const DIETS = ['No restriction', 'Vegetarian', 'Vegan', 'Pescatarian', 'Keto', 'Low-carb', 'Paleo',
    'Mediterranean', 'Gluten-free', 'Dairy-free', 'Halal', 'Kosher'];
const SPOONACULAR_DIETS = { Vegetarian: 'vegetarian', Vegan: 'vegan', Pescatarian: 'pescetarian', Keto: 'ketogenic', Paleo: 'paleo', 'Gluten-free': 'gluten free' };
const GOALS = { Cut: 'Lose weight', Maintain: 'Maintain', Gain: 'Gain muscle' };
// Accent colours. The keys are what Settings stores; the names are what people see.
const ACCENTS = { orange: '#F4A13D', green: '#8CC084', blue: '#6FB7E6', purple: '#B69CF6', pink: '#F08BA8', teal: '#5FD0B8' };
const ACCENT_NAMES = { orange: 'Saffron', green: 'Sage', blue: 'Lagoon', purple: 'Plum', pink: 'Rose', teal: 'Mint' };
const CHAT_HISTORY_LIMIT = 20;
const CHAT_LENGTHS = { short: 800, normal: 2000, long: 4000 };
const CHAT_SUGGESTIONS = [
    ['i-sparkle', 'Make me a high-protein meal plan with quick dinners'],
    ['i-swap', 'Swap Wednesday dinner for something vegetarian'],
    ['i-utensils', 'What can I cook with chicken, rice and broccoli?'],
    ['i-flame', 'Plan a week of cheap meals I can batch-cook on Sunday'],
];
const SECRET_FIELDS = ['claude_api_key', 'openai_api_key', 'spoonacular_api_key', 'brave_api_key'];

// Every setting, with its default. Kept as strings. Saved on this device and on the PC.
const SETTINGS_DEFAULTS = {
    // appearance
    theme: 'ember',            // theme.js THEMES id, or 'auto' (older: dark / light / system)
    accent: 'orange',          // theme.js ACCENTS id, or 'custom'
    text_size: 'default',      // small, default, large, xl
    bg: '',                    // one of the theme's curated backgrounds ('' = its standard one)
    custom_bg: '',             // Advanced: any background colour
    custom_accent: '',         // Advanced: any accent colour (accent: 'custom')
    font_pair: 'editorial',    // theme.js FONTS
    bold_text: 'off',
    icon_style: 'outline',     // theme.js ICON_STYLES
    app_icon: 'default',       // theme.js APP_ICONS (phone apps)
    today_stats: 'protein_g,carbs_g,fat_g',   // which bars Today shows
    start_tab: 'today',
    week_start: 'monday',
    units: '',   // 'imperial' or 'metric'; empty: from the phone's region
    show_nutrition: 'on',
    // meals (Profile → Meals each day)
    meal_slots: 'breakfast,lunch,dinner',
    snacks_per_day: '0',
    reduce_motion: 'off',
    // AI
    active_provider: 'lmstudio',
    lmstudio_model: '',
    ollama_model: '',
    claude_api_key: '',
    claude_model: 'claude-haiku-4-5-20251001',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    temperature: '0.7',
    max_tokens: '8000',
    // on-device AI (phone app only)
    local_model: '',
    local_gpu: 'on',
    local_ctx: '4096',
    keep_awake: 'on',
    // activity log
    verbose_log: 'on',
    // chat
    chef_style: 'friendly',
    chat_length: 'normal',
    chat_actions: 'on',
    // profile
    name: '',
    calorie_target: '2400',
    protein_target: '150',
    diet: 'No restriction',
    allergies: '',
    cuisines: '',
    max_cook_time: '',
    servings: '1',
    skill: 'Intermediate',
    budget: 'Any',
    // recipe sources (Settings → Advanced)
    plan_source: 'auto',          // 'auto': real recipes first, AI fills gaps; 'ai': the AI writes every meal
    sources_off: '',              // ids of sources switched off (sources.js)
    custom_sites: '',             // extra recipe sites to search, e.g. "mysite.com"
    source_priority: '',          // ids searched and preferred first
    calorie_split: 'dinner',      // planner.js SPLITS: 'dinner' | 'even' | 'breakfast' | 'custom'
    split_breakfast: '25',
    split_lunch: '30',
    split_dinner: '45',
    spoonacular_api_key: '',
    web_engine: 'duckduckgo',
    brave_api_key: '',
    // grocery
    grocery_hide_checked: 'off',
    // updates
    auto_update_check: 'on',
    update_prereleases: 'on',
};

// === STATE ===
// My schedule: how long someone has to make and eat each meal ('' = the usual default for the
// meal), different at the weekend if they like, or per day (Advanced). Hard limits for plans.
['breakfast', 'lunch', 'dinner'].forEach(m => {
    SETTINGS_DEFAULTS[`sched_${m}`] = '';
    SETTINGS_DEFAULTS[`sched_we_${m}`] = '';
    for (let d = 0; d < 7; d++) SETTINGS_DEFAULTS[`sched_d${d}_${m}`] = '';
});
SETTINGS_DEFAULTS.sched_weekend = 'off';
SETTINGS_DEFAULTS.sched_asked = '';   // 'yes' once the quick questions were answered or skipped
SETTINGS_DEFAULTS.allow_leftovers = 'off';
SETTINGS_DEFAULTS.builtin_mode = 'backup';     // Nourish's own recipes: 'backup' (only when no web recipe fits), 'mix' (equal terms), 'off'   // 'on': a dinner can come back as the next day's lunch
const settings = Object.assign({}, SETTINGS_DEFAULTS);
let prefs = { goal: 'Maintain', source: 'aiChef', likes: '', hates: '' };
let daysData = [];
let selectedDay = 0;
let grocery = { checked: [], custom: [] };     // checked: item texts; custom: [{ text, checked }]
let cookbook = { recipes: [] };                // saved recipes (see COOKBOOK)
let foodLog = { days: {}, recents: [], favorites: [] };   // what was eaten (foodlog.js), per day
let taste = NourishTaste.empty();   // what the app has learned about the person (taste.js)
let chatHistory = [];                          // [{ role: 'user' | 'assistant', content, card? }]
let chatBusy = false;
let chatBusyLabel = '';
let chatError = '';
let planJob = null;            // { id, started, provider, kind: 'plan' | 'edit', origin } while the AI works on the plan
let backendOnline = null;
let serverInfo = null;
const modelLists = {};         // provider -> { models: [], error: '' }
let updateInfo = null;         // result of the last update check
let updateChecking = false;
let updateError = '';
let secretsSet = {};           // which API keys the PC has saved (the keys themselves never come back)
let pendingClears = [];        // API keys to remove from the PC on the next sync
const secretEditing = {};      // API key rows switched to "type a new key"
let settingsPage = null;

// === STORAGE (localStorage can throw in private browsing) ===
// Returns false when it couldn't be saved (storage full), so callers can make room.
function store(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e) { return false; }
}
function load(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function loadJSON(key, fallback) {
    try { const v = JSON.parse(load(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function unstore(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

// === DOM HELPERS: build elements with textContent, never parse strings as HTML ===
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

function svgEl(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const c of children) el.append(c);
    return el;
}

// An icon from the sprite in index.html.
function icon(name, cls) {
    const svg = svgEl('svg', { 'aria-hidden': 'true' }, svgEl('use', { href: `#${name}` }));
    if (cls) svg.setAttribute('class', cls);
    return svg;
}

// Replaces an element's children, skipping null/false (they would otherwise print as text).
// Written without el.replaceChildren() so older phone browsers (Android WebView < 86) work too.
function setChildren(el, ...children) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
}

const $ = id => document.getElementById(id);

// === ACTIVITY LOG ===
// Everything the app does, step by step, so people can see what's going on (Settings → Activity log)
// and send it when something goes wrong. Secrets (API keys, tokens) are blanked out before saving.
const LOG_KEY = 'nourish_log';
const LOG_MAX = 1500;
let activityLog = [];
try { activityLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; } catch (e) { activityLog = []; }
let logSaveTimer = null;

function redactSecrets(text) {
    return String(text)
        .replace(/hf_[A-Za-z0-9]{6,}/g, 'hf_•••')
        .replace(/sk-(ant-)?[A-Za-z0-9_-]{6,}/g, 'sk-•••')
        .replace(/("?(api_key|apiKey|token|brave_key|x-api-key|authorization|x-subscription-token)"?\s*[:=]\s*"?)(Bearer\s+)?[^",}\s]{4,}/gi, '$1•••');
}

// level: 'info' (always kept), 'debug' (only with detailed logging on), 'warn', 'error'.
function nlog(area, message, details, level = 'info') {
    if (level === 'debug' && settings.verbose_log !== 'on') return;
    let extra;
    if (details !== undefined && details !== null) {
        try { extra = typeof details === 'string' ? details : JSON.stringify(details); } catch (e) { extra = String(details); }
        extra = redactSecrets(extra).slice(0, 3000);
    }
    const entry = { t: Date.now(), level, area, msg: redactSecrets(message) };
    if (extra) entry.details = extra;
    activityLog.push(entry);
    if (activityLog.length > LOG_MAX) activityLog.splice(0, activityLog.length - LOG_MAX);
    clearTimeout(logSaveTimer);
    logSaveTimer = setTimeout(() => { try { localStorage.setItem(LOG_KEY, JSON.stringify(activityLog)); } catch (e) { /* full */ } }, 500);
    try { (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[Nourish]', area, entry.msg, extra || ''); } catch (e) { /* no console */ }
    if (typeof onLogEntry === 'function') onLogEntry(entry);
}

window.addEventListener('error', e => nlog('app', `Script error: ${e.message}`, `${e.filename || ''}:${e.lineno || ''}`, 'error'));
window.addEventListener('unhandledrejection', e => nlog('app', `Unhandled error: ${(e.reason && e.reason.message) || e.reason}`, null, 'error'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const formatElapsed = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const on = key => settings[key] === 'on';

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();
    nlog('app', `Nourish started (${isLocalMode() ? 'on this phone' : IN_PHONE_APP ? 'phone app, connected to a PC' : 'browser'})`,
        { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, provider: settings.active_provider, model: settings[`${settings.active_provider}_model`] || '' });
    applyAppearance();
    selectedDay = todayIndex();
    initTabs();
    initSheets();
    initChat();
    initGrocery();
    renderAll();
    switchTab(['today', 'plan', 'chat', 'grocery'].includes(settings.start_tab) ? settings.start_tab : 'today');
    if (location.protocol === 'file:') {
        showBanner('Opened as a file. Start the server and open http://localhost:8000 instead.');
    }
    // One step failing (say a screen that can't redraw) must not stop the rest of the start-up.
    const startupError = step => e => { nlog('app', `Start-up step "${step}" failed: ${(e && e.message) || e}`, e && e.stack, 'error'); };
    checkBackend().catch(e => { startupError('check server')(e); return backendOnline; }).then(ok => {
        if (!ok) return;
        syncNow().catch(startupError('sync')).then(() => {
            loadServerInfo().catch(startupError('server info'));
            try { resumePendingJobs(); } catch (e) { startupError('resume jobs')(e); }
        });
    });
    setInterval(() => { if (!document.hidden) syncNow(); }, 15000);
    window.addEventListener('online', () => { checkBackend(); syncNow(); });
    // The recipe library: read a little after start, then when the app comes back (at most every 5 minutes).
    librarySummary(libraryIndex());
    setTimeout(libraryLocation, 2500);
    setTimeout(refreshRecipeLibrary, 45000);
    let libraryChecked = 0;
    const checkLibrary = () => { if (Date.now() - libraryChecked > 300000) { libraryChecked = Date.now(); indexLibrary(); } };
    setTimeout(checkLibrary, 8000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        setTimeout(checkLibrary, 3000);
        if (isLocalMode()) resumeLocalPlan();
        if (backendOnline === false) checkBackend();
        syncNow();
    });
    // Re-render the day labels when the date changes while the app stays open.
    let lastDay = new Date().getDate();
    setInterval(() => { if (new Date().getDate() !== lastDay) { lastDay = new Date().getDate(); updateTodayScreen(); } }, 60000);
});

function renderAll() {
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
    renderChat();
    renderSettings();
}

// === LOCAL STATE ===
function loadLocalState() {
    for (const key of Object.keys(SETTINGS_DEFAULTS)) settings[key] = load(key, SETTINGS_DEFAULTS[key]);
    if (!availableProviders()[settings.active_provider]) settings.active_provider = isLocalMode() ? 'local' : 'lmstudio';
    secretsSet = loadJSON('nourish_secrets_set', {});
    pendingClears = loadJSON('nourish_pending_clears', []);

    const savedPrefs = loadJSON('nourish_prefs', null);
    prefs = savedPrefs && typeof savedPrefs === 'object'
        ? Object.assign({}, prefs, savedPrefs)
        // older versions kept these under separate keys
        : { goal: load('saved_goal', 'Maintain'), source: load('saved_source', 'aiChef'), likes: load('saved_likes', ''), hates: load('saved_hates', '') };
    if (!GOALS[prefs.goal]) prefs.goal = 'Maintain';

    daysData = normalizePlan(loadJSON('nourish_plan', null), false);

    const savedGrocery = loadJSON('nourish_grocery', null);
    grocery = cleanGrocery(savedGrocery || { checked: loadJSON('nourish_grocery_checked', []), custom: [] });

    chatHistory = cleanChat(loadJSON('nourish_chat', []));
    cookbook = cleanCookbook(loadJSON('nourish_cookbook', null));
    foodLog = NourishLog.clean(loadJSON('nourish_log', null));
    taste = NourishTaste.clean(loadJSON('nourish_taste', null));
}

function persistLocal(section) {
    if (section === 'settings') {
        for (const key of Object.keys(SETTINGS_DEFAULTS)) {
            if (settings[key] === '' && SECRET_FIELDS.includes(key)) unstore(key);
            else store(key, settings[key]);
        }
        store('nourish_secrets_set', secretsSet);
        store('nourish_pending_clears', pendingClears);
    } else if (section === 'prefs') store('nourish_prefs', prefs);
    else if (section === 'plan') store('nourish_plan', daysData);
    else if (section === 'grocery') store('nourish_grocery', grocery);
    else if (section === 'chat') store('nourish_chat', chatHistory);
    else if (section === 'cookbook') store('nourish_cookbook', cookbook);
    else if (section === 'log') store('nourish_log', foodLog);
    else if (section === 'taste') store('nourish_taste', taste);
}

function cleanGrocery(g) {
    return {
        checked: Array.isArray(g && g.checked) ? g.checked.filter(x => typeof x === 'string') : [],
        custom: Array.isArray(g && g.custom)
            ? g.custom.filter(x => x && typeof x.text === 'string' && x.text.trim()).map(x => ({ text: x.text.trim().slice(0, 200), checked: !!x.checked }))
            : [],
    };
}

function cleanChat(list) {
    return (Array.isArray(list) ? list : [])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => (m.card && typeof m.card === 'object' ? { role: m.role, content: m.content, card: m.card } : { role: m.role, content: m.content }))
        .slice(-100);
}

// === SYNC WITH THE PC ===
// Settings, preferences, the plan, the grocery list, the chat and the cookbook are kept on the PC so every device
// (browser, iPhone app, Android app) shows the same thing. Each section has a revision number:
// a device that has a newer change sends it; a device that's behind takes the PC's copy.
const SECTIONS = ['settings', 'prefs', 'plan', 'grocery', 'chat', 'cookbook', 'log', 'taste'];
const syncMeta = Object.assign(
    Object.fromEntries(SECTIONS.map(s => [s, { rev: 0, dirty: false, ver: 0 }])),
    loadJSON('nourish_sync', {}));
let syncTimer = null;
let syncing = false;
let syncAgain = false;
let lastSynced = 0;
let syncFailed = false;
let settingsStale = false;

function saveSyncMeta() { store('nourish_sync', syncMeta); }

// Call after changing a section: saves it here and sends it to the PC shortly after.
function changed(section) {
    persistLocal(section);
    const meta = syncMeta[section];
    meta.dirty = true;
    meta.ver = (meta.ver || 0) + 1;
    saveSyncMeta();
    updateSyncStatus();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 600);
}

function sectionValue(section) {
    if (section === 'settings') {
        const value = {};
        for (const key of Object.keys(SETTINGS_DEFAULTS)) {
            if (SECRET_FIELDS.includes(key) && !settings[key]) continue;  // empty means "keep the PC's key"
            value[key] = settings[key];
        }
        if (pendingClears.length) value._clear = pendingClears.slice();
        return value;
    }
    if (section === 'prefs') return prefs;
    if (section === 'plan') return daysData;
    if (section === 'grocery') return grocery;
    if (section === 'cookbook') return cookbook;
    if (section === 'log') return foodLog;
    if (section === 'taste') return taste;
    return chatHistory.map(m => (m.card ? { role: m.role, content: m.content, card: m.card } : { role: m.role, content: m.content }));
}

function hasLocalData(section) {
    if (section === 'settings') return Object.keys(SETTINGS_DEFAULTS).some(k => settings[k] !== SETTINGS_DEFAULTS[k]);
    if (section === 'prefs') return !!(prefs.likes || prefs.hates) || prefs.goal !== 'Maintain' || prefs.source !== 'aiChef';
    if (section === 'plan') return daysData.length > 0;
    if (section === 'grocery') return grocery.checked.length > 0 || grocery.custom.length > 0;
    if (section === 'cookbook') return cookbook.recipes.length > 0;
    if (section === 'log') return Object.keys(foodLog.days).length > 0 || foodLog.favorites.length > 0;
    if (section === 'taste') return taste.events.length > 0 || !taste.on || Object.keys(taste.overrides.ingredients).length > 0;
    return chatHistory.length > 0;
}

function isEditingSettings() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest('#settingsList') && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
}

// Takes the PC's copy of a section. Returns false if it has to wait (e.g. the chef is replying).
function applyRemote(section, value) {
    if (section === 'settings') {
        if (!value || typeof value !== 'object') return true;
        for (const key of Object.keys(SETTINGS_DEFAULTS)) {
            if (SECRET_FIELDS.includes(key)) continue;   // keys never come back from the PC
            settings[key] = value[key] == null ? SETTINGS_DEFAULTS[key] : String(value[key]);
        }
        if (!availableProviders()[settings.active_provider]) settings.active_provider = 'lmstudio';
        secretsSet = value._secrets_set && typeof value._secrets_set === 'object' ? value._secrets_set : {};
        applyAppearance();
    } else if (section === 'prefs') {
        if (value && typeof value === 'object') prefs = Object.assign({ goal: 'Maintain', source: 'aiChef', likes: '', hates: '' }, value);
        if (!GOALS[prefs.goal]) prefs.goal = 'Maintain';
        syncChoiceButtons();
    } else if (section === 'plan') {
        const hadPlan = daysData.length > 0;
        daysData = normalizePlan(value, false);
        if (!hadPlan || selectedDay >= daysData.length) selectedDay = todayIndex();
    } else if (section === 'grocery') {
        grocery = cleanGrocery(value);
    } else if (section === 'chat') {
        if (chatBusy) return false;
        chatHistory = cleanChat(value);
    } else if (section === 'cookbook') {
        cookbook = cleanCookbook(value);
    } else if (section === 'log') {
        foodLog = NourishLog.clean(value);
    } else if (section === 'taste') {
        taste = NourishTaste.clean(value);
        tasteCache = null;
    }
    persistLocal(section);
    return true;
}

async function pushSection(section) {
    const meta = syncMeta[section];
    const ver = meta.ver;
    const sentSecrets = section === 'settings' ? SECRET_FIELDS.filter(k => settings[k]) : [];
    const res = await api(`/api/state/${section}`, { method: 'PUT', body: { value: sectionValue(section) }, timeoutMs: 15000 });
    meta.rev = res && res.rev || meta.rev;
    if (meta.ver === ver) meta.dirty = false;
    if (section === 'settings') {
        secretsSet = (res && res.value && res.value._secrets_set) || secretsSet;
        // The PC has the keys now; don't keep a copy on this device.
        for (const key of sentSecrets) {
            if (secretsSet[key]) { settings[key] = ''; secretEditing[key] = false; }
        }
        pendingClears = pendingClears.filter(k => !(res && res.value && res.value._secrets_set) || res.value._secrets_set[k]);
        persistLocal('settings');
    }
    saveSyncMeta();
}

async function syncNow() {
    if (isLocalMode()) return;   // phone-only: nothing to sync with
    if (location.protocol === 'file:' && backendOnline !== true) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    clearTimeout(syncTimer);
    const touched = [];
    try {
        const remote = await api('/api/state', { timeoutMs: 10000 }) || {};
        for (const section of SECTIONS) {
            const meta = syncMeta[section];
            const r = remote[section];
            try {
                if (meta.dirty) {
                    await pushSection(section);
                    if (section === 'settings') touched.push(section);
                } else if (!r) {
                    // The PC has nothing yet: give it what this device has.
                    if (hasLocalData(section)) await pushSection(section);
                } else if (r.rev > meta.rev) {
                    if (applyRemote(section, r.value)) { meta.rev = r.rev; touched.push(section); }
                } else if (r.rev < meta.rev) {
                    await pushSection(section);   // the PC's data file was reset; restore it from here
                }
            } catch (e) {
                // Nourish on the PC before 0.5.0 doesn't keep a cookbook: it stays on this device.
                if (section !== 'cookbook' || e.status !== 400) throw e;
                if (!meta.unsupported) nlog('sync', 'The Nourish on your PC is too old to keep the Cookbook; it stays on this device until the PC is updated', null, 'warn');
                meta.unsupported = true;
            }
        }
        saveSyncMeta();
        lastSynced = Date.now();
        syncFailed = false;
    } catch (e) {
        if (!syncFailed) nlog('sync', `Sync with the PC failed: ${e.message}`, null, 'warn');
        syncFailed = true;
    } finally {
        syncing = false;
    }
    if (touched.length) rerenderAfterSync(touched);
    updateSyncStatus();
    if (syncAgain) { syncAgain = false; syncNow(); }
}

function rerenderAfterSync(sections) {
    if (sections.includes('plan') || sections.includes('settings')) { updateTodayScreen(); updatePlanScreen(); }
    if (sections.includes('plan') || sections.includes('grocery') || sections.includes('settings')) updateGroceryScreen();
    if (sections.includes('chat') || sections.includes('settings')) renderChat();
    if (sections.includes('cookbook') && $('cookbookSheet').classList.contains('active')) renderCookbook();
    if (sections.includes('settings') || sections.includes('prefs')) {
        if (isEditingSettings()) settingsStale = true;
        else renderSettings();
    }
}

function syncStatusText() {
    if (isLocalMode()) return 'Off: Nourish is running on this phone only';
    if (location.protocol === 'file:') return 'Not synced (opened as a file)';
    if (SECTIONS.some(s => syncMeta[s].dirty)) return syncFailed ? 'Waiting for the PC… changes are saved here' : 'Saving to your PC…';
    if (syncFailed) return "Can't reach your PC right now";
    if (!lastSynced) return 'Checking…';
    const secs = Math.round((Date.now() - lastSynced) / 1000);
    return secs < 60 ? 'Up to date with your PC' : `Last synced ${Math.round(secs / 60)} min ago`;
}

function updateSyncStatus() {
    const el = $('syncStatus');
    if (el) el.textContent = syncStatusText();
}

// === APPEARANCE ===
// The look (theme.js works out every colour from the theme, background and accent, keeping text
// readable), font pairing, text size, bold text and icon style.
let lookNotes = [];
function applyAppearance() {
    const root = document.documentElement;
    const T = NourishTheme;
    const look = T.resolve(settings, !!(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches));
    lookNotes = look.notes;
    Object.entries(look.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.setAttribute('data-theme', look.mode);
    root.setAttribute('data-accent', ACCENTS[settings.accent] ? settings.accent : 'orange');
    root.setAttribute('data-text', T.TEXT_SIZES[settings.text_size] ? settings.text_size : 'default');
    root.setAttribute('data-font', T.FONTS[settings.font_pair] ? settings.font_pair : 'editorial');
    root.setAttribute('data-bold', on('bold_text') ? 'on' : 'off');
    root.setAttribute('data-icons', T.ICON_STYLES[settings.icon_style] ? settings.icon_style : 'outline');
    if (on('reduce_motion')) root.setAttribute('data-motion', 'reduced');
    else root.removeAttribute('data-motion');
    const light = look.mode === 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', look.bg);
    // Inside the phone apps, match the phone's status bar (clock, battery) to the theme.
    try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nourishTheme) {
            window.webkit.messageHandlers.nourishTheme.postMessage(light ? 'light' : 'dark');
        }
        if (window.NourishAndroid && window.NourishAndroid.setTheme) window.NourishAndroid.setTheme(light ? 'light' : 'dark');
    } catch (e) { /* older app without theme support */ }
}

// "Auto" follows the phone's own light/dark setting, including when it changes.
if (window.matchMedia) {
    const scheme = matchMedia('(prefers-color-scheme: light)');
    const follow = () => { if (NourishTheme.themeId(settings.theme) === 'auto') applyAppearance(); };
    if (scheme.addEventListener) scheme.addEventListener('change', follow);
    else if (scheme.addListener) scheme.addListener(follow);
}

// === DAYS ===
// Plan day 1 is Monday, Sunday or today, depending on Settings → Appearance → Plan starts on.
function dayBase() {
    if (settings.week_start === 'sunday') return 6;
    if (settings.week_start === 'today') return (new Date().getDay() + 6) % 7;
    return 0;
}
function dayName(i, short = false) {
    const name = DAY_NAMES[(dayBase() + i) % 7];
    return short ? name.slice(0, 3) : name;
}
function todayIndex() {
    const today = (new Date().getDay() + 6) % 7;
    const idx = (today - dayBase() + 7) % 7;
    return daysData.length ? Math.min(idx, daysData.length - 1) : 0;
}
function isToday(i) {
    return (dayBase() + i) % 7 === (new Date().getDay() + 6) % 7;
}

// === TAB NAVIGATION ===
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

function switchTab(tabName) {
    const settingsScreen = $('screenSettings');
    if (tabName === 'settings' && settingsScreen && settingsScreen.classList.contains('active') && settingsPage) {
        settingsPage = null;
        renderSettings();
    }
    const screenMap = { today: 'screenToday', plan: 'screenPlan', chat: 'screenChat', grocery: 'screenGrocery', settings: 'screenSettings' };
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
        t.setAttribute('aria-selected', t.dataset.tab === tabName);
    });
    const screen = $(screenMap[tabName]);
    if (screen) screen.classList.add('active');
    document.body.dataset.tab = tabName;
    if (tabName === 'chat') scrollChatToEnd();
    else window.scrollTo(0, 0);
}

// === FEEDBACK ===
// A light tap under the finger in the phone apps ("tap", "select", "success", "warning").
// Nothing happens in a browser, or with Reduce motion on.
function haptic(style = 'tap') {
    if (on('reduce_motion')) return;
    try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nourishHaptic) window.webkit.messageHandlers.nourishHaptic.postMessage(style);
        else if (window.NourishAndroid && window.NourishAndroid.haptic) window.NourishAndroid.haptic(style);
    } catch (e) { /* older app without haptics */ }
}
const HAPTIC_TARGETS = '.tab, .day-pill, .segment-btn, .switch, .swatch, .heart-btn, .filter-chip, .choice-row button, .grocery-item, .recipe-ingredient, .recipe-step, .source-btn, .btn-primary';
document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest(HAPTIC_TARGETS);
    if (el && !el.disabled) haptic(el.matches('.btn-primary') ? 'tap' : 'select');
}, true);

let toastTimer;
// Error messages in plain words: what happened and what to do next. Technical details (status
// codes, error class names) stay in Settings → Activity log.
const PLAIN_ERRORS = [
    [/(LM Studio|lmstudio).*(not reachable|ConnectError|refused)|not reachable at http:\/\/[^ ]*:1234/i, "Nourish can't reach LM Studio on your PC. Open LM Studio and start its server, or choose another AI in Settings → AI model."],
    [/Ollama.*(not reachable|ConnectError|refused)|not reachable at http:\/\/[^ ]*:11434/i, "Nourish can't reach Ollama on your PC. Start Ollama, or choose another AI in Settings → AI model."],
    [/(Claude|OpenAI|Anthropic)[^:]*returned 40[13]|invalid (x-)?api[ -]key|incorrect api key|authentication_error/i, "The AI service didn't accept your key. Check it in Settings → AI model."],
    [/Spoonacular[^:]*returned (402|429)|points limit/i, "Spoonacular's free daily limit is used up. Plans still work with the other recipe sources; it resets tomorrow."],
    [/Spoonacular[^:]*returned 401/i, "Spoonacular didn't accept the key. Check it in Settings → Advanced → Recipe sources & keys."],
    [/(Claude|OpenAI|Anthropic)[^:]*returned 402|credit balance|insufficient_quota|billing/i, 'Your AI account is out of credit. Top it up, or choose another AI in Settings → AI model.'],
    [/(page|site) returned (HTTP )?404|returned 404/i, "That page wasn't found. Check the link and try again."],
    [/(page|site) returned (HTTP )?(401|403)/i, "That website didn't let Nourish read the page. Try pasting the recipe text or a screenshot instead."],
    [/returned 429|rate.?limit|too many requests/i, 'That service is busy right now (too many requests). Wait a minute and try again.'],
    [/returned 5\d\d|overloaded|service unavailable|bad gateway/i, 'That service is having problems right now. Try again in a few minutes.'],
    [/failed to fetch|networkerror|load failed|network connection was lost|ConnectError|ConnectTimeout|ReadTimeout|timed out|not reachable/i, "Nourish couldn't connect. Check your internet connection (and, if you use the PC app, that it's running), then try again."],
];
function plainError(message) {
    const text = String(message || '');
    for (const [re, plain] of PLAIN_ERRORS) if (re.test(text)) return plain;
    // Whatever else: keep the words, drop codes and class names.
    return text.replace(/\s*\((?:[A-Z][a-zA-Z]+Error|[A-Z][a-zA-Z]+Exception|HTTP \d{3})\)/g, '').replace(/\breturned (\d{3}):?\s*/g, 'said no (error $1): ');
}

function showToast(message, isError = true) {
    haptic(isError ? 'warning' : 'success');
    const toast = $('toast');
    if (isError && message !== plainError(message)) nlog('app', `Shown as plain words: ${message}`, null, 'debug');
    toast.textContent = isError ? plainError(message) : message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 1800);
}

function showBanner(message) {
    const banner = $('offlineBanner');
    banner.textContent = message || '';
    banner.hidden = !message;
}

// Status bar for meal-plan work. Errors stay until dismissed so they can't be missed.
let jobBarTimer;
let jobBarState = null;
let jobBarMessage = '';
function showJobBar(state, message) {
    const bar = $('jobBar');
    clearInterval(jobBarTimer);
    bar.hidden = !state;
    bar.className = 'job-bar' + (state === 'error' ? ' error' : '');
    jobBarState = state || null;
    if (state === 'error') {
        // Keep the lead-in ("Couldn't make the plan:") and put the reason in plain words.
        const m = String(message || '').match(/^([^:]{0,40}:)\s*(.*)$/);
        message = m ? `${m[1]} ${plainError(m[2])}` : plainError(message);
    }
    jobBarMessage = message || '';
    document.documentElement.toggleAttribute('data-working', false);
    if (state === 'busy' && planJob && planJob.local) document.documentElement.setAttribute('data-working', 'local');
    refreshCooking();
    if (!state) return;
    const text = h('span', { class: 'job-bar-text', text: message });
    if (state === 'busy') {
        const started = (planJob && planJob.started) || Date.now();
        const tick = () => { text.textContent = `${message} ${formatElapsed((Date.now() - started) / 1000)}`; };
        tick();
        jobBarTimer = setInterval(tick, 1000);
        setChildren(bar, h('span', { class: 'job-bar-spinner', 'aria-hidden': 'true' }), text,
            planJob ? h('button', { type: 'button', class: 'job-bar-btn', onclick: cancelPlan }, 'Cancel') : null);
    } else {
        setChildren(bar, text, h('button', { type: 'button', class: 'job-bar-btn', onclick: () => showJobBar(null) }, 'Dismiss'));
    }
}

// === API ===
async function api(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
    if (isLocalMode()) return localApi(path, { method, body });
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(API_BASE + path, {
            method,
            cache: 'no-store',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch (e) {
        nlog('server', `${method} ${path} failed: ${e.name === 'AbortError' ? 'timed out' : e.message}`, null, 'warn');
        if (e.name === 'AbortError') throw new Error('The server took too long to answer. Try again.');
        if (backendOnline !== false) { backendOnline = false; updateBackendStatus(); }
        throw new Error("Can't reach the Nourish server. Is it running on your PC?");
    } finally {
        clearTimeout(timer);
    }
    if (backendOnline !== true) { backendOnline = true; updateBackendStatus(); backendCameBack(); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (path.indexOf('/api/jobs/') !== 0 || !res.ok) nlog('server', `${method} ${path} → ${res.status} (${Date.now() - started} ms)`, res.ok ? null : data, res.ok ? 'debug' : 'warn');
    if (!res.ok) {
        const err = new Error(data && typeof data.detail === 'string' ? data.detail : `Server error ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

async function checkBackend() {
    // A slow phone can still be busy loading the app when the PC answers: a generous wait, and one
    // more try, before saying the PC can't be reached.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const data = await api('/health', { timeoutMs: attempt ? 15000 : 10000 });
            backendOnline = !!data && data.status === 'ok';
        } catch (e) {
            backendOnline = false;
        }
        if (backendOnline) break;
    }
    updateBackendStatus();
    return backendOnline;
}

function updateBackendStatus() {
    if (location.protocol === 'file:') return;
    showBanner(backendOnline === false ? "Can't reach the Nourish server. Your saved plan still works; the AI needs the server." : '');
    const summary = $('settingsSummary-server');
    if (summary) summary.textContent = settingsSummary('server');
    const status = $('serverStatus');
    if (status) status.textContent = backendOnline ? 'Connected' : backendOnline === false ? 'Not reachable' : 'Checking…';
    updateSyncStatus();
}

// The PC answered after it had looked unreachable (a slow start, Wi-Fi back): catch up on what
// start-up skipped, once.
let catchingUp = false;
function backendCameBack() {
    if (serverInfo || catchingUp || isLocalMode()) return;
    catchingUp = true;
    setTimeout(() => {
        syncNow().catch(() => {}).then(() => loadServerInfo()).catch(() => {}).then(() => { catchingUp = false; });
    }, 0);
}

async function loadServerInfo() {
    try { serverInfo = await api('/api/info', { timeoutMs: 5000 }); } catch (e) { serverInfo = null; }
    renderServerInfo();
    renderModelHint();
    if (!settingsPage) renderSettings();
    maybeAutoCheckForUpdates();
}

// === UPDATES ===
function maybeAutoCheckForUpdates() {
    if (!on('auto_update_check')) return;
    const last = Number(load('nourish_last_update_check', '0'));
    if (Date.now() - last < 12 * 60 * 60 * 1000) {
        updateInfo = loadJSON('nourish_last_update_info', null);
        // Ignore a cached result for the version that is now installed.
        if (updateInfo && serverInfo && serverInfo.version && updateInfo.latest === serverInfo.version) updateInfo = null;
        markUpdateBadge();
        return;
    }
    checkForUpdates({ manual: false });
}

async function checkForUpdates({ manual }) {
    if (updateChecking) return;
    updateChecking = true;
    updateError = '';
    renderUpdateResult();
    try {
        updateInfo = await api(`/api/update/check?prereleases=${on('update_prereleases')}`, { timeoutMs: 20000 });
        store('nourish_last_update_check', String(Date.now()));
        store('nourish_last_update_info', updateInfo);
        if (!manual && updateInfo && updateInfo.update_available) showToast(`Nourish v${updateInfo.latest} is available — see Settings → Updates`, false);
    } catch (e) {
        updateError = e.message;
    } finally {
        updateChecking = false;
        markUpdateBadge();
        renderUpdateResult();
        if (!settingsPage) renderSettings();
    }
}

function markUpdateBadge() {
    const tab = document.querySelector('.tab[data-tab="settings"]');
    if (tab) tab.classList.toggle('has-badge', !!(updateInfo && updateInfo.update_available));
}

function renderUpdateResult() {
    const box = $('updateResult');
    if (!box) return;
    if (updateChecking) { setChildren(box, h('p', { class: 'settings-note', text: 'Checking GitHub for a newer version…' })); return; }
    if (updateError) { setChildren(box, h('div', { class: 'chat-error' }, h('p', { text: updateError }))); return; }
    if (!updateInfo) { setChildren(box); return; }
    if (!updateInfo.update_available) {
        setChildren(box, h('p', { class: 'settings-note', text: `✓ You're up to date (v${updateInfo.current || (serverInfo && serverInfo.version) || '?'}).` }));
        return;
    }
    setChildren(box,
        h('div', { class: 'settings-group-label', text: `Version ${updateInfo.latest} is available` }),
        h('div', { class: 'settings-group' },
            updateInfo.notes ? h('div', { class: 'settings-row settings-row-stack' }, formatMessage(updateInfo.notes.slice(0, 1500))) : null,
            updateInfo.can_install
                ? h('button', { type: 'button', class: 'settings-row settings-button', id: 'installUpdateBtn', onclick: installUpdate }, 'Download & install')
                : null,
            updateInfo.url ? h('a', { class: 'settings-row settings-button', href: updateInfo.url, target: '_blank', rel: 'noopener' }, 'Open the download page') : null),
        h('p', { class: 'settings-note', text: updateInfo.can_install
            ? 'Nourish downloads the update, checks it against GitHub\'s fingerprint, installs it and restarts by itself. Your plan and settings are kept.'
            : isLocalMode()
                ? 'Download the new app from the release page and install it the same way as before. Your plan, settings and models are kept.'
            : serverInfo && serverInfo.can_self_update
                ? 'The download for this version isn\'t ready yet (GitHub is still building it). Try "Check now" again in a few minutes.'
                : 'This copy (Python or Docker) can\'t update itself: pull the latest code, or switch to Nourish.exe for one-tap updates.' }));
}

async function installUpdate(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    const from = serverInfo && serverInfo.version;
    try {
        await api('/api/update/install', { method: 'POST', timeoutMs: 5 * 60 * 1000 });
    } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Download & install';
        showJobBar('error', `Update failed: ${err.message}`);
        return;
    }
    showJobBar('busy', 'Installing the update and restarting…');
    // Wait for the new version to answer, then reload so the new app loads.
    const deadline = Date.now() + 120000;
    await sleep(3000);
    while (Date.now() < deadline) {
        try {
            const info = await api('/api/info', { timeoutMs: 3000 });
            if (info && info.version && info.version !== from) {
                unstore('nourish_last_update_info');
                location.reload();
                return;
            }
        } catch (err) { /* restarting */ }
        await sleep(2000);
    }
    showJobBar('error', 'The update was installed but Nourish didn\'t come back. Start Nourish.exe again.');
}

// === AI REQUESTS (run as server-side jobs so a locked phone or a slow model can't lose them) ===
async function startJob(body) {
    const res = await api('/api/jobs', { method: 'POST', body });
    return res.job_id;
}

async function waitForJob(id) {
    const deadline = Date.now() + 20 * 60 * 1000;
    let misses = 0;
    while (Date.now() < deadline) {
        await sleep(1500);
        let job;
        try {
            job = await api(`/api/jobs/${id}`, { timeoutMs: 10000 });
            misses = 0;
        } catch (e) {
            if (e.status === 404 || ++misses > 60) throw e; // server restarted, or ~2+ minutes without contact
            continue;
        }
        if (job && job.status === 'done') return job.result;
        if (job && job.status === 'error') {
            const err = new Error(job.detail || 'The AI request failed');
            err.cancelled = job.status_code === 499;
            throw err;
        }
    }
    throw new Error('Gave up after waiting 20 minutes for the AI.');
}

async function fetchModels(provider) {
    try {
        const data = await api(`/api/models?provider=${provider}`, { timeoutMs: 8000 });
        const models = ((data && data.data) || []).map(m => m && m.id).filter(id => id && !/embed/i.test(id));
        modelLists[provider] = { models, error: '' };
    } catch (e) {
        modelLists[provider] = { models: [], error: e.message };
    }
    return modelLists[provider];
}

async function buildAIRequest(messages, { maxTokens } = {}) {
    const p = settings.active_provider;
    let model = settings[`${p}_model`];
    if (p === 'local' && !model) throw new Error('Download a model first: Settings → AI model.');
    if (!model && (p === 'lmstudio' || p === 'ollama')) {
        const list = await fetchModels(p);
        if (list.error) throw new Error(list.error);
        model = list.models[0];
        if (!model) throw new Error(p === 'lmstudio'
            ? 'No model loaded in LM Studio. Open LM Studio, load a model and start the server.'
            : 'Ollama has no models. Run "ollama pull llama3.2" on your PC.');
    }
    if (!model) throw new Error('Pick a model in Settings first.');
    if ((p === 'claude' || p === 'openai') && !settings[`${p}_api_key`] && (isLocalMode() || !secretsSet[`${p}_api_key`])) {
        throw new Error(`Add your ${PROVIDERS[p]} API key in Settings → AI model first.`);
    }
    return {
        provider: p,
        model,
        // Only sent when this device has a key that isn't on the PC yet; otherwise the PC uses its saved key.
        api_key: (p === 'claude' || p === 'openai') && settings[`${p}_api_key`] ? settings[`${p}_api_key`] : undefined,
        messages,
        max_tokens: maxTokens != null ? maxTokens : (Number(settings.max_tokens) || 8000),
        temperature: Number(settings.temperature),
    };
}

function extractText(provider, data) {
    const text = provider === 'claude'
        ? ((data && data.content) || []).filter(b => b && b.type === 'text').map(b => b.text).join('')
        : (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    // Some models "think out loud" in <think> tags first; only the answer matters.
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// === PROFILE → PROMPTS ===
// forRecipe: for an AI writing a recipe, the person's name is left out (a small model would use it
// as the dish's name: "Lunch for Jeff").
function profileText({ forRecipe = false } = {}) {
    const s = settings;
    const lines = [];
    if (s.name && !forRecipe) lines.push(`Name: ${s.name}.`);
    lines.push(`Goal: ${GOALS[prefs.goal] || prefs.goal}.`, `Daily targets: about ${s.calorie_target} kcal and ${s.protein_target} g protein.`);
    if (s.diet && s.diet !== 'No restriction') lines.push(`Diet: ${s.diet}.`);
    if (s.allergies) lines.push(`Allergies/intolerances (NEVER include these): ${s.allergies}.`);
    if (prefs.likes) lines.push(`Foods they like: ${prefs.likes}.`);
    if (prefs.hates) lines.push(`Foods they avoid: ${prefs.hates}.`);
    if (s.cuisines) lines.push(`Favourite cuisines: ${s.cuisines}.`);
    if (s.max_cook_time) lines.push(`Every meal must be ready in ${s.max_cook_time} minutes or less.`);
    if (Number(s.servings) > 1) lines.push(`Cooking for ${s.servings} people: ingredient quantities for ${s.servings} servings; nutrition per person.`);
    lines.push(`Cooking skill: ${s.skill}.`);
    if (s.budget !== 'Any') lines.push(`Budget: ${s.budget}.`);
    lines.push(`Use ${unitSystem() === 'metric' ? 'metric units (g, ml, °C)' : 'US units (cups, oz, lb, °F)'}.`);
    return lines.join('\n');
}

function planSummary(withCalories = false) {
    if (!daysData.length) return 'They have no meal plan yet.';
    return `Their current meal plan (today is Day ${todayIndex() + 1}):\n` + daysData.map((d, i) =>
        `Day ${i + 1} (${dayName(i)}): ` + MEAL_TYPES.map(t => {
            if (!d[t]) return `${MEAL_LABELS[t]}: (empty)`;
            const cal = withCalories && d[t].nutrition && Number.isFinite(d[t].nutrition.calories) ? ` ~${Math.round(d[t].nutrition.calories)} kcal` : '';
            return `${MEAL_LABELS[t]}: ${d[t].name}${cal}`;
        }).join('; ')).join('\n');
}

// Plans are made one meal at a time (mealSystem and recipeRules in ondevice.js); this prompt is kept
// with a saved plan as its context (the chat part of it is used).

function planSystemPrompt() {
    return 'You are a meal-planning chef. Return ONLY raw JSON, no markdown, no comments. ' +
        'Write out all 7 days in full, with varied meals (do not repeat a dish more than twice in the week). ' +
        recipeRules(servingsWanted()) + '\n' +
        `Format: {"days":[{"day":1,"breakfast":${mealFormat(servingsWanted())},"lunch":{same},"dinner":{same}}]}` +
        '\n\nThe person you are planning for:\n' + profileText();
}

function editSystemPrompt() {
    return 'You are a meal-planning chef editing an existing 7-day plan. Return ONLY raw JSON, no markdown, no comments. ' +
        'Change only the meals the person asks about; leave everything else out of your answer. ' +
        'Days are numbered 1-7 as listed below; "today", "tomorrow" and weekday names refer to those days. ' +
        'Change at most 2 meals per answer. For each changed meal: ' + recipeRules(servingsWanted()) + '\n' +
        `Format: {"changes":[{"day":1,"meal":"breakfast|lunch|dinner","recipe":${mealFormat(servingsWanted())}}]}` +
        '\n\nThe person:\n' + profileText() + '\n\n' + planSummary(true);
}

const CHEF_STYLES = {
    friendly: 'Be warm, encouraging and practical.',
    concise: 'Be brief and to the point: short answers, no small talk.',
    coach: 'Act like a supportive nutrition coach: explain the why behind suggestions, mention protein and balance.',
    playful: 'Be fun and upbeat, with the odd food pun, while staying useful.',
};

function chatSystemPrompt() {
    const actions = on('chat_actions')
        ? 'The app can act on requests: when they ask you to make a plan, or to swap or change specific meals, it does it automatically. ' +
          'Otherwise, when they seem happy with an idea, tell them they can say "make me a plan" or tap "Make plan".'
        : 'When they are happy, tell them they can tap "Make plan" to turn this conversation into their 7-day plan.';
    return 'You are Nourish, a chef and nutrition coach inside a meal-planning app. ' + (CHEF_STYLES[settings.chef_style] || CHEF_STYLES.friendly) + ' ' +
        'Help the person shape meals that suit them: ask a short follow-up question when something important is unclear, ' +
        'suggest specific dishes, and keep answers readable (short paragraphs or bullet lists). Do not output JSON. ' +
        actions + ' You are not a doctor; for medical conditions suggest they check with a professional.\n\n' +
        'About them:\n' + profileText() + '\n\n' + planSummary();
}

// Claude needs strictly alternating user/assistant turns that start with the user.
function cleanHistory(messages) {
    const out = [];
    for (const m of messages) {
        if (!out.length && m.role !== 'user') continue;
        if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += '\n\n' + m.content;
        else out.push({ role: m.role, content: m.content });
    }
    return out;
}

// === SETTINGS: CONTROLS ===
function setSetting(key, value, { quiet = false } = {}) {
    settings[key] = String(value);
    changed('settings');
    if (!quiet) showToast('Saved ✓', false);
    if (APPEARANCE_KEYS.includes(key)) { applyAppearance(); if (settingsPage === 'appearance') refreshLookPreview(); }
    if (key === 'today_stats') updateTodayScreen();
    if (['calorie_target', 'protein_target', 'week_start', 'show_nutrition', 'name'].includes(key)) { updateTodayScreen(); updatePlanScreen(); }
    if (key === 'grocery_hide_checked') updateGroceryScreen();
    if (key === 'units') refreshUnits();
}

// Imperial (US) or metric. The phone's measurement system decides until it's changed in Settings.
// Before 0.4.8 the profile had its own Units setting ('US' by default, or 'Metric'); it is read the same way.
function unitSystem() {
    if (settings.units === 'imperial' || settings.units === 'metric') return settings.units;
    if (settings.units === 'Metric') return 'metric';
    const phone = typeof specsCache !== 'undefined' && specsCache && specsCache.measurement;
    if (phone === 'imperial' || phone === 'metric') return phone;
    return NourishUnits.defaultSystem((navigator.languages && navigator.languages[0]) || navigator.language);
}

// Plans keep the AI's own amounts; switching units only redraws.
function refreshUnits() {
    updateGroceryScreen();
    if (openRecipe && $('recipeSheet').classList.contains('active')) openRecipeSheet(openRecipe.mealType, openRecipe.meal, openRecipe.dayIndex);
}

function setPref(key, value) {
    prefs[key] = value;
    changed('prefs');
}

function settingsRow(label, control, { hint, tag = 'label' } = {}) {
    return h(tag, { class: 'settings-row' },
        h('span', { class: 'settings-label' }, label, hint ? h('span', { class: 'settings-hint', text: hint }) : null),
        control);
}

// A text/number box. get/set let it edit a setting or a preference.
function textInput(get, set, { type = 'text', placeholder = '', inputmode, min, max, list, label } = {}) {
    return h('input', {
        type, placeholder, value: get(), inputmode, min, max, list, 'aria-label': label,
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'settings-input',
        onchange: e => {
            let v = e.target.value.trim();
            if (type === 'number' && v !== '') {
                v = String(Math.min(Math.max(Number(v) || Number(min) || 0, Number(min == null ? -Infinity : min)), Number(max == null ? Infinity : max)));
                e.target.value = v;
            }
            set(v);
        },
        onblur: () => { if (settingsStale) setTimeout(() => { if (!isEditingSettings() && settingsStale) { settingsStale = false; renderSettings(); } }, 0); },
    });
}

function settingsInput(key, opts = {}) {
    return textInput(() => settings[key], v => setSetting(key, v), opts);
}

function selectInput(current, options, onchange, label) {
    const entries = Array.isArray(options) ? options.map(o => [o, o]) : Object.entries(options);
    return h('select', { class: 'settings-input', 'aria-label': label, onchange: e => onchange(e.target.value) },
        entries.map(([value, text]) => h('option', { value, selected: value === current }, text)));
}

function settingsSelect(key, options, { onchange } = {}) {
    return selectInput(settings[key], options, v => { setSetting(key, v); if (onchange) onchange(v); });
}

function settingsToggle(key, label, { hint, onchange } = {}) {
    const state = on(key);
    return h('button', {
        type: 'button', class: 'settings-row settings-nav switch-row', role: 'switch', 'aria-checked': String(state),
        onclick: e => {
            const next = !on(key);
            setSetting(key, next ? 'on' : 'off', { quiet: true });
            e.currentTarget.setAttribute('aria-checked', String(next));
            e.currentTarget.querySelector('.switch').setAttribute('aria-checked', String(next));
            if (onchange) onchange(next);
        },
    },
        h('span', { class: 'settings-label' }, label, hint ? h('span', { class: 'settings-hint', text: hint }) : null),
        h('span', { class: 'switch', 'aria-checked': String(state), 'aria-hidden': 'true' }));
}

// A row of 2–4 buttons where one is picked (theme, text size…).
function settingsChoice(label, current, options, onpick) {
    const entries = Object.entries(options);
    const row = h('div', { class: 'choice-row', role: 'radiogroup', 'aria-label': label, style: `grid-template-columns: repeat(${entries.length}, 1fr)` },
        entries.map(([value, text]) => h('button', {
            type: 'button', role: 'radio', class: value === current ? 'active' : null, 'aria-checked': String(value === current),
            onclick: e => {
                row.querySelectorAll('button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
                e.currentTarget.classList.add('active');
                e.currentTarget.setAttribute('aria-checked', 'true');
                onpick(value);
            },
        }, text)));
    return h('div', { class: 'settings-row settings-row-stack' }, h('span', { class: 'settings-label', text: label }), row);
}

// A switch for one of breakfast, lunch and dinner in new plans (at least one stays on).
function mealSlotToggle(meal) {
    const list = () => String(settings.meal_slots || 'breakfast,lunch,dinner').split(',').filter(Boolean);
    const isOn = () => list().includes(meal);
    return h('button', {
        type: 'button', class: 'settings-row settings-nav switch-row', role: 'switch', 'aria-checked': String(isOn()),
        onclick: e => {
            const next = isOn() ? list().filter(m => m !== meal) : list().concat([meal]);
            if (!next.length) { showToast('Keep at least one meal'); return; }
            setSetting('meal_slots', MEAL_TYPES.filter(m => next.includes(m)).join(','), { quiet: true });
            e.currentTarget.setAttribute('aria-checked', String(isOn()));
            e.currentTarget.querySelector('.switch').setAttribute('aria-checked', String(isOn()));
        },
    }, h('span', { class: 'settings-label', text: MEAL_LABELS[meal] }), h('span', { class: 'switch', 'aria-checked': String(isOn()), 'aria-hidden': 'true' }));
}

// === APPEARANCE ===
const APPEARANCE_KEYS = ['theme', 'bg', 'custom_bg', 'accent', 'custom_accent', 'font_pair', 'text_size', 'bold_text', 'icon_style', 'reduce_motion'];
let lookSnapshot = null;   // the look when Appearance was opened, for "Undo"

// A small live picture of the app in the current look, at the top of Appearance.
function lookPreview() {
    return h('div', { class: 'look-preview', id: 'lookPreview', 'aria-hidden': 'true' },
        h('div', { class: 'look-preview-head' },
            h('div', {}, h('div', { class: 'eyebrow', text: 'Preview' }), h('div', { class: 'look-preview-title', text: 'Good morning' })),
            h('span', { class: 'look-preview-btn' }, icon('i-sparkle'))),
        h('div', { class: 'look-preview-body' },
            h('div', { class: 'look-preview-ring' }, h('span', { class: 'num', text: '1,250' }), h('small', { text: 'of 1,800 kcal' })),
            h('div', { class: 'look-preview-macros' }, [['Protein', 'protein', 72], ['Carbs', 'carbs', 55], ['Fat', 'fat', 40]].map(([l, c, w]) =>
                h('div', {}, h('div', { class: 'look-preview-macro' }, h('span', { text: l }), h('span', { class: 'num', text: `${Math.round(w * 1.4)} g` })),
                    h('div', { class: 'macro-track' }, h('div', { class: `macro-fill macro-${c}`, style: `width:${w}%` })))))),
        h('div', { class: 'look-preview-meal' },
            h('span', { class: 'meal-art art-lunch' }, icon('i-sun')),
            h('span', {}, h('span', { class: 'meal-type', text: 'Lunch' }), h('span', { class: 'meal-name', text: 'Lemon Chickpea Salad' }),
                h('span', { class: 'chip' }, icon('i-flame'), h('span', { class: 'num', text: '450 kcal' })))),
        h('div', { class: 'look-preview-actions' }, h('span', { class: 'btn btn-primary' }, icon('i-plus'), 'Add food'), h('span', { class: 'btn btn-secondary' }, icon('i-swap'), 'Swap')));
}
function refreshLookPreview() { const el = $('lookPreview'); if (el) el.replaceWith(lookPreview()); }

function statToggle(key, label) {
    const list = () => String(settings.today_stats || '').split(',').filter(Boolean);
    const isOn = () => list().includes(key);
    return h('button', {
        type: 'button', class: 'settings-row settings-nav switch-row', role: 'switch', 'aria-checked': String(isOn()),
        onclick: e => {
            const next = isOn() ? list().filter(k => k !== key) : list().concat([key]);
            setSetting('today_stats', ['protein_g', 'carbs_g', 'fat_g'].filter(k => next.includes(k)).join(','), { quiet: true });
            e.currentTarget.setAttribute('aria-checked', String(isOn()));
            e.currentTarget.querySelector('.switch').setAttribute('aria-checked', String(isOn()));
        },
    }, h('span', { class: 'settings-label', text: label }), h('span', { class: 'switch', 'aria-checked': String(isOn()), 'aria-hidden': 'true' }));
}

// A colour picker row (Advanced): picking a colour previews it at once; "Clear" goes back to the preset.
function colorRow(label, key, value, hint) {
    const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
    return h('label', { class: 'settings-row color-row' },
        h('span', { class: 'settings-label' }, label, h('span', { class: 'settings-hint', text: settings[key] ? 'Custom' : hint })),
        settings[key] ? h('button', { type: 'button', class: 'link-btn', onclick: e => { e.preventDefault(); setSetting(key, '', { quiet: true }); if (key === 'custom_accent' && settings.accent === 'custom') setSetting('accent', 'orange', { quiet: true }); renderSettings(); } }, 'Clear') : null,
        h('input', { type: 'color', value: hex, 'aria-label': label,
            oninput: e => { settings[key] = e.target.value; if (key === 'custom_accent') settings.accent = 'custom'; applyAppearance(); refreshLookPreview(); },
            onchange: e => { setSetting(key, e.target.value, { quiet: true }); if (key === 'custom_accent') setSetting('accent', 'custom', { quiet: true }); renderSettings(); } }));
}

// The home screen icon (phone apps only: iOS alternate icons, Android launcher aliases).
async function setAppIcon(id, { quiet = false } = {}) {
    setSetting('app_icon', id, { quiet: true });
    if (isLocalMode() && nativeAvailable()) {
        try { await nativeCall('appIcon', { name: id }); if (!quiet) showToast('App icon changed', false); }
        catch (e) { if (!quiet) showToast(`Couldn't change the app icon: ${e.message}`); }
    }
    if (settingsPage === 'appearance') renderSettings();
}

function settingsButton(text, onclick, cls = '') {
    return h('button', { type: 'button', class: `settings-row settings-button ${cls}`, onclick }, text);
}

function infoRow(label, value, id) {
    return h('div', { class: 'settings-row' }, h('span', { class: 'settings-label', text: label }), h('span', { class: 'settings-value', id, text: value }));
}

// API keys: saved on the PC, never shown again. Typing a new one replaces it.
function secretRow(field, label, placeholder) {
    const savedOnPc = secretsSet[field] && !settings[field] && !pendingClears.includes(field);
    if (savedOnPc && !secretEditing[field]) {
        return h('div', { class: 'settings-row' },
            h('span', { class: 'settings-label' }, label, h('span', { class: 'settings-hint', text: 'Saved on your PC ✓' })),
            h('span', { class: 'header-actions' },
                h('button', { type: 'button', class: 'link-btn', onclick: () => { secretEditing[field] = true; renderSettings(); } }, 'Change'),
                h('button', { type: 'button', class: 'link-btn', style: 'color: var(--danger)', onclick: () => {
                    if (!confirm(`Remove the saved ${label}?`)) return;
                    pendingClears = pendingClears.concat([field]);
                    secretsSet = Object.assign({}, secretsSet, { [field]: false });
                    settings[field] = '';
                    changed('settings');
                    renderSettings();
                    showToast('Key removed', false);
                } }, 'Remove')));
    }
    return settingsRow(label, textInput(() => settings[field], v => {
        settings[field] = v;
        pendingClears = pendingClears.filter(k => k !== field);
        changed('settings');
        showToast(v ? 'Saved ✓ (sent to your PC)' : 'Saved ✓', false);
    }, { type: 'password', placeholder, label }));
}

function temperatureLabel(t) {
    return `${Number(t).toFixed(1)} · ${t <= 0.3 ? 'focused' : t <= 0.8 ? 'balanced' : 'adventurous'}`;
}

// === SETTINGS: PAGES ===
const SETTINGS_PAGES = {
    appearance: { icon: 'i-palette', color: '#C07A9B', title: 'Appearance' },
    ai: { icon: 'i-sparkle', color: '#8A79C9', title: 'AI model' },
    chat: { icon: 'i-chat', color: '#6FA77A', title: 'Chat' },
    profile: { icon: 'i-user', color: '#D9893A', title: 'Your profile' },
    schedule: { icon: 'i-clock', color: '#C2964A', title: 'My schedule' },
    learned: { icon: 'i-sparkle', color: '#B07CC6', title: 'What Nourish has learned' },
    sources: { icon: 'i-book', color: '#C9675A', title: 'Recipes' },
    advanced: { icon: 'i-gear', color: '#6E7F8E', title: 'Recipe sources & keys' },
    grocery: { icon: 'i-cart', color: '#4E9E92', title: 'Grocery list' },
    server: { icon: 'i-server', color: '#7C8A96', title: 'Server & devices' },
    updates: { icon: 'i-update', color: '#5B8DBE', title: 'Updates' },
    data: { icon: 'i-shield', color: '#8B7E6E', title: 'Data & privacy' },
    logs: { icon: 'i-list', color: '#6E6862', title: 'Activity log' },
};
const SETTINGS_GROUPS = [['appearance', 'chat'], ['profile', 'schedule', 'learned', 'sources', 'grocery'], ['advanced', 'ai', 'server'], ['updates', 'data', 'logs']];
const SETTINGS_GROUP_TITLES = ['', '', 'Advanced', ''];

function settingsSummary(page) {
    const s = settings;
    switch (page) {
        case 'appearance': {
            const id = NourishTheme.themeId(s.theme);
            return `${id === 'auto' ? 'Auto' : NourishTheme.THEMES[id].name} · ${s.accent === 'custom' ? 'Custom' : (NourishTheme.ACCENTS[s.accent] || NourishTheme.ACCENTS.orange).name}`;
        }
        case 'ai': return s.active_provider === 'local'
            ? `This phone · ${s.local_model ? s.local_model.replace(/\.gguf$/i, '').replace(/-Q\d.*$/i, '') : 'no model yet'}`
            : `${PROVIDERS[s.active_provider].replace(' (local)', '')} · ${s[`${s.active_provider}_model`] || 'auto'}`;
        case 'chat': return `${s.chef_style.charAt(0).toUpperCase() + s.chef_style.slice(1)} · ${on('chat_actions') ? 'can edit plan' : 'chat only'}`;
        case 'profile': return `${s.calorie_target} kcal · ${s.diet === 'No restriction' ? 'any diet' : s.diet}`;
        case 'learned': return !taste.on ? 'Off' : taste.events.length ? `${taste.events.length} thing${taste.events.length > 1 ? 's' : ''} noted` : 'Nothing yet';
        case 'schedule': return ['breakfast', 'lunch', 'dinner'].map(m => SCHEDULE_SHORT[scheduleValue(m)] || '').join(' · ');
        case 'sources': return libraryState.count ? `${libraryState.count} of your own` : 'Automatic';
        case 'advanced': {
            const off = String(s.sources_off || '').split(',').filter(Boolean).length;
            return s.plan_source === 'ai' ? 'AI writes every meal' : off ? `${off} switched off` : 'All on';
        }
        case 'grocery': return grocery.custom.length ? `${grocery.custom.length} added by you` : '';
        case 'logs': {
            const errors = activityLog.filter(e => e.level === 'error' && Date.now() - e.t < 864e5).length;
            return errors ? `${errors} error${errors === 1 ? '' : 's'} today` : `${activityLog.length} entries`;
        }
        case 'server': return isLocalMode() ? 'This phone only' : backendOnline ? 'Connected' : backendOnline === false ? 'Not reachable' : '';
        case 'updates': return updateInfo && updateInfo.update_available ? `v${updateInfo.latest} available` : serverInfo ? `v${serverInfo.version}` : '';
        default: return '';
    }
}

function openSettingsPage(page) {
    if (page !== 'appearance') lookSnapshot = null;
    settingsPage = page;
    if (page === 'sources') indexLibrary();
    renderSettings();
    window.scrollTo(0, 0);
}

const USDA_CREDIT = 'Nutrition is calculated with data from USDA FoodData Central (U.S. Department of Agriculture, public domain), and Open Food Facts when online.';

// A one-line explanation plus a "What is this?" note that opens for people who want to know more.
function help(line, more) {
    return h('span', {}, line, ' ', h('details', { class: 'settings-help' }, h('summary', { text: 'What is this?' }), h('span', { text: more })));
}

function settingsGroup(title, rows, note) {
    return [
        title ? h('div', { class: 'settings-group-label', text: title }) : null,
        h('div', { class: 'settings-group' }, rows),
        note ? h('p', { class: 'settings-note' }, note) : null,
    ];
}

function renderSettings() {
    const list = $('settingsList');
    if (!list) return;
    settingsStale = false;
    const page = SETTINGS_PAGES[settingsPage] ? settingsPage : null;
    $('settingsTitle').textContent = page ? SETTINGS_PAGES[page].title : 'Settings';
    $('settingsBack').hidden = !page;

    if (!page) {
        const goalText = GOALS[prefs.goal] || prefs.goal;
        setChildren(list,
            h('div', { class: 'settings-group' },
                h('button', { type: 'button', class: 'settings-nav profile-card', onclick: () => openSettingsPage('profile') },
                    h('span', { class: 'profile-avatar', 'aria-hidden': 'true', text: settings.name ? settings.name.trim().charAt(0).toUpperCase() : '' },
                        settings.name ? null : icon('i-user')),
                    h('span', { class: 'settings-label' },
                        h('div', { class: 'title', text: settings.name || 'Set up your profile' }),
                        h('div', { class: 'text-dim', text: `${goalText} · ${settings.calorie_target} kcal · ${settings.diet === 'No restriction' ? 'any diet' : settings.diet}` })),
                    icon('i-chevron', 'chev'))),
            SETTINGS_GROUPS.map((group, gi) => [SETTINGS_GROUP_TITLES[gi] ? h('div', { class: 'settings-group-label', text: SETTINGS_GROUP_TITLES[gi] }) : null, h('div', { class: 'settings-group' }, group.map(key => {
                const p = SETTINGS_PAGES[key];
                const badge = key === 'updates' && updateInfo && updateInfo.update_available;
                return h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => openSettingsPage(key) },
                    h('span', { class: 'nav-icon', style: `background:${p.color}` }, icon(p.icon)),
                    h('span', { class: 'settings-label', text: p.title }),
                    h('span', { id: `settingsSummary-${key}`, class: 'settings-value settings-nav-summary' + (badge ? ' badge' : ''), text: settingsSummary(key) }),
                    icon('i-chevron', 'chev'));
            }))]),
            h('p', { class: 'settings-note', text: `Nourish${serverInfo && serverInfo.version ? ' v' + serverInfo.version : ''} · free & open source (AGPL-3.0) · changes save automatically and sync with your PC` }),
            h('p', { class: 'settings-note', text: USDA_CREDIT }),
        );
        updateBackendStatus();
        return;
    }
    setChildren(list, ...SETTINGS_RENDERERS[page]());
    updateBackendStatus();
    renderModelControl();
    renderServerInfo();
    renderModelHint();
    renderUpdateResult();
}

// === MY SCHEDULE ===
const SCHEDULE_DEFAULT = { breakfast: '20', lunch: '30', dinner: 'norush' };   // the same as the built-in slot limits
const SCHEDULE_CHOICES = {
    breakfast: ['5', '10', '20', '30', '45', 'norush', 'nocook'],
    lunch: ['10', '20', '30', '45', '60', 'norush', 'nocook'],
    dinner: ['20', '30', '45', '60', '90', 'norush', 'nocook'],
};
const SCHEDULE_SHORT = { 5: '5 min', 10: '10 min', 20: '20 min', 30: '30 min', 45: '45 min', 60: '1 hour', 90: '1½ hours', norush: 'No rush', nocook: "Don't cook" };
const SCHEDULE_LONG = Object.assign({}, SCHEDULE_SHORT, { nocook: "I don't cook this meal" });
function scheduleValue(meal, prefix = 'sched_') { return settings[`${prefix}${meal}`] || (prefix === 'sched_' ? SCHEDULE_DEFAULT[meal] : ''); }
function scheduleOptions(meal, inherit) {
    const o = inherit ? { '': inherit } : {};
    SCHEDULE_CHOICES[meal].forEach(v => { o[v] = SCHEDULE_LONG[v]; });
    return o;
}
// What a choice means for the recipes, in plain words.
function scheduleMeaning(meal, value) {
    if (value === 'nocook') return 'Grab-and-go or no-cook ideas only';
    if (value === 'norush') return meal === 'dinner' ? 'Any recipe, however long' : 'Longer recipes are fine';
    const L = NourishPlanner.slotLimits({ [`sched_${meal}`]: value }, meal);
    return L.noCook ? 'No-cook ideas (there is no time to cook)' : `Recipes ready in ${L.minutes} min or less`;
}
function scheduleChips(meal, onpick) {
    const current = scheduleValue(meal);
    return h('div', { class: 'time-chips', role: 'radiogroup', 'aria-label': `${MEAL_LABELS[meal]} time` }, SCHEDULE_CHOICES[meal].map(v =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === current), class: 'time-chip' + (v === current ? ' selected' : ''),
            onclick: () => { setSetting(`sched_${meal}`, v === SCHEDULE_DEFAULT[meal] ? '' : v, { quiet: true }); onpick(); } }, SCHEDULE_SHORT[v])));
}

function scheduleRow(label, control, opts) {
    const r = settingsRow(label, control, opts);
    r.classList.add('schedule-row');
    return r;
}

// === WHAT NOURISH HAS LEARNED ===
const TASTE_EVENT_WORDS = { save: 'Saved', eaten: 'Ate', swap: 'Swapped away', skip: 'Skipped', delete: 'Removed from the Cookbook', log: 'Logged', rate: 'Rated', chat: 'Told the chef' };
function ago(t) {
    const d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : `${Math.round(d / 30)} month${d >= 45 ? 's' : ''} ago`;
}
function tasteChanged() { tasteCache = null; changed('taste'); renderSettings(); }
function hourWords(h) {
    if (h == null) return '';
    const hr = Math.floor(h), min = Math.round((h - hr) * 60);
    return new Date(2000, 0, 1, hr, min).toLocaleTimeString([], { hour: 'numeric', minute: min ? '2-digit' : undefined });
}

const SETTINGS_RENDERERS = {
    learned() {
        const prof = tasteProfile();
        const o = taste.overrides;
        const overrideRow = (kind, name, current) => scheduleRow(name.charAt(0).toUpperCase() + name.slice(1),
            selectInput(current, { like: 'Like', dislike: "Don't like", forget: 'Forget this' }, v => { o[kind][name] = v; tasteChanged(); }, name));
        const pick = (key, labels, learnedText) => selectInput(o[key] || '', Object.assign({ '': learnedText ? `Auto: ${learnedText}` : 'Auto' }, labels), v => { o[key] = v; tasteChanged(); }, key);
        const addBox = h('input', { type: 'text', class: 'settings-input', placeholder: 'e.g. coriander', 'aria-label': 'A food', autocomplete: 'off' });
        const addFood = v => () => {
            const name = addBox.value.trim().toLowerCase().replace(/s$/, '');
            if (!name) return;
            o.ingredients[name] = v;
            tasteChanged();
            showToast(v === 'like' ? `Noted: you like ${name}` : `Noted: less ${name}`, false);
        };
        const sentence = [];
        if (prof.likes.length) sentence.push(`You seem to enjoy ${prof.likes.slice(0, 5).join(', ')}.`);
        if (prof.dislikes.length) sentence.push(`You're less keen on ${prof.dislikes.slice(0, 4).join(', ')}.`);
        if (prof.cuisinesLiked.length) sentence.push(`Favourite cuisines: ${prof.cuisinesLiked.slice(0, 3).join(', ')}.`);
        if (prof.spice !== 'unknown') sentence.push(`Spice: ${prof.spice}.`);
        if (prof.effort !== 'unknown') sentence.push(`Cooking effort you like: ${prof.effort}.`);
        if (prof.filling === 'more') sentence.push('You often find portions small, so plans lean towards more filling meals.');
        const times = ['breakfast', 'lunch', 'dinner'].filter(m => prof.mealTimes[m] != null).map(m => `${MEAL_LABELS[m].toLowerCase()} around ${hourWords(prof.mealTimes[m])}`);
        const recent = taste.events.slice(-12).reverse();
        const likedRows = [...new Set(prof.likes.concat(Object.keys(o.ingredients).filter(k => o.ingredients[k] === 'like')))].slice(0, 15);
        const dislikedRows = [...new Set(prof.dislikes.concat(Object.keys(o.ingredients).filter(k => o.ingredients[k] === 'dislike')))].slice(0, 15);
        return [
            ...settingsGroup('', [h('button', { type: 'button', class: 'settings-row settings-nav switch-row', role: 'switch', 'aria-checked': String(taste.on), onclick: () => { taste.on = !taste.on; tasteChanged(); } },
                h('span', { class: 'settings-label', text: 'Learn from what I do' }),
                h('span', { class: 'switch', 'aria-checked': String(taste.on), 'aria-hidden': 'true' }))],
                help('Nourish notices what you save, cook, rate, swap away, skip and log, and what you tell the chef, and uses it to pick and write meals you will like.',
                    'It all stays on this device and syncs only to Nourish on your PC. It is never sent anywhere else: AI services on the internet (Claude, OpenAI) are not told any of it. The AI model itself is not retrained; Nourish keeps a short list of what you like and uses it to choose and guide recipes. You will still get something new now and then.')),
            ...(taste.on ? [
                h('div', { class: 'learned-summary' },
                    h('p', { text: sentence.length ? sentence.join(' ') : "Nothing learned yet. Save recipes, mark meals as eaten and tap 👍 or 👎 after a meal, and this fills in." }),
                    times.length ? h('p', { class: 'text-dim', text: `You usually have ${times.join(', ')}.` }) : null,
                    prof.proteins.length ? h('p', { class: 'text-dim', text: `Favourite proteins: ${prof.proteins.join(', ')}.` }) : null),
                ...settingsGroup('Foods you like', likedRows.length ? likedRows.map(k => overrideRow('ingredients', k, o.ingredients[k] || 'like')) : [h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'None yet.' }))]),
                ...settingsGroup('Foods you are less keen on', dislikedRows.length ? dislikedRows.map(k => overrideRow('ingredients', k, o.ingredients[k] || 'dislike')) : [h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'None yet.' }))]),
                ...settingsGroup('Tell Nourish yourself', [
                    h('div', { class: 'settings-row settings-row-stack' }, addBox,
                        h('div', { class: 'quick-actions' },
                            h('button', { type: 'button', class: 'btn btn-secondary', onclick: addFood('like') }, '👍 I like it'),
                            h('button', { type: 'button', class: 'btn btn-secondary', onclick: addFood('dislike') }, '👎 Less of it'))),
                ]),
                ...(prof.cuisinesLiked.length || prof.cuisinesDisliked.length || Object.keys(o.cuisines).length ? settingsGroup('Cuisines',
                    [...new Set(prof.cuisinesLiked.concat(prof.cuisinesDisliked, Object.keys(o.cuisines).filter(k => o.cuisines[k] !== 'forget')))].map(k => overrideRow('cuisines', k, o.cuisines[k] || (prof.cuisinesLiked.includes(k) ? 'like' : 'dislike')))) : []),
                ...settingsGroup('How you like it', [
                    scheduleRow('Spice', pick('spice', { mild: 'Mild', medium: 'Medium', hot: 'Hot' }, prof.spice !== 'unknown' && !o.spice ? prof.spice : '')),
                    scheduleRow('Cooking effort', pick('effort', { easy: 'Easy', medium: 'Medium', involved: 'Involved is fine' }, prof.effort !== 'unknown' && !o.effort ? prof.effort : '')),
                    scheduleRow('Portions', pick('filling', { fine: 'They are fine', more: 'More filling, please' }, !o.filling ? (prof.filling === 'more' ? 'more filling' : 'fine') : '')),
                    scheduleRow('Favourites again', pick('repeats', { rarely: 'Rarely', sometimes: 'Sometimes', often: 'Often' }, !o.repeats ? prof.repeats : '')),
                ], '"Auto" means Nourish works it out from what you do. Your own choices here win. Favourites again: sometimes is up to 2 loved recipes a week, often up to 4.'),
                ...settingsGroup('Recently noted', recent.length ? recent.map(e => h('div', { class: 'settings-row' },
                    h('span', { class: 'settings-label' }, e.type === 'chat' ? `"${e.word === '__spice' ? (e.sign > 0 ? 'spicier' : 'less spicy') : e.word}"` : (e.name || '—'),
                        h('span', { class: 'settings-hint', text: `${TASTE_EVENT_WORDS[e.type] || e.type}${e.type === 'rate' ? ` ${e.rating === 'up' ? '👍' : e.rating === 'down' ? '👎' : ''} ${(e.tags || []).map(t => NourishTaste.TAGS[t]).join(', ')}` : ''} · ${ago(e.t)}` })),
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Forget this', title: 'Forget this', onclick: () => { NourishTaste.forget(taste, e.t); tasteChanged(); } }, icon('i-close'))))
                    : [h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'Nothing yet.' }))]),
            ] : []),
            ...settingsGroup('', [settingsButton('Reset what Nourish has learned', () => {
                if (!confirm('Forget everything Nourish has learned about your tastes? This can\'t be undone.')) return;
                const wasOn = taste.on;
                taste = NourishTaste.empty();
                taste.on = wasOn;
                tasteChanged();
                store(RATE_DISMISSED_KEY, []);
                showToast('Reset. Nourish starts learning again from scratch.', false);
            }, 'danger')]),
        ];
    },
    schedule() {
        const meals = ['breakfast', 'lunch', 'dinner'];
        const weekend = on('sched_weekend');
        const row = (meal, prefix, inherit) => scheduleRow(MEAL_LABELS[meal],
            selectInput(settings[`${prefix}${meal}`] || (inherit ? '' : SCHEDULE_DEFAULT[meal]), scheduleOptions(meal, inherit), v => {
                setSetting(`${prefix}${meal}`, !inherit && v === SCHEDULE_DEFAULT[meal] ? '' : v, { quiet: true });
                renderSettings();
            }, `${MEAL_LABELS[meal]} time`),
            { hint: inherit ? (settings[`${prefix}${meal}`] ? scheduleMeaning(meal, settings[`${prefix}${meal}`]) : '') : scheduleMeaning(meal, scheduleValue(meal)) });
        const days = Array.from({ length: 7 }, (_, d) => d);
        return [
            ...settingsGroup(weekend ? 'Weekdays' : 'Every day', meals.map(m => row(m, 'sched_')),
                help('How long you have to make and eat each meal. Plans only use recipes that fit.',
                    'The time includes about 5 minutes to eat (10 at dinner), so "20 min" means recipes ready in 15 minutes. "I don\'t cook this meal" gives grab-and-go or no-cook ideas only. Without changes, breakfast is quick (15 min), lunch is light (25 min) and dinner can take as long as it takes.')),
            ...settingsGroup('', [settingsToggle('sched_weekend', 'Different times at the weekend', { onchange: () => renderSettings() })]),
            ...settingsGroup('', [settingsToggle('allow_leftovers', 'Allow leftovers', { hint: 'Cook once, eat twice: a dinner can come back as the next day\'s lunch. Otherwise no meal is ever repeated.' })]),
            ...(weekend ? settingsGroup('Saturday and Sunday', meals.map(m => row(m, 'sched_we_', 'As weekdays'))) : []),
            h('details', { class: 'settings-advanced' + (days.some(d => meals.some(m => settings[`sched_d${d}_${m}`])) ? ' has-values' : '') , open: days.some(d => meals.some(m => settings[`sched_d${d}_${m}`])) },
                h('summary', { class: 'settings-group-label', text: 'Advanced: day by day' }),
                days.map(d => settingsGroup(DAY_NAMES[d], meals.map(m => row(m, `sched_d${d}_`, 'As usual'))))),
            ...settingsGroup('', [settingsButton('Reset my schedule', () => {
                Object.keys(SETTINGS_DEFAULTS).filter(k => k.startsWith('sched_') && k !== 'sched_asked').forEach(k => setSetting(k, SETTINGS_DEFAULTS[k], { quiet: true }));
                renderSettings();
                showToast('Schedule reset', false);
            }, 'danger')], 'These are hard limits for new plans, swaps and AI-written meals. Your current plan stays as it is until you make a new one.'),
        ];
    },
    appearance() {
        const T = NourishTheme;
        if (!lookSnapshot) lookSnapshot = Object.fromEntries(APPEARANCE_KEYS.map(k => [k, settings[k]]));
        const themeId = T.themeId(settings.theme);
        const shown = themeId === 'auto' ? (document.documentElement.getAttribute('data-theme') === 'light' ? 'paper' : 'ember') : themeId;
        const pick = (key, value) => { setSetting(key, value, { quiet: true }); renderSettings(); };
        const tile = (id, t) => {
            const look = id === 'auto' ? null : T.resolve(Object.assign({}, settings, { theme: id, bg: '', custom_bg: '' }), false).vars;
            const selected = themeId === id;
            return h('button', { type: 'button', role: 'radio', 'aria-checked': String(selected), class: 'theme-tile' + (selected ? ' selected' : ''), onclick: () => { setSetting('custom_bg', '', { quiet: true }); setSetting('bg', '', { quiet: true }); pick('theme', id); } },
                id === 'auto'
                    ? h('span', { class: 'theme-tile-art auto' }, h('i', { style: 'background:#0C0B0A' }), h('i', { style: 'background:#F5EFE6' }))
                    : h('span', { class: 'theme-tile-art', style: `background:${look['--bg']}` },
                        h('i', { class: 'card', style: `background:${look['--surface-2']};border-color:${look['--border-strong']}` }),
                        h('i', { class: 'line', style: `background:${look['--text']}` }),
                        h('i', { class: 'line short', style: `background:${look['--text-3']}` }),
                        h('i', { class: 'dot', style: `background:${look['--accent']}` })),
                h('span', { class: 'theme-tile-name', text: id === 'auto' ? 'Auto' : t.name }),
                h('span', { class: 'theme-tile-note', text: id === 'auto' ? 'Follows your phone' : t.note }));
        };
        const t = T.THEMES[shown];
        const bgs = t.bgs.length > 1 && !settings.custom_bg ? h('div', { class: 'settings-row settings-row-stack' },
            h('span', { class: 'settings-label', text: 'Background' }),
            h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Background' }, t.bgs.map((c, i) => {
                const sel = (settings.bg || t.bgs[0]) === c;
                return h('button', { type: 'button', role: 'radio', class: 'swatch bg-swatch' + (sel ? ' selected' : ''), 'aria-checked': String(sel), 'aria-label': T.BG_NAMES[i], title: T.BG_NAMES[i],
                    style: `background:${c};color:${c}`, onclick: () => pick('bg', i ? c : '') });
            }))) : null;
        const accentName = settings.accent === 'custom' ? 'Custom' : (T.ACCENTS[settings.accent] || T.ACCENTS.orange).name;
        const fontRow = id => {
            const f = T.FONTS[id];
            const sel = (T.FONTS[settings.font_pair] ? settings.font_pair : 'editorial') === id;
            return h('button', { type: 'button', role: 'radio', 'aria-checked': String(sel), class: 'settings-row settings-nav font-row' + (sel ? ' selected' : ''), onclick: () => pick('font_pair', id) },
                h('span', { class: 'font-sample', style: `font-family:"${f.heading}"` }, 'Aa'),
                h('span', { class: 'settings-label' }, f.name, h('span', { class: 'settings-hint', text: `${f.note} · ${f.heading === f.body ? f.heading : f.heading + ' + ' + f.body}` })),
                h('span', { class: 'font-digits', style: `font-family:"${f.body}";font-variant-numeric:lining-nums tabular-nums`, text: '1,250' }),
                sel ? icon('i-check', 'font-check') : null);
        };
        const iconSample = ['i-home', 'i-calendar', 'i-heart', 'i-cart'];
        const changedLook = APPEARANCE_KEYS.some(k => lookSnapshot[k] !== settings[k]);
        const native = isLocalMode() && nativeAvailable();
        return [
            lookPreview(),
            changedLook ? h('div', { class: 'look-bar' },
                h('span', { text: 'Your changes are showing everywhere.' }),
                h('button', { type: 'button', class: 'link-btn', onclick: () => { Object.entries(lookSnapshot).forEach(([k, v]) => setSetting(k, v, { quiet: true })); renderSettings(); showToast('Changes undone', false); } }, 'Undo')) : null,
            ...settingsGroup('Theme', [
                h('div', { class: 'theme-tiles', role: 'radiogroup', 'aria-label': 'Theme' }, ['auto'].concat(Object.keys(T.THEMES)).map(id => tile(id, T.THEMES[id]))),
                bgs,
            ]),
            ...settingsGroup('Accent colour', [
                h('div', { class: 'settings-row settings-row-stack' },
                    h('span', { class: 'settings-row-top' }, h('span', { class: 'settings-label', text: 'Accent' }), h('span', { class: 'settings-value', text: accentName })),
                    h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' }, Object.entries(T.ACCENTS).map(([name, a]) =>
                        h('button', {
                            type: 'button', role: 'radio', class: 'swatch' + (settings.accent === name ? ' selected' : ''), 'aria-checked': String(settings.accent === name), 'aria-label': a.name, title: a.name,
                            style: `background:${a.accent};color:${a.accent}`, onclick: () => pick('accent', name),
                        })))),
            ]),
            ...settingsGroup('Font', Object.keys(T.FONTS).map(fontRow), 'Numbers always use even, same-width digits so they line up, whichever font you pick.'),
            ...settingsGroup('Text', [
                settingsChoice('Text size', T.TEXT_SIZES[settings.text_size] ? settings.text_size : 'default', T.TEXT_SIZES, v => pick('text_size', v)),
                settingsToggle('bold_text', 'Bold text', { hint: 'Heavier text, easier to read', onchange: () => renderSettings() }),
            ]),
            ...settingsGroup('Icons', [
                h('div', { class: 'icon-styles', role: 'radiogroup', 'aria-label': 'Icon style' }, Object.entries(T.ICON_STYLES).map(([id, name]) => {
                    const sel = (T.ICON_STYLES[settings.icon_style] ? settings.icon_style : 'outline') === id;
                    return h('button', { type: 'button', role: 'radio', 'aria-checked': String(sel), class: 'icon-style' + (sel ? ' selected' : ''), 'data-icons': id, onclick: () => pick('icon_style', id) },
                        h('span', { class: 'icon-style-row' }, iconSample.map(n => icon(n))), h('span', { text: name }));
                })),
            ]),
            ...settingsGroup('App icon', [
                h('div', { class: 'app-icons', role: 'radiogroup', 'aria-label': 'App icon' }, Object.entries(T.APP_ICONS).map(([id, ic]) => {
                    const sel = (settings.app_icon || 'default') === id;
                    return h('button', { type: 'button', role: 'radio', 'aria-checked': String(sel), class: 'app-icon-tile' + (sel ? ' selected' : ''), disabled: !native,
                        onclick: () => setAppIcon(id) },
                        h('img', { src: `app-icon-${id}.png`, alt: '', width: 56, height: 56 }), h('span', { text: ic.name }));
                })),
            ], native ? 'Changes the Nourish icon on your home screen. Your phone may show a short notice when it changes.'
                : 'The home screen icon can be changed in the iPhone and Android apps. Browsers and the PC app can’t change their icon.'),
            ...settingsGroup('Today screen', [
                ...[['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat']].map(([key, label]) => statToggle(key, label)),
                settingsToggle('show_nutrition', 'Show nutrition', { hint: 'Calories and macros on meals' }),
            ], 'Choose which bars show next to the calorie ring.'),
            ...settingsGroup('Layout', [
                settingsRow('Open on', settingsSelect('start_tab', { today: 'Today', plan: 'Plan', chat: 'Chat', grocery: 'Grocery' })),
                settingsRow('Week starts on', settingsSelect('week_start', { monday: 'Monday', sunday: 'Sunday', today: 'Today' })),
                settingsChoice('Units', unitSystem(), { imperial: 'Imperial (cups, °F)', metric: 'Metric (ml, °C)' }, v => setSetting('units', v, { quiet: true })),
                h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => openSettingsPage('profile') },
                    h('span', { class: 'settings-label' }, 'Meals each day', h('span', { class: 'settings-hint', text: 'Which meals and how many snacks: in Your profile' })), icon('i-chevron', 'chev')),
                settingsToggle('reduce_motion', 'Reduce motion', { hint: 'Fewer animations' }),
            ]),
            ...settingsGroup('Advanced', [
                colorRow('Background colour', 'custom_bg', settings.custom_bg || (document.documentElement.style.getPropertyValue('--bg') || '#0C0B0A').trim(), 'Any colour; text adjusts to stay readable'),
                colorRow('Accent colour', 'custom_accent', settings.custom_accent || ((T.ACCENTS[settings.accent] || T.ACCENTS.orange).accent), 'Any colour for buttons and highlights'),
                lookNotes.length ? h('div', { class: 'settings-row look-note', role: 'note', text: lookNotes.join(' ') }) : null,
            ], help('Pick any colour you like.', 'Nourish works out matching cards, borders and text from your colour, and checks the contrast (the WCAG accessibility formula). If a colour would make text hard to read, it adjusts it slightly and tells you here.')),
            ...settingsGroup('', [settingsButton('Reset appearance to default', () => {
                if (!confirm('Go back to the original look (Ember theme, Saffron accent, Editorial font, default text and icons)?')) return;
                Object.entries(NourishTheme.DEFAULTS).forEach(([k, v]) => setSetting(k, v, { quiet: true }));
                setSetting('today_stats', SETTINGS_DEFAULTS.today_stats, { quiet: true });
                setAppIcon('default', { quiet: true });
                renderSettings();
                showToast('Back to the original look', false);
            }, 'danger')]),
        ];
    },
    ai() {
        const p = settings.active_provider;
        const cloud = p === 'claude' || p === 'openai';
        const local = p === 'local';
        const tempValue = h('span', { class: 'settings-value', text: temperatureLabel(settings.temperature) });
        const tempSlider = h('input', {
            type: 'range', min: '0', max: '1.2', step: '0.1', value: settings.temperature, class: 'settings-range',
            'aria-label': 'Creativity',
            oninput: e => { tempValue.textContent = temperatureLabel(e.target.value); },
            onchange: e => setSetting('temperature', e.target.value),
        });
        return [
            ...settingsGroup('Provider', [
                settingsRow('Provider', settingsSelect('active_provider', availableProviders(), { onchange: () => renderSettings() })),
                local ? null : h('div', { id: 'modelControl' }),
                cloud ? secretRow(`${p}_api_key`, 'API key', p === 'claude' ? 'sk-ant-…' : 'sk-…') : null,
            ], h('span', { id: 'modelHint' })),
            local ? renderOnDeviceSection() : null,
            ...settingsGroup('Answers', [
                h('div', { class: 'settings-row settings-row-stack' },
                    h('div', { class: 'settings-row-top' }, h('span', { class: 'settings-label', text: 'Creativity' }), tempValue),
                    tempSlider),
                local ? null : settingsRow('Plan length', settingsSelect('max_tokens', { 4000: 'Short (faster)', 8000: 'Standard', 12000: 'Long', 16000: 'Extra long' })),
            ], local ? 'Lower creativity gives more predictable plans.' : 'Lower creativity gives more predictable plans. Use "Long" if plans come back with fewer than 7 days.'),
            ...settingsGroup('Check', [
                settingsButton('Test the AI', testAI),
                h('div', { id: 'testResult', class: 'settings-row settings-result', hidden: true }),
            ]),
        ];
    },
    chat() {
        return [
            ...settingsGroup('The chef', [
                settingsRow('Style', settingsSelect('chef_style', { friendly: 'Friendly', concise: 'Concise', coach: 'Nutrition coach', playful: 'Playful' })),
                settingsRow('Reply length', settingsSelect('chat_length', { short: 'Short', normal: 'Normal', long: 'Detailed' })),
            ]),
            ...settingsGroup('Actions', [
                settingsToggle('chat_actions', 'Let chat change my plan', { hint: '"Make me a plan", "swap Tuesday dinner"…' }),
            ], 'When on, asking the chef for a plan puts it straight into the Plan tab, and asking to swap or change a meal updates that meal.'),
            ...settingsGroup('', [settingsButton('Clear chat history', clearChat, 'danger')]),
        ];
    },
    profile() {
        return [
            ...settingsGroup('You', [
                settingsRow('Name', settingsInput('name', { placeholder: 'optional' })),
                settingsRow('Goal', selectInput(prefs.goal, GOALS, v => { setPref('goal', v); syncChoiceButtons(); showToast('Saved ✓', false); }, 'Goal')),
            ]),
            ...settingsGroup('Daily targets', [
                settingsRow('Calories', settingsInput('calorie_target', { type: 'number', inputmode: 'numeric', min: '1000', max: '6000' })),
                settingsRow('Protein (g)', settingsInput('protein_target', { type: 'number', inputmode: 'numeric', min: '20', max: '400' })),
                settingsRow('Calories by meal', settingsSelect('calorie_split', Object.assign({ dinner: 'Bigger dinner', even: 'Even', breakfast: 'Bigger breakfast' },
                    settings.calorie_split === 'custom' ? { custom: 'Custom (Advanced)' } : {}))),
            ], 'Each day of your plan is sized to land within about 5% of your calories. "Bigger dinner" gives about 25% at breakfast, 30% at lunch and 45% at dinner.'),
            ...settingsGroup('Food', [
                settingsRow('Diet', settingsSelect('diet', DIETS)),
                settingsRow('Allergies', settingsInput('allergies', { placeholder: 'e.g. peanuts, shellfish' })),
                settingsRow('Love', textInput(() => prefs.likes, v => { setPref('likes', v); showToast('Saved ✓', false); }, { placeholder: 'e.g. chicken, pasta' })),
                settingsRow('Avoid', textInput(() => prefs.hates, v => { setPref('hates', v); showToast('Saved ✓', false); }, { placeholder: 'e.g. mushrooms' })),
                settingsRow('Cuisines', settingsInput('cuisines', { placeholder: 'e.g. Mexican, Thai' })),
            ], 'Allergies are never included by the AI and are filtered out of recipe searches.'),
            ...settingsGroup('Meals each day', MEAL_TYPES.map(mealSlotToggle).concat([
                settingsRow('Snacks', settingsSelect('snacks_per_day', { 0: 'None', 1: '1 a day', 2: '2 a day', 3: '3 a day' }), { hint: 'Small snacks inside your calories' }),
            ]), 'New plans use these. Your calories are shared out over the meals you keep, and each snack takes about a tenth of the day.'),
            ...settingsGroup('Cooking', [
                settingsRow('Max cook time', settingsSelect('max_cook_time', { '': 'Any', 15: '15 min', 20: '20 min', 30: '30 min', 45: '45 min', 60: '1 hour' })),
                settingsRow('Servings', settingsSelect('servings', ['1', '2', '3', '4', '5', '6']), { hint: 'Recipes are written for this many people' }),
                settingsRow('Skill', settingsSelect('skill', ['Beginner', 'Intermediate', 'Advanced'])),
                settingsRow('Budget', settingsSelect('budget', { Any: 'Any', 'Budget-friendly': 'Budget-friendly', Moderate: 'Moderate', 'No limit': 'No limit' })),
            ], 'Your profile is used for every AI meal plan and chat.'),
        ];
    },
    sources() {
        return [
            ...settingsGroup('How plans are made', [
                infoRow('Recipes', settings.plan_source === 'ai' ? 'Written by the AI' : 'Real recipes first'),
            ], settings.plan_source === 'ai'
                ? 'The AI writes every meal (changed in Advanced → Recipe sources & keys).'
                : `Nourish uses your own recipe files, its library of recipes found before, ${typeof NourishBuiltins !== 'undefined' ? NourishBuiltins.all().length + ' of its own recipes' : 'its own recipes'}, ${NourishSources.usable().length} trusted recipe sites and TheMealDB, picks the best recipe for each meal and sizes it to your targets. No meal is repeated. The AI only writes a meal when nothing suitable is found.`),
            ...libraryGroup(),
            ...settingsGroup('Nutrition', [infoRow('Data', 'USDA FoodData Central')], USDA_CREDIT),
        ];
    },
    advanced() {
        const lib = libraryStats();
        const bySource = Object.entries(lib.perSource).sort((x, y) => y[1] - x[1]);
        const refreshed = Number(load(LIBRARY_REFRESH_KEY, 0));
        const libraryRows = [
            infoRow('Web recipes saved', `${lib.total.toLocaleString()} (breakfast ${lib.perMeal.breakfast}, lunch ${lib.perMeal.lunch}, dinner ${lib.perMeal.dinner})`),
            infoRow('Last refreshed', refreshed ? new Date(refreshed).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet'),
            ...bySource.slice(0, 30).map(([name, n]) => infoRow(name, `${n} recipe${n === 1 ? '' : 's'}`)),
            settingsButton(libraryRefreshing ? 'Refreshing recipes…' : 'Refresh recipes now', () => refreshRecipeLibrary({ manual: true }), 'settings-button-primary'),
            settingsRow('Nourish recipes', settingsSelect('builtin_mode', { backup: 'Backup only', mix: 'Mix in', off: 'Off' })),
        ];
        const off = new Set(String(settings.sources_off || '').split(',').filter(Boolean));
        const toggle = id => {
            if (off.has(id)) off.delete(id); else off.add(id);
            setSetting('sources_off', [...off].join(','), { quiet: true });
        };
        const sourceRow = src => h('button', {
            type: 'button', class: 'settings-row settings-nav switch-row', role: 'switch', 'aria-checked': String(!off.has(src.id)),
            onclick: e => { toggle(src.id); const v = !off.has(src.id); e.currentTarget.setAttribute('aria-checked', String(v)); e.currentTarget.querySelector('.switch').setAttribute('aria-checked', String(v)); },
        }, h('span', { class: 'settings-label' }, src.name, h('span', { class: 'settings-hint', text: src.note || `${src.domain}${src.healthy ? ' · lighter cooking' : ''}${src.nutrition ? ' · lists nutrition' : ''}` })),
            h('span', { class: 'switch', 'aria-checked': String(!off.has(src.id)), 'aria-hidden': 'true' }));
        const names = Object.fromEntries(NourishSources.all().map(x => [x.id, x.name]));
        return [
            ...settingsGroup('Your recipe library', libraryRows,
                help('Every web recipe Nourish reads is kept on this device, so plans start from a big, tested pool and work offline. It grows by itself while the app is open on Wi-Fi.',
                    '"Nourish recipes" are the app\'s own recipes. "Backup only" (the default) uses them only when no web recipe fits a meal, or when you\'re offline. "Mix in" treats them like any other source. "Off" never uses them.')),
            ...settingsGroup('Where recipes come from', [
                settingsRow('New plans', settingsSelect('plan_source', { auto: 'Real recipes first', ai: 'AI writes every meal' }, { onchange: () => renderSettings() })),
            ], help('"Real recipes first" uses tested recipes from cooking sites and only asks the AI when nothing fits. "AI writes every meal" is the older way: slower, especially on a phone.',
                'Real recipes have been cooked and tested by people, and most sites list their own nutrition, which Nourish checks against USDA data. On a phone, writing a whole week with the AI can take 20 minutes or more; finding recipes takes seconds.')),
            ...settingsGroup('Recipe sites', NourishSources.usable().map(sourceRow),
                help('Switch off any site you don’t want recipes from.', 'Each site was checked: it publishes recipe data for search engines, its robots.txt allows reading recipe pages, and its terms don’t forbid it. Nourish only reads the few pages a plan needs, a few at a time, and remembers them so it doesn’t ask twice. A site that fails is skipped quietly.')),
            ...settingsGroup('Recipe databases', NourishSources.SOURCES.filter(x => x.kind === 'api').map(sourceRow).concat([
                secretRow('spoonacular_api_key', 'Spoonacular key', 'optional, free key'),
            ]), help('TheMealDB works without a key. Spoonacular is an optional extra that needs a free key.', 'An API is a service apps can ask directly for recipes. Get a free Spoonacular key at spoonacular.com/food-api, then paste it here.')),
            ...settingsGroup('Your own sites', [
                settingsRow('Also search', settingsInput('custom_sites', { placeholder: 'e.g. mysite.com' }), { hint: 'separate several with commas' }),
            ], help('Add a recipe site you like and Nourish searches it too.', 'Works best with sites built on WordPress (most food blogs). Nourish uses the site\'s own search, so nothing is crawled.')),
            ...settingsGroup('Search these first', [
                settingsRow('Priority', textInput(() => String(settings.source_priority || '').split(',').filter(Boolean).map(id => names[id] || id).join(', '), v => {
                    const want = v.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
                    const ids = want.map(w => (NourishSources.all().find(x => x.name.toLowerCase() === w || x.id === w || (x.domain || '') === w) || {}).id).filter(Boolean);
                    setSetting('source_priority', ids.join(','));
                }, { placeholder: 'e.g. Skinnytaste, Budget Bytes' })),
            ], help('Sites named here are preferred when their recipes fit just as well.', 'Type site names separated by commas, in the order you prefer them.')),
            ...settingsGroup('Calories by meal (custom)', [
                settingsRow('Breakfast %', textInput(() => settings.split_breakfast, v => { setSetting('split_breakfast', v); setSetting('calorie_split', 'custom', { quiet: true }); }, { type: 'number', inputmode: 'numeric', min: '10', max: '60' })),
                settingsRow('Lunch %', textInput(() => settings.split_lunch, v => { setSetting('split_lunch', v); setSetting('calorie_split', 'custom', { quiet: true }); }, { type: 'number', inputmode: 'numeric', min: '10', max: '60' })),
                settingsRow('Dinner %', textInput(() => settings.split_dinner, v => { setSetting('split_dinner', v); setSetting('calorie_split', 'custom', { quiet: true }); }, { type: 'number', inputmode: 'numeric', min: '10', max: '70' })),
            ], help('Typing a number here switches "Calories by meal" in your profile to Custom.', 'The three numbers are shares of your daily calories. They don\'t have to add up to exactly 100: Nourish scales them.')),
            ...settingsGroup('AI model', [
                h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => openSettingsPage('ai') },
                    h('span', { class: 'settings-label', text: 'Choose the AI' }), h('span', { class: 'settings-value', text: settingsSummary('ai') }), icon('i-chevron', 'chev')),
            ], help('The AI writes a meal when no recipe fits, and powers the chat.', 'It can run on this phone (private, no account, slower) or use Claude, OpenAI or a model on your PC.')),
        ];
    },
    grocery() {
        return [
            ...settingsGroup('List', [
                settingsToggle('grocery_hide_checked', 'Hide ticked items'),
            ]),
            ...settingsGroup('', [
                settingsButton('Untick everything', resetGrocery),
                settingsButton('Remove items I added', clearCustomGrocery, 'danger'),
            ], 'The list is built from your meal plan. Items you add yourself stay until you remove them. Ticks sync between your devices, so one person can shop while another checks.'),
        ];
    },
    server() {
        if (isLocalMode()) {
            return [
                ...settingsGroup('Where Nourish runs', [
                    infoRow('Running', 'On this phone only'),
                    settingsButton('Connect to my PC instead', switchToPc),
                ], 'Everything (your plan, settings, chat and AI models) stays on this phone. Connecting to Nourish on your PC instead shares one plan between all your devices and lets you use the PC\'s AI.'),
            ];
        }
        return [
            ...settingsGroup('Connection', [
                infoRow('Status', '', 'serverStatus'),
                infoRow('Sync', syncStatusText(), 'syncStatus'),
                h('div', { id: 'serverInfo' }),
                settingsButton('Sync now', () => {
                    checkBackend().then(ok => { if (ok) { syncNow().then(() => showToast(syncFailed ? "Couldn't sync" : 'Synced ✓', syncFailed)); loadServerInfo(); renderModelControl(true); } });
                }),
                IN_PHONE_APP ? settingsButton('Connect to a different PC', () => { location.href = 'nourishapp://connect'; }) : null,
                IN_PHONE_APP && typeof nativeAvailable === 'function' && nativeAvailable() ? settingsButton('Use on this phone only (no PC)', switchToPhone) : null,
            ], 'Your settings, plan, grocery list and chat are kept on the PC, so every phone and browser connected to it shows the same thing. The phone and PC must be on the same Wi-Fi.'),
        ];
    },
    updates() {
        return [
            ...settingsGroup('This version', [
                infoRow('Installed', serverInfo && serverInfo.version ? `v${serverInfo.version}` : '…'),
                settingsToggle('auto_update_check', 'Check when the app opens'),
                settingsToggle('update_prereleases', 'Include test versions', { hint: 'Pre-alpha and beta releases' }),
                settingsButton('Check now', () => checkForUpdates({ manual: true })),
            ]),
            h('div', { id: 'updateResult' }),
        ];
    },
    logs() {
        const list = h('div', { class: 'log-list', id: 'logList' });
        renderLogList(list);
        return [
            ...settingsGroup('', [
                settingsToggle('verbose_log', 'Detailed logging', { hint: 'Every request, download step and timing' }),
                IN_PHONE_APP && /NourishApp\/\S+ \(iOS\)/.test(navigator.userAgent) ? settingsButton('Check download connection', checkDownloadConnection) : null,
                settingsButton('Share log', () => shareLog(false)),
                settingsButton('Copy log', () => shareLog(true)),
                settingsButton('Clear log', () => {
                    if (!confirm('Clear the activity log?')) return;
                    activityLog = [];
                    try { localStorage.removeItem(LOG_KEY); } catch (e) { /* ignore */ }
                    renderSettings();
                }, 'danger'),
            ], 'Shows what Nourish is doing, step by step. If something goes wrong, tap Share log and send it. API keys and tokens are never included.'),
            h('div', { class: 'settings-group-label', text: 'Latest first' }),
            list,
        ];
    },
    data() {
        return [
            ...settingsGroup('Your data', [
                settingsButton('Export meal plan', exportPlan),
                settingsButton('Clear chat history', clearChat),
                settingsButton('Clear meal plan', clearPlan, 'danger'),
                settingsButton('Reset all settings', resetSettings, 'danger'),
            ], isLocalMode() ? 'Your plan, chat, settings, API keys and AI models are stored only on this phone. Nothing goes anywhere else except the recipe sites, Hugging Face and AI services you choose.' : 'Your plan, chat, settings and API keys are stored on your own PC (in nourish-data.json next to Nourish) and on this device. API keys are never sent back to phones. Nothing goes anywhere else except the AI and recipe services you choose.'),
        ];
    },
};

// === ACTIVITY LOG PAGE ===
const LOG_LEVEL_LABEL = { error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG' };

function logLine(e) {
    const d = new Date(e.t);
    const time = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour12: false })}`;
    return `${time} ${LOG_LEVEL_LABEL[e.level] || e.level} [${e.area}] ${e.msg}${e.details ? '\n    ' + e.details : ''}`;
}

function renderLogList(box) {
    const recent = activityLog.slice(-400).reverse();
    setChildren(box, recent.length ? recent.map(e => h('div', { class: `log-entry log-${e.level}` },
        h('div', { class: 'log-head' },
            h('span', { class: 'log-time', text: new Date(e.t).toLocaleTimeString(undefined, { hour12: false }) }),
            h('span', { class: 'log-area', text: e.area }),
            h('span', { class: 'log-level', text: LOG_LEVEL_LABEL[e.level] || e.level })),
        h('div', { class: 'log-msg', text: e.msg }),
        e.details ? h('div', { class: 'log-details', text: e.details }) : null))
        : h('p', { class: 'settings-note', text: 'Nothing logged yet.' }));
}

// Called by nlog() for each new entry: keeps the open log page live.
function onLogEntry() {
    const box = document.getElementById('logList');
    if (box && settingsPage === 'logs') {
        clearTimeout(onLogEntry.timer);
        onLogEntry.timer = setTimeout(() => renderLogList(box), 300);
    }
}

async function logReport() {
    const lines = [`Nourish activity log · ${new Date().toISOString()}`,
        `App: ${(serverInfo && serverInfo.version) || '?'} · ${isLocalMode() ? 'phone-only mode' : IN_PHONE_APP ? 'phone app (PC mode)' : 'browser'}`,
        `Device: ${navigator.userAgent}`,
        `AI: ${PROVIDERS[settings.active_provider]} · ${settings[`${settings.active_provider}_model`] || 'auto'} · creativity ${settings.temperature}`];
    if (isLocalMode() && typeof getSpecs === 'function') {
        try {
            const sp = await getSpecs();
            lines.push(`Phone: ${sp.device} · RAM ${Math.round(sp.ram / 1048576)} MB · usable ${Math.round((sp.usable || 0) / 1048576)} MB · free ${Math.round((sp.disk_free || 0) / 1048576)} MB · ${sp.os || "OS ?"} · ${sp.thermal || "?"}`);
        } catch (e) { lines.push(`Phone: unknown (${e.message})`); }
    }
    lines.push('', ...activityLog.map(logLine));
    return redactSecrets(lines.join('\n'));
}

// Runs the phone's download check (network, DNS, the download server) on a small public model file.
// Everything it finds goes into the activity log.
async function checkDownloadConnection() {
    showToast('Checking the download connection… (up to a minute)', false);
    nlog('download', 'Download connection check started');
    try {
        const r = await nativeCall('downloadCheck', { url: 'https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/resolve/main/LFM2.5-230M-Q4_K_M.gguf' }, { timeoutMs: 120000 });
        showToast(r.advice || 'Check finished: see the log below', false);
    } catch (e) {
        nlog('download', `Download connection check failed: ${e.message}`, null, 'error');
        showToast(`Check failed: ${e.message}`);
    }
    if (settingsPage === 'logs') renderSettings();
}

async function shareLog(copyOnly) {
    const text = await logReport();
    if (!copyOnly && navigator.share) {
        try { await navigator.share({ title: 'Nourish activity log', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyText(text).then(() => showToast('Log copied — paste it into a message', false), () => showToast("Couldn't copy the log on this device"));
}

function renderModelControl(refresh = false) {
    const box = $('modelControl');
    if (!box) return;
    const p = settings.active_provider;
    if (p === 'local') { setChildren(box); return; }
    if (p === 'claude' || p === 'openai') {
        setChildren(box,
            settingsRow('Model', settingsInput(`${p}_model`, { list: `${p}-models`, placeholder: SETTINGS_DEFAULTS[`${p}_model`] })),
            h('datalist', { id: `${p}-models` }, MODEL_SUGGESTIONS[p].map(m => h('option', { value: m }))));
        return;
    }
    const cached = modelLists[p];
    if (!cached || refresh) {
        setChildren(box, settingsRow('Model', h('span', { class: 'settings-value', text: 'Loading models…' }), { tag: 'div' }));
        fetchModels(p).then(() => { if (settings.active_provider === p) renderModelControl(); });
        return;
    }
    const key = `${p}_model`;
    const options = [['', p === 'lmstudio' ? 'Automatic (first loaded)' : 'Automatic (first installed)']].concat(cached.models.map(m => [m, m]));
    if (settings[key] && !cached.models.includes(settings[key])) options.push([settings[key], `${settings[key]} (not found)`]);
    setChildren(box,
        settingsRow('Model', settingsSelect(key, Object.fromEntries(options))),
        cached.error ? h('div', { class: 'settings-row settings-result error', text: cached.error }) : null,
        settingsButton('Refresh model list', () => renderModelControl(true)));
}

function renderModelHint() {
    const el = $('modelHint');
    if (!el) return;
    const p = settings.active_provider;
    if (p === 'local') {
        el.textContent = 'Runs entirely on this phone: private, free and works offline. Bigger models give better plans but are slower and warmer.';
    } else if (p === 'lmstudio' || p === 'ollama') {
        const url = serverInfo && serverInfo[`${p}_url`];
        el.textContent = `The Nourish server reaches ${PROVIDERS[p].replace(' (local)', '')} at ${url || '…'}. ` +
            `To change it, set ${p === 'lmstudio' ? 'LMSTUDIO_URL' : 'OLLAMA_URL'} in backend/.env and restart the server.`;
    } else {
        el.textContent = isLocalMode()
            ? 'Cloud models cost money per use on your own account. The key is kept on this phone. Creativity is capped at 1.0 for Claude.'
            : 'Cloud models cost money per use on your own account. The key is saved on your PC and used by every device. Creativity is capped at 1.0 for Claude.';
    }
}

function renderServerInfo() {
    const box = $('serverInfo');
    if (!box) return;
    if (!serverInfo) { setChildren(box); return; }
    const phone = serverInfo.in_docker
        ? "Use your PC's IP address with :8000 (running in Docker, so it can't be detected)"
        : serverInfo.lan_urls && serverInfo.lan_urls.length ? serverInfo.lan_urls.join('\n') : 'No home-network address found';
    setChildren(box,
        h('div', { class: 'settings-row settings-row-stack' },
            h('span', { class: 'settings-label', text: 'Open on your phone' }),
            h('span', { class: 'settings-value settings-mono', text: phone })),
        infoRow('Version', serverInfo.version || ''));
}

async function testAI(e) {
    const btn = e.currentTarget;
    const out = $('testResult');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    out.hidden = false;
    out.className = 'settings-row settings-result';
    out.textContent = 'Sending a tiny test message…';
    const started = Date.now();
    try {
        const req = await buildAIRequest([{ role: 'user', content: 'Reply with just the word: ready' }], { maxTokens: 20 });
        const data = await waitForJob(await startJob(req));
        const reply = extractText(req.provider, data).trim().slice(0, 40) || '(empty reply)';
        out.textContent = `✓ ${req.model} replied "${reply}" in ${((Date.now() - started) / 1000).toFixed(1)} s`;
    } catch (err) {
        out.classList.add('error');
        out.textContent = `✗ ${err.message}`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Test the AI';
    }
}

function exportPlan() {
    if (!daysData.length) { showToast('There is no meal plan to export yet'); return; }
    const blob = new Blob([JSON.stringify({ days: daysData }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'nourish-meal-plan.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function resetSettings() {
    if (!confirm('Reset every setting (including saved API keys) to its default, on every device? Your meal plan and chat are kept.')) return;
    Object.assign(settings, SETTINGS_DEFAULTS);
    pendingClears = SECRET_FIELDS.slice();
    secretsSet = {};
    changed('settings');
    applyAppearance();
    renderAll();
    showToast('Settings reset', false);
}

function clearPlan() {
    if (!daysData.length) return;
    if (!confirm('Delete the current meal plan and grocery ticks?')) return;
    daysData = [];
    grocery.checked = [];
    changed('plan');
    changed('grocery');
    renderAll();
    showToast('Meal plan cleared', false);
}

// === SHEETS ===
function initSheets() {
    $('generateSheetBackdrop').addEventListener('click', closeGenerateSheet);
    $('recipeSheetBackdrop').addEventListener('click', closeRecipeSheet);
    document.querySelectorAll('[data-action="new-plan"]').forEach(b => b.addEventListener('click', showGenerateSheet));
    $('closeGenerateBtn').addEventListener('click', closeGenerateSheet);
    $('generateBtn').addEventListener('click', generateMealPlan);
    $('editProfileBtn').addEventListener('click', () => { closeGenerateSheet(); switchTab('settings'); openSettingsPage('profile'); });
    $('settingsBack').addEventListener('click', () => openSettingsPage(null));
    $('importLinkBtn').addEventListener('click', () => showImportSheet());
    $('importSheetBackdrop').addEventListener('click', closeImportSheet);
    $('closeImportBtn').addEventListener('click', closeImportSheet);
    $('importBtn').addEventListener('click', runImport);
    $('importUrl').addEventListener('keydown', e => { if (e.key === 'Enter') runImport(); });
    document.querySelectorAll('[data-import-mode]').forEach(b => b.addEventListener('click', () => { setImportMode(b.dataset.importMode); showImportError(''); }));
    $('importImage').addEventListener('change', () => {
        const file = $('importImage').files && $('importImage').files[0];
        $('importImageName').textContent = file ? file.name : 'Choose a screenshot of the recipe';
    });
    $('cookbookBtn').addEventListener('click', showCookbook);
    $('cookbookBackdrop').addEventListener('click', closeCookbook);
    $('recipeEditBackdrop').addEventListener('click', closeRecipeEditor);
    $('foodSheetBackdrop').addEventListener('click', closeFoodSheet);
    $('slotBackdrop').addEventListener('click', closeSlotPicker);
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        // The top sheet first.
        for (const [id, close] of [['foodSheet', closeFoodSheet], ['slotSheet', closeSlotPicker], ['recipeEditSheet', closeRecipeEditor], ['recipeSheet', closeRecipeSheet], ['importSheet', closeImportSheet], ['cookbookSheet', closeCookbook], ['generateSheet', closeGenerateSheet]]) {
            if ($(id).classList.contains('active')) { close(); return; }
        }
    });

    document.querySelectorAll('.segment-btn[data-goal]').forEach(btn => {
        btn.addEventListener('click', () => { setPref('goal', btn.dataset.goal); syncChoiceButtons(); });
    });
}

function syncChoiceButtons() {
    document.querySelectorAll('.segment-btn[data-goal]').forEach(b => {
        b.classList.toggle('active', b.dataset.goal === prefs.goal);
        b.setAttribute('aria-pressed', b.dataset.goal === prefs.goal);
    });
}

// The first time: three quick questions about time (with the usual answers already picked and a
// Skip), then the usual form. Changed any time in Settings → My schedule.
function renderScheduleQuestions() {
    const box = $('scheduleQuick');
    const form = $('generateForm');
    if (!box || !form) return;
    const ask = settings.sched_asked !== 'yes';
    box.hidden = !ask;
    form.hidden = ask;
    const summary = $('scheduleSummary');
    if (summary) setChildren(summary, h('span', { text: `Time: ${['breakfast', 'lunch', 'dinner'].map(m => `${MEAL_LABELS[m]} ${SCHEDULE_SHORT[scheduleValue(m)]}`).join(' · ')} ` }),
        h('button', { type: 'button', class: 'link-btn', onclick: () => { closeGenerateSheet(); switchTab('settings'); openSettingsPage('schedule'); } }, 'Change'));
    if (!ask) return;
    const done = () => { setSetting('sched_asked', 'yes', { quiet: true }); renderScheduleQuestions(); };
    setChildren(box,
        h('p', { class: 'sheet-hint', text: 'Quick question, so your recipes fit your day: how much time do you usually have to make and eat each meal?' }),
        ['breakfast', 'lunch', 'dinner'].map(m => h('div', { class: 'input-group' },
            h('div', { class: 'label', text: MEAL_LABELS[m] }),
            scheduleChips(m, renderScheduleQuestions),
            h('div', { class: 'time-meaning', text: scheduleMeaning(m, scheduleValue(m)) }))),
        h('div', { class: 'quick-actions' },
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => {
                ['breakfast', 'lunch', 'dinner'].forEach(m => setSetting(`sched_${m}`, '', { quiet: true }));
                done();
            } }, 'Skip'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: done }, 'Continue')),
        h('p', { class: 'sheet-hint', text: 'You can change this any time in Settings → My schedule, including different times at the weekend.' }));
}

function showGenerateSheet() {
    renderScheduleQuestions();
    syncChoiceButtons();
    $('inputLikes').value = prefs.likes || '';
    $('inputHates').value = prefs.hates || '';
    const btn = $('generateBtn');
    btn.disabled = !!planJob;
    btn.textContent = planJob ? 'A plan is already cooking…' : 'Generate Plan';
    $('generateSheet').classList.add('active');
}

function closeGenerateSheet() {
    $('generateSheet').classList.remove('active');
}

let openRecipe = null;
// dayIndex: the plan's day it's on; cookbookId: opened from the Cookbook.
function openRecipeSheet(mealType, meal, dayIndex = null, { cookbookId = null } = {}) {
    openRecipe = { mealType, meal, dayIndex, cookbookId };
    const saved = cookbookId ? cookbook.recipes.find(e => e.id === cookbookId) : cookbookEntry(meal);
    const content = $('recipeSheetContent');
    const units = unitSystem();
    const ingredients = NourishGrocery.dedupeIngredients(meal.ingredients || []).map(line => NourishUnits.formatIngredient(NourishUnits.clampIngredient(line).line, units));
    const n = meal.nutrition;
    const profile = (meal.ingredients || []).length ? NourishPlanner.recipeProfile(meal) : null;
    const time = mealTime(meal);
    const chips = [h('span', { class: 'chip', title: time.estimated ? 'Estimated from the steps: the recipe gives no time' : 'Hands-on time' + (time.makeAhead ? ', then waiting' : '') }, icon('i-clock'), time.text)];
    if (time.makeAhead) chips.push(h('span', { class: 'chip accent', text: 'Make ahead' }));
    if (portionLabel(meal)) chips.push(h('span', { class: 'chip', title: 'Your portion, sized to fit your day. The amounts and calories below are for this portion.' }, icon('i-user'), portionLabel(meal)));
    if (meal.leftover) chips.push(h('span', { class: 'chip', text: 'Leftovers' }));
    if (meal.builtin) chips.push(h('span', { class: 'chip', title: "Written for Nourish, not from a recipe site", text: 'Nourish recipe' }));
    if (meal.rating && meal.rating.value) chips.push(h('span', { class: 'chip', title: `Rated ${meal.rating.value} of 5 on ${meal.source_name || 'its site'}` }, `★ ${meal.rating.value}${meal.rating.count ? ` (${meal.rating.count.toLocaleString()})` : ''}`));
    if (meal.servings && !portionLabel(meal)) chips.push(h('span', { class: 'chip' }, icon('i-user'), `Serves ${meal.servings}`));
    // How much work it is (steps, ingredients, techniques), so a busy morning isn't a surprise.
    if (profile) chips.push(h('span', { class: 'chip', title: `Difficulty ${profile.difficulty} of 10: ${profile.steps} steps, ${profile.ingredients} ingredients${profile.techniques.length ? ', ' + profile.techniques.join(', ') : ''}` },
        icon('i-utensils'), profile.difficulty <= 3 ? 'Easy' : profile.difficulty <= 6 ? 'Medium' : 'Involved'));
    if (on('show_nutrition') && !n) chips.push(h('span', { class: 'chip accent' }, icon('i-flame'), '— kcal'));
    // Ticked ingredients and the step you're on stay while this recipe is open (also after the heart is tapped).
    const progressKey = `${meal.name}|${dayIndex}|${mealType}|${cookbookId}`;
    if (!recipeProgress || recipeProgress.key !== progressKey) recipeProgress = { key: progressKey, ticked: new Set(), step: -1 };
    const where = dayIndex != null ? `${MEAL_LABELS[mealType] || ''} · ${isToday(dayIndex) ? 'Today' : dayName(dayIndex)}` : MEAL_LABELS[mealType] || '';

    setChildren(content,
        h('div', { class: `recipe-hero art-${mealType}` },
            h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
            icon(MEAL_ICONS[mealType] || 'i-utensils'),
            h('div', { class: 'recipe-top' },
                h('button', {
                    type: 'button', class: `icon-btn heart-btn${saved ? ' saved' : ''}`, 'aria-pressed': String(!!saved),
                    'aria-label': saved ? 'Remove from Cookbook' : 'Save to Cookbook',
                    onclick: () => {
                        if (cookbookId) { removeFromCookbook(cookbookId); closeRecipeSheet(); return; }
                        toggleSaved(meal, mealType);
                        openRecipeSheet(mealType, meal, dayIndex);
                    },
                }, icon('i-heart')),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closeRecipeSheet }, icon('i-close')))),
        h('div', { class: 'recipe-header' },
            h('div', { class: 'meal-type', text: where }),
            h('h2', { class: 'recipe-name', text: meal.name }),
            meal.description ? h('p', { class: 'recipe-description', text: meal.description }) : null,
            h('div', { class: 'recipe-meta' }, chips)),
        on('show_nutrition') && n ? nutritionPanel(meal) : null,
        Array.isArray(meal.incomplete) && meal.incomplete.length ? h('div', { class: 'recipe-warning', role: 'note' },
            h('div', { class: 'recipe-warning-title', text: 'This recipe may be incomplete' }),
            h('p', { text: 'The AI tried 3 times but this is the best it wrote. What\'s still wrong:' }),
            h('ul', {}, meal.incomplete.slice(0, 6).map(p => h('li', { text: p }))),
            dayIndex != null ? h('button', {
                type: 'button', class: 'btn btn-primary', disabled: !!planJob,
                onclick: () => { closeRecipeSheet(); remakeMeal(dayIndex, mealType, 'retry'); },
            }, icon('i-refresh'), 'Try again') : null) : null,
        cookbookId ? h('div', { class: 'recipe-actions three' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => showSlotPicker(meal.name, mealType, (d, t) => { placeInPlan(meal, d, t); closeRecipeSheet(); closeCookbook(); showToast(`Added "${meal.name}" to ${dayName(d)}`, false); }) }, icon('i-calendar'), 'Add to plan'),
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openRecipeEditor(meal, { mode: 'edit', mealType, cookbookId }) }, icon('i-edit'), 'Edit'),
            h('button', { type: 'button', class: 'btn btn-secondary danger', onclick: () => { removeFromCookbook(cookbookId); closeRecipeSheet(); } }, icon('i-trash'), 'Remove')) : null,
        dayIndex != null && !cookbookId ? eatenControl(dayIndex, mealType) : null,
        dayIndex != null && !cookbookId ? rateRow(dayIndex, mealType, meal) : null,
        cookbookId ? null : h('div', { class: 'recipe-actions' },
            dayIndex != null && !isSnackSlot(mealType) ? h('button', {
                type: 'button', class: 'btn btn-secondary', disabled: !!planJob,
                onclick: () => { closeRecipeSheet(); swapMeal(dayIndex, mealType); },
            }, icon('i-swap'), 'Swap meal') : null,
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => askAboutMeal(meal) }, icon('i-chat'), 'Ask the chef')),
        ingredients.length ? h('div', { class: 'recipe-section' },
            h('div', { class: 'recipe-section-title' }, 'Ingredients', h('small', { text: meal.servings ? `${ingredients.length} · for ${meal.servings}` : String(ingredients.length) })),
            h('div', { class: 'recipe-ingredients' }, ingredients.map((line, idx) => ingredientRow(line, idx)))) : null,
        meal.steps.length ? h('div', { class: 'recipe-section' },
            h('div', { class: 'recipe-section-title' }, 'Method', h('small', { text: `${meal.steps.length} steps` })),
            h('p', { class: 'recipe-steps-hint', text: 'Tap a step to follow along while you cook.' }),
            h('div', { class: 'recipe-steps' }, meal.steps.map((s, idx) => h('button', {
                type: 'button', class: 'recipe-step' + stepClass(idx), 'aria-pressed': String(idx < recipeProgress.step),
                onclick: e => {
                    // Tap a step to make it the one you're on; tap it again when it's done.
                    recipeProgress.step = recipeProgress.step === idx ? idx + 1 : idx;
                    e.currentTarget.parentNode.querySelectorAll('.recipe-step').forEach((b, i) => {
                        b.className = 'recipe-step' + stepClass(i);
                        b.setAttribute('aria-pressed', String(i < recipeProgress.step));
                    });
                },
            },
                h('span', { class: 'recipe-step-number', text: idx + 1 }),
                h('span', { class: 'recipe-step-text' }, highlightStep(NourishUnits.convertText(s, units))))))) : null,
        meal.source_url ? h('a', { class: 'btn btn-secondary recipe-source', href: meal.source_url, target: '_blank', rel: 'noopener noreferrer' },
            icon('i-link'), `Recipe from ${meal.source_name || 'the web'}${meal.via_name ? ` · via ${meal.via_name}` : ''}`)
            : meal.library_path ? h('div', { class: 'btn btn-secondary recipe-source', role: 'note' }, icon('i-book'), `From your recipe library: ${meal.library_path}`)
            : meal.builtin ? h('div', { class: 'btn btn-secondary recipe-source', role: 'note' }, icon('i-book'), "Nourish recipe: written for this app, not from a recipe site (works offline)")
            : h('div', { style: 'height:20px' }),
    );
    content.scrollTop = 0;
    $('recipeSheet').classList.add('active');
    describeLater(meal, mealType, dayIndex, cookbookId);
}

// A one-line description written by the AI on this phone or PC (a small job), once per recipe,
// only when the model is already set up and nothing else is running.
async function describeLater(meal, mealType, dayIndex, cookbookId) {
    if (meal.description || planJob || !['local', 'lmstudio', 'ollama'].includes(settings.active_provider) || !aiReady()) return;
    if (settings.active_provider === 'local' && !settings.local_model) return;
    try {
        const run = settings.active_provider === 'local' ? phoneRunner({ isCancelled: () => !!planJob }) : aiRunner();
        const text = await aiDescribe(run, meal);
        if (!text || meal.description) return;
        meal.description = text;
        if (dayIndex != null) changed('plan');
        if (openRecipe && openRecipe.meal === meal) openRecipeSheet(mealType, meal, dayIndex, { cookbookId });
    } catch (e) { nlog('plan', `No description: ${e.message}`, null, 'debug'); }
}

let recipeProgress = null;
function stepClass(idx) {
    return idx < recipeProgress.step ? ' done' : idx === recipeProgress.step ? ' current' : '';
}

// One ingredient, tappable to tick off; the amount is in bold.
function ingredientRow(line, idx) {
    const sp = NourishUnits.splitIngredient(line);
    const amount = sp && sp.qty != null && !sp.note && sp.text && line.endsWith(sp.text) ? line.slice(0, line.length - sp.text.length).trim() : '';
    return h('button', {
        type: 'button', class: 'recipe-ingredient' + (recipeProgress.ticked.has(idx) ? ' done' : ''), 'aria-pressed': String(recipeProgress.ticked.has(idx)),
        onclick: e => {
            const el = e.currentTarget;
            if (recipeProgress.ticked.has(idx)) recipeProgress.ticked.delete(idx); else recipeProgress.ticked.add(idx);
            el.classList.toggle('done', recipeProgress.ticked.has(idx));
            el.setAttribute('aria-pressed', String(recipeProgress.ticked.has(idx)));
        },
    }, h('span', {}, amount ? h('span', { class: 'qty', text: amount }) : null, amount ? ' ' + sp.text : line));
}

// Times and temperatures in a step stand out, so they're easy to find mid-cook.
const STEP_KEYS = /(\d+(?:[.,]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?\s*(?:°\s*[CF]\b|degrees(?:\s+[CF]\b)?|(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)\b))/gi;
function highlightStep(text) {
    const out = [];
    let last = 0;
    String(text).replace(STEP_KEYS, (match, _g, offset) => {
        if (offset > last) out.push(text.slice(last, offset));
        out.push(h('span', { class: 'step-key', text: match }));
        last = offset + match.length;
        return match;
    });
    if (last < text.length) out.push(text.slice(last));
    return out;
}

// Calories per serving and how they split between protein, carbs and fat.
function nutritionPanel(meal) {
    const n = meal.nutrition;
    const g = k => (Number.isFinite(n[k]) ? n[k] : null);
    const kcal = { p: (g('protein_g') || 0) * 4, c: (g('carbs_g') || 0) * 4, f: (g('fat_g') || 0) * 9 };
    const sum = kcal.p + kcal.c + kcal.f;
    const split = h('div', { class: 'nutrition-split', 'aria-hidden': 'true' },
        ['p', 'c', 'f'].map(k => h('span', { class: k, style: 'flex-grow:0' })));
    if (sum > 0) requestAnimationFrame(() => requestAnimationFrame(() => {
        split.querySelectorAll('span').forEach(el => { el.style.flexGrow = String(kcal[el.className] / sum); });
    }));
    const macro = (label, key, color) => h('div', { class: 'nutrition-macro' },
        h('span', { class: 'k' }, h('i', { class: 'macro-dot', style: `background:var(--${color})` }), label),
        h('span', { class: 'v num' }, g(key) != null ? String(Math.round(g(key))) : '—', h('small', { text: 'g' })));
    return h('section', { class: 'nutrition-panel', 'aria-label': 'Nutrition' },
        h('div', { class: 'nutrition-top' },
            h('div', { class: 'nutrition-kcal num' }, h('small', { class: 'about', text: 'about' }), formatCalories(n.calories), h('small', { text: portionLabel(meal) ? 'kcal for your portion' : meal.servings ? 'kcal per serving' : 'kcal' })),
            meal.nutrition_unmatched || meal.nutrition_estimated ? h('span', { class: 'chip warn', text: 'Approximate' }) : null),
        sum > 0 ? split : null,
        h('div', { class: 'nutrition-macros' }, macro('Protein', 'protein_g', 'protein'), macro('Carbs', 'carbs_g', 'carbs'), macro('Fat', 'fat_g', 'fat')),
        meal.servings ? h('p', { class: 'recipe-note', text: portionLabel(meal)
            ? `Nutrition is for one person's portion (${portionLabel(meal)} of the recipe). Ingredient amounts are for ${meal.servings} ${meal.servings > 1 ? 'people' : 'person'}.`
            : `Nutrition is for one serving. Ingredient amounts make ${meal.servings} serving${meal.servings > 1 ? 's' : ''}.` }) : null,
        nutritionNotes(meal).map(t => h('p', { class: 'recipe-note', text: t })),
        calorieBreakdown(meal));
}

// "How is this worked out?": every ingredient with its calories per serving, what was assumed
// (oil with no amount…), what couldn't be counted, and how the site's own numbers compare.
function calorieBreakdown(meal) {
    if (!(meal.ingredients || []).length || typeof NourishNutrition === 'undefined') return null;
    const servings = Math.max(1, Number(meal.servings) || 1);
    const c = NourishNutrition.calculate(meal.ingredients, servings);
    const rows = c.lines.filter(l => l.kcal > 0 || l.assumed).sort((a, b) => b.kcal - a.kcal);
    const check = meal.nutrition_check;
    const shown = meal.nutrition && meal.nutrition.calories;
    return h('details', { class: 'calorie-breakdown' },
        h('summary', { text: 'How is this worked out?' }),
        h('p', { class: 'recipe-note', text: `Each ingredient as written, per serving, from USDA food data. Together: about ${formatCalories(c.nutrition.calories)} kcal${shown && Math.abs(shown - c.nutrition.calories) > 15 ? ` (the recipe shows ${formatCalories(shown)}: ${meal.nutrition_basis === 'source' ? "the site's own number, which agrees within 15%" : 'it includes ingredients worked out another way'})` : ''}.` }),
        h('div', { class: 'breakdown-rows' }, rows.map(l => h('div', { class: 'breakdown-row' },
            h('span', { class: 'what' }, l.line, l.assumed ? h('small', { text: `no amount given, counted as ${l.assumed}` }) : null),
            h('span', { class: 'kcal num', text: `${l.kcal}` })))),
        c.unmatched.length ? h('p', { class: 'recipe-note', text: `Not counted (not in the food table): ${c.unmatched.join('; ')}.` }) : null,
        check ? h('p', { class: 'recipe-note', text: `Cross-check: ${meal.source_name || 'the recipe site'} says ${formatCalories(check.source)} kcal, our calculation ${formatCalories(check.calculated)} kcal (${Math.round(Math.abs(check.source - check.calculated) / Math.max(1, check.calculated) * 100)}% apart). ${meal.nutrition_basis === 'source' ? "Close enough, so the site's number is used." : 'Too far apart, so our calculation is used.'}` }) : null);
}

function portionWords(p) {
    const words = { 0.5: 'half', 0.75: 'three quarters', 1.25: '1¼ times', 1.5: '1½ times', 1.75: '1¾ times', 2: 'twice' };
    return words[Math.round(p * 4) / 4] || `${Number(p).toFixed(2).replace(/0$/, '')}×`;
}

// Where the numbers come from, and what was changed to fit the person's targets, in plain words.
function nutritionNotes(meal) {
    const notes = [];
    if (meal.nutrition_basis === 'source') notes.push(`Numbers from ${meal.source_name || 'the recipe'}, checked against USDA data.`);
    else if (meal.nutrition_basis === 'calculated') notes.push('Numbers worked out from the ingredients with USDA data.');
    if (meal.nutrition_unmatched) notes.push(`Not counted (not in the food table): ${meal.nutrition_unmatched.join('; ')}.`);
    if (meal.scaled && Math.abs(meal.scaled.portion - 1) > 0.05) notes.push(`Portion: ${portionLabel(meal)} (${portionWords(meal.scaled.portion)} the recipe's serving), sized to fit this day. The ingredient amounts and calories are for that portion, so the same recipe can show different calories on different days.`);
    if (meal.trimmed) notes.push('Less oil or sugar than the original, to fit your calories. Seasoning is unchanged.');
    if (meal.reseasoned) notes.push(`Seasoning added: ${meal.reseasoned.join(', ')}.`);
    return notes;
}

// "How was it?": one optional tap after a meal (thumbs up or down, and a few quick notes). It
// teaches the taste profile; it never asks twice and can be dismissed.
const RATE_DISMISSED_KEY = 'nourish_rate_dismissed';
function rateKey(dayIndex, mealType) { return `${logKey(dayIndex)}|${mealType}`; }
function rateMeal(dayIndex, mealType, meal, change) {
    if (!meal) return;
    const key = rateKey(dayIndex, mealType);
    const old = NourishTaste.ratingOf(taste, key) || { rating: '', tags: [] };
    const next = Object.assign({ rating: old.rating, tags: (old.tags || []).slice() }, change(old));
    learn('rate', meal, { key, rating: next.rating, tags: next.tags, slot: mealType });
    updateTodayScreen();
    if (openRecipe && openRecipe.dayIndex === dayIndex && openRecipe.mealType === mealType) openRecipeSheet(mealType, meal, dayIndex);
}
function rateRow(dayIndex, mealType, meal, { compact = false } = {}) {
    if (!taste.on || dayIndex == null || !meal) return null;
    const key = rateKey(dayIndex, mealType);
    const r = NourishTaste.ratingOf(taste, key);
    const tags = (r && r.tags) || [];
    const thumb = (v, label, glyph) => h('button', { type: 'button', class: 'rate-btn' + (r && r.rating === v ? ' on' : ''), 'aria-pressed': String(!!(r && r.rating === v)), 'aria-label': label, title: label,
        onclick: () => rateMeal(dayIndex, mealType, meal, o => ({ rating: o.rating === v ? '' : v })) }, glyph);
    const tag = (id) => h('button', { type: 'button', class: 'rate-tag' + (tags.includes(id) ? ' on' : ''), 'aria-pressed': String(tags.includes(id)),
        onclick: () => rateMeal(dayIndex, mealType, meal, o => {
            const t = (o.tags || []).includes(id) ? o.tags.filter(x => x !== id) : (o.tags || []).concat([id]);
            return { tags: t, rating: o.rating || (id === 'loved' ? 'up' : '') };
        }) }, NourishTaste.TAGS[id]);
    const dismiss = compact ? h('button', { type: 'button', class: 'icon-btn rate-close', 'aria-label': 'Not now', onclick: () => {
        const set = loadJSON(RATE_DISMISSED_KEY, []).concat([key]).slice(-200);
        store(RATE_DISMISSED_KEY, set);
        updateTodayScreen();
    } }, icon('i-close')) : null;
    return h('div', { class: 'rate-row' + (compact ? ' compact' : '') },
        h('div', { class: 'rate-head' }, h('span', { class: 'rate-q', text: r && (r.rating || tags.length) ? 'Thanks, noted.' : 'How was it?' }), thumb('up', 'Liked it', '👍'), thumb('down', "Didn't like it", '👎'), dismiss),
        (!compact || r) ? h('div', { class: 'rate-tags' }, ['loved', 'too_bland', 'too_much_work', 'too_small'].map(tag)) : null);
}
// On Today: the latest meal marked eaten that hasn't been rated (or waved away) gets the quick row.
function rateTargetToday(dayIndex, day, entry) {
    if (!taste.on || !isToday(dayIndex)) return null;
    const dismissed = new Set(loadJSON(RATE_DISMISSED_KEY, []));
    const eaten = MEAL_TYPES.filter(t => day[t] && (entry.meals || {})[t] === 'eaten');
    const open = eaten.filter(t => !dismissed.has(rateKey(dayIndex, t)) && !NourishTaste.ratingOf(taste, rateKey(dayIndex, t)));
    return open.length ? open[open.length - 1] : null;
}

// "Did you eat this?" on a planned meal: Not yet / Eaten / Skipped.
function eatenControl(dayIndex, mealType) {
    const status = logEntry(dayIndex).meals[mealType] || '';
    const pick = v => () => { setMealStatus(dayIndex, mealType, v || null); openRecipeSheet(mealType, slotMeal(daysData[dayIndex], mealType), dayIndex); };
    return h('div', { class: 'segmented eaten-control', role: 'radiogroup', 'aria-label': 'Did you eat this?' },
        [['', 'Not yet'], ['eaten', 'Eaten'], ['skipped', 'Skipped']].map(([v, label]) =>
            h('button', { type: 'button', role: 'radio', class: 'segment-btn' + (status === v ? ' active' : ''), 'aria-checked': String(status === v), onclick: pick(v) }, label)));
}

function closeRecipeSheet() {
    $('recipeSheet').classList.remove('active');
}

function askAboutMeal(meal) {
    closeRecipeSheet();
    switchTab('chat');
    const input = $('chatInput');
    input.value = `About "${meal.name}": `;
    autoGrow(input);
    input.focus();
}

// === FORMATTING ===
function formatCalories(cal) {
    return Number.isFinite(cal) ? Math.round(cal).toLocaleString() : '—';
}
function formatMinutes(min) {
    return Number.isFinite(min) && min > 0 ? `${Math.round(min)} min` : '— min';
}
// A recipe's time in plain words, never "— min": hands-on time, plus any waiting ("10 min +
// overnight", not "250 min"), estimated from the steps when the source gives none ("about 20 min").
function mealTime(meal) {
    if (!meal) return { text: '', estimated: false, makeAhead: false };
    let p = null;
    try { p = (meal.ingredients || []).length || (meal.steps || []).length ? NourishPlanner.recipeProfile(meal) : null; } catch (e) { p = null; }
    const total = Number(meal.time_minutes) > 0 ? Number(meal.time_minutes) : 0;
    const hands = p ? p.minutes : total;
    if (!(hands > 0)) return { text: 'about 10 min', estimated: true, makeAhead: false };
    const passive = p ? NourishPlanner.stepMinutes(meal.steps || []).passive : 0;
    let wait = Number(meal.wait_minutes) > 0 ? Number(meal.wait_minutes) : total > hands + 10 ? total - hands : 0;
    if (!wait && passive >= 15) wait = passive;
    const overnight = /\bovernight\b/i.test((meal.steps || []).join(' ') + ' ' + (meal.name || '')) || wait >= 360;
    const handsText = `${p && p.timeEstimated && !(Number(meal.active_minutes) > 0) ? 'about ' : ''}${Math.round(hands)} min`;
    const waitText = overnight ? 'overnight' : wait >= 60 ? `${Math.round(wait / 60 * 2) / 2} h waiting` : wait >= 15 ? `${Math.round(wait)} min waiting` : '';
    return { text: waitText ? `${handsText} + ${waitText}` : handsText, estimated: !!(p && p.timeEstimated), makeAhead: overnight || wait >= 60 };
}
// "1.25 servings" when a recipe's portion was changed to fit the day.
function portionLabel(meal) {
    const p = meal && meal.scaled && Number(meal.scaled.portion);
    if (!(p > 0) || Math.abs(p - 1) < 0.05) return '';
    return `${Math.round(p * 100) / 100} servings`;
}
function sumNutrient(day, key) {
    return daySlots(day).reduce((sum, [, m]) => sum + ((m.nutrition && m.nutrition[key]) || 0), 0);
}
function hasNutrition(day) {
    return MEAL_TYPES.some(t => day[t] && day[t].nutrition && Number.isFinite(day[t].nutrition.calories));
}

// === BRAND MARK ===
// The app icon's bowl and sprout, drawn inline (the same artwork as art/icon.svg).
// Its gradients (bmBg, bmBowl, bmLeaf) are in index.html, so every copy can use them.
function brandMark(size = 64) {
    const s = (tag, attrs, ...kids) => svgEl(tag, attrs, ...kids);
    return s('svg', { class: 'brand-mark', viewBox: '0 0 64 64', width: String(size), height: String(size), 'aria-hidden': 'true' },
        s('rect', { width: '64', height: '64', rx: '15', fill: 'url(#bmBg)' }),
        s('path', { d: 'M32 33.5V22', stroke: '#9FD08C', 'stroke-width': '2.4', 'stroke-linecap': 'round', fill: 'none' }),
        s('path', { d: 'M31.6 25.5C25.4 25.6 21 21.4 20.2 15.2C26.6 15 31 18.9 31.6 25.5Z', fill: 'url(#bmLeaf)' }),
        s('path', { d: 'M32.4 22.4C33 16.6 37.2 12.6 43.4 12.4C42.8 18.4 38.6 22.3 32.4 22.4Z', fill: 'url(#bmLeaf)' }),
        s('path', { d: 'M12 33.5H52C52 44.8 43 53 32 53S12 44.8 12 33.5Z', fill: 'url(#bmBowl)' }),
        s('rect', { x: '10', y: '31.2', width: '44', height: '4', rx: '2', fill: '#FFE2B0' }));
}

// === PLAN BEING MADE ===
// While a plan is made meal by meal, the Today and Plan screens show the week filling in.
// Reads the saved progress (nourish_plan_progress) and the job bar's text; changes nothing.
function cookingState() {
    if (jobBarState !== 'busy' || (planJob && planJob.kind !== 'plan')) return null;
    const saved = loadJSON(PLAN_PROGRESS_KEY, null);
    if (!saved || saved.failed || !Array.isArray(saved.days)) return null;
    const total = 7;
    const cells = [];
    const fresh = [];
    for (let d = 0; d < total; d++) {
        const day = saved.days[d] || (saved.current && saved.current.day === d ? saved.current.meals : null) || {};
        for (const t of MEAL_TYPES) {
            const meal = day[t];
            cells.push({ d, t, done: !!(meal && meal.name) });
            if (meal && meal.name) fresh.push({ d, t, name: String(meal.name) });
        }
    }
    const now = cells.find(c => !c.done);
    return { cells, now, done: cells.filter(c => c.done).length, total: total * MEAL_TYPES.length, fresh: fresh.slice(-3).reverse() };
}

function cookingPanel(where) {
    const st = cookingState();
    if (!st) return null;
    const message = jobBarMessage.replace(/…$/, '');
    const pct = Math.round(st.done / st.total * 100);
    return h('section', { class: 'cooking', id: `cooking-${where}`, 'aria-live': 'polite' },
        h('div', { class: 'cooking-head' },
            h('div', {},
                h('div', { class: 'eyebrow', text: 'In the kitchen' }),
                h('div', { class: 'cooking-title', text: st.done ? 'Your week is cooking' : 'Starting your week' }),
                h('div', { class: 'cooking-now' }, h('span', { class: 'job-bar-spinner', 'aria-hidden': 'true' }), h('span', { text: message || 'Working…' }))),
            h('div', { class: 'cooking-count num' }, `${st.done}`, h('small', { text: `of ${st.total} meals` }))),
        h('div', { class: 'cooking-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(st.total), 'aria-valuenow': String(st.done), 'aria-label': 'Meals made' },
            h('span', { style: `width:${Math.max(pct, 2)}%` })),
        h('div', { class: 'cooking-grid', 'aria-hidden': 'true' },
            ...[0, 1, 2, 3, 4, 5, 6].flatMap(d => [h('span', { class: 'day', text: dayName(d, true) }),
                ...st.cells.filter(c => c.d === d).map(c => h('span', { class: `cooking-cell art-${c.t}${c.done ? ' done' : ''}${st.now === c ? ' now' : ''}` }))])),
        st.fresh.length ? h('div', { class: 'cooking-fresh' }, h('div', { class: 'eyebrow', text: 'Just made' }),
            st.fresh.map(f => h('div', { class: 'cooking-fresh-item' },
                h('span', { class: `dot art-${f.t}` }, icon(MEAL_ICONS[f.t])),
                h('span', {}, h('b', { text: f.name }), ` · ${dayName(f.d, true)} ${MEAL_LABELS[f.t].toLowerCase()}`)))) : null,
        h('p', { class: 'cooking-note', text: 'Each meal is saved as soon as it\'s done, so nothing is lost if you leave Nourish.' }),
        planJob ? h('div', { class: 'cooking-actions' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: cancelPlan }, icon('i-close'), 'Stop making the plan')) : null);
}

// Swaps the panels in place on every progress update (the job bar calls this).
function refreshCooking() {
    for (const [where, holder] of [['today', 'todayBody'], ['plan', 'planAccordions']]) {
        const box = $(holder);
        if (!box) continue;
        const old = $(`cooking-${where}`);
        const panel = cookingPanel(where);
        const redraw = where === 'today' ? updateTodayScreen : updatePlanScreen;
        if (old && panel) old.replaceWith(panel);
        else if (old) { old.remove(); if (!daysData.length) redraw(); }
        else if (panel) { if (!daysData.length) redraw(); else box.prepend(panel); }
    }
}

// === TODAY SCREEN ===
function greeting() {
    const hour = new Date().getHours();
    const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = settings.name.trim().split(/\s+/)[0];
    return name ? `${part}, ${name}` : part;
}

function updateTodayScreen() {
    const body = $('todayBody');
    if (!body) return;
    const hasPlan = daysData.length > 0;
    $('todayEyebrow').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    $('todayTitle').textContent = greeting();
    $('newPlanHeaderBtn').hidden = !hasPlan;

    if (!hasPlan) {
        const cooking = cookingPanel('today');
        if (cooking) { setChildren(body, cooking); return; }
        setChildren(body, h('div', { class: 'empty-state welcome', id: 'emptyState' },
            h('div', { class: 'welcome-hero' },
                brandMark(64),
                h('div', { class: 'eyebrow', text: 'No meal plan yet' }),
                h('h2', {}, 'A week of good food, ', h('em', { text: 'planned for you.' })),
                h('p', { text: 'Breakfasts, lunches and dinners that fit your goals, with every recipe checked and a grocery list ready to go.' }),
                h('div', { class: 'empty-actions' },
                    h('button', { type: 'button', class: 'btn btn-primary', onclick: showGenerateSheet }, icon('i-sparkle'), 'Generate Meal Plan'),
                    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => switchTab('chat') }, icon('i-chat'), 'Plan it with the chef'))),
            h('div', { class: 'welcome-points' },
                h('div', { class: 'welcome-point' }, h('span', {}, icon('i-flame')), h('span', {}, h('b', { text: 'Made for you' }), ' · your calories, diet and tastes')),
                h('div', { class: 'welcome-point' }, h('span', {}, icon('i-link')), h('span', {}, h('b', { text: 'Any recipe' }), ' · add one from a link, text or a screenshot')),
                h('div', { class: 'welcome-point' }, h('span', {}, icon('i-cart')), h('span', {}, h('b', { text: 'Shopping sorted' }), ' · a grocery list that writes itself')))));
        return;
    }
    if (selectedDay >= daysData.length) selectedDay = todayIndex();
    const day = daysData[selectedDay];

    const strip = h('div', { class: 'day-strip', id: 'dayStrip', role: 'tablist', 'aria-label': 'Day' }, daysData.map((d, idx) => h('button', {
        type: 'button', role: 'tab',
        class: 'day-pill' + (idx === selectedDay ? ' active' : '') + (isToday(idx) ? ' today' : ''),
        'aria-selected': String(idx === selectedDay),
        onclick: () => { selectedDay = idx; updateTodayScreen(); },
    }, h('span', { class: 'd-name', text: isToday(idx) ? 'Today' : dayName(idx, true) }), h('span', { class: 'd-num', text: idx + 1 }))));

    let summary = null;
    const entry = logEntry(selectedDay);
    const dayTotals = NourishLog.totals(day, entry);
    if (on('show_nutrition')) {
        const calTarget = Number(settings.calorie_target) || 2400;
        const known = hasNutrition(day) || entry.items.length > 0;
        const totalCal = dayTotals.planned.calories;
        const r = 56;
        const circumference = 2 * Math.PI * r;
        const fraction = known && calTarget > 0 ? Math.min(totalCal / calTarget, 1) : 0;
        const ring = svgEl('svg', { viewBox: '0 0 132 132', 'aria-hidden': 'true' },
            svgEl('defs', {}, svgEl('linearGradient', { id: 'ringGrad', x1: '0', y1: '0', x2: '1', y2: '1' },
                svgEl('stop', { offset: '0%', 'stop-color': 'var(--accent-2)' }),
                svgEl('stop', { offset: '100%', 'stop-color': 'var(--accent)' }))),
            svgEl('circle', { class: 'track', cx: '66', cy: '66', r: String(r) }),
            svgEl('circle', { class: 'bar', id: 'calorieProgress', cx: '66', cy: '66', r: String(r), 'stroke-dasharray': `0 ${circumference}` }));
        // Animate the ring filling in.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const bar = $('calorieProgress');
            if (bar) bar.style.strokeDasharray = `${circumference * fraction} ${circumference}`;
        }));
        // Protein from Settings; carbs ~50% and fat ~30% of the calorie target.
        const macros = [['Protein', 'protein_g', Number(settings.protein_target) || 150, 'macro-protein'],
            ['Carbs', 'carbs_g', Math.round(calTarget * 0.5 / 4), 'macro-carbs'], ['Fat', 'fat_g', Math.round(calTarget * 0.3 / 9), 'macro-fat']];
        summary = h('section', { class: 'card summary', id: 'calorieSection' },
            h('div', { class: 'ring' }, ring,
                h('div', { class: 'ring-center' },
                    known ? h('div', { class: 'ring-about', text: 'about' }) : null,
                    h('div', { class: 'ring-value num', id: 'calorieValue', text: known ? formatCalories(totalCal) : '—' }),
                    h('div', { class: 'ring-label', id: 'calorieLabel', text: known ? `of ${calTarget.toLocaleString()} kcal` : 'no nutrition data' }))),
            h('div', { class: 'macros' }, macros.filter(([, key]) => todayStatOn(key)).map(([label, key, max, cls]) => {
                const total = dayTotals.planned[key];
                const fill = h('div', { class: `macro-fill ${cls}` });
                requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = Math.min(total / max * 100, 100) + '%'; }));
                return h('div', {},
                    h('div', { class: 'macro-head' }, h('span', {}, h('i', { class: 'macro-dot', style: `background:var(--${cls.replace('macro-', '')})` }), label), h('span', { class: 'num', text: known ? `${Math.round(total)} / ${max}g` : '—' })),
                    h('div', { class: 'macro-track' }, fill));
            })),
            known ? dayBreakdown(day, entry, totalCal, calTarget) : null);
    }

    const title = isToday(selectedDay) ? "Today's meals" : `${dayName(selectedDay)}'s meals`;
    const rateTarget = rateTargetToday(selectedDay, day, entry);
    setChildren(body,
        cookingPanel('today'),
        strip,
        summary,
        on('show_nutrition') ? dayStatus(selectedDay, day, dayTotals) : null,
        h('h2', { class: 'section-title' }, title, h('small', { text: `Day ${selectedDay + 1}` })),
        h('div', { class: 'meal-cards', id: 'mealCards' }, daySlots(day).map(([t, meal]) => {
            const card = mealCard(t, meal, selectedDay, entry.meals[t]);
            return t === rateTarget ? h('div', { class: 'meal-with-rate' }, card, rateRow(selectedDay, t, meal, { compact: true })) : card;
        })),
        extrasSection(selectedDay, entry));
    const active = strip.querySelector('.day-pill.active');
    if (active && active.scrollIntoView) requestAnimationFrame(() => {
        strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    });
}

// "How today adds up": each meal, snack and extra with its calories, the real total and how far it
// is from the target, in plain words. The total is never rounded or nudged to the target.
function dayBreakdown(day, entry, total, target) {
    const rows = daySlots(day).map(([t, m]) => [MEAL_LABELS[t] || 'Snack', m.name, m.nutrition && m.nutrition.calories, (entry.meals || {})[t]]);
    (entry.items || []).forEach(it => rows.push(['Extra', it.name, it.nutrition && it.nutrition.calories, '']));
    const diff = Math.round(total - target);
    const pct = Math.abs(diff) / Math.max(1, target);
    const verdict = Math.abs(diff) < 10 ? 'Right on your target.'
        : pct <= 0.1 ? `${formatCalories(Math.abs(diff))} kcal ${diff < 0 ? 'under' : 'over'} your target, which is close enough: plans aim for within 5–10%.`
        : `${formatCalories(Math.abs(diff))} kcal ${diff < 0 ? 'under' : 'over'} your target.`;
    return h('details', { class: 'calorie-breakdown day' },
        h('summary', { text: 'How today adds up' }),
        h('div', { class: 'breakdown-rows' }, rows.map(([slot, name, kcal, status]) => h('div', { class: 'breakdown-row' + (status === 'skipped' ? ' skipped' : '') },
            h('span', { class: 'what' }, name, h('small', { text: `${slot}${status === 'skipped' ? ' · skipped, not counted' : status === 'eaten' ? ' · eaten' : ''}` })),
            h('span', { class: 'kcal num', text: kcal != null ? formatCalories(kcal) : '—' }))),
            h('div', { class: 'breakdown-row total' }, h('span', { class: 'what', text: 'Total (about)' }), h('span', { class: 'kcal num', text: formatCalories(total) }))),
        h('p', { class: 'recipe-note', text: `${verdict} Every number is worked out from the ingredients as written; open a recipe to see its breakdown.` }));
}

function mealCard(type, meal, dayIndex, status) {
    const card = h('button', { type: 'button', class: 'meal-card' + (status ? ` ${status}` : ''), onclick: () => openRecipeSheet(type, meal, dayIndex) },
        h('div', { class: `meal-art art-${type}` }, icon(MEAL_ICONS[type])),
        h('div', { class: 'meal-content' },
            h('div', { class: 'meal-type', text: MEAL_LABELS[type] }),
            h('div', { class: 'meal-name', text: meal.name }),
            h('div', { class: 'meal-badges' },
                h('span', { class: 'chip' }, icon('i-clock'), mealTime(meal).text),
                on('show_nutrition') ? h('span', { class: 'chip' }, icon('i-flame'), `${formatCalories(meal.nutrition && meal.nutrition.calories)} kcal`) : null,
                portionLabel(meal) ? h('span', { class: 'chip', text: portionLabel(meal) }) : null,
                meal.builtin ? h('span', { class: 'chip', text: 'Nourish recipe' }) : null,
                meal.leftover ? h('span', { class: 'chip', text: 'Leftovers' }) : null,
                status === 'eaten' ? h('span', { class: 'chip ok' }, icon('i-check'), 'Eaten') : status === 'skipped' ? h('span', { class: 'chip', text: 'Skipped' }) : null,
                meal.incomplete ? h('span', { class: 'chip warn', text: 'May be incomplete' }) : null)),
        icon('i-chevron', 'chev'));
    // Tap the circle: eaten → skipped → not yet.
    const next = status === 'eaten' ? 'skipped' : status === 'skipped' ? null : 'eaten';
    const label = status === 'eaten' ? 'Eaten. Tap to mark skipped' : status === 'skipped' ? 'Skipped. Tap to clear' : 'Mark as eaten';
    return h('div', { class: 'meal-row' }, card,
        h('button', { type: 'button', class: `eat-btn${status ? ' ' + status : ''}`, 'aria-label': `${MEAL_LABELS[type]}: ${label}`, title: label,
            onclick: () => setMealStatus(dayIndex, type, next) }, icon(status === 'skipped' ? 'i-close' : 'i-check')));
}

// === FOOD LOG ===
// What was eaten: planned meals marked eaten or skipped, and anything extra (foodlog.js). Kept per
// date, so a plan day maps to this week's date for that weekday.
function dateOfDay(idx) {
    const now = new Date();
    const todayIdx = ((now.getDay() + 6) % 7 - dayBase() + 7) % 7;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() + (idx - todayIdx));
    return d;
}
function logKey(idx) { return NourishLog.dayKey(dateOfDay(idx)); }
function logEntry(idx) { return foodLog.days[logKey(idx)] || { items: [], meals: {} }; }
function todayStatOn(key) { return String(settings.today_stats || 'protein_g,carbs_g,fat_g').split(',').includes(key); }

function setMealStatus(dayIndex, type, status) {
    NourishLog.setMeal(foodLog, logKey(dayIndex), type, status);
    changed('log');
    const meal = daysData[dayIndex] && slotMeal(daysData[dayIndex], type);
    if (status && meal) learn(status === 'eaten' ? 'eaten' : 'skip', meal, { slot: isSnackSlot(type) ? 'snack' : type, hour: isToday(dayIndex) ? new Date().getHours() + new Date().getMinutes() / 60 : null });
    updateTodayScreen();
    if (status) showToast(status === 'eaten' ? 'Marked as eaten' : 'Marked as skipped', false);
}

// What's left today, in plain words, and a calm note (with an offer, never a change) when over.
function dayStatus(idx, day, t) {
    const target = Number(settings.calorie_target) || 2400;
    const over = Math.round(t.planned.calories - target);
    const parts = [];
    if (t.tracking) {
        // Left = the target minus everything in the day (eaten, still planned, and extras).
        const toCome = Math.round(t.planned.calories - t.eaten.calories);
        const left = Math.round(target - t.planned.calories);
        parts.push(h('p', { class: 'day-status' },
            h('span', {}, 'Eaten so far ', h('b', { class: 'num', text: `${formatCalories(t.eaten.calories)} kcal` })),
            toCome > 0 ? h('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }) : null,
            toCome > 0 ? h('span', {}, h('b', { class: 'num', text: `${formatCalories(toCome)} kcal` }), ' still planned') : null,
            left > 0 ? h('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }) : null,
            left > 0 ? h('span', {}, h('b', { class: 'num', text: `${formatCalories(left)} kcal` }), ' free for extras') : null));
    }
    parts.unshift(h('button', { type: 'button', class: 'quick-add', onclick: () => openFoodSheet(idx) }, icon('i-plus'),
        h('span', {}, h('b', { text: 'Add food' }), h('span', { text: 'A snack, a drink or anything extra' }))));
    if (over > target * 0.05 && t.extras.calories > 0) {
        const openToday = daySlots(day).filter(([s]) => !logEntry(idx).meals[s]);
        const tomorrow = idx + 1 < daysData.length ? idx + 1 : null;
        parts.push(h('div', { class: 'calm-note', role: 'note' },
            h('div', { class: 'calm-note-title', text: `About ${formatCalories(over)} kcal over your ${target.toLocaleString()} today` }),
            h('p', { text: "That's fine. One day doesn't undo a week. If you like, Nourish can make some meals a little lighter (smaller portions, less oil and sugar; seasoning stays)." }),
            h('div', { class: 'calm-note-actions' },
                openToday.length ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => offerLighten([idx], over, openToday.map(([s]) => s)) }, 'Lighten the rest of today') : null,
                tomorrow != null ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => offerLighten([tomorrow], over, null) }, `Lighten ${dayName(tomorrow)}`) : null)));
    }
    return parts.length ? h('div', { class: 'day-status-wrap' }, parts) : null;
}

// Asks first, then makes the chosen meals smaller to take off `kcal` in all.
function offerLighten(dayIdxs, kcal, slots) {
    const d = dayIdxs[0];
    const day = daysData[d];
    const which = (slots || daySlots(day).map(([s]) => s)).filter(s => slotMeal(day, s) && !logEntry(d).meals[s]);
    if (!which.length) { showToast('There are no meals left to lighten that day.'); return; }
    const total = which.reduce((sum, s) => sum + ((slotMeal(day, s).nutrition || {}).calories || 0), 0);
    const cut = Math.min(kcal, total * 0.35);   // never more than about a third
    const names = which.map(s => slotMeal(day, s).name).join(', ');
    if (!confirm(`Make ${isToday(d) ? "the rest of today's" : dayName(d) + "'s"} meals about ${formatCalories(cut)} kcal lighter?\n\n${names}\n\nPortions get a little smaller and oil and sugar are cut first. You can always generate a new plan.`)) return;
    which.forEach(s => {
        const meal = slotMeal(day, s);
        const n = meal.nutrition && meal.nutrition.calories;
        if (!n) return;
        const lighter = NourishPlanner.lighten(meal, cut * n / total, servingsWanted());
        if (isSnackSlot(s)) day.snacks[Number(s.slice(6)) - 1] = lighter; else day[s] = lighter;
    });
    changed('plan');
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
    showToast(`Done: ${which.length} meal${which.length > 1 ? 's' : ''} made lighter`, false);
}

function extrasSection(idx, entry) {
    const items = entry.items || [];
    const total = items.reduce((sum, x) => sum + x.nutrition.calories, 0);
    return h('section', { class: 'extras' },
        h('h2', { class: 'section-title' }, 'Snacks and extras',
            h('button', { type: 'button', class: 'btn btn-secondary btn-small add-food-btn', onclick: () => openFoodSheet(idx) }, icon('i-plus'), 'Add')),
        items.length
            ? h('div', { class: 'log-list' }, items.map(it => h('button', { type: 'button', class: 'log-item', onclick: () => openFoodSheet(idx, it) },
                h('span', { class: 'log-item-body' },
                    h('span', { class: 'log-item-name', text: it.name }),
                    h('span', { class: 'log-item-amount', text: `${formatAmountLabel(it)}${it.estimate ? ' · estimate' : ''}` })),
                h('span', { class: 'log-item-kcal num', text: `${formatCalories(it.nutrition.calories)} kcal` }),
                icon('i-chevron', 'chev'))).concat(items.length > 1 ? [h('div', { class: 'log-total' }, h('span', { text: 'Extras today' }), h('span', { class: 'num', text: `${formatCalories(total)} kcal` }))] : []))
            : h('button', { type: 'button', class: 'log-empty', onclick: () => openFoodSheet(idx) }, icon('i-plus'),
                h('span', {}, h('b', { text: 'Had a snack or a drink?' }), ' Add anything you ate or drank that isn’t in the plan.')));
}
function formatAmountLabel(it) {
    const n = NourishUnits.formatQty ? NourishUnits.formatQty(it.amount) : String(it.amount);
    return `${n} ${it.unit}`;
}

// === ADD FOOD ===
// Type it in plain words, search, pick a recent or favorite, or scan a barcode. Every amount can be
// changed before it's saved. Numbers come from the USDA table or Open Food Facts, and say "estimate".
let foodDraft = null;   // { idx, items: [], editId }
function openFoodSheet(idx, editItem = null) {
    foodDraft = { idx, items: editItem ? [Object.assign({}, editItem)] : [], editId: editItem ? editItem.id : null, busy: '', note: '' };
    renderFoodSheet();
    $('foodSheet').classList.add('active');
    if (!editItem) setTimeout(() => { const i = $('foodText'); if (i) i.focus(); }, 350);
}
function closeFoodSheet() { $('foodSheet').classList.remove('active'); foodDraft = null; }

async function addFoodFromText() {
    const text = $('foodText').value.trim();
    if (!text) return;
    const found = NourishLog.parse(text);
    foodDraft.note = '';
    for (const it of found) {
        if (!it.unmatched) { foodDraft.items.push(it); continue; }
        // Not in the food table: ask Open Food Facts (online), else let the person type the calories.
        foodDraft.busy = `Looking up "${it.text}"…`;
        renderFoodSheet();
        const online = await lookupFoodOnline(it.text).catch(() => null);
        foodDraft.items.push(online || Object.assign(NourishLog.manual(it.text, 0), { needsCalories: true }));
    }
    foodDraft.busy = '';
    $('foodText').value = '';
    renderFoodSheet();
}
async function lookupFoodOnline(name) {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,nutriments,serving_quantity,serving_size,code`;
    const res = await fetchForImport(url, { browser: false });
    if (!res || res.status >= 400) return null;
    const data = JSON.parse(res.body || '{}');
    for (const p of data.products || []) { const it = NourishLog.fromOpenFoodFacts(p); if (it) return it; }
    return null;
}
async function lookupBarcode(code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length < 6) { showToast('That barcode number looks too short.'); return; }
    foodDraft.busy = 'Looking up the barcode…';
    renderFoodSheet();
    try {
        const res = await fetchForImport(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity,serving_size,code`, { browser: false });
        const data = res && res.status < 400 ? JSON.parse(res.body || '{}') : {};
        const it = data && data.product ? NourishLog.fromOpenFoodFacts(data.product, code) : null;
        if (it) foodDraft.items.push(it);
        else foodDraft.note = "That product isn't in Open Food Facts yet. Type what it was instead.";
    } catch (e) {
        foodDraft.note = "Couldn't look up the barcode. Check your internet connection, or type what it was.";
    }
    foodDraft.busy = '';
    renderFoodSheet();
}
// A photo of a barcode (or the camera, where the browser can read barcodes itself).
async function scanBarcode(file) {
    try {
        let code = null;
        if (typeof BarcodeDetector !== 'undefined') {
            const bmp = await createImageBitmap(file);
            const found = await new BarcodeDetector().detect(bmp);
            code = found && found[0] && found[0].rawValue;
        } else if (canReadTextOnPhone()) {
            const image = await imageForReading(file);
            const r = await nativeCall('barcode', { image: image.data }, { timeoutMs: 30000 });
            code = r && r.code;
        }
        if (!code) { foodDraft.note = "No barcode found in that photo. Try again closer, or type the number under the barcode."; renderFoodSheet(); return; }
        await lookupBarcode(code);
    } catch (e) {
        foodDraft.note = "Couldn't read that photo. Try again, or type the number under the barcode.";
        renderFoodSheet();
    }
}

function renderFoodSheet() {
    const d = foodDraft;
    if (!d) return;
    const editing = !!d.editId;
    const total = d.items.reduce((sum, x) => sum + (x.nutrition.calories || 0), 0);
    const stepFor = it => (it.amount >= 4 ? 1 : it.unit === 'g' || it.unit === 'ml' ? 25 : 0.5);
    const row = (it, i) => h('div', { class: 'food-row' },
        h('div', { class: 'food-row-top' },
            h('div', { class: 'food-row-name' }, h('b', { text: it.name }),
                h('span', { class: 'food-row-src', text: it.source === 'you' ? 'your numbers' : `${it.source || 'USDA'}${it.estimate ? ' · estimate' : ''}` })),
            h('button', { type: 'button', class: `icon-btn fav-btn${NourishLog.isFavorite(foodLog, it) ? ' on' : ''}`, 'aria-label': 'Favorite', onclick: () => { NourishLog.toggleFavorite(foodLog, it); changed('log'); renderFoodSheet(); } }, icon('i-heart')),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${it.name}`, onclick: () => { d.items.splice(i, 1); renderFoodSheet(); } }, icon('i-trash'))),
        it.needsCalories
            ? h('label', { class: 'food-kcal-input' }, h('span', { text: "Not in the food list. Calories, if you know them:" }),
                h('input', { type: 'number', inputmode: 'numeric', min: '0', class: 'settings-input num', value: it.nutrition.calories || '', oninput: e => { d.items[i] = Object.assign(NourishLog.manual(it.name, e.target.value), { needsCalories: true }); updateFoodTotal(); } }))
            : h('div', { class: 'food-row-amount' },
                h('div', { class: 'stepper' },
                    h('button', { type: 'button', 'aria-label': 'Less', onclick: () => { d.items[i] = NourishLog.setAmount(it, Math.max(stepFor(it) === 0.5 ? 0.25 : stepFor(it), it.amount - stepFor(it))); renderFoodSheet(); } }, '−'),
                    h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', class: 'num', value: String(Math.round(it.amount * 100) / 100), 'aria-label': 'Amount',
                        onchange: e => { d.items[i] = NourishLog.setAmount(it, e.target.value); renderFoodSheet(); } }),
                    h('button', { type: 'button', 'aria-label': 'More', onclick: () => { d.items[i] = NourishLog.setAmount(it, it.amount + stepFor(it)); renderFoodSheet(); } }, '+')),
                h('span', { class: 'food-unit', text: it.unit }),
                h('span', { class: 'food-row-kcal num', text: `${formatCalories(it.nutrition.calories)} kcal` })),
        it.needsCalories ? null : h('div', { class: 'food-row-macros num', text: `P ${Math.round(it.nutrition.protein_g)} g · C ${Math.round(it.nutrition.carbs_g)} g · F ${Math.round(it.nutrition.fat_g)} g${it.grams ? ` · ${Math.round(it.grams)} g` : ''}` }));
    const chips = (list, label) => list.length ? h('div', { class: 'food-chips-wrap' }, h('div', { class: 'label', text: label }),
        h('div', { class: 'food-chips' }, list.slice(0, 12).map(it => h('button', { type: 'button', class: 'filter-chip', onclick: () => { d.items.push(Object.assign({}, it)); renderFoodSheet(); } }, `${it.name} · ${formatCalories(it.nutrition.calories)}`)))) : null;
    const results = d.search ? NourishLog.search(d.search) : [];
    setChildren($('foodSheetContent'),
        h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
        h('div', { class: 'sheet-header' },
            h('div', {}, h('div', { class: 'eyebrow', text: isToday(d.idx) ? 'Today' : dayName(d.idx) }), h('h2', { class: 'title', text: editing ? 'Edit food' : 'Add food' })),
            h('button', { type: 'button', class: 'icon-btn btn-close', 'aria-label': 'Close', onclick: closeFoodSheet }, icon('i-close'))),
        h('div', { class: 'sheet-body' },
            editing ? null : h('div', { class: 'input-group' },
                h('label', { class: 'label', for: 'foodText', text: 'What did you have?' }),
                h('div', { class: 'food-input' },
                    h('input', { id: 'foodText', type: 'text', placeholder: 'e.g. 2 slices of pizza and a coffee', autocomplete: 'off', enterkeyhint: 'done',
                        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addFoodFromText(); } } }),
                    h('button', { type: 'button', class: 'btn btn-secondary', onclick: addFoodFromText }, 'Add'))),
            d.busy ? h('p', { class: 'sheet-hint' }, h('span', { class: 'job-bar-spinner', 'aria-hidden': 'true' }), ' ', d.busy) : null,
            d.note ? h('p', { class: 'form-error', role: 'alert', text: d.note }) : null,
            d.items.length ? h('div', { class: 'food-rows' }, d.items.map(row)) : null,
            editing ? null : h('div', { class: 'input-group' },
                h('label', { class: 'label', for: 'foodSearch', text: 'Search foods' }),
                h('input', { id: 'foodSearch', type: 'search', placeholder: 'e.g. banana, yogurt, cola', value: d.search || '', autocomplete: 'off',
                    oninput: e => { d.search = e.target.value; const pos = e.target.selectionStart; renderFoodSheet(); const el = $('foodSearch'); el.focus(); el.setSelectionRange(pos, pos); } }),
                results.length ? h('div', { class: 'food-results' }, results.map(it => h('button', { type: 'button', class: 'food-result', onclick: () => { d.items.push(it); d.search = ''; renderFoodSheet(); } },
                    h('span', { text: it.name }), h('span', { class: 'num', text: `${formatCalories(it.nutrition.calories)} kcal · 1 ${it.unit}` })))) : null),
            editing ? null : chips(foodLog.favorites, 'Favorites'),
            editing ? null : chips(foodLog.recents.filter(r => !NourishLog.isFavorite(foodLog, r)), 'Recent'),
            editing ? null : h('div', { class: 'input-group' },
                h('div', { class: 'label', text: 'Packaged food' }),
                h('div', { class: 'food-barcode' },
                    !(typeof BarcodeDetector !== 'undefined' || canReadTextOnPhone()) ? null : h('label', { class: 'btn btn-secondary' }, icon('i-image'), 'Photo of the barcode',
                        h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: e => { const f = e.target.files && e.target.files[0]; if (f) scanBarcode(f); e.target.value = ''; } })),
                    h('input', { id: 'foodBarcode', type: 'text', inputmode: 'numeric', placeholder: 'or type the barcode number', autocomplete: 'off',
                        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); lookupBarcode(e.target.value); } } })),
                h('p', { class: 'sheet-hint', text: typeof BarcodeDetector !== 'undefined' || canReadTextOnPhone()
                    ? 'Barcodes are looked up in Open Food Facts, a free food database.'
                    : 'Type the number under the barcode; it\u2019s looked up in Open Food Facts, a free food database. (This device can\u2019t read barcodes from photos.)' })),
            h('p', { class: 'sheet-hint', text: 'Calories are worked out from USDA food data and typical portions, so they’re estimates. Change the amount if yours was bigger or smaller.' }),
            h('div', { class: 'food-actions' },
                editing ? h('button', { type: 'button', class: 'btn btn-secondary danger', onclick: () => { NourishLog.remove(foodLog, logKey(d.idx), d.editId); changed('log'); closeFoodSheet(); updateTodayScreen(); showToast('Removed', false); } }, icon('i-trash'), 'Delete') : null,
                h('button', { type: 'button', class: 'btn btn-primary', id: 'foodSave', disabled: !d.items.length, onclick: saveFood },
                    icon('i-check'), editing ? 'Save' : d.items.length ? `Add ${d.items.length > 1 ? d.items.length + ' items' : ''} · ` : 'Add', h('span', { class: 'num', id: 'foodTotal', text: d.items.length ? `${formatCalories(total)} kcal` : '' })))));
}
function updateFoodTotal() {
    const el = $('foodTotal');
    if (el && foodDraft) el.textContent = `${formatCalories(foodDraft.items.reduce((s, x) => s + (x.nutrition.calories || 0), 0))} kcal`;
}
function saveFood() {
    const d = foodDraft;
    if (!d || !d.items.length) return;
    const key = logKey(d.idx);
    if (d.editId) NourishLog.update(foodLog, key, d.editId, d.items[0]);
    else d.items.forEach(it => NourishLog.add(foodLog, key, Object.assign({}, it, { needsCalories: undefined })));
    changed('log');
    if (!d.editId) d.items.forEach(it => learn('log', { name: it.name, ingredients: [it.name] }));
    const n = d.items.length;
    closeFoodSheet();
    updateTodayScreen();
    showToast(d.editId ? 'Saved' : `Added ${n} item${n > 1 ? 's' : ''}`, false);
}

// === PLAN SCREEN ===
function updatePlanScreen() {
    const container = $('planAccordions');
    if (!container) return;
    $('planEyebrow').textContent = daysData.length ? `${daysData.length} day${daysData.length === 1 ? "" : "s"} · from ${dayName(0, true)}` : 'Your week';
    const cooking = cookingPanel('plan');
    if (!daysData.length && cooking) { setChildren(container, cooking); return; }
    if (!daysData.length) {
        setChildren(container, h('div', { class: 'empty-state' },
            h('div', { class: 'empty-art' }, icon('i-calendar')),
            h('h2', { class: 'title', text: 'Your week is empty' }),
            h('p', { text: 'Generate a plan, ask the chef in Chat, or add recipes from links with the link button above.' }),
            h('div', { class: 'empty-actions' },
                h('button', { type: 'button', class: 'btn btn-primary', onclick: showGenerateSheet }, icon('i-sparkle'), 'Generate Meal Plan'))));
        return;
    }
    setChildren(container, cooking, ...daysData.map((day, idx) => h('section', { class: `card plan-day${isToday(idx) ? ' is-today' : ''}` },
        h('div', { class: 'plan-day-head' },
            h('div', {},
                h('div', { class: 'eyebrow', text: `Day ${idx + 1}${isToday(idx) ? ' · Today' : ''}` }),
                h('h2', { class: 'title', text: dayName(idx) })),
            on('show_nutrition') && hasNutrition(day) ? h('span', { class: 'chip accent' }, icon('i-flame'), `${formatCalories(sumNutrient(day, 'calories'))} kcal`) : null),
        MEAL_TYPES.map(t => day[t]
            ? h('button', { type: 'button', class: 'plan-meal', 'data-meal-type': t, onclick: () => openRecipeSheet(t, day[t], idx) },
                h('span', { class: `dot art-${t}` }, icon(MEAL_ICONS[t])),
                h('span', { class: 'plan-meal-body' },
                    h('span', { class: 'plan-meal-type', text: MEAL_LABELS[t] }),
                    h('span', { class: 'plan-meal-name', text: day[t].name }),
                    day[t].incomplete ? h('span', { class: 'plan-meal-warn', text: 'May be incomplete · tap to try again' }) : null),
                h('span', { class: 'plan-meal-meta', text: [mealTime(day[t]).text, on('show_nutrition') ? `${formatCalories(day[t].nutrition && day[t].nutrition.calories)} kcal` : '', portionLabel(day[t])].filter(Boolean).join(' · ') }))
            : h('button', { type: 'button', class: 'plan-meal empty', 'data-meal-type': t, onclick: () => showImportSheet(idx, t) },
                h('span', { class: `dot art-${t}` }, icon('i-plus')),
                h('span', { class: 'plan-meal-body' },
                    h('span', { class: 'plan-meal-type', text: MEAL_LABELS[t] }),
                    h('span', { class: 'plan-meal-name', text: 'Add a recipe from a link' }))))
            .concat((day.snacks || []).map((m, i) => h('button', { type: 'button', class: 'plan-meal', 'data-meal-type': 'snack', onclick: () => openRecipeSheet(`snack-${i + 1}`, m, idx) },
                h('span', { class: 'dot art-snack' }, icon('i-leaf')),
                h('span', { class: 'plan-meal-body' },
                    h('span', { class: 'plan-meal-type', text: 'Snack' }),
                    h('span', { class: 'plan-meal-name', text: m.name })),
                h('span', { class: 'plan-meal-meta', text: on('show_nutrition') ? `${formatCalories(m.nutrition && m.nutrition.calories)} kcal` : mealTime(m).text })))))));
}

// === GROCERY SCREEN ===
function initGrocery() {
    $('groceryShareBtn').addEventListener('click', shareGrocery);
    $('groceryResetBtn').addEventListener('click', resetGrocery);
}

// One row per thing to buy, merged across the week (grocery.js). Ticks are kept by the row's key.
const GROCERY_ORDER = NourishGrocery.CATEGORIES.map(c => c[0]).concat(['Other']);

function groceryItems() {
    const items = {};
    const withSnacks = daysData.map(d => Object.assign({}, d, Object.fromEntries((d.snacks || []).map((m, i) => [`snack-${i + 1}`, m]))));
    NourishGrocery.buildList(withSnacks, MEAL_TYPES.concat(['snack-1', 'snack-2', 'snack-3']), unitSystem()).forEach(row => {
        if (!items[row.category]) items[row.category] = [];
        items[row.category].push(row);
    });
    return items;
}

// Each aisle gets its own colour dot.
const GROCERY_COLORS = { Protein: 'var(--fat)', Dairy: '#A9C7E8', 'Grains & bakery': 'var(--carbs)', Produce: 'var(--protein)', Pantry: '#C9A27E', Other: 'var(--text-3)' };
function updateGroceryScreen() {
    const container = $('groceryContainer');
    if (!container) return;
    const items = groceryItems();
    const categories = GROCERY_ORDER.filter(c => items[c]);
    const checked = new Set(grocery.checked);
    const hide = on('grocery_hide_checked');
    const planCount = categories.reduce((n, c) => n + items[c].length, 0);
    const total = planCount + grocery.custom.length;
    const done = categories.reduce((n, c) => n + items[c].filter(i => checked.has(i.key)).length, 0) + grocery.custom.filter(c => c.checked).length;

    const input = h('input', { type: 'text', id: 'groceryAddInput', placeholder: 'Add an item…', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Add an item',
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addCustomItem(input); } } });
    const addRow = h('div', { class: 'add-item' }, input,
        h('button', { type: 'button', class: 'icon-btn accent', 'aria-label': 'Add', onclick: () => addCustomItem(input) }, icon('i-plus')));

    if (!total) {
        setChildren(container,
            h('div', { class: 'empty-state' },
                h('div', { class: 'empty-art' }, icon('i-cart')),
                h('h2', { class: 'title', text: 'No grocery list yet' }),
                h('p', { text: daysData.length ? 'This plan has no ingredient lists. Add items yourself below.' : 'Generate a meal plan and its ingredients show up here, sorted by aisle. You can add your own items too.' })),
            addRow);
        return;
    }

    const itemRow = (text, isChecked, onToggle, onRemove) => (hide && isChecked) ? null : h('label', { class: 'grocery-item' + (isChecked ? ' checked' : '') },
        h('input', { type: 'checkbox', checked: isChecked, onchange: e => onToggle(e.target) }),
        h('span', { class: 'grocery-item-text', text }),
        onRemove ? h('button', { type: 'button', class: 'remove', 'aria-label': `Remove ${text}`, onclick: e => { e.preventDefault(); onRemove(); } }, icon('i-close')) : null);

    const sections = [];
    if (grocery.custom.length) {
        sections.push(h('section', { class: 'card grocery-category', style: '--cat:var(--accent)' },
            h('div', { class: 'category-header' }, h('span', { text: 'Added by you' }), h('span', { class: 'count', text: `${grocery.custom.filter(c => c.checked).length}/${grocery.custom.length}` })),
            grocery.custom.map((item, i) => itemRow(item.text, item.checked,
                box => { grocery.custom[i].checked = box.checked; groceryChanged(box); },
                () => { grocery.custom.splice(i, 1); changed('grocery'); updateGroceryScreen(); }))));
    }
    for (const cat of categories) {
        sections.push(h('section', { class: 'card grocery-category', style: `--cat:${GROCERY_COLORS[cat] || 'var(--text-3)'}` },
            h('div', { class: 'category-header' }, h('span', { text: cat }), h('span', { class: 'count', text: `${items[cat].filter(i => checked.has(i.key)).length}/${items[cat].length}` })),
            items[cat].map(item => itemRow(item.text, checked.has(item.key), box => toggleGrocery(item.key, box)))));
    }
    const pct = total ? Math.round(done / total * 100) : 0;
    setChildren(container,
        h('section', { class: 'card grocery-progress' },
            h('div', { class: 'big num', text: `${pct}%` }),
            h('div', { class: 'info' },
                h('div', { class: 'progress-label', id: 'progressLabel', text: done === total ? 'All done — enjoy your week!' : `${done} of ${total} items` }),
                h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill', id: 'progressFill', style: `width:${pct}%` })))),
        addRow,
        sections,
        hide && done ? h('p', { class: 'empty-note', text: `${done} ticked item${done === 1 ? '' : 's'} hidden` }) : null);
}

function groceryChanged(box) {
    changed('grocery');
    if (box && !on('grocery_hide_checked')) {
        // Update in place so the list doesn't jump while shopping.
        const row = box.closest('.grocery-item');
        if (row) row.classList.toggle('checked', box.checked);
        const all = document.querySelectorAll('#groceryContainer .grocery-item input[type="checkbox"]');
        const done = Array.prototype.filter.call(all, b => b.checked).length;
        const pct = all.length ? Math.round(done / all.length * 100) : 0;
        $('progressLabel').textContent = done === all.length ? 'All done — enjoy your week!' : `${done} of ${all.length} items`;
        $('progressFill').style.width = pct + '%';
        const big = document.querySelector('.grocery-progress .big');
        if (big) big.textContent = `${pct}%`;
        const section = row && row.closest('.grocery-category');
        if (section) {
            const boxes = section.querySelectorAll('input[type="checkbox"]');
            section.querySelector('.count').textContent = `${Array.prototype.filter.call(boxes, b => b.checked).length}/${boxes.length}`;
        }
    } else {
        updateGroceryScreen();
    }
}

function toggleGrocery(item, box) {
    grocery.checked = grocery.checked.filter(x => x !== item);
    if (box.checked) grocery.checked.push(item);
    groceryChanged(box);
}

function addCustomItem(input) {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    grocery.custom.push({ text: text.slice(0, 200), checked: false });
    changed('grocery');
    updateGroceryScreen();
    const again = $('groceryAddInput');
    if (again) again.focus();
}

function resetGrocery() {
    if (!grocery.checked.length && !grocery.custom.some(c => c.checked)) { showToast('Nothing is ticked', false); return; }
    grocery.checked = [];
    grocery.custom.forEach(c => { c.checked = false; });
    changed('grocery');
    updateGroceryScreen();
    showToast('Unticked everything', false);
}

function clearCustomGrocery() {
    if (!grocery.custom.length) { showToast('You haven\'t added any items', false); return; }
    if (!confirm('Remove the items you added to the grocery list?')) return;
    grocery.custom = [];
    changed('grocery');
    updateGroceryScreen();
    renderSettings();
    showToast('Removed', false);
}

function groceryText() {
    const items = groceryItems();
    const checked = new Set(grocery.checked);
    const lines = ['Nourish grocery list'];
    const custom = grocery.custom.filter(c => !c.checked);
    if (custom.length) lines.push('', 'Added by you', ...custom.map(c => `• ${c.text}`));
    for (const cat of GROCERY_ORDER) {
        const left = (items[cat] || []).filter(i => !checked.has(i.key));
        if (left.length) lines.push('', cat, ...left.map(i => `• ${i.text}`));
    }
    return lines.length > 1 ? lines.join('\n') : '';
}

function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    // Phones open Nourish over plain http on the home network, where the clipboard API is blocked.
    return legacyCopy(text);
}

function legacyCopy(text) {
    const area = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* not supported */ }
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
}

async function shareGrocery() {
    const text = groceryText();
    if (!text) { showToast('Nothing left to buy', false); return; }
    if (navigator.share) {
        try { await navigator.share({ title: 'Grocery list', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyText(text).then(() => showToast('List copied — paste it anywhere', false), () => showToast("Couldn't copy the list on this device"));
}

// === PLAN DATA ===
function toNumber(v) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
}
function toStringList(v) {
    return Array.isArray(v) ? v.map(x => typeof x === 'string' ? x.trim() : ((x && (x.name || x.text)) || '')).filter(Boolean).map(String) : [];
}

// One line per thing (a repeat of an earlier line is dropped) and impossible amounts capped
// ("1 cup curry paste" → "2 tbsp curry paste"; each cap is logged once per plan).
let reportCaps = false;
function cleanIngredients(list, dish) {
    return NourishGrocery.dedupeIngredients(list).map(line => {
        const c = NourishUnits.clampIngredient(line);
        if (c.clamped && reportCaps) nlog('plan', `Amount capped in "${dish}": "${line}" → "${c.line}" (${c.clamped})`, null, 'warn');
        return c.line;
    });
}

// The amount and unit of each ingredient, kept apart from the words, so any unit system can be shown
// exactly ({ qty: 0.5, unit: 'cup', text: 'green curry paste' }).
function ingredientAmounts(list) {
    return list.map(line => NourishUnits.splitIngredient(line));
}

function normalizeMeal(m) {
    if (!m || typeof m !== 'object' || !m.name) return null;
    const n = m.nutrition && typeof m.nutrition === 'object' ? m.nutrition : null;
    const ingredients = cleanIngredients(toStringList(m.ingredients), m.name);
    const written = !m.source_url && !m.library_path;   // by the AI: its spelling is checked
    const out = Object.assign({
        name: written && typeof NourishPlanner !== 'undefined' ? NourishPlanner.fixName(String(m.name).trim()) : String(m.name).trim(),
        servings: toNumber(m.servings) >= 1 ? Math.round(toNumber(m.servings)) : undefined,
        time_minutes: toNumber(m.time_minutes),
        nutrition: n ? { calories: toNumber(n.calories), protein_g: toNumber(n.protein_g), carbs_g: toNumber(n.carbs_g), fat_g: toNumber(n.fat_g) } : null,
        ingredients,
        amounts: ingredientAmounts(ingredients),
        steps: toStringList(m.steps),
        // What the recipe checks (recipes.js) still found wrong after the remakes; shown on the recipe.
        incomplete: Array.isArray(m.incomplete) && m.incomplete.length ? m.incomplete.map(String).slice(0, 12) : undefined,
        nutrition_basis: m.nutrition_basis === 'source' || m.nutrition_basis === 'calculated' ? m.nutrition_basis : undefined,
        nutrition_unmatched: Array.isArray(m.nutrition_unmatched) && m.nutrition_unmatched.length ? m.nutrition_unmatched.map(String).slice(0, 12) : undefined,
        nutrition_assumed: Array.isArray(m.nutrition_assumed) && m.nutrition_assumed.length ? m.nutrition_assumed.slice(0, 12).map(a => ({ line: String(a.line || ''), amount: String(a.amount || '') })) : undefined,
        nutrition_check: m.nutrition_check && Number(m.nutrition_check.source) > 0 ? { source: toNumber(m.nutrition_check.source), calculated: toNumber(m.nutrition_check.calculated) } : undefined,
        scaled: m.scaled && Number(m.scaled.portion) > 0 ? { from_servings: toNumber(m.scaled.from_servings), portion: toNumber(m.scaled.portion) } : undefined,
        reseasoned: Array.isArray(m.reseasoned) && m.reseasoned.length ? m.reseasoned.map(String).slice(0, 6) : undefined,
        trimmed: m.trimmed ? true : undefined,
        active_minutes: toNumber(m.active_minutes) > 0 ? toNumber(m.active_minutes) : undefined,
        quick: m.quick ? true : undefined,
        wait_minutes: toNumber(m.wait_minutes) > 0 ? toNumber(m.wait_minutes) : undefined,
        time_estimated: m.time_estimated ? true : undefined,
        leftover: m.leftover ? true : undefined,
        builtin: m.builtin ? true : undefined,
        adapted: Array.isArray(m.adapted) && m.adapted.length ? m.adapted.map(String).slice(0, 4) : undefined,
        description: m.description ? String(m.description).slice(0, 200) : undefined,
        rating: m.rating && Number(m.rating.value) > 0 ? { value: toNumber(m.rating.value), count: toNumber(m.rating.count) || 0 } : undefined,
        cuisine: m.cuisine ? String(m.cuisine).slice(0, 30) : undefined,
        // The meal the recipe's source files it under: part of telling a breakfast from a dinner.
        category: Array.isArray(m.category) ? m.category.map(String).slice(0, 6) : m.category ? String(m.category).slice(0, 80) : undefined,
        library_path: m.library_path ? String(m.library_path).slice(0, 300) : undefined,
    }, safeSource(m));
    // Nutrition is never taken on trust: it's calculated from the ingredients (USDA data, nutrition.js),
    // and a source's own numbers are kept only when they agree within 15%.
    if (!out.nutrition_basis && out.ingredients.length && typeof NourishNutrition !== 'undefined') {
        NourishNutrition.settle(Object.assign(out, { servings: out.servings || 1 }));
        // Nothing could be counted (no amounts): unknown, shown as "—", never the AI's guess.
        if (!out.nutrition || !(out.nutrition.calories > 0)) out.nutrition = n ? { calories: null, protein_g: null, carbs_g: null, fat_g: null } : null;
    }
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
    return out;
}

function safeSource(m) {
    try {
        const url = new URL(m.source_url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return {};
        const out = { source_url: url.href, source_name: String(m.source_name || url.hostname.replace(/^www\./, '')).slice(0, 60) };
        if (m.via_url && /^https?:\/\//i.test(m.via_url)) Object.assign(out, { via_url: String(m.via_url), via_name: String(m.via_name || '').slice(0, 40) });
        return out;
    } catch (e) {
        return {};
    }
}

// Returns a clean array of days. With strict=true, throws a user-readable error if unusable.
function normalizePlan(data, strict = true) {
    const days = (data && Array.isArray(data.days) ? data.days : Array.isArray(data) ? data : [])
        .filter(d => d && typeof d === 'object')
        .map(d => {
            const out = Object.fromEntries(MEAL_TYPES.map(t => [t, normalizeMeal(d[t])]));
            const snacks = (Array.isArray(d.snacks) ? d.snacks : []).map(normalizeMeal).filter(Boolean).slice(0, 3);
            if (snacks.length) out.snacks = snacks;
            return out;
        })
        .filter(d => MEAL_TYPES.some(t => d[t]) || (d.snacks && d.snacks.length))
        .slice(0, 7);
    if (strict && !days.length) throw new Error("The response didn't contain any meals. Try again, or try another model.");
    return days;
}

function applyPlan(raw, { navigate = true } = {}) {
    reportCaps = true;
    try { daysData = normalizePlan(raw); } finally { reportCaps = false; }
    const planNames = () => daysData.flatMap(d => MEAL_TYPES.map(x => d && d[x] && d[x].name).filter(Boolean));
    // Breakfast is breakfast, for plans the AI wrote in one go too: a meal that breaks its slot's
    // rules (or the person's schedule) is replaced by a simple built-in one that fits.
    // Never the same meal twice in a plan (a leftover lunch, when allowed, is the exception).
    const seen = NourishPlanner.dishList();
    daysData.forEach((d, i) => MEAL_TYPES.forEach(t => {
        const meal = d && d[t];
        if (!meal || meal.leftover) return;
        if (seen.has(meal.name)) {
            const other = builtinFor(t, i, planNames());
            nlog('plan', `${dayName(i)} ${t}: "${meal.name}" is already in the plan${other ? `; replaced by "${other.name}"` : ''}`, null, 'warn');
            if (other) d[t] = normalizeMeal(other);
        }
        seen.add(d[t].name);
    }));
    daysData.forEach((d, i) => MEAL_TYPES.forEach(t => {
        const misfit = d && d[t] ? slotCheck(d[t], t, i) : '';
        if (!misfit) return;
        const quick = builtinFor(t, i, planNames());
        nlog('plan', `${dayName(i)} ${t}: "${d[t].name}" ${misfit}${quick ? `; replaced by "${quick.name}"` : ''}`, null, 'warn');
        if (quick) d[t] = normalizeMeal(quick);
    }));
    // Snacks (Profile → Meals each day): plans the AI wrote get them here too.
    if (NourishPlanner.snacksOf(settings)) {
        const exclude = NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet });
        daysData.forEach((d, i) => {
            if (d.snacks && d.snacks.length) return;
            NourishPlanner.addSnacks(d, settings, i, servingsWanted(), exclude);
            if (d.snacks) d.snacks = d.snacks.map(normalizeMeal).filter(Boolean);
        });
    }
    rememberPlan(planNames());
    selectedDay = todayIndex();
    grocery.checked = [];
    changed('plan');
    changed('grocery');
    renderAll();
    if (navigate) switchTab('today');
    showToast(daysData.length < 7 ? `Got ${daysData.length} of 7 days (the response was cut short).` : 'Your meal plan is ready 🎉', daysData.length < 7);
}

// Applies {"changes":[{day, meal, recipe}]} from the AI. Returns what changed.
function applyEdits(parsed) {
    if (parsed && !Array.isArray(parsed.changes) && Array.isArray(parsed.days)) {
        applyPlan(parsed, { navigate: false });
        return { replacedPlan: true, changes: [] };
    }
    const list = parsed && Array.isArray(parsed.changes) ? parsed.changes : parsed && parsed.recipe ? [parsed] : [];
    const done = [];
    for (const c of list) {
        const day = Math.round(toNumber(c && c.day)) - 1;
        const meal = String((c && c.meal) || '').toLowerCase();
        reportCaps = true;
        let recipe;
        try { recipe = normalizeMeal(c && (c.recipe || c.new_recipe)); } finally { reportCaps = false; }
        if (!(day >= 0 && day < 7) || !MEAL_TYPES.includes(meal) || !recipe) continue;
        while (daysData.length <= day) daysData.push({ breakfast: null, lunch: null, dinner: null });
        daysData[day][meal] = recipe;
        done.push({ day: day + 1, meal, name: recipe.name });
    }
    if (!done.length) throw new Error("The AI didn't send back any usable changes. Try asking again, a bit more specifically.");
    changed('plan');
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
    return { replacedPlan: false, changes: done };
}

// === THE APP LEARNS THE PERSON (taste.js) ===
// Everything someone does with their food goes into a private taste profile: kept on this device,
// synced to their own PC, never sent anywhere else (cloud AIs don't get it).
let tasteCache = null;
function tasteProfile() {
    if (!tasteCache) tasteCache = NourishTaste.profile(taste);
    return tasteCache;
}
function learn(type, recipe, extra) {
    if (!taste.on) return;
    try {
        if (NourishTaste.record(taste, type, recipe, extra || {})) { tasteCache = null; changed('taste'); }
    } catch (e) { nlog('taste', `Couldn't note that: ${e.message}`, null, 'warn'); }
}
// Recipes scored for the person (−1…1), with a small push towards something new now and then.
function tasteScorer() {
    const prof = tasteProfile();
    if (!prof.on || !prof.learnedAnything) return null;
    const seed = Math.floor(Date.now() / (7 * 86400000));
    return r => NourishTaste.score(prof, r, { explore: true, seed });
}
// Recipes they loved or saved, offered again as often as they like favourites back.
// A built-in recipe for a slot that fits its rules and isn't one of `taken` (the plan's dishes),
// closest to the slot's share of the day; the quick meals when the built-in set has nothing.
function builtinFor(type, d, taken) {
    const used = NourishPlanner.dishList(taken || []);
    const recent = NourishPlanner.dishList(recentPlanDishes());
    const kcal = (Number(settings.calorie_target) || 2000) * (NourishPlanner.splitOf(settings)[MEAL_TYPES.indexOf(type)] || 0.33);
    const exclude = NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet });
    if (settings.builtin_mode === 'off') return null;
    const list = typeof NourishBuiltins !== 'undefined' ? NourishBuiltins.forMeal(type) : [];
    const ok = list.filter(r => !used.has(r.name) && !exclude(r) && !slotCheck(r, type, d))
        .sort((a, b) => (recent.has(a.name) ? 1 : 0) - (recent.has(b.name) ? 1 : 0) || Math.abs(Math.log(kcal / a.nutrition.calories)) - Math.abs(Math.log(kcal / b.nutrition.calories)));
    const pick = ok.length ? ok[Math.floor(Math.random() * Math.min(5, ok.length))] : null;
    return pick ? JSON.parse(JSON.stringify(pick)) : quickMealFor(type, d, taken);
}

// === NO REPEATS ===
// Every plan's dishes are remembered for 14 days, so the next plans bring new ones (favourites
// excepted: recipes saved to the Cookbook or rated "loved it" can come back).
const PLAN_HISTORY_KEY = 'nourish_plan_history';
const PLAN_MEMORY_DAYS = 14;
function rememberPlan(names) {
    const since = Date.now() - PLAN_MEMORY_DAYS * 864e5;
    const list = (loadJSON(PLAN_HISTORY_KEY, []) || []).filter(e => e && e.at > since);
    list.push({ at: Date.now(), names: names.slice(0, 40) });
    store(PLAN_HISTORY_KEY, list.slice(-20));
}
function recentPlanDishes() {
    const since = Date.now() - PLAN_MEMORY_DAYS * 864e5;
    const favs = NourishPlanner.dishList(cookbook.recipes.map(e => e.recipe && e.recipe.name).filter(Boolean)
        .concat(taste.events.filter(e => e.type === 'rate' && (e.rating === 'up' || (e.tags || []).includes('loved'))).map(e => e.name)));
    const names = (loadJSON(PLAN_HISTORY_KEY, []) || []).filter(e => e && e.at > since).flatMap(e => e.names || []);
    return [...new Set(names)].filter(n => !favs.has(n));
}

function favoriteRecipes() {
    const prof = tasteProfile();
    if (!prof.on || prof.repeats === 'rarely') return null;
    const loved = new Set(taste.events.filter(e => e.type === 'rate' && (e.rating === 'up' || (e.tags || []).includes('loved'))).map(e => e.name));
    const list = cookbook.recipes.filter(e => e.recipe && (loved.has(e.recipe.name) || prof.repeats === 'often')).map(e => e.recipe).slice(0, 30);
    return list.length ? { recipes: list, cap: prof.repeats === 'often' ? 4 : 2 } : null;
}

// === WHAT GOES WITH EVERY AI MEAL REQUEST ===
// Called by mealAsk (ondevice.js) for every meal the AI writes or rewrites, on every AI.
function mealGuidance({ type, d, cuisine, dish }) {
    const parts = [];
    const notes = cookbookNotes([type, cuisine, dish, prefs.likes].filter(Boolean).join(' '));
    if (notes) parts.push(notes);
    // What the app has learned: only for AIs on this phone or the person's own PC, never a cloud AI.
    if (['local', 'lmstudio', 'ollama'].includes(settings.active_provider)) {
        const learned = NourishTaste.guidance(tasteProfile());
        if (learned) parts.push(learned);
    }
    return parts.join(' ');
}

// === YOUR RECIPE LIBRARY ===
// Files in the Nourish folders (Recipe Books, My Recipes) on this phone or the PC, read in the
// background in small batches whenever they change (library.js). Their recipes compete on equal
// terms with every other source; their text is cooking knowledge for the AI (cookbookNotes).
const LIBRARY_KEY = 'nourish_library_index';
const libraryState = { count: 0, files: 0, folder: '', where: null, busy: false, error: '', notes: [], progress: null, cancel: false };
let libraryIndexCache = null;
function libraryIndex() { if (!libraryIndexCache) libraryIndexCache = loadJSON(LIBRARY_KEY, { files: {} }); return libraryIndexCache; }
// Saved on this device. Cookbook passages can be big: if the phone's storage for the app is full,
// fewer passages per file are kept (the recipes always are).
function saveLibraryIndex(index) {
    libraryIndexCache = index;
    for (const keep of [Infinity, 100, 30, 0]) {
        const copy = keep === Infinity ? index : Object.assign({}, index, { files: Object.fromEntries(Object.entries(index.files || {}).map(([p, e]) => [p, Object.assign({}, e, { passages: (e.passages || []).slice(0, keep) })])) });
        try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(copy)); if (keep !== Infinity) nlog('library', `Storage is nearly full: keeping ${keep} cooking passages per file`, null, 'warn'); return; } catch (e) { /* try smaller */ }
    }
}
// Notes from the person's cookbooks for the AI writing or adapting a meal: the 2–3 passages most
// related to it (pairings, seasoning, technique), short so the prompt stays small on a phone.
function cookbookNotes(question, k) {
    if (!libraryState.count && !Object.values(libraryIndex().files || {}).some(e => e.passages && e.passages.length)) return '';
    const found = NourishLibrary.retrieve(libraryIndex(), question, k || (settings.active_provider === 'local' ? 2 : 3));
    if (!found.length) return '';
    return 'Ideas from their own cookbooks (use for pairings, seasoning and technique; do not copy): '
        + found.map((f, i) => `(${i + 1}) ${f.text.replace(/\s+/g, ' ').slice(0, settings.active_provider === 'local' ? 260 : 420)}`).join(' ');
}
function libraryRecipes() { return NourishLibrary.allRecipes(libraryIndex()); }
function librarySummary(index) {
    const files = Object.keys(index.files || {});
    libraryState.files = files.length;
    libraryState.count = NourishLibrary.allRecipes(index).length;
    libraryState.notes = files.filter(f => index.files[f].note).map(f => `${f}: ${index.files[f].note}`).slice(0, 20);
}
function libraryAvailable() { return !isLocalMode() || nativeAvailable(); }

async function indexLibrary({ quiet = true } = {}) {
    if (libraryState.busy || !libraryAvailable()) return;
    libraryState.busy = true;
    libraryState.error = '';
    try {
        const io = {
            list: async () => { const r = await api('/api/library', { timeoutMs: 30000 }); libraryState.folder = r.folder || ''; return r.files || []; },
            read: path => api('/api/library/read', { method: 'POST', timeoutMs: 120000, body: { path } }),
            // Books (EPUB, Word) are read a slice at a time (books.js), never the whole file at once.
            range: async (path, offset, length) => {
                const out = new Uint8Array(length);
                let got = 0;
                while (got < length) {
                    const r = await api('/api/library/range', { method: 'POST', timeoutMs: 60000, body: { path, offset: offset + got, length: Math.min(4 * 1024 * 1024, length - got) } });
                    const bin = atob((r && r.data) || '');
                    if (!bin.length) break;
                    for (let i = 0; i < bin.length; i++) out[got + i] = bin.charCodeAt(i);
                    got += bin.length;
                }
                return got < length ? out.subarray(0, got) : out;
            },
            ocr: canReadTextOnPhone() ? async image => ((await nativeCall('ocr', { image }, { timeoutMs: 60000 })) || {}).text || '' : null,
            readStructured: (html, url) => { try { return NourishImport.structuredRecipe(new DOMParser().parseFromString(html, 'text/html'), url); } catch (e) { return null; } },
            readText: html => { try { return NourishImport.readableText(new DOMParser().parseFromString(html, 'text/html')); } catch (e) { return ''; } },
            sleep: ms => new Promise(ok => setTimeout(ok, ms)),
        };
        libraryState.cancel = false;
        let shown = 0;
        const res = await NourishLibrary.refresh(JSON.parse(JSON.stringify(libraryIndex())), io, {
            batch: 2, pause: 500, maxFiles: 20,
            // A big book: how far it has got, shown in Settings → Recipes (at most once a second).
            progress: (path, done, total, chapter) => {
                libraryState.progress = { path, done, total, chapter };
                if (settingsPage === 'sources' && Date.now() - shown > 1000) { shown = Date.now(); renderSettings(); }
            },
            cancelled: () => libraryState.cancel,
        });
        libraryState.progress = null;
        saveLibraryIndex(res.index);
        librarySummary(res.index);
        if (res.cancelled) { nlog('library', 'Reading the recipe files was stopped (the rest is read next time)'); return; }
        if (res.changed) nlog('library', `Recipe library: ${libraryState.count} recipes from ${libraryState.files} files (${res.read} read now${res.pending ? `, ${res.pending} more next time` : ''})`, res.errors.length ? res.errors : null);
        if (res.pending) setTimeout(() => indexLibrary(), 20000);   // big folders: the rest a little later
    } catch (e) {
        libraryState.error = e.message;
        if (!quiet) showToast(`Couldn't read your recipe folder: ${e.message}`);
        nlog('library', `Couldn't read the recipe folder: ${e.message}`, null, 'warn');
    } finally {
        libraryState.busy = false;
        libraryState.progress = null;
        if (settingsPage === 'sources') renderSettings();
    }
}
function cancelLibraryReading() {
    libraryState.cancel = true;
    showToast('Stopping… (the book is read again next time)', false);
}

async function openLibraryFolder() {
    try {
        const r = await api('/api/library/open', { method: 'POST', body: {} });
        if (r && r.opened === false && r.folder) showToast(`Your recipe folder is on the PC: ${r.folder}`, false);
    } catch (e) {
        showToast(`Couldn't open the folder: ${e.message}`);
    }
}

// "Add files": on the phones the system file picker (the files are copied into the library);
// on the PC (or a browser) a file chooser whose files are sent to the PC's folder.
async function addLibraryFiles() {
    if (isLocalMode()) {
        try {
            const r = await api('/api/library/add', { method: 'POST', body: {} });
            if (r && r.rejected && r.rejected.length) showToast(`${r.rejected.join(', ')}: ${NourishBooks.KINDLE_NOTE}`);
            if (r && r.added) { showToast(`Added ${r.added} file${r.added > 1 ? 's' : ''}. Reading ${r.added > 1 ? 'them' : 'it'} now…`, false); indexLibrary({ quiet: false }); }
        } catch (e) {
            showToast(`Couldn't add the files: ${plainError(e.message)}`);
        }
        return;
    }
    const input = h('input', { type: 'file', multiple: true, accept: '.epub,.pdf,.docx,.txt,.text,.md,.markdown,.html,.htm,.mhtml,.webarchive,.jpg,.jpeg,.png,.heic,.webp,.mobi,.azw,.azw3', style: 'display:none' });
    input.addEventListener('change', async () => {
        const files = [...(input.files || [])];
        input.remove();
        let added = 0;
        for (const file of files) {
            try {
                if (/\.(mobi|azw3?|kfx)$/i.test(file.name)) throw new Error(NourishBooks.KINDLE_NOTE);
                const book = /\.(epub|docx)$/i.test(file.name);
                if (file.size > (book ? 400 : 40) * 1024 * 1024) throw new Error(book ? 'it is over 400 MB' : 'it is over 40 MB');
                const data = await new Promise((ok, bad) => {
                    const reader = new FileReader();
                    reader.onload = () => ok(String(reader.result).replace(/^data:[^,]*,/, ''));
                    reader.onerror = () => bad(new Error("it couldn't be read"));
                    reader.readAsDataURL(file);
                });
                await api('/api/library/add', { method: 'POST', timeoutMs: 180000, body: { name: file.name, data } });
                added++;
            } catch (e) {
                showToast(`Couldn't add ${file.name}: ${plainError(e.message)}`);
            }
        }
        if (added) { showToast(`Added ${added} file${added > 1 ? 's' : ''}. Reading ${added > 1 ? 'them' : 'it'} now…`, false); indexLibrary({ quiet: false }); }
    });
    document.body.appendChild(input);
    input.click();
}

// Where the folders are, as the phone or PC reports it (inside LiveContainer, the iPhone's Files
// app shows them in LiveContainer's folder, not as "Nourish").
async function libraryLocation() {
    if (!libraryAvailable()) return;
    try {
        if (isLocalMode()) {
            const r = await api('/api/library/where', {});
            libraryState.folder = (r && r.folder) || libraryState.folder;
            libraryState.where = r || null;
            if (r && r.path) nlog('library', `Recipe folders: ${r.folder}`, `${r.path}${r.fileSharing === false ? ' (file sharing is OFF in this build)' : ''}${r.container ? ' (running inside another app)' : ''}`);
        } else if (!libraryState.folder) {
            const r = await api('/api/library', { timeoutMs: 30000 });
            libraryState.folder = (r && r.folder) || '';
        }
    } catch (e) { /* older app without "where": the folder name from the last listing is used */ }
    if (settingsPage === 'sources') renderSettings();
}

// One line per file: how far reading it has got.
function libraryFileStatus(path) {
    const entry = (libraryIndex().files || {})[path];
    const p = libraryState.progress;
    if (p && p.path === path) return `Reading… part ${p.done} of ${p.total}${p.chapter ? ` (${String(p.chapter).slice(0, 40)})` : ''}`;
    if (!entry) return libraryState.busy ? 'Reading…' : 'Waiting to be read';
    if (entry.recipes && entry.recipes.length) return `Read · ${entry.recipes.length} recipe${entry.recipes.length > 1 ? 's' : ''}`;
    if (entry.passages && entry.passages.length) return 'Read · used as cooking knowledge';
    return entry.note ? `Not used: ${entry.note}` : 'Read';
}

function libraryGroup() {
    if (!libraryAvailable()) return settingsGroup('My recipe files', [infoRow('Folders', 'in the phone app or on your PC')], 'Drop cookbooks and recipe files into the Nourish folders and Nourish learns from them.');
    const phone = isLocalMode();
    const android = phone && /Android/i.test(navigator.userAgent);
    const container = !!(libraryState.where && libraryState.where.container);
    const where = !phone ? (libraryState.folder || 'the Nourish folder next to your data file')
        : android ? 'Inside the Nourish app' : (libraryState.folder || 'On My iPhone › Nourish');
    const listed = (libraryIndex().listed || []).slice(0, 60);
    const rows = [
        h('div', { class: 'settings-row settings-row-stack' },
            h('span', { class: 'settings-label', text: 'Where they are' }),
            h('span', { class: 'settings-hint selectable', text: where })),
        // Sideloaded inside LiveContainer: iOS files the folders under that app, deep in its own folders.
        container ? h('div', { class: 'settings-row settings-row-stack' },
            h('span', { class: 'settings-label', text: 'Why are they there?' }),
            h('span', { class: 'settings-hint', text: 'Nourish is running inside another app (LiveContainer), so your iPhone keeps its files inside that app\'s folders instead of a "Nourish" folder. The easiest way to add recipe books is the Add files button below.' })) : null,
        settingsButton(container ? 'Add files (the easy way)' : 'Add files', addLibraryFiles, 'settings-button-primary'),
        !android && !container ? settingsButton(phone ? 'Show the folder in Files' : 'Open my recipe folder', openLibraryFolder) : null,
        infoRow('Recipes found', libraryState.busy ? 'Reading…' : `${libraryState.count} from ${libraryState.files} file${libraryState.files === 1 ? '' : 's'}`),
        libraryState.progress ? h('div', { class: 'settings-row settings-row-stack' },
            h('span', { class: 'settings-label', text: `Reading ${libraryState.progress.path.split('/').pop()}` }),
            h('progress', { class: 'library-progress', max: String(libraryState.progress.total || 1), value: String(libraryState.progress.done || 0) }),
            h('span', { class: 'settings-hint', text: `Part ${libraryState.progress.done} of ${libraryState.progress.total}. Big books are read a little at a time so the phone stays cool.` })) : null,
        libraryState.progress ? settingsButton('Stop reading', cancelLibraryReading) : null,
        ...listed.map(f => h('div', { class: 'settings-row settings-row-stack library-file' },
            h('span', { class: 'settings-label', text: f.path.split('/').pop() }),
            h('span', { class: 'settings-hint', text: `${f.folder || ''}${f.folder ? ' · ' : ''}${libraryFileStatus(f.path)}` }))),
        listed.length || libraryState.busy ? null : h('div', { class: 'settings-row' }, h('span', { class: 'settings-hint', text: 'No files yet. Tap Add files, or drop files into the folders.' })),
        settingsButton('Check for new files now', () => indexLibrary({ quiet: false })),
    ];
    const how = android ? 'Tap Add files to choose files on this phone.'
        : container ? `Nourish is running inside another app (LiveContainer), so the Files app shows these folders under that app: ${where}. Add files is the easiest way in.`
        : phone ? 'In the Files app: On My iPhone → Nourish → Recipe Books or My Recipes. Or tap Add files.'
        : 'Drop files into the Recipe Books or My Recipes folder on this PC, or tap Add files.';
    return settingsGroup('My recipe files', rows, help(`Cookbooks and your own recipes (EPUB, PDF${android ? ' (on the PC)' : ''}, Word, text, Markdown, saved web pages${phone && !android ? ', photos' : ''}). Kindle books (MOBI, AZW3) can't be read. ${how}`,
        'Nourish reads each file in the background and learns from it: which ingredients go together, how dishes are seasoned and cooked. Its recipes can also turn up in your plans, next to recipes from everywhere else; they are not put first. Each folder has a "Read me" note. Files are only read again when they change.'));
}

// === GENERATE MEAL PLAN ===
// Automatic by default: real recipes from every source at once (finder.js), sized to the person's
// targets (planner.js); the AI writes only the meals no source had a good match for. Advanced →
// "Where recipes come from" can switch to the AI writing every meal (the older way).
async function generateMealPlan() {
    const likes = $('inputLikes').value.trim();
    const hates = $('inputHates').value.trim();
    if (planJob) { showToast('A plan is already being made'); return; }
    prefs.likes = likes;
    prefs.hates = hates;
    changed('prefs');
    closeGenerateSheet();
    if (settings.plan_source === 'ai') {
        await runPlanJob({ kind: 'plan', origin: 'sheet', messages: [
            { role: 'system', content: planSystemPrompt() },
            { role: 'user', content: `Goal: ${GOALS[prefs.goal]}. Likes: ${likes || 'anything'}. Avoids: ${hates || 'nothing'}. Generate the 7-day meal plan JSON.` },
        ] });
        return;
    }
    await runSmartPlan(likes, hates);
}

// What finder.js needs from the app: how to fetch a page, read recipe data, call the recipe APIs,
// and which sources are switched on.
function finderOptions(likes, hates) {
    const off = new Set(String(settings.sources_off || '').split(',').filter(Boolean));
    return {
        settings: Object.assign({}, settings, { goal: prefs.goal }),
        goal: prefs.goal, likes, avoid: hates, days: 7, people: servingsWanted(),
        enabled: id => !off.has(id),
        customSites: String(settings.custom_sites || '').split(/[\s,]+/).filter(Boolean),
        spoonacularKeySaved: !isLocalMode() && !!secretsSet.spoonacular_api_key,
        spoonacularDiet: SPOONACULAR_DIETS[settings.diet],
        fetchPage: (url, { browser } = {}) => fetchForImport(url, { browser }),
        readRecipe: (html, url) => { try { return NourishImport.structuredRecipe(new DOMParser().parseFromString(html, 'text/html'), url); } catch (e) { return null; } },
        api: (path, body) => api(path, { method: 'POST', timeoutMs: 45000, body }),
        library: () => libraryRecipes(),
        pairingScore: r => NourishLibrary.pairingScore(libraryIndex(), r),
        weekday: d => (dayBase() + d) % 7,
        taste: tasteScorer(),
        favorites: favoriteRecipes(),
        already: recentPlanDishes(),
        cache: { get: k => loadJSON(k, null), set: (k, v) => store(k, v) },
        log: m => nlog('plan', m),
        trace: m => nlog('sources', m, null, 'debug'),
    };
}

// The recipe library grows quietly while the app is open: small batches every few hours, on Wi-Fi
// only (never on mobile data), never while a plan is being made, towards several hundred web recipes
// per meal from many sites. Each run continues where the last one stopped (finder.js "grow").
// Why it used to read 0 pages: it asked the same first page of the same searches as the plans,
// whose recipes were all in the library already, so there was nothing new to read.
const LIBRARY_REFRESH_KEY = 'nourish_library_refreshed';
let libraryRefreshing = false;
async function onWifi() {
    if (isLocalMode() && nativeAvailable()) {
        try { const n = await nativeCall('network', {}, { timeoutMs: 5000 }); return !!(n && n.known && n.online && n.wifi && !n.expensive && !n.constrained); } catch (e) { return false; }
    }
    const c = navigator.connection;
    return !(c && (c.saveData || c.type === 'cellular'));
}
// What the library holds: web recipes per meal and per site.
function libraryStats() {
    const cache = loadJSON(NourishFinder.CACHE.recipes, {}) || {};
    const out = { total: 0, perMeal: { breakfast: 0, lunch: 0, dinner: 0 }, perSource: {} };
    Object.values(cache).forEach(c => {
        const r = c && c.r;
        if (!r) return;
        out.total++;
        const fit = NourishPlanner.mealFit(r);
        MEAL_TYPES.forEach(m => { if (fit[m]) out.perMeal[m]++; });
        const name = r.source_name || 'Other';
        out.perSource[name] = (out.perSource[name] || 0) + 1;
    });
    return out;
}
async function refreshRecipeLibrary({ manual = false } = {}) {
    if (libraryRefreshing) return;
    try {
        if (planJob || settings.plan_source === 'ai') { if (manual) showToast('Wait for the plan to finish first'); return; }
        if (!manual && (document.hidden || Number(load(LIBRARY_REFRESH_KEY, 0)) > Date.now() - 3 * 3600e3)) return;
        if (!manual && !(await onWifi())) { nlog('sources', 'Recipe library: not refreshed (not on Wi-Fi)', null, 'debug'); return; }
        libraryRefreshing = true;
        if (manual) { showJobBar('busy', 'Finding new recipes for your library…'); if (settingsPage === 'advanced') renderSettings(); }
        store(LIBRARY_REFRESH_KEY, String(Date.now()));
        const before = libraryStats().total;
        const o = Object.assign(finderOptions(prefs.likes, prefs.hates), { grow: true, already: [],
            limits: manual ? { seconds: 90, searches: 40, pages: 60, parallel: 3 } : { seconds: 45, searches: 16, pages: 24, parallel: 2 } });
        o.enabled = (orig => id => id !== 'library' && id !== 'builtin' && orig(id))(o.enabled);
        const { stats } = await NourishFinder.findRecipes(o);
        const now = libraryStats();
        nlog('sources', `Recipe library ${manual ? 'refreshed' : 'refreshed in the background'}: ${stats.searches} searches, ${stats.pages} pages read, ${now.total - before} new recipes; the library now has ${now.total} (breakfast ${now.perMeal.breakfast}, lunch ${now.perMeal.lunch}, dinner ${now.perMeal.dinner})`,
            { perSource: stats.perSource, turnedAway: stats.why, leftAlone: stats.blocked, failed: stats.failed });
        if (manual) showToast(now.total > before ? `${now.total - before} new recipe${now.total - before === 1 ? '' : 's'} saved (${now.total} in your library)` : 'No new recipes this time. Try again later.', false);
    } catch (e) {
        nlog('sources', `Recipe library refresh failed: ${e.message}`, null, 'warn');
        if (manual) showToast(`Couldn't refresh: ${e.message}`);
    } finally {
        libraryRefreshing = false;
        if (manual) { showJobBar(null); if (settingsPage === 'advanced') renderSettings(); }
    }
}
// Checks every half hour while the app is open (it only refreshes every 3 hours, on Wi-Fi).
setInterval(() => { refreshRecipeLibrary(); }, 30 * 60e3);

async function runSmartPlan(likes, hates) {
    const started = Date.now();
    localPlanCancelled = false;
    planJob = { id: 'stepwise', started, provider: settings.active_provider, kind: 'plan', origin: 'sheet', local: settings.active_provider === 'local' };
    showJobBar('busy', 'Finding recipes for your week…');
    const btn = $('generateBtn');
    try {
        const plan = await NourishFinder.planFromSources(finderOptions(likes, hates));
        const st = plan.stats;
        const pm = st.perMeal || {};
        nlog('plan', `Found ${st.recipes} usable recipes in ${st.seconds} s (${st.searches} searches, ${st.pages} pages, ${st.fromCache} from your recipe library of ${st.library || 0}); ` +
            `good new ones per meal: breakfast ${(pm.breakfast || {}).web || 0}, lunch ${(pm.lunch || {}).web || 0}, dinner ${(pm.dinner || {}).web || 0} (plus Nourish's own); ${plan.missing.length} meals still to fill`,
            { perSource: st.perSource, perMeal: pm, turnedAway: st.why, failed: st.failed, leftAlone: st.blocked, excluded: st.excluded, bland: st.bland });
        if (localPlanCancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
        if (plan.missing.length) await fillMissingMeals(plan);
        const planSettings = Object.assign({}, settings, { goal: prefs.goal });
        let days = plan.days.map(d => NourishPlanner.fitDay(d, planSettings, servingsWanted()));
        // The last check, with or without an AI: every day within 10% of the calorie target.
        const pools = Object.fromEntries(MEAL_TYPES.map(m => [m, (plan.pools[m] || []).concat(typeof NourishBuiltins !== 'undefined' && settings.builtin_mode !== 'off' ? NourishBuiltins.forMeal(m) : [])]));
        const kept = NourishPlanner.keepToTargets(days, { pools, settings: planSettings, people: servingsWanted(),
            exclude: NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet }), weekday: d => (dayBase() + d) % 7, already: recentPlanDishes() });
        days = kept.days;
        if (kept.changes.length) nlog('plan', `Kept ${kept.changes.length} day(s) to the calorie target`, kept.changes);
        if (!days.some(d => MEAL_TYPES.some(t => d[t]))) {
            throw new Error(aiReady()
                ? "Couldn't find or write any recipes. Check your internet connection and try again."
                : 'No recipes could be found right now. Check your internet connection, or download an AI model in Settings so Nourish can write recipes itself.');
        }
        applyPlan({ days });
        nlog('plan', `Plan ready in ${Math.round((Date.now() - started) / 100) / 10} s`, days.map((d, i) => `Day ${i + 1}: ${Math.round(NourishPlanner.dayTotals(d).kcal)} kcal`));
        showJobBar(null);
    } catch (err) {
        nlog('plan', err.cancelled ? 'Cancelled' : `Plan failed: ${err.message}`, err.stack, err.cancelled ? 'info' : 'error');
        if (err.cancelled) { showJobBar(null); showToast('Meal plan cancelled', false); }
        else showJobBar('error', `Couldn't make the plan: ${err.message}`);
    } finally {
        planJob = null;
        btn.disabled = false;
        btn.textContent = 'Generate Plan';
    }
}

// The meals no source matched. Never a repeat: first any recipe found that isn't in the plan yet
// (or in recent plans), then the built-in recipes, then the AI as the last resort, then a recipe
// from an older plan. A slot stays empty before a meal is used twice.
async function fillMissingMeals(plan) {
    const onPhone = settings.active_provider === 'local';
    const canWrite = aiReady() && !(onPhone && !settings.local_model);
    const inPlan = () => NourishPlanner.dishList(plan.days.flatMap(d => MEAL_TYPES.map(t => d[t] && !d[t].leftover && d[t].name).filter(Boolean)));
    const recent = NourishPlanner.dishList(recentPlanDishes());
    const exclude = NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet });
    // The closest fits on calories from a list, skipping what's in the plan and what doesn't fit the slot.
    const closestFew = (list, slot, skip) => {
        const used = inPlan();
        // Only recipes a realistic portion (half to double) can bring to the slot's calories.
        return list.filter(r => r && r.nutrition && r.nutrition.calories > 0 && slot.kcal / r.nutrition.calories >= 0.55 && slot.kcal / r.nutrition.calories <= 2 && !used.has(r.name) && !(skip && skip.has(r.name)) && !exclude(r) && !slotCheck(r, slot.meal, slot.day))
            .sort((a, b) => Math.abs(Math.log(slot.kcal / a.nutrition.calories)) - Math.abs(Math.log(slot.kcal / b.nutrition.calories))).slice(0, 4);
    };
    const run = canWrite ? (onPhone ? phoneRunner({ onStatus: text => showJobBar('busy', text), isCancelled: () => localPlanCancelled }) : aiRunner()) : null;
    // A small job for the AI: pick the one they'd enjoy most from a few real recipes.
    const closest = async (list, slot, skip) => {
        const few = closestFew(list, slot, skip);
        if (few.length < 2 || !run) return few[0] || null;
        try { return few[await aiChoose(run, slot.meal, few.map(r => r.name))] || few[0]; } catch (e) { return few[0]; }
    };
    let empty = 0;
    for (const slot of plan.missing) {
        if (localPlanCancelled) break;
        const day = plan.days[slot.day];
        let meal = null;
        let how = '';
        const pool = plan.pools[slot.meal] || [];
        // 1. A recipe that was found (web, your files, the built-in set) but not picked yet.
        meal = await closest(pool, slot, recent);
        if (meal) how = 'a found recipe not used yet';
        // 2. The built-in recipes (all of them, whatever the pool held).
        if (!meal && typeof NourishBuiltins !== 'undefined' && settings.builtin_mode !== 'off') { meal = await closest(NourishBuiltins.forMeal(slot.meal), slot, recent); if (meal) how = 'a Nourish recipe'; }
        if (meal) meal = JSON.parse(JSON.stringify(meal));
        // 2b. A real recipe with one disliked ingredient: the AI suggests a swap (a small job).
        if (!meal && run && (plan.adaptable || []).length) {
            for (const { r, term } of plan.adaptable.slice(0, 3)) {
                try {
                    const sub = await aiSubstitute(run, r.name, term);
                    const changed = sub && NourishPlanner.adapt(r, term, sub);
                    if (!changed) continue;
                    NourishNutrition.settle(changed);
                    if (exclude(changed) || slotCheck(changed, slot.meal, slot.day) || inPlan().has(changed.name) || !(changed.nutrition && changed.nutrition.calories > 0)) continue;
                    meal = changed; how = `a real recipe with ${term} swapped for ${sub}`;
                    plan.adaptable = plan.adaptable.filter(x => x.r !== r);
                    break;
                } catch (e) { /* next one */ }
            }
        }
        // 3. The AI, as the last resort.
        if (!meal && canWrite) {
            const others = plan.days.flatMap(d => MEAL_TYPES.map(t => d[t] && d[t].name).filter(Boolean));
            const sameDay = MEAL_TYPES.map(t => day[t] && day[t].name).filter(Boolean);
            showJobBar('busy', `Writing ${dayName(slot.day)} ${slot.meal} (no recipe matched)…`);
            const servings = servingsWanted();
            const ask = mealAsk({ type: slot.meal, d: slot.day, recent: sameDay,
                extra: [prefs.likes ? `They like: ${prefs.likes}.` : '', prefs.hates ? `Never use: ${prefs.hates}.` : '',
                    sameDay.length ? 'Use a different main protein and vegetable from the other meals that day.' : ''].filter(Boolean).join(' ') });
            try {
                const r = await makeMeal({ type: slot.meal, system: mealSystem(servings), ask, grammar: onPhone ? mealGrammar(servings) : null,
                    earlier: others, id: `fill-${slot.day}-${slot.meal}`, label: `${dayName(slot.day)} ${slot.meal}`, limits: slotLimitsFor(slot.meal, slot.day) }, run, { isCancelled: () => localPlanCancelled });
                if (r && r.meal) {
                    meal = normalizeMeal(r.meal);
                    if (meal && exclude(meal)) { nlog('plan', `The AI's ${slot.meal} "${meal.name}" has ${exclude(meal)}, which is avoided; not used`, null, 'warn'); meal = null; }
                    if (meal && !NourishPlanner.flavorCheck(meal).ok) { NourishPlanner.reseason(meal); NourishNutrition.settle(meal); }
                    const misfit = meal ? slotCheck(meal, slot.meal, slot.day) : '';
                    if (misfit) { nlog('plan', `The AI's ${slot.meal} "${meal.name}" ${misfit}; not used`, null, 'warn'); meal = null; }
                    if (meal && inPlan().has(meal.name)) { nlog('plan', `The AI's ${slot.meal} "${meal.name}" is already in the plan; not used`, null, 'warn'); meal = null; }
                    if (meal) how = 'written by the AI';
                }
            } catch (e) {
                nlog('plan', `The AI couldn't write ${dayName(slot.day)} ${slot.meal}: ${e.message}`, null, 'warn');
            }
        }
        // 4. A dish from a plan in the last two weeks (still never one already in this plan).
        if (!meal) {
            meal = closest(pool.concat(typeof NourishBuiltins !== 'undefined' && settings.builtin_mode !== 'off' ? NourishBuiltins.forMeal(slot.meal) : []), slot, null);
            if (meal) { meal = JSON.parse(JSON.stringify(await meal)); how = 'a recipe from a recent plan'; }
        }
        if (!meal && settings.builtin_mode !== 'off') {
            meal = quickMealFor(slot.meal, slot.day, inPlan().names());
            if (meal) how = 'a quick built-in meal';
        }
        if (meal) {
            day[slot.meal] = normalizeMeal(meal) || meal;
            nlog('plan', `${dayName(slot.day)} ${slot.meal}: ${how} (${meal.name})`);
        } else {
            empty++;
            nlog('plan', `${dayName(slot.day)} ${slot.meal}: nothing new fits; left empty rather than repeat a meal`, null, 'warn');
        }
    }
    if (empty) showToast(`${empty} meal${empty > 1 ? 's were' : ' was'} left empty: nothing new fitted, and meals are never repeated. Try again on Wi-Fi, or loosen My schedule.`, false);
}

function chatPlanMessages() {
    return [
        { role: 'system', content: planSystemPrompt() },
        ...cleanHistory(chatHistory.slice(-CHAT_HISTORY_LIMIT).concat([
            { role: 'user', content: 'Using everything we discussed above, create my 7-day meal plan now. Return only the JSON.' }])),
    ];
}

async function generatePlanFromChat() {
    if (planJob) { showToast('A plan is already cooking'); return; }
    if (!chatHistory.some(m => m.role === 'user')) { showToast('Chat with the chef first, then make a plan'); return; }
    await runPlanJob({ kind: 'plan', origin: 'chat', messages: chatPlanMessages() });
}

function swapMeal(dayIndex, mealType) {
    const current = daysData[dayIndex] && daysData[dayIndex][mealType];
    if (current) learn('swap', current);
    if (settings.plan_source !== 'ai') return swapFromSources(dayIndex, mealType);
    return remakeMeal(dayIndex, mealType, 'swap');
}

// Swap with a real recipe (mostly from what's already been found, so it's quick), sized to the
// day; the AI writes one only when nothing fits.
async function swapFromSources(dayIndex, mealType) {
    if (planJob) { showToast('A plan is already being made'); return; }
    const day = daysData[dayIndex] || {};
    const current = day[mealType];
    const label = `${isToday(dayIndex) ? 'today\'s' : dayName(dayIndex) + '\'s'} ${MEAL_LABELS[mealType].toLowerCase()}`;
    planJob = { id: 'stepwise', started: Date.now(), provider: settings.active_provider, kind: 'edit', origin: 'recipe', local: false };
    showJobBar('busy', `Finding another recipe for ${label}…`);
    let picked = null;
    try {
        const o = Object.assign(finderOptions(prefs.likes, prefs.hates), { days: 2, limits: { searches: 6, pages: 8, seconds: 25 } });
        const { pools } = await NourishFinder.findRecipes(o);
        const inWeek = NourishPlanner.dishList(daysData.flatMap(d => MEAL_TYPES.map(t => d && d[t] && d[t].name).filter(Boolean)));
        const others = MEAL_TYPES.filter(t => t !== mealType).map(t => day[t]).filter(Boolean);
        const taken = new Set(others.map(NourishPlanner.mainProtein).concat(others.map(NourishPlanner.mainVeg)).filter(Boolean));
        const share = NourishPlanner.splitOf(settings)[MEAL_TYPES.indexOf(mealType)] * (Number(settings.calorie_target) || 2000);
        const scorer = tasteScorer();
        const recent = NourishPlanner.dishList(recentPlanDishes());
        const fits = (pools[mealType] || []).filter(r => !inWeek.has(r.name) && !taken.has(NourishPlanner.mainProtein(r)) && !taken.has(NourishPlanner.mainVeg(r)) && !slotCheck(r, mealType, dayIndex))
            .map(r => ({ r, d: Math.abs(Math.log(share / r.nutrition.calories)) - (scorer ? scorer(r) * 0.3 : 0) + (recent.has(r.name) ? 0.3 : 0) }))
            .filter(x => x.d < Math.log(2)).sort((a, b) => a.d - b.d).slice(0, 4);
        if (fits.length) picked = fits[Math.floor(Math.random() * fits.length)].r;
    } catch (e) {
        nlog('plan', `Looking for another recipe failed: ${e.message}`, null, 'warn');
    } finally {
        planJob = null;
        showJobBar(null);
    }
    if (!picked) {
        if (aiReady()) return remakeMeal(dayIndex, mealType, 'swap');
        showToast('No other recipe fits that meal right now. Try again later, or download an AI model in Settings.');
        return;
    }
    const meal = normalizeMeal(JSON.parse(JSON.stringify(picked)));
    const fitted = NourishPlanner.fitDay(Object.assign({}, day, { [mealType]: meal }), Object.assign({}, settings, { goal: prefs.goal }), servingsWanted());
    daysData[dayIndex] = fitted;
    changed('plan');
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
    showToast(`Swapped in: ${fitted[mealType].name}`, false);
    if (openRecipe && openRecipe.dayIndex === dayIndex && openRecipe.mealType === mealType) openRecipeSheet(mealType, daysData[dayIndex][mealType], dayIndex);
}

// One meal of the plan made again by the AI, checked like a plan's meals (made again up to 2 times
// while something's wrong). mode 'swap': a different dish; 'retry': the same dish, written out properly.
// Returns the model's result ({ meal, problems, attempts }) or null when cancelled.
async function makeMealFor(dayIndex, mealType, mode, onAttempt) {
    const onPhone = settings.active_provider === 'local';
    const current = daysData[dayIndex] && daysData[dayIndex][mealType];
    const servings = servingsWanted();
    const others = [];
    daysData.forEach((d, i) => MEAL_TYPES.forEach(t => { if (d && d[t] && !(i === dayIndex && t === mealType)) others.push(d[t].name); }));
    const sameDay = MEAL_TYPES.filter(t => t !== mealType).map(t => daysData[dayIndex] && daysData[dayIndex][t] && daysData[dayIndex][t].name).filter(Boolean);
    const retry = mode === 'retry' && current;
    const ask = mealAsk({ type: mealType, d: dayIndex, dish: retry ? current.name : '',
        recent: retry ? [] : sameDay.concat(current ? [current.name] : []),
        extra: !retry && current ? `It must not be ${current.name} or anything like it.` : '' });
    const isCancelled = () => localPlanCancelled;
    const run = onPhone ? phoneRunner({ onStatus: text => showJobBar('busy', text), isCancelled }) : aiRunner();
    return makeMeal({ type: mealType, system: mealSystem(servings), ask, grammar: onPhone ? mealGrammar(servings) : null,
        earlier: retry ? others : others.concat(current ? [current.name] : []), id: `${mode}-${dayIndex}-${mealType}`,
        label: `${dayName(dayIndex)} ${mealType}`, limits: slotLimitsFor(mealType, dayIndex) }, run, { onAttempt, isCancelled });
}

// The Swap and Try again buttons on a recipe.
async function remakeMeal(dayIndex, mealType, mode) {
    if (planJob) { showToast('The chef is already working on your plan'); return; }
    const onPhone = settings.active_provider === 'local';
    if (onPhone && !settings.local_model) { showToast('Download a model first: Settings → AI model.'); return; }
    const label = `${isToday(dayIndex) ? 'today\'s' : dayName(dayIndex) + '\'s'} ${MEAL_LABELS[mealType].toLowerCase()}`;
    const verb = mode === 'retry' ? 'Remaking' : 'Swapping';
    localPlanCancelled = false;
    planJob = { id: 'stepwise', started: Date.now(), provider: settings.active_provider, kind: 'edit', origin: 'recipe', local: onPhone };
    nlog('plan', `${verb} ${label} with ${PROVIDERS[settings.active_provider]}`);
    if (onPhone) nativeCall('keepAwake', { on: true }).catch(() => {});
    try {
        const r = await makeMealFor(dayIndex, mealType, mode, a => showJobBar('busy', `${verb} ${label}${a ? ` · try ${a + 1} of 3` : ''}…`));
        if (!r) { showJobBar(null); showToast('Cancelled', false); return; }
        if (!r.meal) throw new Error(r.problems.slice(0, 2).join('; ') || 'no usable answer');
        const misfit = slotCheck(r.meal, mealType, dayIndex);
        if (misfit) throw new Error(`the AI's ${MEAL_LABELS[mealType].toLowerCase()} didn't fit (${misfit}). Try again`);
        reportCaps = true;
        try { daysData[dayIndex][mealType] = normalizeMeal(r.meal); } finally { reportCaps = false; }
        changed('plan');
        updateTodayScreen();
        updatePlanScreen();
        updateGroceryScreen();
        showJobBar(null);
        showToast(r.problems.length ? `${r.meal.name}: may be incomplete` : `${mode === 'retry' ? 'Remade' : 'Swapped in'}: ${r.meal.name}`, !!r.problems.length);
        if (openRecipe && openRecipe.dayIndex === dayIndex && openRecipe.mealType === mealType) openRecipeSheet(mealType, daysData[dayIndex][mealType], dayIndex);
    } catch (err) {
        nlog('plan', `${verb} failed: ${err.message}`, err.stack, 'error');
        showJobBar('error', `Couldn't ${mode === 'retry' ? 'remake' : 'swap'} the meal: ${err.message}`);
    } finally {
        planJob = null;
        if (onPhone) nativeCall('keepAwake', { on: false }).catch(() => {});
    }
}

// Meals the chef changed from the chat get the same checks as a plan's; one that fails is written
// out again (the same dish), up to 3 times, and kept with a "may be incomplete" note if still wrong.
async function checkChangedMeals(changes) {
    for (const c of changes) {
        const meal = daysData[c.day - 1] && daysData[c.day - 1][c.meal];
        if (!meal || localPlanCancelled) continue;
        // A dish the person asked the chef for by name is theirs to choose, even if it breaks the
        // slot's usual rules (lamb for breakfast on a Sunday): only the recipe itself is checked.
        const misfit = slotCheck(meal, c.meal, c.day - 1);
        const problems = allProblems(meal, c.meal, [], false).filter(p => p !== misfit);
        if (!problems.length) continue;
        nlog('plan', `Day ${c.day} ${c.meal} "${meal.name}" from the chat has ${problems.length} problem(s); writing it out again`, problems, 'warn');
        const r = await makeMealFor(c.day - 1, c.meal, 'retry', a => showJobBar('busy', `Checking ${dayName(c.day - 1)} ${c.meal} · try ${a + 1} of 3…`));
        if (r && r.meal) {
            daysData[c.day - 1][c.meal] = normalizeMeal(r.meal);
            c.name = r.meal.name;
        } else if (r) {
            meal.incomplete = problems;
        }
    }
    changed('plan');
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
}

// Starts (or, after a reload, resumes) an AI job that makes or edits the plan, and applies the result.
async function runPlanJob(job, resume = null) {
    const origin = resume ? resume.origin : job.origin;
    const kind = resume ? resume.kind || 'plan' : job.kind;
    const busyText = kind === 'edit' ? 'Updating your plan…' : 'Cooking your meal plan…';
    const jobStarted = Date.now();
    nlog('plan', `${kind === 'edit' ? 'Changing the plan' : 'Making a plan'} (from ${origin}) with ${PROVIDERS[settings.active_provider]} · ${settings[`${settings.active_provider}_model`] || 'auto'}`);
    try {
        let parsed;
        const onPhone = !resume && settings.active_provider === 'local';
        if (!resume && kind === 'plan') {
            // One meal at a time, with every AI: each recipe is checked and made again (up to 2 times)
            // when something's wrong (ondevice.js). Each finished meal is saved (nourish_plan_progress),
            // so an interrupted plan continues where it stopped.
            if (onPhone && !settings.local_model) throw new Error('Download a model first: Settings → AI model.');
            localPlanCancelled = false;
            const saved = job.continueSaved ? loadJSON(PLAN_PROGRESS_KEY, null) : null;
            const state = saved && Array.isArray(saved.days) ? saved : { days: [], messages: job.messages, origin, started: Date.now() };
            if (!saved) store(PLAN_PROGRESS_KEY, state);
            const resumeFrom = state.days.length;
            planJob = { id: 'stepwise', started: Date.now(), provider: settings.active_provider, kind, origin, local: onPhone };
            if (origin === 'chat') { chatBusy = true; chatBusyLabel = 'Cooking your plan…'; chatError = ''; }
            renderChat();
            if (state.days.length || state.current) nlog('plan', `Resuming from day ${state.days.length + 1} of 7 (${state.days.length} days saved)`);
            if (onPhone) {
                nativeCall('keepAwake', { on: true }).catch(() => {});   // once for the whole plan
                nativeCall('notify', { permission: true }).catch(() => {});
            }
            const busy = text => { showJobBar('busy', text); if (origin === 'chat') { chatBusyLabel = text; renderChat(); } };
            try {
                parsed = await generatePlanOnDevice(state.messages || job.messages, {
                    onDay: d => { if (saved && d === resumeFrom) busy(`Resuming from day ${d + 1} of 7…`); },
                    onMeal: (d, type, attempt) => busy(`Day ${d + 1} of 7 · ${MEAL_LABELS[type]}${attempt ? ` · remaking (try ${attempt + 1} of ${Math.max(3, attempt + 1)})` : ''}…`),
                    onStatus: busy,
                    isCancelled: () => localPlanCancelled,
                    save: st => store(PLAN_PROGRESS_KEY, st),
                }, state, onPhone ? undefined : aiRunner());
            } finally {
                if (onPhone) nativeCall('keepAwake', { on: false }).catch(() => {});
            }
            if (!parsed.days.length) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
            const times = parsed.stats.map(x => `${x.seconds}s`).join(', ');
            if (times) nlog('plan', `Seconds per day: ${times}; model calls per day: ${parsed.stats.map(x => x.attempts).join(', ')}`);
            unstore(PLAN_PROGRESS_KEY);
            if (onPhone && document.visibilityState !== 'visible') {
                nativeCall('notify', { title: 'Your meal plan is ready', body: `${parsed.days.length} days are waiting in Nourish.` }).catch(() => {});
            }
        } else {
            if (resume) {
                planJob = resume;
            } else {
                showJobBar('busy', 'Preparing…');
                const req = await buildAIRequest(job.messages, kind === 'edit' ? { maxTokens: onPhone ? EDIT_TOKENS : Number(settings.max_tokens) || 8000 } : {});
                if (onPhone) req.grammar = editGrammar(servingsWanted());
                planJob = { id: await startJob(req), started: Date.now(), provider: req.provider, kind, origin, local: onPhone };
                if (!isLocalMode()) store('nourish_pending_plan', planJob);
            }
            if (origin === 'chat') { chatBusy = true; chatBusyLabel = kind === 'edit' ? 'Updating your plan…' : 'Cooking your plan…'; chatError = ''; }
            renderChat();
            showJobBar('busy', busyText);
            const data = await waitForJob(planJob.id);
            parsed = parseLLMJSON(extractText(planJob.provider, data));
        }
        if (kind === 'edit') {
            const result = applyEdits(parsed);
            if (!result.replacedPlan) {
                planJob = Object.assign({}, planJob, { id: 'stepwise', local: onPhone });
                localPlanCancelled = false;
                await checkChangedMeals(result.changes);
            }
            const summary = result.replacedPlan ? 'I rewrote your plan.' : result.changes.map(c => `Day ${c.day} (${dayName(c.day - 1)}) ${c.meal}: ${c.name}`).join('\n');
            if (origin === 'chat') {
                addAssistantMessage(result.replacedPlan
                    ? 'Done — I updated your whole plan. Have a look in the Plan tab.'
                    : `Done — I updated your plan:\n${result.changes.map(c => `- **${dayName(c.day - 1)} ${c.meal}:** ${c.name}`).join('\n')}`,
                { type: 'edit', changes: result.changes });
            } else {
                showToast(result.replacedPlan ? 'Plan updated' : `Swapped in: ${summary.split(': ').pop()}`, false);
            }
        } else if (origin === 'chat') {
            applyPlan(parsed, { navigate: false });
            addAssistantMessage(`Here's your new ${daysData.length}-day plan — it's in the Plan tab now, and your grocery list is ready. Want me to change anything? Just say something like "swap Tuesday dinner".`,
                { type: 'plan', days: daysData.length, dinners: daysData.slice(0, 7).map(d => (d.dinner && d.dinner.name) || '') });
        } else {
            applyPlan(parsed);
        }
        nlog('plan', `Done in ${Math.round((Date.now() - jobStarted) / 1000)} s: ${daysData.length} days`);
        showJobBar(null);
    } catch (err) {
        const message = (err && err.message) || 'unknown error';
        if (err && err.cancelled) unstore(PLAN_PROGRESS_KEY);
        if (err && err.paused) waitToCoolThenResume();
        else if (err && !err.cancelled) {
            const saved = loadJSON(PLAN_PROGRESS_KEY, null);
            if (saved) { saved.failed = message; store(PLAN_PROGRESS_KEY, saved); }   // don't retry this by itself
        }
        nlog('plan', err && err.cancelled ? 'Cancelled' : `Failed after ${Math.round((Date.now() - jobStarted) / 1000)} s: ${message}`, err && err.stack, err && err.cancelled ? 'info' : 'error');
        if (err && err.cancelled) { showJobBar(null); showToast(kind === 'edit' ? 'Change cancelled' : 'Meal plan cancelled', false); }
        else if (origin === 'chat') { showJobBar(null); chatError = kind === 'edit' ? `Couldn't change the plan: ${message}` : `Couldn't make the plan: ${message}`; }
        else showJobBar('error', kind === 'edit' ? `Couldn't swap the meal: ${message}` : `Couldn't make the plan: ${message}`);
    } finally {
        planJob = null;
        unstore('nourish_pending_plan');
        if (origin === 'chat') { chatBusy = false; chatBusyLabel = ''; }
        renderChat();
        const btn = $('generateBtn');
        btn.disabled = false;
        btn.textContent = 'Generate Plan';
    }
}

let localPlanCancelled = false;
const PLAN_PROGRESS_KEY = 'nourish_plan_progress';

// One model call for a plan with a PC or cloud AI (the phone's own model uses phoneRunner in ondevice.js).
// Returns the text, or null when cancelled.
function aiRunner() {
    return async msgs => {
        if (localPlanCancelled) return null;
        const req = await buildAIRequest(msgs);
        const id = await startJob(req);
        if (planJob) planJob.currentJob = id;
        try {
            return extractText(req.provider, await waitForJob(id));
        } catch (e) {
            if (e.cancelled || localPlanCancelled) return null;
            throw e;
        } finally {
            if (planJob) planJob.currentJob = null;
        }
    };
}

// An on-phone plan that stopped part-way (the app was closed, iOS stopped it, the phone got too hot)
// continues by itself the next time Nourish is open.
function resumeLocalPlan() {
    if (planJob) return;
    const saved = loadJSON(PLAN_PROGRESS_KEY, null);
    if (!saved || saved.failed || !Array.isArray(saved.days) || saved.days.length >= 7 || !Array.isArray(saved.messages)) return;
    nlog('plan', `Found a plan stopped at day ${saved.days.length} of 7; continuing`);
    showJobBar('busy', `Resuming from day ${saved.days.length + 1} of 7…`);
    runPlanJob({ kind: 'plan', origin: saved.origin || 'sheet', messages: saved.messages, continueSaved: true });
}

// After a "too hot" stop: check every minute, continue once the phone is back to nominal or fair.
let coolTimer = null;
function waitToCoolThenResume() {
    clearInterval(coolTimer);
    coolTimer = setInterval(async () => {
        if (planJob || !loadJSON(PLAN_PROGRESS_KEY, null)) { clearInterval(coolTimer); return; }
        const specs = await nativeCall('specs', {}, { timeoutMs: 10000 }).catch(() => null);
        if (specs && (specs.thermal === 'nominal' || specs.thermal === 'fair')) { clearInterval(coolTimer); resumeLocalPlan(); }
    }, 60000);
}
async function cancelPlan() {
    if (!planJob) return;
    if (planJob.id === 'stepwise') {
        // Stops the meal being made; meals already made are kept.
        localPlanCancelled = true;
        if (planJob.local) nativeCall('cancelGenerate', {}).catch(() => {});
        else if (planJob.currentJob) api(`/api/jobs/${planJob.currentJob}`, { method: 'DELETE' }).catch(() => {});
        return;
    }
    try { await api(`/api/jobs/${planJob.id}`, { method: 'DELETE' }); } catch (e) { /* the poll will report it */ }
}

function resumePendingJobs() {
    resumeLocalPlan();   // a plan made meal by meal continues from its last saved meal
    if (isLocalMode()) return;   // other on-device requests don't survive a restart
    const plan = loadJSON('nourish_pending_plan', null);
    if (plan && plan.id && !planJob) runPlanJob(null, plan);
    const chat = loadJSON('nourish_pending_chat', null);
    if (chat && chat.id && !chatBusy) requestChatReply(chat);
}

// === RECIPES FROM A LINK, PASTED TEXT OR A SCREENSHOT ===
// importer.js finds the recipe (embedded recipe data, a social post's caption or transcript, or the
// page's text read by the AI); it's shown in an editable preview before anything is saved.
let importTarget = null;   // { dayIndex, mealType } when opened from an empty meal in the plan
let importMode = 'link';
let importBusy = false;

function showImportSheet(dayIndex = null, mealType = null, mode = 'link') {
    importTarget = dayIndex != null ? { dayIndex, mealType: mealType || 'dinner' } : null;
    setImportMode(mode);
    showImportError('');
    showImportStatus('');
    $('importSheet').classList.add('active');
}

function closeImportSheet() {
    $('importSheet').classList.remove('active');
}

function setImportMode(mode) {
    importMode = mode;
    document.querySelectorAll('[data-import-mode]').forEach(b => {
        const active = b.dataset.importMode === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-import-panel]').forEach(p => { p.hidden = p.dataset.importPanel !== mode; });
    $('importBtn').textContent = { link: 'Find the recipe', paste: 'Read the recipe', image: 'Read the screenshot' }[mode];
    if (mode === 'image') $('importImageHint').textContent = screenshotHint();
}

function showImportStatus(text) {
    $('importStatus').hidden = !text;
    $('importStatusText').textContent = text || '';
}

// An error, with buttons to try pasting the text or a screenshot when the page couldn't be read.
function showImportError(message, { offerOthers = false } = {}) {
    const box = $('importError');
    box.hidden = !message;
    if (!message) { setChildren(box); return; }
    setChildren(box, h('div', { text: message }),
        offerOthers ? h('div', { class: 'import-error-actions' },
            h('p', { text: 'You can still add it: open the post or page yourself, then paste the recipe text or take a screenshot of it.' }),
            h('div', { class: 'import-error-buttons' },
                h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { setImportMode('paste'); showImportError(''); $('importText').focus(); } }, icon('i-text'), 'Paste the text'),
                h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { setImportMode('image'); showImportError(''); } }, icon('i-image'), 'Use a screenshot'))) : null);
}

// Can this device and AI read the recipe out of text? (Recipe data on a page needs no AI.)
function aiReady() {
    const p = settings.active_provider;
    if (p === 'local') return !!settings.local_model;
    if (p === 'claude' || p === 'openai') return !!settings[`${p}_api_key`] || (!isLocalMode() && !!secretsSet[`${p}_api_key`]);
    return !isLocalMode();
}
const NEEDS_AI = 'Reading this needs an AI model: download one in Settings → AI model (or add a Claude or OpenAI key).';

// One AI request outside a plan: the phone's model (with a forced format) or the PC/cloud AI.
async function askAI(messages, { grammar = null, maxTokens } = {}) {
    const req = await buildAIRequest(messages, { maxTokens });
    if (req.provider === 'local') {
        req.grammar = grammar;
        return runOnDevice(req, 'ask-' + Date.now());
    }
    return extractText(req.provider, await waitForJob(await startJob(req)));
}

function extractWithAI(text, info) {
    if (!aiReady()) throw new Error(NEEDS_AI);
    return extractRecipe(text, Object.assign({ provider: settings.active_provider }, info), askAI, { onPhone: settings.active_provider === 'local' });
}

async function fetchForImport(url, { browser = true } = {}) {
    const started = Date.now();
    const res = await api('/api/web/fetch', { method: 'POST', timeoutMs: 30000, body: { url, browser } });
    nlog('import', `GET ${url.length > 120 ? url.slice(0, 120) + '…' : url} → ${res.status} (${Date.now() - started} ms, ${(res.body || '').length} characters)`, null, res.status >= 400 ? 'warn' : 'debug');
    return res;
}

// How a screenshot can be read here: on the iPhone itself, or by a cloud AI that can see pictures.
function screenshotHint() {
    if (canReadTextOnPhone()) return 'Read on your iPhone (nothing is uploaded), then the AI pulls out the recipe.';
    if (settings.active_provider === 'claude' || settings.active_provider === 'openai') return `${PROVIDERS[settings.active_provider]} reads the screenshot.`;
    return 'Reading screenshots needs the iPhone app, or a Claude or OpenAI key (Settings → AI model). You can paste the text instead.';
}
function canReadTextOnPhone() {
    if (!isLocalMode() || !nativeAvailable()) return false;
    if (typeof specsCache !== 'undefined' && specsCache && specsCache.platform) return specsCache.platform === 'ios';
    return /iPhone|iPad|iPod/.test(navigator.userAgent);   // before the phone's details have loaded
}

// A picture as a JPEG (upright, at most 2000 px on its longest side), base64.
async function imageForReading(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a picture Nourish can open.")); i.src = url; });
        const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return { type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1] };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function runImport() {
    if (importBusy) return;
    showImportError('');
    const btn = $('importBtn');
    importBusy = true;
    btn.disabled = true;
    const started = Date.now();
    try {
        let result;
        if (importMode === 'link') {
            const url = $('importUrl').value.trim();
            if (!url) throw new Error('Paste the link to a recipe first.');
            nlog('import', `Importing ${url}`);
            result = await NourishImport.importUrl(url, { fetchPage: fetchForImport, extract: extractWithAI, onStatus: showImportStatus });
        } else if (importMode === 'paste') {
            const text = $('importText').value.trim();
            if (text.length < 30) throw new Error('Paste the whole recipe: the ingredients and the steps.');
            showImportStatus('Asking the AI to find the recipe…');
            const recipe = await extractWithAI(text, { kind: 'paste' });
            if (!recipe) throw new Error("The AI didn't find a recipe in that text. Make sure it includes the ingredients.");
            result = { recipe, how: 'ai', notes: ['Read from pasted text'] };
        } else {
            const file = $('importImage').files && $('importImage').files[0];
            if (!file) throw new Error('Choose a screenshot first.');
            showImportStatus('Preparing the picture…');
            const image = await imageForReading(file);
            let recipe;
            if (canReadTextOnPhone()) {
                showImportStatus('Reading the text in the picture…');
                const read = await nativeCall('ocr', { image: image.data }, { timeoutMs: 60000 });
                if (!read || (read.text || '').trim().length < 20) throw new Error("No text was found in that picture. Try a clearer screenshot, or paste the text.");
                showImportStatus('Asking the AI to find the recipe…');
                recipe = await extractWithAI(read.text, { kind: 'screenshot' });
            } else if (settings.active_provider === 'claude' || settings.active_provider === 'openai') {
                showImportStatus(`${PROVIDERS[settings.active_provider]} is reading the screenshot…`);
                recipe = await extractWithAI('', { kind: 'screenshot', image });
            } else {
                throw new Error(screenshotHint());
            }
            if (!recipe) throw new Error("No recipe was found in that screenshot. Make sure the ingredients are in the picture.");
            result = { recipe, how: 'ai', notes: ['Read from a screenshot'] };
        }
        const recipe = result.recipe;
        // Nutrition: calculated from the ingredients; the page's own numbers are kept when they agree.
        if (!recipe.servings) { recipe.servings = 4; result.notes.push('The recipe doesn\'t say how many it serves; 4 is assumed'); }
        NourishNutrition.settle(recipe);
        result.notes.push(recipe.nutrition_basis === 'source' ? 'Nutrition from the recipe, checked against USDA data' : 'Nutrition calculated from the ingredients (USDA data)');
        nlog('import', `Found "${recipe.name}" in ${Math.round((Date.now() - started) / 100) / 10} s (${result.how === 'structured' ? 'recipe data on the page' : 'read by the AI'}): ${(recipe.ingredients || []).length} ingredients, ${(recipe.steps || []).length} steps`, result.notes);
        showImportStatus('');
        closeImportSheet();
        $('importUrl').value = '';
        $('importText').value = '';
        $('importImage').value = '';
        $('importImageName').textContent = 'Choose a screenshot of the recipe';
        openRecipeEditor(recipe, { mode: 'import', notes: result.notes, mealType: (importTarget && importTarget.mealType) || guessMealType(recipe), target: importTarget });
    } catch (err) {
        showImportStatus('');
        const message = (err && err.message) || 'Something went wrong';
        nlog('import', `Import failed after ${Math.round((Date.now() - started) / 1000)} s: ${message}`, err && err.stack, err && err.blocked ? 'warn' : 'error');
        showImportError(message, { offerOthers: !!(err && err.blocked) || (importMode === 'link' && /HTTP|couldn't load|timed out|abort/i.test(message)) });
    } finally {
        importBusy = false;
        btn.disabled = false;
    }
}

function guessMealType(recipe) {
    const text = `${recipe.name} ${recipe.category || ''}`.toLowerCase();
    if (/breakfast|brunch|pancake|waffle|omelet|oatmeal|overnight oats|granola|smoothie|muffin|french toast|scrambled|porridge/.test(text)) return 'breakfast';
    if (/lunch|salad|sandwich|wrap|soup/.test(text)) return 'lunch';
    return 'dinner';
}

// === RECIPE PREVIEW / EDITOR ===
// An imported recipe before it's saved (mode 'import'), or a Cookbook recipe (mode 'edit').
let editing = null;   // { mode, recipe, mealType, target, cookbookId }

function openRecipeEditor(recipe, { mode = 'import', notes = [], mealType = 'dinner', target = null, cookbookId = null } = {}) {
    editing = { mode, recipe, mealType, target, cookbookId };
    const n = recipe.nutrition || {};
    const num = (id, value, label, attrs = {}) => h('div', { class: 'edit-num' },
        h('label', { class: 'label', for: id, text: label }),
        h('input', Object.assign({ id, type: 'number', inputmode: 'decimal', min: '0', value: value == null || value === '' ? '' : String(Math.round(value)) }, attrs)));
    const lines = (list) => (list || []).join('\n');
    const source = recipe.source_url ? h('a', { class: 'edit-source', href: recipe.source_url, target: '_blank', rel: 'noopener noreferrer' },
        icon('i-link'), `${recipe.source_name || NourishImport.hostOf(recipe.source_url)}${recipe.via_name ? ` · via ${recipe.via_name}` : ''}`) : null;
    const estimated = !!recipe.nutrition_estimated || !!recipe.nutrition_unmatched;
    setChildren($('recipeEditContent'),
        h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
        h('div', { class: 'sheet-header' },
            h('h2', { class: 'title', text: mode === 'import' ? 'Check the recipe' : 'Edit recipe' }),
            h('button', { type: 'button', class: 'icon-btn btn-close', 'aria-label': 'Close', onclick: closeRecipeEditor }, icon('i-close'))),
        h('div', { class: 'sheet-body' },
            mode === 'import' ? h('p', { class: 'sheet-hint', text: 'Fix anything that looks wrong, then save it to your Cookbook or add it to your plan.' }) : null,
            source,
            notes.length ? h('p', { class: 'edit-notes', text: notes.join(' · ') }) : null,
            h('div', { class: 'input-group' }, h('label', { class: 'label', for: 'editName', text: 'Name' }), h('input', { id: 'editName', type: 'text', value: recipe.name || '' })),
            h('div', { class: 'edit-row' },
                h('div', { class: 'edit-num' }, h('label', { class: 'label', for: 'editType', text: 'Meal' }),
                    h('select', { id: 'editType' }, MEAL_TYPES.map(t => h('option', { value: t, selected: t === mealType }, MEAL_LABELS[t])))),
                num('editServings', recipe.servings, 'Serves', { min: '1', max: '50' }),
                num('editTime', recipe.time_minutes, 'Minutes')),
            h('div', { class: 'input-group' }, h('label', { class: 'label', for: 'editIngredients', text: 'Ingredients · one per line' }),
                h('textarea', { id: 'editIngredients', rows: String(Math.min(14, Math.max(5, (recipe.ingredients || []).length + 1))) }, lines(recipe.ingredients))),
            h('div', { class: 'input-group' }, h('label', { class: 'label', for: 'editSteps', text: 'Steps · one per line' }),
                h('textarea', { id: 'editSteps', rows: String(Math.min(14, Math.max(5, (recipe.steps || []).length + 2))) }, lines(recipe.steps))),
            h('div', { class: 'label edit-nutrition-title' }, 'Nutrition per serving', estimated ? h('span', { class: 'chip warn', id: 'editEstimated', text: 'Approximate' }) : null),
            h('div', { class: 'edit-row four' },
                num('editKcal', n.calories, 'kcal'), num('editProtein', n.protein_g, 'Protein g'), num('editCarbs', n.carbs_g, 'Carbs g'), num('editFat', n.fat_g, 'Fat g')),
            nutritionNotes(recipe).filter(t => !/^Portion|^Less oil|^Seasoning/.test(t)).map(t => h('p', { class: 'recipe-note', text: t })),
            h('div', { class: 'form-error', id: 'editError', role: 'alert', hidden: true }),
            mode === 'edit'
                ? h('button', { type: 'button', class: 'btn btn-primary edit-save', onclick: saveEditedCookbookRecipe }, icon('i-check'), 'Save changes')
                : h('div', { class: 'edit-actions' },
                    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => saveImported('cookbook') }, icon('i-heart'), 'Save to Cookbook'),
                    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => saveImported('plan') }, icon('i-calendar'), target ? `Add to ${dayName(target.dayIndex)} ${MEAL_LABELS[target.mealType].toLowerCase()}` : 'Add to plan…'),
                    h('label', { class: 'edit-also' }, h('input', { type: 'checkbox', id: 'editAlsoSave', checked: true }), 'Also keep it in my Cookbook when adding to the plan'))));
    ['editKcal', 'editProtein', 'editCarbs', 'editFat'].forEach(id => $(id).addEventListener('input', () => { const chip = $('editEstimated'); if (chip) chip.textContent = 'Edited'; editing.nutritionEdited = true; }));
    $('recipeEditContent').scrollTop = 0;
    $('recipeEditSheet').classList.add('active');
}

function closeRecipeEditor() {
    $('recipeEditSheet').classList.remove('active');
    editing = null;
}

// The recipe as edited, or null (with the problem shown) when it can't be saved.
function editedRecipe() {
    const val = id => $(id).value.trim();
    const numOrNull = id => (val(id) === '' || !(Number(val(id)) >= 0) ? null : Number(val(id)));
    const split = id => val(id).split('\n').map(l => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
    const err = $('editError');
    const fail = text => { err.textContent = text; err.hidden = false; err.scrollIntoView({ block: 'center' }); return null; };
    err.hidden = true;
    const r = editing.recipe;
    const recipe = {
        name: val('editName'), servings: numOrNull('editServings'), time_minutes: numOrNull('editTime'),
        ingredients: split('editIngredients'), steps: split('editSteps'),
        nutrition: numOrNull('editKcal') != null ? { calories: numOrNull('editKcal'), protein_g: numOrNull('editProtein') || 0, carbs_g: numOrNull('editCarbs') || 0, fat_g: numOrNull('editFat') || 0 } : null,
        // Numbers typed in by hand are kept; otherwise they're worked out again from the ingredients.
        nutrition_basis: editing.nutritionEdited ? 'source' : undefined,
        source_url: r.source_url, source_name: r.source_name, via_url: r.via_url, via_name: r.via_name,
    };
    if (recipe.name.length < 2) return fail('Give the recipe a name.');
    if (!recipe.ingredients.length) return fail('Add at least one ingredient.');
    if (!recipe.steps.length) return fail('Add at least one step.');
    return normalizeMeal(recipe);
}

function saveImported(where) {
    const recipe = editedRecipe();
    if (!recipe) return;
    const mealType = $('editType').value;
    if (where === 'cookbook') {
        addToCookbook(recipe, mealType, 'imported');
        closeRecipeEditor();
        showToast(`Saved "${recipe.name}" to your Cookbook`, false);
        return;
    }
    const alsoSave = $('editAlsoSave').checked;
    const target = editing.target;
    const put = (dayIndex, type) => {
        placeInPlan(recipe, dayIndex, type);
        if (alsoSave) addToCookbook(recipe, mealType, 'imported');
        closeRecipeEditor();
        showToast(`Added "${recipe.name}" to ${dayName(dayIndex)}${alsoSave ? ' and your Cookbook' : ''}`, false);
    };
    if (target) put(target.dayIndex, target.mealType);
    else showSlotPicker(recipe.name, mealType, put);
}

function placeInPlan(recipe, dayIndex, mealType) {
    while (daysData.length <= dayIndex) daysData.push({ breakfast: null, lunch: null, dinner: null });
    daysData[dayIndex][mealType] = normalizeMeal(JSON.parse(JSON.stringify(recipe)));
    changed('plan');
    selectedDay = dayIndex;
    renderAll();
}

// === PICK A DAY AND MEAL ===
function showSlotPicker(name, mealType, onPick) {
    const days = Math.min(Math.max(daysData.length, 1) + (daysData.length < 7 ? 1 : 0), 7);
    const replaces = () => {
        const d = Number($('slotDay').value), t = $('slotMeal').value;
        const meal = daysData[d] && daysData[d][t];
        $('slotNote').textContent = meal ? `This replaces "${meal.name}" in your plan.` : 'This meal is empty.';
    };
    setChildren($('slotContent'),
        h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
        h('div', { class: 'sheet-header' },
            h('h2', { class: 'title', text: 'Add to plan' }),
            h('button', { type: 'button', class: 'icon-btn btn-close', 'aria-label': 'Close', onclick: closeSlotPicker }, icon('i-close'))),
        h('div', { class: 'sheet-body' },
            h('p', { class: 'sheet-hint', text: name }),
            h('div', { class: 'input-group import-slot' },
                h('div', {}, h('label', { class: 'label', for: 'slotDay', text: 'Day' }),
                    h('select', { id: 'slotDay', onchange: replaces }, Array.from({ length: days }, (_, i) =>
                        h('option', { value: String(i), selected: i === Math.min(selectedDay, days - 1) }, `${isToday(i) ? 'Today' : dayName(i)}${i >= daysData.length ? ' (new)' : ''}`)))),
                h('div', {}, h('label', { class: 'label', for: 'slotMeal', text: 'Meal' }),
                    h('select', { id: 'slotMeal', onchange: replaces }, MEAL_TYPES.map(t => h('option', { value: t, selected: t === mealType }, MEAL_LABELS[t]))))),
            h('p', { class: 'recipe-note slot-note', id: 'slotNote' }),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const d = Number($('slotDay').value), t = $('slotMeal').value; closeSlotPicker(); onPick(d, t); } }, icon('i-calendar'), 'Add to plan')));
    replaces();
    $('slotSheet').classList.add('active');
}

function closeSlotPicker() {
    $('slotSheet').classList.remove('active');
}

// === COOKBOOK ===
// Saved recipes, kept apart from the plan: making a new plan or swapping a meal never changes them.
// { recipes: [{ id, saved_at, source: 'generated' | 'imported', meal_type, recipe }] }
const COOKBOOK_MAX = 500;
function cleanCookbook(value) {
    const list = value && Array.isArray(value.recipes) ? value.recipes : [];
    return {
        recipes: list.filter(e => e && typeof e === 'object' && e.recipe && e.recipe.name)
            .map(e => ({
                id: String(e.id || cookbookId()), saved_at: Number(e.saved_at) || Date.now(),
                source: e.source === 'imported' ? 'imported' : 'generated',
                meal_type: MEAL_TYPES.includes(e.meal_type) ? e.meal_type : 'dinner',
                recipe: normalizeMeal(e.recipe) || { name: String(e.recipe.name), ingredients: [], amounts: [], steps: [] },
            })).slice(0, COOKBOOK_MAX),
    };
}
function cookbookId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// The same recipe: same name and same source page (generated recipes have none).
function sameRecipe(a, b) {
    return String(a.name || '').trim().toLowerCase() === String(b.name || '').trim().toLowerCase() && (a.source_url || '') === (b.source_url || '');
}
function cookbookEntry(meal) {
    return meal ? cookbook.recipes.find(e => sameRecipe(e.recipe, meal)) : null;
}

function addToCookbook(meal, mealType, source) {
    const existing = cookbookEntry(meal);
    const copy = normalizeMeal(JSON.parse(JSON.stringify(meal)));
    delete copy.incomplete;   // a saved recipe is a copy; the plan's "may be incomplete" note isn't carried over
    if (existing) {
        existing.recipe = copy;
        existing.meal_type = mealType;
    } else {
        cookbook.recipes.unshift({ id: cookbookId(), saved_at: Date.now(), source, meal_type: mealType, recipe: copy });
        learn('save', copy);
        if (cookbook.recipes.length > COOKBOOK_MAX) cookbook.recipes.length = COOKBOOK_MAX;
    }
    changed('cookbook');
    if ($('cookbookSheet').classList.contains('active')) renderCookbook();
}

function removeFromCookbook(id) {
    const entry = cookbook.recipes.find(e => e.id === id);
    cookbook.recipes = cookbook.recipes.filter(e => e.id !== id);
    changed('cookbook');
    if (entry) learn('delete', entry.recipe);
    if ($('cookbookSheet').classList.contains('active')) renderCookbook();
    if (entry) showToast(`Removed "${entry.recipe.name}" from your Cookbook`, false);
}

// The heart on a recipe: saves it, or removes it again.
function toggleSaved(meal, mealType) {
    const entry = cookbookEntry(meal);
    if (entry) removeFromCookbook(entry.id);
    else {
        addToCookbook(meal, mealType, meal.source_url ? 'imported' : 'generated');
        showToast('Saved to your Cookbook', false);
    }
}

let cookbookFilter = { q: '', type: 'all', source: 'all' };

function showCookbook() {
    renderCookbook();
    $('cookbookSheet').classList.add('active');
}
function closeCookbook() {
    $('cookbookSheet').classList.remove('active');
}

function renderCookbook() {
    const f = cookbookFilter;
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = cookbook.recipes.filter(e => {
        if (f.type !== 'all' && e.meal_type !== f.type) return false;
        if (f.source !== 'all' && e.source !== f.source) return false;
        const text = `${e.recipe.name} ${(e.recipe.ingredients || []).join(' ')} ${e.recipe.source_name || ''}`.toLowerCase();
        return words.every(w => text.indexOf(w) !== -1);
    });
    const chip = (group, value, label) => h('button', {
        type: 'button', class: `filter-chip${f[group] === value ? ' active' : ''}`, 'aria-pressed': String(f[group] === value),
        onclick: () => { cookbookFilter[group] = value; renderCookbook(); },
    }, label);
    const content = $('cookbookContent');
    const hadFocus = document.activeElement && document.activeElement.id === 'cookbookSearch';
    setChildren(content,
        h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
        h('div', { class: 'sheet-header' },
            h('div', {}, h('div', { class: 'eyebrow', text: `${cookbook.recipes.length} saved` }), h('h2', { class: 'title', text: 'Cookbook' })),
            h('div', { class: 'header-actions' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add a recipe from a link', onclick: () => showImportSheet() }, icon('i-plus')),
                h('button', { type: 'button', class: 'icon-btn btn-close', 'aria-label': 'Close', onclick: closeCookbook }, icon('i-close')))),
        h('div', { class: 'sheet-body cookbook-body' },
            h('div', { class: 'cookbook-search' }, icon('i-search'),
                h('input', { id: 'cookbookSearch', type: 'search', placeholder: 'Search recipes and ingredients', value: f.q, autocomplete: 'off',
                    oninput: e => { cookbookFilter.q = e.target.value; renderCookbook(); } })),
            h('div', { class: 'filter-row', role: 'group', 'aria-label': 'Meal' }, chip('type', 'all', 'All meals'), MEAL_TYPES.map(t => chip('type', t, MEAL_LABELS[t]))),
            h('div', { class: 'filter-row', role: 'group', 'aria-label': 'Source' }, chip('source', 'all', 'Any source'), chip('source', 'generated', 'Made by Nourish'), chip('source', 'imported', 'Imported')),
            !cookbook.recipes.length
                ? h('div', { class: 'empty-state compact' },
                    h('div', { class: 'empty-art' }, icon('i-heart')),
                    h('h2', { class: 'title', text: 'No saved recipes yet' }),
                    h('p', { text: 'Tap the heart on any recipe to keep it here, or add one from a link, pasted text or a screenshot.' }),
                    h('div', { class: 'empty-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => showImportSheet() }, icon('i-link'), 'Add a recipe')))
                : !shown.length
                    ? h('p', { class: 'cookbook-none', text: 'No saved recipes match.' })
                    : h('div', { class: 'cookbook-list' }, shown.map(e => h('button', { type: 'button', class: 'cookbook-card', onclick: () => openRecipeSheet(e.meal_type, e.recipe, null, { cookbookId: e.id }) },
                        h('span', { class: `dot art-${e.meal_type}` }, icon(MEAL_ICONS[e.meal_type])),
                        h('span', { class: 'cookbook-card-body' },
                            h('span', { class: 'plan-meal-type', text: MEAL_LABELS[e.meal_type] }),
                            h('span', { class: 'plan-meal-name', text: e.recipe.name }),
                            h('span', { class: 'plan-meal-meta', text: [mealTime(e.recipe).text, on('show_nutrition') && e.recipe.nutrition ? `${formatCalories(e.recipe.nutrition.calories)} kcal` : ''].filter(Boolean).join(' · ') }),
                            h('span', { class: 'cookbook-source' }, icon(e.source === 'imported' ? 'i-link' : 'i-sparkle'), e.source === 'imported' ? (e.recipe.source_name || 'Imported') : 'Made by Nourish')),
                        icon('i-chevron', 'chev'))))));
    if (hadFocus) { const s = $('cookbookSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

function saveEditedCookbookRecipe() {
    const recipe = editedRecipe();
    if (!recipe) return;
    const entry = cookbook.recipes.find(e => e.id === editing.cookbookId);
    if (!entry) { closeRecipeEditor(); return; }
    entry.recipe = recipe;
    entry.meal_type = $('editType').value;
    changed('cookbook');
    closeRecipeEditor();
    renderCookbook();
    if (openRecipe && openRecipe.cookbookId === entry.id) openRecipeSheet(entry.meal_type, entry.recipe, null, { cookbookId: entry.id });
    showToast('Saved', false);
}

// === CHAT ===
// The chef can act on what you ask: "make me a plan" creates one; "swap Tuesday dinner" edits it.
const DAY_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|today|tomorrow|tonight|weekend|day\s*[1-7])\b/i;
const MEAL_WORDS = /\b(breakfasts?|lunch(es)?|dinners?|suppers?|meals?)\b/i;
const EDIT_VERBS = /\b(swap|replace|change|switch|substitute|instead|remove|update|different|another|vegetarian|vegan|lighter|healthier|spicier|cheaper|quicker|faster|redo)\b/i;
const CREATE_RE = /\b(make|create|generate|build|give|write|draft|design|put together|come up with|plan out|need|want|new)\b.{0,50}\b(meal\s*plan|plan|menu|week of|7[- ]?day|seven[- ]day)\b|^\s*plan (my|the|a|out|meals)\b/i;
const QUESTION_RE = /^\s*(what|which|how|why|is|are|does|do|can you explain|tell me about)\b/i;

function chatIntent(text) {
    if (!on('chat_actions')) return null;
    const wholeNewPlan = CREATE_RE.test(text) && /\b(new|whole|entire|fresh|another|different)\b.{0,20}\b(plan|week|menu)\b/i.test(text);
    if (daysData.length && !wholeNewPlan && EDIT_VERBS.test(text) && (DAY_WORDS.test(text) || MEAL_WORDS.test(text)) && !QUESTION_RE.test(text)) return 'edit';
    if (CREATE_RE.test(text) && !(QUESTION_RE.test(text) && /\b(my|current|this)\s+(meal\s*)?plan\b/i.test(text))) return 'create';
    return null;
}

function initChat() {
    const form = $('chatForm');
    const input = $('chatInput');
    form.addEventListener('submit', e => { e.preventDefault(); sendChat(input.value); });
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', e => {
        // Enter sends on a computer keyboard; Shift+Enter makes a new line. The send button works everywhere.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(input.value); }
    });
    $('chatPlanBtn').addEventListener('click', generatePlanFromChat);
}

function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function addAssistantMessage(content, card) {
    chatHistory.push(card ? { role: 'assistant', content, card } : { role: 'assistant', content });
    chatHistory = chatHistory.slice(-100);
    changed('chat');
}

function clearChat() {
    if (!chatHistory.length) { showToast('The chat is already empty', false); return; }
    if (!confirm('Delete the whole chat history on every device?')) return;
    chatHistory = [];
    chatError = '';
    changed('chat');
    renderChat();
    showToast('Chat cleared', false);
}

async function sendChat(text) {
    text = (text || '').trim();
    if (!text || chatBusy) return;
    const intent = chatIntent(text);
    if (intent && planJob) { showToast('The chef is already working on your plan'); return; }
    nlog('chat', `Message sent (${text.length} characters) → ${intent ? (intent === 'create' ? 'make a plan' : 'change the plan') : 'chat reply'}`);
    const input = $('chatInput');
    input.value = '';
    autoGrow(input);
    chatHistory.push({ role: 'user', content: text });
    chatHistory = chatHistory.slice(-100);
    if (taste.on && NourishTaste.fromChat(taste, text).length) { tasteCache = null; changed('taste'); }
    changed('chat');
    if (intent === 'create') {
        await runPlanJob({ kind: 'plan', origin: 'chat', messages: chatPlanMessages() });
    } else if (intent === 'edit') {
        await runPlanJob({ kind: 'edit', origin: 'chat', messages: [
            { role: 'system', content: editSystemPrompt() },
            ...cleanHistory(chatHistory.slice(-6).concat([{ role: 'user', content: `Apply this request to my plan: "${text}". Return only the JSON changes.` }])),
        ] });
    } else {
        await requestChatReply();
    }
}

async function requestChatReply(resume = null) {
    chatBusy = true;
    chatBusyLabel = '';
    chatError = '';
    renderChat();
    try {
        let pending = resume;
        if (!pending) {
            const phone = settings.active_provider === 'local';
            const req = await buildAIRequest(
                [{ role: 'system', content: chatSystemPrompt() }].concat(cleanHistory(chatHistory.slice(phone ? -8 : -CHAT_HISTORY_LIMIT))),
                { maxTokens: Math.min(Number(settings.max_tokens) || 8000, CHAT_LENGTHS[settings.chat_length] || 2000, phone ? 1024 : 8000) });
            pending = { id: await startJob(req), provider: req.provider };
            if (!isLocalMode()) store('nourish_pending_chat', pending);
        }
        const data = await waitForJob(pending.id);
        chatBusy = false;   // let addAssistantMessage's sync include this reply
        addAssistantMessage(extractText(pending.provider, data).trim() || '(The AI sent an empty reply.)');
    } catch (err) {
        chatError = (err && err.message) || 'Something went wrong';
        nlog('chat', `Reply failed: ${chatError}`, null, 'error');
    } finally {
        unstore('nourish_pending_chat');
        chatBusy = false;
        renderChat();
    }
}

// Minimal, safe formatting for chat replies: paragraphs, bullet/numbered lists and **bold**.
// Built with DOM nodes only, so model output can never inject HTML.
function formatInline(text) {
    return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part =>
        part.startsWith('**') && part.endsWith('**') ? h('strong', { text: part.slice(2, -2) }) : document.createTextNode(part));
}

function formatMessage(text) {
    const blocks = [];
    let list = null;
    for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
        if (bullet || numbered) {
            const type = bullet ? 'ul' : 'ol';
            if (!list || list.tagName.toLowerCase() !== type) { list = h(type); blocks.push(list); }
            list.append(h('li', {}, formatInline((bullet || numbered)[1])));
        } else {
            list = null;
            if (heading) blocks.push(h('p', {}, h('strong', { text: heading[1] })));
            else if (line.trim()) blocks.push(h('p', {}, formatInline(line)));
        }
    }
    return blocks;
}

function chatCard(card) {
    if (card.type === 'plan') {
        return h('div', { class: 'chat-card' },
            h('div', { class: 'chat-card-title' }, icon('i-calendar'), `${card.days || 7}-day plan added`),
            Array.isArray(card.dinners) && card.dinners.some(Boolean)
                ? h('ul', {}, card.dinners.slice(0, 7).map((d, i) => d ? h('li', { text: `${dayName(i, true)} dinner · ${d}` }) : null)) : null,
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => switchTab('plan') }, 'Open the plan'));
    }
    if (card.type === 'edit' && Array.isArray(card.changes) && card.changes.length) {
        const first = card.changes[0];
        return h('div', { class: 'chat-card' },
            h('div', { class: 'chat-card-title' }, icon('i-check'), card.changes.length === 1 ? 'Plan updated' : `${card.changes.length} meals updated`),
            h('button', {
                type: 'button', class: 'btn btn-secondary',
                onclick: () => {
                    const day = daysData[first.day - 1];
                    if (day && day[first.meal]) openRecipeSheet(first.meal, day[first.meal], first.day - 1);
                    else switchTab('plan');
                },
            }, card.changes.length === 1 ? 'View the new recipe' : 'View the first one'));
    }
    return null;
}

function renderChat() {
    const box = $('chatMessages');
    if (!box) return;
    const planBtn = $('chatPlanBtn');
    planBtn.disabled = !!planJob || !chatHistory.some(m => m.role === 'user');
    const label = planBtn.querySelector('span');
    if (label) label.textContent = planJob ? 'Cooking…' : 'Make plan';
    $('chatSend').disabled = chatBusy;

    const avatar = () => h('div', { class: 'chat-avatar', 'aria-hidden': 'true' }, brandMark(30));
    const items = [];
    if (!chatHistory.length) {
        items.push(h('div', { class: 'chat-welcome' },
            h('div', { class: 'chat-mark' }, brandMark(76)),
            h('h2', { class: 'title', text: settings.name ? `Hi ${settings.name.trim().split(/\s+/)[0]}, I'm your chef` : "Hi, I'm your chef" }),
            h('p', { text: on('chat_actions')
                ? 'Tell me what you like and how you cook. Ask me to make a plan and it goes straight into your Plan tab; ask me to swap a meal and I\'ll change it.'
                : 'Tell me what you like, what you need, and how you cook. When it sounds right, tap "Make plan" to turn the chat into your 7-day plan.' }),
            h('div', { class: 'chat-suggestions' }, CHAT_SUGGESTIONS
                .filter(([, s]) => daysData.length || !/^Swap/.test(s))
                .map(([ic, s]) => h('button', { type: 'button', class: 'chat-suggestion', onclick: () => sendChat(s) }, icon(ic), h('span', { text: s }))))));
    }
    for (const m of chatHistory) {
        if (m.role === 'assistant') {
            items.push(h('div', { class: 'chat-row' }, avatar(),
                h('div', { class: 'chat-bubble chat-assistant' }, formatMessage(m.content), m.card ? chatCard(m.card) : null)));
        } else {
            items.push(h('div', { class: 'chat-row user' }, h('div', { class: 'chat-bubble chat-user' }, h('p', { text: m.content }))));
        }
    }
    if (chatBusy) items.push(h('div', { class: 'chat-row' }, avatar(),
        h('div', { class: 'chat-bubble chat-assistant chat-typing', 'aria-label': chatBusyLabel || 'The chef is typing' },
            h('span'), h('span'), h('span'), chatBusyLabel ? h('em', { text: chatBusyLabel }) : null)));
    if (chatError) {
        const last = chatHistory[chatHistory.length - 1];
        items.push(h('div', { class: 'chat-error', role: 'alert' },
            h('p', { text: chatError }),
            last && last.role === 'user'
                ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => {
                    chatHistory.pop();
                    chatError = '';
                    sendChat(last.content);
                } }, 'Try again') : null));
    }
    setChildren(box, ...items);
    scrollChatToEnd();
}

function scrollChatToEnd() {
    const screen = $('screenChat');
    if (screen && screen.classList.contains('active')) {
        requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    }
}
