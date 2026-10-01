// === CONFIG ===
// The Nourish server serves this page, so API calls go back to wherever the page came from
// (any port: NOURISH_PORT can change it). Opened as a file, fall back to the default server.
const API_BASE = location.protocol === 'file:' ? 'http://localhost:8000' : '';

// True inside the Nourish Android/iOS app (it adds "NourishApp" to the browser's user agent).
const IN_PHONE_APP = /\bNourishApp\//.test(navigator.userAgent);

const SVG_NS = 'http://www.w3.org/2000/svg';
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const MEAL_ICONS = { breakfast: 'i-sunrise', lunch: 'i-sun', dinner: 'i-moon' };
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
const ACCENTS = { orange: '#FF7043', green: '#22A06B', blue: '#3B82F6', purple: '#8B5CF6', pink: '#EC4899', teal: '#0EA5A0' };
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
    theme: 'dark',
    accent: 'orange',
    text_size: 'default',
    start_tab: 'today',
    week_start: 'monday',
    show_nutrition: 'on',
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
    units: 'US',
    // recipe sources
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
const settings = Object.assign({}, SETTINGS_DEFAULTS);
let prefs = { goal: 'Maintain', source: 'aiChef', likes: '', hates: '' };
let daysData = [];
let selectedDay = 0;
let grocery = { checked: [], custom: [] };     // checked: item texts; custom: [{ text, checked }]
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
function store(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) { /* not persisted */ }
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
    checkBackend().then(ok => {
        if (!ok) return;
        syncNow().then(() => { loadServerInfo(); resumePendingJobs(); });
    });
    setInterval(() => { if (!document.hidden) syncNow(); }, 15000);
    window.addEventListener('online', () => { checkBackend(); syncNow(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
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
// Settings, preferences, the plan, the grocery list and the chat are kept on the PC so every device
// (browser, iPhone app, Android app) shows the same thing. Each section has a revision number:
// a device that has a newer change sends it; a device that's behind takes the PC's copy.
const SECTIONS = ['settings', 'prefs', 'plan', 'grocery', 'chat'];
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
    return chatHistory.map(m => (m.card ? { role: m.role, content: m.content, card: m.card } : { role: m.role, content: m.content }));
}

function hasLocalData(section) {
    if (section === 'settings') return Object.keys(SETTINGS_DEFAULTS).some(k => settings[k] !== SETTINGS_DEFAULTS[k]);
    if (section === 'prefs') return !!(prefs.likes || prefs.hates) || prefs.goal !== 'Maintain' || prefs.source !== 'aiChef';
    if (section === 'plan') return daysData.length > 0;
    if (section === 'grocery') return grocery.checked.length > 0 || grocery.custom.length > 0;
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
function applyAppearance() {
    const root = document.documentElement;
    root.setAttribute('data-theme', ['dark', 'light', 'system'].includes(settings.theme) ? settings.theme : 'dark');
    root.setAttribute('data-accent', ACCENTS[settings.accent] ? settings.accent : 'orange');
    root.setAttribute('data-text', ['small', 'default', 'large'].includes(settings.text_size) ? settings.text_size : 'default');
    if (on('reduce_motion')) root.setAttribute('data-motion', 'reduced');
    else root.removeAttribute('data-motion');
    const light = settings.theme === 'light' || (settings.theme === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#F6F3F0' : '#0F0D0C');
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
    const follow = () => { if (settings.theme === 'system') applyAppearance(); };
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
let toastTimer;
function showToast(message, isError = true) {
    const toast = $('toast');
    toast.textContent = message;
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
function showJobBar(state, message) {
    const bar = $('jobBar');
    clearInterval(jobBarTimer);
    bar.hidden = !state;
    bar.className = 'job-bar' + (state === 'error' ? ' error' : '');
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
    if (backendOnline !== true) { backendOnline = true; updateBackendStatus(); }
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
    try {
        const data = await api('/health', { timeoutMs: 5000 });
        backendOnline = !!data && data.status === 'ok';
    } catch (e) {
        backendOnline = false;
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
function profileText() {
    const s = settings;
    const lines = [];
    if (s.name) lines.push(`Name: ${s.name}.`);
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
    lines.push(`Use ${s.units === 'Metric' ? 'metric units (g, ml)' : 'US units (cups, oz, lb)'}.`);
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

const RECIPE_FORMAT = '{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]}';

function planSystemPrompt() {
    return 'You are a meal-planning chef. Return ONLY raw JSON, no markdown, no comments. ' +
        'Write out all 7 days in full, with varied meals (do not repeat a dish more than twice in the week). ' +
        'Keep each meal to at most 8 ingredients (with quantities) and 5 short steps. ' +
        `Format: {"days":[{"day":1,"breakfast":${RECIPE_FORMAT},"lunch":{same},"dinner":{same}}]}` +
        '\n\nThe person you are planning for:\n' + profileText();
}

function editSystemPrompt() {
    return 'You are a meal-planning chef editing an existing 7-day plan. Return ONLY raw JSON, no markdown, no comments. ' +
        'Change only the meals the person asks about; leave everything else out of your answer. ' +
        'Days are numbered 1-7 as listed below; "today", "tomorrow" and weekday names refer to those days. ' +
        'Keep each meal to at most 8 ingredients (with quantities) and 5 short steps. ' +
        `Format: {"changes":[{"day":1,"meal":"breakfast|lunch|dinner","recipe":${RECIPE_FORMAT}}]}` +
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
    if (['theme', 'accent', 'text_size', 'reduce_motion'].includes(key)) applyAppearance();
    if (['calorie_target', 'protein_target', 'week_start', 'show_nutrition', 'name'].includes(key)) { updateTodayScreen(); updatePlanScreen(); }
    if (key === 'grocery_hide_checked') updateGroceryScreen();
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
    appearance: { icon: 'i-palette', color: '#AF52DE', title: 'Appearance' },
    ai: { icon: 'i-bot', color: '#5856D6', title: 'AI model' },
    chat: { icon: 'i-chat', color: '#34C759', title: 'Chat' },
    profile: { icon: 'i-user', color: '#FF9500', title: 'Your profile' },
    sources: { icon: 'i-book', color: '#FF2D55', title: 'Recipe sources' },
    grocery: { icon: 'i-cart', color: '#30B0C7', title: 'Grocery list' },
    server: { icon: 'i-server', color: '#8E8E93', title: 'Server & devices' },
    updates: { icon: 'i-update', color: '#007AFF', title: 'Updates' },
    data: { icon: 'i-shield', color: '#636366', title: 'Data & privacy' },
    logs: { icon: 'i-list', color: '#48484A', title: 'Activity log' },
};
const SETTINGS_GROUPS = [['appearance', 'ai', 'chat'], ['profile', 'sources', 'grocery'], ['server', 'updates', 'data', 'logs']];

function settingsSummary(page) {
    const s = settings;
    switch (page) {
        case 'appearance': return `${{ dark: 'Dark', light: 'Light', system: 'Auto' }[s.theme] || 'Dark'} · ${s.accent.charAt(0).toUpperCase() + s.accent.slice(1)}`;
        case 'ai': return s.active_provider === 'local'
            ? `This phone · ${s.local_model ? s.local_model.replace(/\.gguf$/i, '').replace(/-Q\d.*$/i, '') : 'no model yet'}`
            : `${PROVIDERS[s.active_provider].replace(' (local)', '')} · ${s[`${s.active_provider}_model`] || 'auto'}`;
        case 'chat': return `${s.chef_style.charAt(0).toUpperCase() + s.chef_style.slice(1)} · ${on('chat_actions') ? 'can edit plan' : 'chat only'}`;
        case 'profile': return `${s.calorie_target} kcal · ${s.diet === 'No restriction' ? 'any diet' : s.diet}`;
        case 'sources': return s.web_engine === 'brave' ? 'Web: Brave' : 'Web: DuckDuckGo';
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
    settingsPage = page;
    renderSettings();
    window.scrollTo(0, 0);
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
            SETTINGS_GROUPS.map(group => h('div', { class: 'settings-group' }, group.map(key => {
                const p = SETTINGS_PAGES[key];
                const badge = key === 'updates' && updateInfo && updateInfo.update_available;
                return h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => openSettingsPage(key) },
                    h('span', { class: 'nav-icon', style: `background:${p.color}` }, icon(p.icon)),
                    h('span', { class: 'settings-label', text: p.title }),
                    h('span', { id: `settingsSummary-${key}`, class: 'settings-value settings-nav-summary' + (badge ? ' badge' : ''), text: settingsSummary(key) }),
                    icon('i-chevron', 'chev'));
            }))),
            h('p', { class: 'settings-note', text: `Nourish${serverInfo && serverInfo.version ? ' v' + serverInfo.version : ''} · free & open source (AGPL-3.0) · changes save automatically and sync with your PC` }),
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

const SETTINGS_RENDERERS = {
    appearance() {
        return [
            ...settingsGroup('Look', [
                settingsChoice('Theme', settings.theme, { dark: 'Dark', light: 'Light', system: 'Auto' }, v => setSetting('theme', v, { quiet: true })),
                h('div', { class: 'settings-row' },
                    h('span', { class: 'settings-label', text: 'Accent colour' }),
                    h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' }, Object.entries(ACCENTS).map(([name, color]) =>
                        h('button', {
                            type: 'button', role: 'radio', class: 'swatch' + (settings.accent === name ? ' selected' : ''),
                            'aria-checked': String(settings.accent === name), 'aria-label': name,
                            style: `background:${color};color:${color}`,
                            onclick: e => {
                                e.currentTarget.parentNode.querySelectorAll('.swatch').forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
                                e.currentTarget.classList.add('selected');
                                e.currentTarget.setAttribute('aria-checked', 'true');
                                setSetting('accent', name, { quiet: true });
                            },
                        })))),
                settingsChoice('Text size', settings.text_size, { small: 'Small', default: 'Default', large: 'Large' }, v => setSetting('text_size', v, { quiet: true })),
            ]),
            ...settingsGroup('Layout', [
                settingsRow('Open on', settingsSelect('start_tab', { today: 'Today', plan: 'Plan', chat: 'Chat', grocery: 'Grocery' })),
                settingsRow('Plan starts on', settingsSelect('week_start', { monday: 'Monday', sunday: 'Sunday', today: 'Today' })),
                settingsToggle('show_nutrition', 'Show nutrition', { hint: 'Calories and macros on meals' }),
                settingsToggle('reduce_motion', 'Reduce motion', { hint: 'Fewer animations' }),
            ], 'These settings sync to every device connected to your PC.'),
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
            ]),
            ...settingsGroup('Food', [
                settingsRow('Diet', settingsSelect('diet', DIETS)),
                settingsRow('Allergies', settingsInput('allergies', { placeholder: 'e.g. peanuts, shellfish' })),
                settingsRow('Love', textInput(() => prefs.likes, v => { setPref('likes', v); showToast('Saved ✓', false); }, { placeholder: 'e.g. chicken, pasta' })),
                settingsRow('Avoid', textInput(() => prefs.hates, v => { setPref('hates', v); showToast('Saved ✓', false); }, { placeholder: 'e.g. mushrooms' })),
                settingsRow('Cuisines', settingsInput('cuisines', { placeholder: 'e.g. Mexican, Thai' })),
            ], 'Allergies are never included by the AI and are filtered out of recipe searches.'),
            ...settingsGroup('Cooking', [
                settingsRow('Max cook time', settingsSelect('max_cook_time', { '': 'Any', 15: '15 min', 20: '20 min', 30: '30 min', 45: '45 min', 60: '1 hour' })),
                settingsRow('Servings', settingsSelect('servings', ['1', '2', '3', '4', '5', '6'])),
                settingsRow('Skill', settingsSelect('skill', ['Beginner', 'Intermediate', 'Advanced'])),
                settingsRow('Budget', settingsSelect('budget', { Any: 'Any', 'Budget-friendly': 'Budget-friendly', Moderate: 'Moderate', 'No limit': 'No limit' })),
                settingsRow('Units', settingsSelect('units', { US: 'US (cups, oz)', Metric: 'Metric (g, ml)' })),
            ], 'Your profile is used for every AI meal plan and chat.'),
        ];
    },
    sources() {
        const brave = settings.web_engine === 'brave';
        const sources = { aiChef: 'AI Chef', web: 'Web search', themealdb: 'TheMealDB', spoonacular: 'Spoonacular' };
        return [
            ...settingsGroup('Default', [
                settingsRow('New plans use', selectInput(prefs.source, sources, v => { setPref('source', v); syncChoiceButtons(); showToast('Saved ✓', false); }, 'Default source')),
            ]),
            ...settingsGroup('Web search', [
                settingsRow('Search with', settingsSelect('web_engine', { duckduckgo: 'DuckDuckGo', brave: 'Brave Search' }, { onchange: () => renderSettings() })),
                brave ? secretRow('brave_api_key', 'Brave key', 'from brave.com/search/api') : null,
            ], 'Finds real recipes on recipe websites and reads them in full: ingredients, steps, time and (when the site lists it) nutrition. DuckDuckGo needs no key but sometimes limits searches; Brave\'s free plan is more reliable.'),
            ...settingsGroup('Spoonacular', [
                secretRow('spoonacular_api_key', 'API key', 'free key'),
            ], 'Recipes with nutrition, filtered by your diet, allergies and cook time. Free key: spoonacular.com/food-api.'),
            ...settingsGroup('TheMealDB', [infoRow('Ready to use', 'no key needed')],
                'A free collection of recipes from around the world. It has no nutrition data.'),
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
    $('importBtn').addEventListener('click', importFromLink);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeRecipeSheet(); closeGenerateSheet(); closeImportSheet(); }
    });

    document.querySelectorAll('.segment-btn').forEach(btn => {
        btn.addEventListener('click', () => { setPref('goal', btn.dataset.goal); syncChoiceButtons(); });
    });
    document.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => { setPref('source', btn.dataset.source); syncChoiceButtons(); });
    });
}

function syncChoiceButtons() {
    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.goal === prefs.goal);
        b.setAttribute('aria-pressed', b.dataset.goal === prefs.goal);
    });
    document.querySelectorAll('.source-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.source === prefs.source);
        b.setAttribute('aria-pressed', b.dataset.source === prefs.source);
    });
}

function showGenerateSheet() {
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

function openRecipeSheet(mealType, meal, dayIndex = null) {
    const content = $('recipeSheetContent');
    const n = meal.nutrition;
    const chips = [h('span', { class: 'chip' }, icon('i-clock'), formatMinutes(meal.time_minutes))];
    if (on('show_nutrition')) {
        chips.push(h('span', { class: 'chip accent' }, icon('i-flame'), `${formatCalories(n && n.calories)} kcal`));
        if (n && n.protein_g != null) chips.push(h('span', { class: 'chip', text: `Protein ${Math.round(n.protein_g)}g` }));
        if (n && n.carbs_g != null) chips.push(h('span', { class: 'chip', text: `Carbs ${Math.round(n.carbs_g)}g` }));
        if (n && n.fat_g != null) chips.push(h('span', { class: 'chip', text: `Fat ${Math.round(n.fat_g)}g` }));
    }
    const where = dayIndex != null ? `${MEAL_LABELS[mealType] || ''} · ${isToday(dayIndex) ? 'Today' : dayName(dayIndex)}` : MEAL_LABELS[mealType] || '';

    setChildren(content,
        h('div', { class: `recipe-hero art-${mealType}` },
            icon(MEAL_ICONS[mealType] || 'i-utensils'),
            h('div', { class: 'recipe-top' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closeRecipeSheet }, icon('i-close')))),
        h('div', { class: 'recipe-header' },
            h('div', { class: 'meal-type', text: where }),
            h('h2', { class: 'recipe-name', text: meal.name }),
            h('div', { class: 'recipe-meta' }, chips)),
        h('div', { class: 'recipe-actions' },
            dayIndex != null ? h('button', {
                type: 'button', class: 'btn btn-secondary', disabled: !!planJob,
                onclick: () => { closeRecipeSheet(); swapMeal(dayIndex, mealType); },
            }, icon('i-swap'), 'Swap meal') : null,
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => askAboutMeal(meal) }, icon('i-chat'), 'Ask the chef')),
        meal.ingredients.length ? h('div', { class: 'recipe-section' },
            h('div', { class: 'recipe-section-title', text: `Ingredients · ${meal.ingredients.length}` }),
            h('div', { class: 'recipe-ingredients' }, meal.ingredients.map(i => h('div', { class: 'recipe-ingredient', text: i })))) : null,
        meal.steps.length ? h('div', { class: 'recipe-section' },
            h('div', { class: 'recipe-section-title', text: 'Instructions' }),
            h('div', { class: 'recipe-steps' }, meal.steps.map((s, idx) => h('div', { class: 'recipe-step' },
                h('div', { class: 'recipe-step-number', text: idx + 1 }),
                h('div', { class: 'recipe-step-text', text: s }))))) : null,
        meal.source_url ? h('a', { class: 'btn btn-secondary recipe-source', href: meal.source_url, target: '_blank', rel: 'noopener noreferrer' },
            icon('i-link'), `Original recipe on ${meal.source_name || 'the web'}`) : h('div', { style: 'height:20px' }),
    );
    content.scrollTop = 0;
    $('recipeSheet').classList.add('active');
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
function sumNutrient(day, key) {
    return MEAL_TYPES.reduce((sum, t) => sum + ((day[t] && day[t].nutrition && day[t].nutrition[key]) || 0), 0);
}
function hasNutrition(day) {
    return MEAL_TYPES.some(t => day[t] && day[t].nutrition && Number.isFinite(day[t].nutrition.calories));
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
        setChildren(body, h('div', { class: 'empty-state', id: 'emptyState' },
            h('div', { class: 'empty-art' }, icon('i-leaf')),
            h('h2', { class: 'title', text: 'No meal plan yet' }),
            h('p', { text: 'Get a full week of breakfasts, lunches and dinners that fit your goals, made by AI or found on recipe sites.' }),
            h('div', { class: 'empty-actions' },
                h('button', { type: 'button', class: 'btn btn-primary', onclick: showGenerateSheet }, icon('i-sparkle'), 'Generate Meal Plan'),
                h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => switchTab('chat') }, icon('i-chat'), 'Plan it with the chef'))));
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
    if (on('show_nutrition')) {
        const calTarget = Number(settings.calorie_target) || 2400;
        const known = hasNutrition(day);
        const totalCal = sumNutrient(day, 'calories');
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
                    h('div', { class: 'ring-value num', id: 'calorieValue', text: known ? formatCalories(totalCal) : '—' }),
                    h('div', { class: 'ring-label', id: 'calorieLabel', text: known ? `of ${calTarget.toLocaleString()} kcal` : 'no nutrition data' }))),
            h('div', { class: 'macros' }, macros.map(([label, key, max, cls]) => {
                const total = sumNutrient(day, key);
                const fill = h('div', { class: `macro-fill ${cls}` });
                requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = Math.min(total / max * 100, 100) + '%'; }));
                return h('div', {},
                    h('div', { class: 'macro-head' }, h('span', { text: label }), h('span', { class: 'num', text: known ? `${Math.round(total)} / ${max}g` : '—' })),
                    h('div', { class: 'macro-track' }, fill));
            })));
    }

    const title = isToday(selectedDay) ? "Today's meals" : `${dayName(selectedDay)}'s meals`;
    setChildren(body,
        strip,
        summary,
        h('h2', { class: 'section-title' }, title, h('small', { text: `Day ${selectedDay + 1}` })),
        h('div', { class: 'meal-cards', id: 'mealCards' }, MEAL_TYPES.filter(t => day[t]).map(t => mealCard(t, day[t], selectedDay))));
    const active = strip.querySelector('.day-pill.active');
    if (active && active.scrollIntoView) requestAnimationFrame(() => {
        strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    });
}

function mealCard(type, meal, dayIndex) {
    return h('button', { type: 'button', class: 'meal-card', onclick: () => openRecipeSheet(type, meal, dayIndex) },
        h('div', { class: `meal-art art-${type}` }, icon(MEAL_ICONS[type])),
        h('div', { class: 'meal-content' },
            h('div', { class: 'meal-type', text: MEAL_LABELS[type] }),
            h('div', { class: 'meal-name', text: meal.name }),
            h('div', { class: 'meal-badges' },
                h('span', { class: 'chip' }, icon('i-clock'), formatMinutes(meal.time_minutes)),
                on('show_nutrition') ? h('span', { class: 'chip' }, icon('i-flame'), `${formatCalories(meal.nutrition && meal.nutrition.calories)} kcal`) : null)),
        icon('i-chevron', 'chev'));
}

// === PLAN SCREEN ===
function updatePlanScreen() {
    const container = $('planAccordions');
    if (!container) return;
    $('planEyebrow').textContent = daysData.length ? `${daysData.length} days · starts ${dayName(0)}` : 'Your week';
    if (!daysData.length) {
        setChildren(container, h('div', { class: 'empty-state' },
            h('div', { class: 'empty-art' }, icon('i-calendar')),
            h('h2', { class: 'title', text: 'Your week is empty' }),
            h('p', { text: 'Generate a plan, ask the chef in Chat, or add recipes from links with the link button above.' }),
            h('div', { class: 'empty-actions' },
                h('button', { type: 'button', class: 'btn btn-primary', onclick: showGenerateSheet }, icon('i-sparkle'), 'Generate Meal Plan'))));
        return;
    }
    setChildren(container, ...daysData.map((day, idx) => h('section', { class: 'card plan-day' },
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
                    h('span', { class: 'plan-meal-name', text: day[t].name })),
                h('span', { class: 'plan-meal-meta', text: on('show_nutrition') ? `${formatMinutes(day[t].time_minutes)} · ${formatCalories(day[t].nutrition && day[t].nutrition.calories)} kcal` : formatMinutes(day[t].time_minutes) }))
            : h('button', { type: 'button', class: 'plan-meal empty', 'data-meal-type': t, onclick: () => showImportSheet(idx, t) },
                h('span', { class: `dot art-${t}` }, icon('i-plus')),
                h('span', { class: 'plan-meal-body' },
                    h('span', { class: 'plan-meal-type', text: MEAL_LABELS[t] }),
                    h('span', { class: 'plan-meal-name', text: 'Add a recipe from a link' })))))));
}

// === GROCERY SCREEN ===
function initGrocery() {
    $('groceryShareBtn').addEventListener('click', shareGrocery);
    $('groceryResetBtn').addEventListener('click', resetGrocery);
}

const GROCERY_CATEGORIES = [
    ['Protein', ['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'turkey', 'egg', 'tofu', 'tempeh', 'lamb', 'bacon', 'sausage', 'ham', 'lentil', 'chickpea', 'bean']],
    ['Dairy', ['milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'feta', 'parmesan', 'mozzarella']],
    ['Grains & bakery', ['rice', 'pasta', 'noodle', 'bread', 'oat', 'flour', 'quinoa', 'tortilla', 'couscous', 'bagel', 'wrap', 'granola']],
    ['Produce', ['tomato', 'onion', 'garlic', 'lettuce', 'spinach', 'broccoli', 'carrot', 'apple', 'banana', 'berr', 'lemon', 'lime', 'bell pepper', 'mushroom', 'potato', 'zucchini', 'cucumber', 'celery', 'kale', 'cabbage', 'avocado', 'ginger', 'cilantro', 'parsley', 'basil', 'herb', 'pea', 'corn', 'squash', 'asparagus', 'fruit', 'orange', 'vegetable', 'veggie', 'salad']],
    ['Pantry', ['oil', 'salt', 'pepper', 'spice', 'sauce', 'vinegar', 'soy', 'honey', 'sugar', 'stock', 'broth', 'paprika', 'cumin', 'mustard', 'nut', 'seed', 'syrup']],
];

function categorizeIngredient(ing) {
    const lower = ing.toLowerCase();
    for (const [cat, words] of GROCERY_CATEGORIES) if (words.some(w => lower.includes(w))) return cat;
    return 'Other';
}

function groceryItems() {
    const items = {};
    const seen = new Set();
    daysData.forEach(day => MEAL_TYPES.forEach(t => ((day[t] && day[t].ingredients) || []).forEach(ing => {
        const key = ing.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const category = categorizeIngredient(ing);
        if (!items[category]) items[category] = [];
        items[category].push(ing);
    })));
    return items;
}

function updateGroceryScreen() {
    const container = $('groceryContainer');
    if (!container) return;
    const items = groceryItems();
    const order = GROCERY_CATEGORIES.map(c => c[0]).concat(['Other']);
    const categories = order.filter(c => items[c]);
    const checked = new Set(grocery.checked);
    const hide = on('grocery_hide_checked');
    const planCount = categories.reduce((n, c) => n + items[c].length, 0);
    const total = planCount + grocery.custom.length;
    const done = categories.reduce((n, c) => n + items[c].filter(i => checked.has(i)).length, 0) + grocery.custom.filter(c => c.checked).length;

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
        sections.push(h('section', { class: 'card grocery-category' },
            h('div', { class: 'category-header' }, h('span', { text: 'Added by you' }), h('span', { class: 'count', text: `${grocery.custom.filter(c => c.checked).length}/${grocery.custom.length}` })),
            grocery.custom.map((item, i) => itemRow(item.text, item.checked,
                box => { grocery.custom[i].checked = box.checked; groceryChanged(box); },
                () => { grocery.custom.splice(i, 1); changed('grocery'); updateGroceryScreen(); }))));
    }
    for (const cat of categories) {
        sections.push(h('section', { class: 'card grocery-category' },
            h('div', { class: 'category-header' }, h('span', { text: cat }), h('span', { class: 'count', text: `${items[cat].filter(i => checked.has(i)).length}/${items[cat].length}` })),
            items[cat].map(item => itemRow(item, checked.has(item), box => toggleGrocery(item, box)))));
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
    for (const cat of GROCERY_CATEGORIES.map(c => c[0]).concat(['Other'])) {
        const left = (items[cat] || []).filter(i => !checked.has(i));
        if (left.length) lines.push('', cat, ...left.map(i => `• ${i}`));
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

function normalizeMeal(m) {
    if (!m || typeof m !== 'object' || !m.name) return null;
    const n = m.nutrition && typeof m.nutrition === 'object' ? m.nutrition : null;
    return Object.assign({
        name: String(m.name).trim(),
        time_minutes: toNumber(m.time_minutes),
        nutrition: n ? { calories: toNumber(n.calories), protein_g: toNumber(n.protein_g), carbs_g: toNumber(n.carbs_g), fat_g: toNumber(n.fat_g) } : null,
        ingredients: toStringList(m.ingredients),
        steps: toStringList(m.steps),
    }, safeSource(m));
}

function safeSource(m) {
    try {
        const url = new URL(m.source_url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return {};
        return { source_url: url.href, source_name: String(m.source_name || url.hostname.replace(/^www\./, '')).slice(0, 60) };
    } catch (e) {
        return {};
    }
}

// Returns a clean array of days. With strict=true, throws a user-readable error if unusable.
function normalizePlan(data, strict = true) {
    const days = (data && Array.isArray(data.days) ? data.days : Array.isArray(data) ? data : [])
        .filter(d => d && typeof d === 'object')
        .map(d => Object.fromEntries(MEAL_TYPES.map(t => [t, normalizeMeal(d[t])])))
        .filter(d => MEAL_TYPES.some(t => d[t]))
        .slice(0, 7);
    if (strict && !days.length) throw new Error("The response didn't contain any meals. Try again, or try another model.");
    return days;
}

function applyPlan(raw, { navigate = true } = {}) {
    daysData = normalizePlan(raw);
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
        const recipe = normalizeMeal(c && (c.recipe || c.new_recipe));
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

// === GENERATE MEAL PLAN ===
async function generateMealPlan() {
    const likes = $('inputLikes').value.trim();
    const hates = $('inputHates').value.trim();
    if (!likes && !hates) { showToast('Enter at least one food you like or avoid'); return; }
    if (planJob) { showToast('A plan is already cooking'); return; }
    prefs.likes = likes;
    prefs.hates = hates;
    changed('prefs');
    closeGenerateSheet();

    if (prefs.source !== 'aiChef') {
        const names = { themealdb: 'TheMealDB', spoonacular: 'Spoonacular', web: 'the web (this can take a minute)' };
        showJobBar('busy', `Searching ${names[prefs.source] || prefs.source}…`);
        try {
            const generators = { themealdb: generateWithTheMealDB, spoonacular: generateWithSpoonacular, web: generateWithWeb };
            applyPlan(await (generators[prefs.source] || generateWithTheMealDB)(likes, hates));
            showJobBar(null);
        } catch (err) {
            showJobBar('error', (err && err.message) || 'Something went wrong');
        }
        return;
    }
    await runPlanJob({ kind: 'plan', origin: 'sheet', messages: [
        { role: 'system', content: planSystemPrompt() },
        { role: 'user', content: `Goal: ${GOALS[prefs.goal]}. Likes: ${likes || 'anything'}. Avoids: ${hates || 'nothing'}. Generate the 7-day meal plan JSON.` },
    ] });
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

async function swapMeal(dayIndex, mealType) {
    if (planJob) { showToast('The chef is already working on your plan'); return; }
    const current = daysData[dayIndex] && daysData[dayIndex][mealType];
    await runPlanJob({ kind: 'edit', origin: 'recipe', messages: [
        { role: 'system', content: editSystemPrompt() },
        { role: 'user', content: `Replace ${MEAL_LABELS[mealType].toLowerCase()} on Day ${dayIndex + 1}${current ? ` ("${current.name}")` : ''} with a different dish that fits my profile and the rest of that day.` },
    ] });
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
        if (onPhone && kind === 'plan') {
            // On the phone: one day at a time, each forced into the right format.
            if (!settings.local_model) throw new Error('Download a model first: Settings → AI model.');
            localPlanCancelled = false;
            planJob = { id: 'on-device', started: Date.now(), provider: 'local', kind, origin, local: true };
            if (origin === 'chat') { chatBusy = true; chatBusyLabel = 'Cooking your plan…'; chatError = ''; }
            renderChat();
            parsed = await generatePlanOnDevice(job.messages,
                d => { showJobBar('busy', `Cooking day ${d + 1} of 7…`); if (origin === 'chat') { chatBusyLabel = `Cooking day ${d + 1} of 7…`; renderChat(); } },
                () => localPlanCancelled);
            if (!parsed.days.length) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
        } else {
            if (resume) {
                planJob = resume;
            } else {
                showJobBar('busy', 'Preparing…');
                const req = await buildAIRequest(job.messages, kind === 'edit' ? { maxTokens: Math.min(Number(settings.max_tokens) || 8000, onPhone ? 1600 : 4000) } : {});
                if (onPhone) req.grammar = GBNF_EDIT;
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
async function cancelPlan() {
    if (!planJob) return;
    if (planJob.id === 'on-device') {
        // Stop after the day being made; days already made are kept.
        localPlanCancelled = true;
        nativeCall('cancelGenerate', {}).catch(() => {});
        return;
    }
    try { await api(`/api/jobs/${planJob.id}`, { method: 'DELETE' }); } catch (e) { /* the poll will report it */ }
}

function resumePendingJobs() {
    if (isLocalMode()) return;   // on-device requests don't survive the app restarting
    const plan = loadJSON('nourish_pending_plan', null);
    if (plan && plan.id && !planJob) runPlanJob(null, plan);
    const chat = loadJSON('nourish_pending_chat', null);
    if (chat && chat.id && !chatBusy) requestChatReply(chat);
}

function spreadOverWeek(meals, toMeal) {
    if (!meals.length) throw new Error('No recipes found for those foods. Try different "likes".');
    return {
        days: Array.from({ length: 7 }, (_, d) => Object.fromEntries(
            MEAL_TYPES.map((t, m) => [t, toMeal(meals[(d * 3 + m) % meals.length])]))),
    };
}

function joinList(...parts) {
    return parts.filter(Boolean).join(', ');
}

async function generateWithTheMealDB(likes, hates) {
    const data = await api('/api/recipes/themealdb', {
        method: 'POST', timeoutMs: 45000,
        body: { query: likes || 'chicken', exclude: joinList(hates, settings.allergies) },
    });
    return spreadOverWeek((data && data.meals) || [], r => {
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
            const ing = r && r[`strIngredient${i}`];
            if (ing && ing.trim()) ingredients.push(`${r[`strMeasure${i}`] || ''} ${ing}`.trim());
        }
        // Split into sentences without regex lookbehind (unsupported before iOS 16.4).
        const steps = ((r && r.strInstructions) || '').replace(/\.\s+/g, '.\n').split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 3).slice(0, 12);
        // TheMealDB has no nutrition or cooking-time data; leave them unknown rather than invent numbers.
        return { name: r && r.strMeal, time_minutes: null, nutrition: null, ingredients, steps };
    });
}

async function generateWithSpoonacular(likes, hates) {
    if (!settings.spoonacular_api_key && !secretsSet.spoonacular_api_key) throw new Error('Spoonacular needs a free API key. Add it in Settings → Recipe sources.');
    const data = await api('/api/recipes/spoonacular', {
        method: 'POST', timeoutMs: 45000,
        body: {
            api_key: settings.spoonacular_api_key || undefined, query: likes || 'chicken', exclude: hates, number: 21,
            diet: SPOONACULAR_DIETS[settings.diet], intolerances: settings.allergies || undefined,
            max_ready_time: Number(settings.max_cook_time) || undefined,
        },
    });
    return spreadOverWeek((data && data.results) || [], r => {
        const nutrient = name => { const f = ((r && r.nutrition && r.nutrition.nutrients) || []).find(n => n && n.name === name); return f ? f.amount : null; };
        return {
            name: r && r.title,
            time_minutes: r && r.readyInMinutes,
            nutrition: r && r.nutrition ? { calories: nutrient('Calories'), protein_g: nutrient('Protein'), carbs_g: nutrient('Carbohydrates'), fat_g: nutrient('Fat') } : null,
            ingredients: ((r && r.extendedIngredients) || []).map(i => i && i.original),
            steps: ((r && r.analyzedInstructions && r.analyzedInstructions[0] && r.analyzedInstructions[0].steps) || []).map(s => s && s.step).slice(0, 12),
        };
    });
}

async function generateWithWeb(likes, hates) {
    const base = [likes || 'healthy', settings.diet !== 'No restriction' ? settings.diet : '', settings.cuisines].filter(Boolean).join(' ');
    const body = mealType => ({
        query: `${base} ${mealType} recipe`, number: 7, exclude: joinList(hates, settings.allergies),
        brave_key: settings.web_engine === 'brave' ? settings.brave_api_key || undefined : undefined,
        engine: settings.web_engine,
    });
    const results = await Promise.allSettled(MEAL_TYPES.map(t => api('/api/recipes/web', { method: 'POST', timeoutMs: 120000, body: body(t) })));
    const byType = Object.fromEntries(MEAL_TYPES.map((t, i) => [t, results[i].status === 'fulfilled' ? (results[i].value && results[i].value.recipes) || [] : []]));
    if (!MEAL_TYPES.some(t => byType[t].length)) {
        const err = results.find(r => r.status === 'rejected');
        throw new Error((err && err.reason && err.reason.message) || 'No recipes found on the web for those foods. Try different "likes".');
    }
    // Fill each slot from its own search; borrow from the others if one came back empty.
    const all = MEAL_TYPES.reduce((acc, t) => acc.concat(byType[t]), []);
    return {
        days: Array.from({ length: 7 }, (_, d) => Object.fromEntries(MEAL_TYPES.map(t => {
            const pool = byType[t].length ? byType[t] : all;
            return [t, pool[d % pool.length]];
        }))),
    };
}

function showImportSheet(dayIndex = selectedDay, mealType = 'dinner') {
    const days = Math.max(daysData.length, 1);
    setChildren($('importDay'), Array.from({ length: Math.min(days + (days < 7 ? 1 : 0), 7) }, (_, i) =>
        h('option', { value: String(i), selected: i === dayIndex }, `Day ${i + 1} · ${dayName(i, true)}${i >= daysData.length ? ' (new)' : ''}`)));
    $('importMeal').value = mealType;
    $('importError').hidden = true;
    $('importSheet').classList.add('active');
}

function closeImportSheet() {
    $('importSheet').classList.remove('active');
}

async function importFromLink() {
    const url = $('importUrl').value.trim();
    const errorBox = $('importError');
    const btn = $('importBtn');
    errorBox.hidden = true;
    if (!url) { errorBox.textContent = 'Paste the address of a recipe page first.'; errorBox.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = 'Reading the recipe…';
    try {
        const recipe = normalizeMeal(await api('/api/recipes/import', { method: 'POST', timeoutMs: 45000, body: { url } }));
        if (!recipe) throw new Error('No recipe was found on that page.');
        const dayIndex = Number($('importDay').value) || 0;
        const mealType = $('importMeal').value;
        while (daysData.length <= dayIndex) daysData.push({ breakfast: null, lunch: null, dinner: null });
        daysData[dayIndex][mealType] = recipe;
        changed('plan');
        $('importUrl').value = '';
        closeImportSheet();
        selectedDay = dayIndex;
        renderAll();
        showToast(`Added "${recipe.name}" to ${dayName(dayIndex)}`, false);
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add recipe';
    }
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

    const avatar = () => h('div', { class: 'chat-avatar', 'aria-hidden': 'true' }, icon('i-leaf'));
    const items = [];
    if (!chatHistory.length) {
        items.push(h('div', { class: 'chat-welcome' },
            h('div', { class: 'empty-art' }, icon('i-chat')),
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
