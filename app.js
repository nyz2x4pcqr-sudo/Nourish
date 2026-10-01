// === CONFIG ===
// The Nourish server serves this page, so API calls go back to wherever the page came from
// (any port: NOURISH_PORT can change it). Opened as a file, fall back to the default server.
const API_BASE = location.protocol === 'file:' ? 'http://localhost:8000' : '';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const MEAL_EMOJI = { breakfast: '🍳', lunch: '🥗', dinner: '🍝' };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PROVIDERS = { lmstudio: 'LM Studio (local)', ollama: 'Ollama (local)', claude: 'Claude', openai: 'OpenAI' };
const MODEL_SUGGESTIONS = {
    claude: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    openai: ['gpt-4o-mini', 'gpt-4o'],
};
const DIETS = ['No restriction', 'Vegetarian', 'Vegan', 'Pescatarian', 'Keto', 'Low-carb', 'Paleo',
    'Mediterranean', 'Gluten-free', 'Dairy-free', 'Halal', 'Kosher'];
const SPOONACULAR_DIETS = { Vegetarian: 'vegetarian', Vegan: 'vegan', Pescatarian: 'pescetarian', Keto: 'ketogenic', Paleo: 'paleo', 'Gluten-free': 'gluten free' };
const CHAT_HISTORY_LIMIT = 20;
const CHAT_SUGGESTIONS = [
    'I want high-protein meals that take under 30 minutes',
    'Plan a week of cheap meals I can batch-cook on Sunday',
    'What can I cook with chicken, rice and broccoli?',
    'Swap anything spicy in my plan for milder dishes',
];

// Every setting, with its default. Stored in localStorage under the same key, as a string.
const SETTINGS_DEFAULTS = {
    active_provider: 'lmstudio',
    lmstudio_model: '',
    ollama_model: '',
    claude_api_key: '',
    claude_model: 'claude-haiku-4-5-20251001',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    temperature: '0.7',
    max_tokens: '8000',
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
    spoonacular_api_key: '',
    web_engine: 'duckduckgo',
    brave_api_key: '',
    auto_update_check: 'on',
    update_prereleases: 'on',
};

// === STATE ===
let goal = 'Maintain';
let source = 'aiChef';
let daysData = [];
let selectedDay = 0;
let checkedGrocery = new Set();
let backendOnline = null;
let serverInfo = null;
const modelLists = {};         // provider -> { models: [], error: '' }
const settings = { ...SETTINGS_DEFAULTS };
let chatHistory = [];          // [{ role: 'user' | 'assistant', content }]
let chatBusy = false;
let chatError = '';
let planJob = null;            // { id, started } while an AI plan is cooking
let updateInfo = null;         // result of the last update check
let updateChecking = false;
let updateError = '';

// === STORAGE (localStorage can throw in private browsing) ===
function store(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) { /* not persisted */ }
}
function load(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function loadJSON(key, fallback) {
    try { return JSON.parse(load(key)) ?? fallback; } catch (e) { return fallback; }
}
function unstore(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

// === DOM HELPER: builds elements with textContent, never parses strings as HTML ===
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

// Like el.replaceChildren(), but skips null/false (replaceChildren would print them as text).
function setChildren(el, ...children) {
    el.replaceChildren(...children.flat().filter(c => c != null && c !== false));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const formatElapsed = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    daysData = normalizePlan(loadJSON('nourish_plan', null), false);
    checkedGrocery = new Set(loadJSON('nourish_grocery_checked', []));
    chatHistory = loadJSON('nourish_chat', []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    initTabs();
    initSheets();
    initChat();
    renderAll();
    if (location.protocol === 'file:') {
        showBanner('Opened as a file. Start the server and open http://localhost:8000 instead.');
    }
    checkBackend().then(ok => { if (ok) { loadServerInfo(); resumePendingJobs(); } });
    window.addEventListener('online', checkBackend);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && backendOnline === false) checkBackend(); });
});

function renderAll() {
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
    renderChat();
    renderSettings();
}

// === TAB NAVIGATION ===
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    switchTab('today');
}

function switchTab(tabName) {
    if (tabName === 'settings' && document.getElementById('screenSettings')?.classList.contains('active') && settingsPage) {
        settingsPage = null;
        renderSettings();
    }
    const screenMap = { today: 'screenToday', plan: 'screenPlan', chat: 'screenChat', grocery: 'screenGrocery', settings: 'screenSettings' };
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
        t.setAttribute('aria-selected', t.dataset.tab === tabName);
    });
    document.getElementById(screenMap[tabName])?.classList.add('active');
    document.body.dataset.tab = tabName;
    if (tabName === 'chat') scrollChatToEnd();
    else window.scrollTo(0, 0);
}

// === FEEDBACK ===
let toastTimer;
function showToast(message, isError = true) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 1800);
}

function showBanner(message) {
    const banner = document.getElementById('offlineBanner');
    banner.textContent = message || '';
    banner.hidden = !message;
}

// Status bar for meal-plan generation. Errors stay until dismissed so they can't be missed.
let jobBarTimer;
function showJobBar(state, message) {
    const bar = document.getElementById('jobBar');
    clearInterval(jobBarTimer);
    bar.hidden = !state;
    bar.className = 'job-bar' + (state === 'error' ? ' error' : '');
    if (!state) return;
    const text = h('span', { class: 'job-bar-text', text: message });
    if (state === 'busy') {
        const started = planJob?.started || Date.now();
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(API_BASE + path, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('The server took too long to answer. Try again.');
        backendOnline = false;
        updateBackendStatus();
        throw new Error("Can't reach the Nourish server. Is it running on your PC?");
    } finally {
        clearTimeout(timer);
    }
    if (backendOnline === false) { backendOnline = true; updateBackendStatus(); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
        const err = new Error(typeof data?.detail === 'string' ? data.detail : `Server error ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

async function checkBackend() {
    try {
        const data = await api('/health', { timeoutMs: 5000 });
        backendOnline = data?.status === 'ok';
    } catch (e) {
        backendOnline = false;
    }
    updateBackendStatus();
    return backendOnline;
}

function updateBackendStatus() {
    if (location.protocol === 'file:') return;
    showBanner(backendOnline === false ? "Can't reach the Nourish server. Your saved plan still works; the AI needs the server." : '');
    const status = document.getElementById('serverStatus');
    if (status) status.textContent = backendOnline ? 'Connected' : backendOnline === false ? 'Not reachable' : 'Checking…';
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
    if (settings.auto_update_check !== 'on') return;
    const last = Number(load('nourish_last_update_check', '0'));
    if (Date.now() - last < 12 * 60 * 60 * 1000) {
        updateInfo = loadJSON('nourish_last_update_info', null);
        // Ignore a cached result for the version that is now installed.
        if (updateInfo && serverInfo?.version && updateInfo.latest === serverInfo.version) updateInfo = null;
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
        updateInfo = await api(`/api/update/check?prereleases=${settings.update_prereleases === 'on'}`, { timeoutMs: 20000 });
        store('nourish_last_update_check', String(Date.now()));
        store('nourish_last_update_info', updateInfo);
        if (!manual && updateInfo?.update_available) showToast(`Nourish v${updateInfo.latest} is available — see Settings → Updates`, false);
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
    document.querySelector('.tab[data-tab="settings"]')?.classList.toggle('has-badge', !!updateInfo?.update_available);
}

function renderUpdateResult() {
    const box = document.getElementById('updateResult');
    if (!box) return;
    if (updateChecking) { setChildren(box, h('p', { class: 'settings-note', text: 'Checking GitHub for a newer version…' })); return; }
    if (updateError) { setChildren(box, h('div', { class: 'chat-error' }, h('p', { text: updateError }))); return; }
    if (!updateInfo) { setChildren(box); return; }
    if (!updateInfo.update_available) {
        setChildren(box, h('p', { class: 'settings-note', text: `✓ You're up to date (v${updateInfo.current || serverInfo?.version || '?'}).` }));
        return;
    }
    setChildren(box,
        h('div', { class: 'settings-group-label', text: `Version ${updateInfo.latest} is available` }),
        h('div', { class: 'settings-group update-card' },
            updateInfo.notes ? h('div', { class: 'settings-row settings-row-stack update-notes' }, formatMessage(updateInfo.notes.slice(0, 1500))) : null,
            updateInfo.can_install
                ? h('button', { type: 'button', class: 'settings-row settings-button', id: 'installUpdateBtn', onclick: installUpdate }, 'Download & install')
                : null,
            updateInfo.url ? h('a', { class: 'settings-row settings-button', href: updateInfo.url, target: '_blank', rel: 'noopener' }, 'Open the download page') : null),
        h('p', { class: 'settings-note', text: updateInfo.can_install
            ? 'Nourish downloads the update, checks it against GitHub\'s fingerprint, installs it and restarts by itself. Your plan and settings are kept.'
            : 'This copy (Python or Docker) can\'t update itself: pull the latest code, or switch to Nourish.exe for one-tap updates.' }));
}

async function installUpdate(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    const from = serverInfo?.version;
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
            if (info?.version && info.version !== from) {
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
    const { job_id } = await api('/api/jobs', { method: 'POST', body });
    return job_id;
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
        if (job?.status === 'done') return job.result;
        if (job?.status === 'error') {
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
        const models = (data?.data || []).map(m => m?.id).filter(id => id && !/embed/i.test(id));
        modelLists[provider] = { models, error: '' };
    } catch (e) {
        modelLists[provider] = { models: [], error: e.message };
    }
    return modelLists[provider];
}

async function buildAIRequest(messages, { maxTokens } = {}) {
    const p = settings.active_provider;
    let model = settings[`${p}_model`];
    if (!model && (p === 'lmstudio' || p === 'ollama')) {
        const list = await fetchModels(p);
        if (list.error) throw new Error(list.error);
        model = list.models[0];
        if (!model) throw new Error(p === 'lmstudio'
            ? 'No model loaded in LM Studio. Open LM Studio, load a model and start the server.'
            : 'Ollama has no models. Run "ollama pull llama3.2" on your PC.');
    }
    if (!model) throw new Error('Pick a model in Settings first.');
    return {
        provider: p,
        model,
        api_key: p === 'claude' ? settings.claude_api_key : p === 'openai' ? settings.openai_api_key : undefined,
        messages,
        max_tokens: maxTokens ?? (Number(settings.max_tokens) || 8000),
        temperature: Number(settings.temperature),
    };
}

function extractText(provider, data) {
    return provider === 'claude'
        ? (data?.content || []).filter(b => b?.type === 'text').map(b => b.text).join('')
        : data?.choices?.[0]?.message?.content || '';
}

// === PROFILE → PROMPTS ===
function profileText() {
    const s = settings;
    const lines = [`Goal: ${goal}.`, `Daily targets: about ${s.calorie_target} kcal and ${s.protein_target} g protein.`];
    if (s.diet && s.diet !== 'No restriction') lines.push(`Diet: ${s.diet}.`);
    if (s.allergies) lines.push(`Allergies/intolerances (NEVER include these): ${s.allergies}.`);
    const likes = load('saved_likes', ''), hates = load('saved_hates', '');
    if (likes) lines.push(`Foods they like: ${likes}.`);
    if (hates) lines.push(`Foods they avoid: ${hates}.`);
    if (s.cuisines) lines.push(`Favourite cuisines: ${s.cuisines}.`);
    if (s.max_cook_time) lines.push(`Every meal must be ready in ${s.max_cook_time} minutes or less.`);
    if (Number(s.servings) > 1) lines.push(`Cooking for ${s.servings} people: ingredient quantities for ${s.servings} servings; nutrition per person.`);
    lines.push(`Cooking skill: ${s.skill}.`);
    if (s.budget !== 'Any') lines.push(`Budget: ${s.budget}.`);
    lines.push(`Use ${s.units === 'Metric' ? 'metric units (g, ml)' : 'US units (cups, oz, lb)'}.`);
    return lines.join('\n');
}

function planSummary() {
    if (!daysData.length) return 'They have no meal plan yet.';
    return 'Their current meal plan:\n' + daysData.map((d, i) =>
        `Day ${i + 1}: ` + MEAL_TYPES.filter(t => d[t]).map(t => `${MEAL_LABELS[t]}: ${d[t].name}`).join('; ')).join('\n');
}

function planSystemPrompt() {
    return 'You are a meal-planning chef. Return ONLY raw JSON, no markdown, no comments. ' +
        'Write out all 7 days in full, with varied meals (do not repeat a dish more than twice in the week). ' +
        'Keep each meal to at most 8 ingredients (with quantities) and 5 short steps. ' +
        'Format: {"days":[{"day":1,"breakfast":{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]},"lunch":{same},"dinner":{same}}]}' +
        '\n\nThe person you are planning for:\n' + profileText();
}

function chatSystemPrompt() {
    return 'You are Nourish, a friendly, practical chef and nutrition coach inside a meal-planning app. ' +
        'Help the person shape a meal plan that suits them: ask a short follow-up question when something important is unclear, ' +
        'suggest specific dishes, and keep answers concise (short paragraphs or bullet lists). Do not output JSON. ' +
        'When they are happy, tell them they can tap "Make plan" to turn this conversation into their 7-day plan. ' +
        'You are not a doctor; for medical conditions suggest they check with a professional.\n\n' +
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

// === SETTINGS ===
function loadSettings() {
    for (const key of Object.keys(SETTINGS_DEFAULTS)) settings[key] = load(key, SETTINGS_DEFAULTS[key]);
    if (!PROVIDERS[settings.active_provider]) settings.active_provider = 'lmstudio';
    goal = load('saved_goal', goal);
    source = load('saved_source', source);
    document.getElementById('inputLikes').value = load('saved_likes', '');
    document.getElementById('inputHates').value = load('saved_hates', '');
}

function setSetting(key, value, { quiet = false } = {}) {
    settings[key] = String(value);
    store(key, String(value));
    if (!quiet) showToast('Saved ✓', false);
    if (key === 'calorie_target' || key === 'protein_target') updateTodayScreen();
}

function settingsRow(label, control, { hint } = {}) {
    return h('label', { class: 'settings-row' },
        h('span', { class: 'settings-label' }, label, hint ? h('span', { class: 'settings-hint', text: hint }) : null),
        control);
}

function settingsInput(key, { type = 'text', placeholder = '', inputmode, min, max, list } = {}) {
    return h('input', {
        type, placeholder, value: settings[key], inputmode, min, max, list,
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'settings-input',
        onchange: e => {
            let v = e.target.value.trim();
            if (type === 'number' && v !== '') {
                v = String(Math.min(Math.max(Number(v) || Number(min) || 0, Number(min ?? -Infinity)), Number(max ?? Infinity)));
                e.target.value = v;
            }
            setSetting(key, v);
        },
    });
}

function settingsSelect(key, options, { onchange } = {}) {
    const entries = Array.isArray(options) ? options.map(o => [o, o]) : Object.entries(options);
    return h('select', {
        class: 'settings-input',
        onchange: e => { setSetting(key, e.target.value); onchange?.(e.target.value); },
    }, entries.map(([value, label]) => h('option', { value, selected: value === settings[key] }, label)));
}

function settingsButton(text, onclick, cls = '') {
    return h('button', { type: 'button', class: `settings-row settings-button ${cls}`, onclick }, text);
}

function temperatureLabel(t) {
    return `${Number(t).toFixed(1)} · ${t <= 0.3 ? 'focused' : t <= 0.8 ? 'balanced' : 'adventurous'}`;
}

const SETTINGS_PAGES = {
    ai: { icon: '🤖', title: 'AI model' },
    profile: { icon: '🙂', title: 'Your profile' },
    sources: { icon: '📖', title: 'Recipe sources' },
    server: { icon: '🖥️', title: 'Server & phone' },
    updates: { icon: '⬆️', title: 'Updates' },
    data: { icon: '🗂️', title: 'Data & privacy' },
};
let settingsPage = null;

function settingsSummary(page) {
    const s = settings;
    switch (page) {
        case 'ai': return `${PROVIDERS[s.active_provider].replace(' (local)', '')} · ${s[`${s.active_provider}_model`] || 'auto'}`;
        case 'profile': return `${s.calorie_target} kcal · ${s.diet === 'No restriction' ? 'any diet' : s.diet}`;
        case 'sources': return s.web_engine === 'brave' ? 'Web: Brave' : 'Web: DuckDuckGo';
        case 'server': return backendOnline ? 'Connected' : backendOnline === false ? 'Not reachable' : '';
        case 'updates': return updateInfo?.update_available ? `v${updateInfo.latest} available` : serverInfo ? `v${serverInfo.version}` : '';
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
        note ? h('p', { class: 'settings-note', ...(typeof note === 'string' ? { text: note } : {}) }, typeof note === 'string' ? null : note) : null,
    ];
}

function renderSettings() {
    const list = document.getElementById('settingsList');
    const page = SETTINGS_PAGES[settingsPage] ? settingsPage : null;
    document.getElementById('settingsTitle').textContent = page ? SETTINGS_PAGES[page].title : 'Settings';
    document.getElementById('settingsBack').hidden = !page;

    if (!page) {
        setChildren(list,
            h('div', { class: 'settings-group' }, Object.entries(SETTINGS_PAGES).map(([key, { icon, title }]) =>
                h('button', { type: 'button', class: 'settings-row settings-nav', onclick: () => openSettingsPage(key) },
                    h('span', { class: 'settings-nav-icon', 'aria-hidden': 'true', text: icon }),
                    h('span', { class: 'settings-label', text: title }),
                    h('span', { class: 'settings-value settings-nav-summary' + (key === 'updates' && updateInfo?.update_available ? ' badge' : ''), text: settingsSummary(key) }),
                    h('span', { class: 'settings-chevron', 'aria-hidden': 'true', text: '›' })))),
            h('p', { class: 'settings-note', text: `Nourish ${serverInfo?.version ? 'v' + serverInfo.version : ''} · free & open source (AGPL-3.0) · changes save automatically` }),
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
    ai() {
        const p = settings.active_provider;
        const cloud = p === 'claude' || p === 'openai';
        const tempValue = h('span', { class: 'settings-value', text: temperatureLabel(settings.temperature) });
        const tempSlider = h('input', {
            type: 'range', min: '0', max: '1.2', step: '0.1', value: settings.temperature, class: 'settings-range',
            'aria-label': 'Creativity',
            oninput: e => { tempValue.textContent = temperatureLabel(e.target.value); },
            onchange: e => setSetting('temperature', e.target.value),
        });
        return [
            ...settingsGroup('Provider', [
                settingsRow('Provider', settingsSelect('active_provider', PROVIDERS, { onchange: () => renderSettings() })),
                h('div', { id: 'modelControl' }),
                cloud ? settingsRow('API key', settingsInput(`${p}_api_key`, { type: 'password', placeholder: p === 'claude' ? 'sk-ant-…' : 'sk-…' })) : null,
            ], h('span', { id: 'modelHint' })),
            ...settingsGroup('Answers', [
                h('div', { class: 'settings-row settings-row-stack' },
                    h('div', { class: 'settings-row-top' }, h('span', { class: 'settings-label', text: 'Creativity' }), tempValue),
                    tempSlider),
                settingsRow('Response length', settingsSelect('max_tokens', { 4000: 'Short (faster)', 8000: 'Standard', 12000: 'Long' })),
            ], 'Lower creativity gives more predictable plans. Use "Long" if plans come back with fewer than 7 days.'),
            ...settingsGroup('Check', [
                settingsButton('Test the AI', testAI),
                h('div', { id: 'testResult', class: 'settings-row settings-result', hidden: true }),
            ]),
        ];
    },
    profile() {
        return [
            ...settingsGroup('Daily targets', [
                settingsRow('Calories', settingsInput('calorie_target', { type: 'number', inputmode: 'numeric', min: '1000', max: '6000' })),
                settingsRow('Protein (g)', settingsInput('protein_target', { type: 'number', inputmode: 'numeric', min: '20', max: '400' })),
            ]),
            ...settingsGroup('Food', [
                settingsRow('Diet', settingsSelect('diet', DIETS)),
                settingsRow('Allergies', settingsInput('allergies', { placeholder: 'e.g. peanuts, shellfish' })),
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
        return [
            ...settingsGroup('🌐 Web search', [
                settingsRow('Search with', settingsSelect('web_engine', { duckduckgo: 'DuckDuckGo', brave: 'Brave Search' }, { onchange: () => renderSettings() })),
                brave ? settingsRow('Brave key', settingsInput('brave_api_key', { type: 'password', placeholder: 'from brave.com/search/api' })) : null,
            ], 'Finds real recipes on recipe websites and reads them in full: ingredients, steps, time and (when the site lists it) nutrition. DuckDuckGo needs no key but sometimes limits searches; Brave\'s free plan is more reliable. "+ From link" on the Plan tab adds any single recipe page.'),
            ...settingsGroup('Spoonacular', [
                settingsRow('API key', settingsInput('spoonacular_api_key', { type: 'password', placeholder: 'free key' })),
            ], 'Recipes with nutrition, filtered by your diet, allergies and cook time. Free key: spoonacular.com/food-api.'),
            ...settingsGroup('TheMealDB', [
                h('div', { class: 'settings-row' }, h('span', { class: 'settings-label', text: 'Ready to use' }), h('span', { class: 'settings-value', text: 'no key needed' })),
            ], 'A free collection of recipes from around the world. It has no nutrition data.'),
        ];
    },
    server() {
        return [
            ...settingsGroup('Connection', [
                h('div', { class: 'settings-row' },
                    h('span', { class: 'settings-label', text: 'Status' }),
                    h('span', { id: 'serverStatus', class: 'settings-value' })),
                h('div', { id: 'serverInfo' }),
                settingsButton('Check again', () => checkBackend().then(ok => { if (ok) { loadServerInfo(); renderModelControl(true); } })),
            ], 'Your phone and PC must be on the same Wi-Fi, and Nourish must be running on the PC.'),
        ];
    },
    updates() {
        return [
            ...settingsGroup('This version', [
                h('div', { class: 'settings-row' }, h('span', { class: 'settings-label', text: 'Installed' }),
                    h('span', { class: 'settings-value', text: serverInfo?.version ? `v${serverInfo.version}` : '…' })),
                settingsRow('Check for updates', settingsSelect('auto_update_check', { on: 'When the app opens', off: 'Only when I tap' })),
                settingsRow('Include', settingsSelect('update_prereleases', { on: 'Test versions too', off: 'Stable only' })),
                settingsButton('Check now', () => checkForUpdates({ manual: true })),
            ]),
            h('div', { id: 'updateResult' }),
        ];
    },
    data() {
        return [
            ...settingsGroup('Your data', [
                settingsButton('Export meal plan', exportPlan),
                settingsButton('Clear chat history', clearChat),
                settingsButton('Clear meal plan', clearPlan, 'danger'),
                settingsButton('Reset all settings', resetSettings, 'danger'),
            ], 'Your plan, chat, settings and API keys are stored only on this device, and sent only to your own Nourish server. Nothing goes anywhere else except the AI and recipe services you choose.'),
        ];
    },
};

function renderModelControl(refresh = false) {
    const box = document.getElementById('modelControl');
    if (!box) return;
    const p = settings.active_provider;
    if (p === 'claude' || p === 'openai') {
        setChildren(box, 
            settingsRow('Model', settingsInput(`${p}_model`, { list: `${p}-models`, placeholder: SETTINGS_DEFAULTS[`${p}_model`] })),
            h('datalist', { id: `${p}-models` }, MODEL_SUGGESTIONS[p].map(m => h('option', { value: m }))));
        return;
    }
    const cached = modelLists[p];
    if (!cached || refresh) {
        setChildren(box, settingsRow('Model', h('span', { class: 'settings-value', text: 'Loading models…' })));
        fetchModels(p).then(() => { if (settings.active_provider === p) renderModelControl(); });
        return;
    }
    const key = `${p}_model`;
    const options = [['', p === 'lmstudio' ? 'Automatic (first loaded)' : 'Automatic (first installed)'], ...cached.models.map(m => [m, m])];
    if (settings[key] && !cached.models.includes(settings[key])) options.push([settings[key], `${settings[key]} (not found)`]);
    setChildren(box, 
        settingsRow('Model', settingsSelect(key, Object.fromEntries(options))),
        cached.error ? h('div', { class: 'settings-row settings-result error', text: cached.error }) : null,
        settingsButton('Refresh model list', () => renderModelControl(true)));
}

function renderModelHint() {
    const el = document.getElementById('modelHint');
    if (!el) return;
    const p = settings.active_provider;
    if (p === 'lmstudio' || p === 'ollama') {
        const url = serverInfo?.[`${p}_url`];
        el.textContent = `The Nourish server reaches ${PROVIDERS[p].replace(' (local)', '')} at ${url || '…'}. ` +
            `To change it, set ${p === 'lmstudio' ? 'LMSTUDIO_URL' : 'OLLAMA_URL'} in backend/.env and restart the server.`;
    } else {
        el.textContent = 'Cloud models cost money per use on your own account. Creativity is capped at 1.0 for Claude.';
    }
}

function renderServerInfo() {
    const box = document.getElementById('serverInfo');
    if (!box) return;
    if (!serverInfo) { setChildren(box, ); return; }
    const phone = serverInfo.in_docker
        ? "Use your PC's IP address with :8000 (running in Docker, so it can't be detected)"
        : serverInfo.lan_urls?.length ? serverInfo.lan_urls.join('\n') : 'No home-network address found';
    setChildren(box, 
        h('div', { class: 'settings-row settings-row-stack' },
            h('span', { class: 'settings-label', text: 'Open on your phone' }),
            h('span', { class: 'settings-value settings-mono', text: phone })),
        h('div', { class: 'settings-row' },
            h('span', { class: 'settings-label', text: 'Version' }),
            h('span', { class: 'settings-value', text: serverInfo.version || '' })));
}

async function testAI(e) {
    const btn = e.currentTarget;
    const out = document.getElementById('testResult');
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
    if (!confirm('Reset every setting (including API keys) to its default? Your meal plan and chat are kept.')) return;
    for (const key of Object.keys(SETTINGS_DEFAULTS)) unstore(key);
    Object.assign(settings, SETTINGS_DEFAULTS);
    renderAll();
    showToast('Settings reset', false);
}

function clearPlan() {
    if (!daysData.length) return;
    if (!confirm('Delete the current meal plan and grocery ticks?')) return;
    daysData = [];
    checkedGrocery.clear();
    store('nourish_plan', []);
    store('nourish_grocery_checked', []);
    renderAll();
    showToast('Meal plan cleared', false);
}

// === SHEETS ===
function initSheets() {
    document.getElementById('generateSheetBackdrop').addEventListener('click', closeGenerateSheet);
    document.getElementById('recipeSheetBackdrop').addEventListener('click', closeRecipeSheet);
    document.querySelectorAll('[data-action="new-plan"]').forEach(b => b.addEventListener('click', showGenerateSheet));
    document.getElementById('closeGenerateBtn').addEventListener('click', closeGenerateSheet);
    document.getElementById('generateBtn').addEventListener('click', generateMealPlan);
    document.getElementById('editProfileBtn').addEventListener('click', () => { closeGenerateSheet(); switchTab('settings'); openSettingsPage('profile'); });
    document.getElementById('settingsBack').addEventListener('click', () => openSettingsPage(null));
    document.getElementById('importLinkBtn').addEventListener('click', showImportSheet);
    document.getElementById('importSheetBackdrop').addEventListener('click', closeImportSheet);
    document.getElementById('closeImportBtn').addEventListener('click', closeImportSheet);
    document.getElementById('importBtn').addEventListener('click', importFromLink);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeRecipeSheet(); closeGenerateSheet(); closeImportSheet(); }
    });

    document.querySelectorAll('.segment-btn').forEach(btn => {
        btn.addEventListener('click', () => { goal = btn.dataset.goal; store('saved_goal', goal); syncChoiceButtons(); });
    });
    document.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => { source = btn.dataset.source; store('saved_source', source); syncChoiceButtons(); });
    });
}

function syncChoiceButtons() {
    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.goal === goal);
        b.setAttribute('aria-pressed', b.dataset.goal === goal);
    });
    document.querySelectorAll('.source-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.source === source);
        b.setAttribute('aria-pressed', b.dataset.source === source);
    });
}

function showGenerateSheet() {
    syncChoiceButtons();
    const btn = document.getElementById('generateBtn');
    btn.disabled = !!planJob;
    btn.textContent = planJob ? 'A plan is already cooking…' : 'Generate Plan';
    document.getElementById('generateSheet').classList.add('active');
}

function closeGenerateSheet() {
    document.getElementById('generateSheet').classList.remove('active');
}

function openRecipeSheet(mealType, meal) {
    const content = document.getElementById('recipeSheetContent');
    const n = meal.nutrition;
    const chips = [`⏱ ${formatMinutes(meal.time_minutes)}`, `${formatCalories(n?.calories)} cal`];
    if (n?.protein_g != null) chips.push(`P: ${Math.round(n.protein_g)}g`);
    if (n?.carbs_g != null) chips.push(`C: ${Math.round(n.carbs_g)}g`);
    if (n?.fat_g != null) chips.push(`F: ${Math.round(n.fat_g)}g`);

    setChildren(content, 
        h('div', { class: 'recipe-sheet-top' },
            h('div', { class: 'recipe-sheet-handle' }),
            h('button', { type: 'button', class: 'btn-close', 'aria-label': 'Close', onclick: closeRecipeSheet }, '✕')),
        h('div', { class: 'recipe-hero' }, h('div', { class: 'recipe-emoji', text: MEAL_EMOJI[mealType] || '🍽️' })),
        h('div', { class: 'recipe-header' },
            h('div', { class: 'meal-type', text: MEAL_LABELS[mealType] || '' }),
            h('h2', { class: 'recipe-name', text: meal.name }),
            h('div', { class: 'recipe-meta' }, chips.map(c => h('div', { class: 'recipe-chip', text: c })))),
        meal.ingredients.length ? h('div', { class: 'recipe-section' },
            h('div', { class: 'recipe-section-title', text: 'Ingredients' }),
            h('div', { class: 'recipe-ingredients' }, meal.ingredients.map(i => h('div', { class: 'recipe-ingredient', text: i })))) : null,
        meal.steps.length ? h('div', { class: 'recipe-section' },
            h('div', { class: 'recipe-section-title', text: 'Instructions' }),
            h('div', { class: 'recipe-steps' }, meal.steps.map((s, idx) => h('div', { class: 'recipe-step' },
                h('div', { class: 'recipe-step-number', text: idx + 1 }),
                h('div', { class: 'recipe-step-text', text: s }))))) : null,
        h('div', { class: 'recipe-section' },
            meal.source_url ? h('a', { class: 'btn btn-secondary recipe-source', href: meal.source_url, target: '_blank', rel: 'noopener noreferrer' },
                `🔗 Original recipe on ${meal.source_name || 'the web'}`) : null,
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => askAboutMeal(meal) }, '💬 Ask the chef about this meal')),
    );
    content.scrollTop = 0;
    document.getElementById('recipeSheet').classList.add('active');
}

function closeRecipeSheet() {
    document.getElementById('recipeSheet').classList.remove('active');
}

function askAboutMeal(meal) {
    closeRecipeSheet();
    switchTab('chat');
    const input = document.getElementById('chatInput');
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
    return MEAL_TYPES.reduce((sum, t) => sum + (day[t]?.nutrition?.[key] || 0), 0);
}
function hasNutrition(day) {
    return MEAL_TYPES.some(t => Number.isFinite(day[t]?.nutrition?.calories));
}

// === TODAY SCREEN ===
function updateTodayScreen() {
    const hasPlan = daysData.length > 0;
    document.getElementById('emptyState').hidden = hasPlan;
    document.getElementById('dayStrip').hidden = !hasPlan;
    document.getElementById('calorieSection').hidden = !hasPlan;
    document.getElementById('mealCards').hidden = !hasPlan;
    document.getElementById('newPlanHeaderBtn').hidden = !hasPlan;
    if (!hasPlan) {
        document.getElementById('todayTitle').textContent = 'Today';
        return;
    }
    if (selectedDay >= daysData.length) selectedDay = 0;

    const strip = document.getElementById('dayStrip');
    setChildren(strip, ...daysData.map((d, idx) => h('button', {
        type: 'button',
        class: 'day-pill' + (idx === selectedDay ? ' active' : ''),
        'aria-pressed': idx === selectedDay,
        onclick: () => { selectedDay = idx; updateTodayScreen(); },
    }, DAY_NAMES[idx % 7].slice(0, 3))));

    const day = daysData[selectedDay];
    document.getElementById('todayTitle').textContent = `Day ${selectedDay + 1} · ${DAY_NAMES[selectedDay % 7]}`;

    const calTarget = Number(settings.calorie_target) || 2400;
    const known = hasNutrition(day);
    const totalCal = sumNutrient(day, 'calories');
    document.getElementById('calorieValue').textContent = known ? formatCalories(totalCal) : '—';
    document.getElementById('calorieLabel').textContent = known ? `of ${calTarget.toLocaleString()} calories` : 'no nutrition data for these recipes';
    updateCalorieRing(known ? totalCal : 0, calTarget);

    // Protein from Settings; carbs ~50% and fat ~30% of the calorie target.
    const macros = [['protein_g', 'proteinValue', Number(settings.protein_target) || 150],
        ['carbs_g', 'carbsValue', calTarget * 0.5 / 4], ['fat_g', 'fatValue', calTarget * 0.3 / 9]];
    const fills = document.querySelectorAll('.macro-fill');
    macros.forEach(([key, id, max], i) => {
        const total = sumNutrient(day, key);
        document.getElementById(id).textContent = known ? `${Math.round(total)}g` : '—';
        fills[i].style.width = Math.min(total / max * 100, 100) + '%';
    });

    setChildren(document.getElementById('mealCards'), ...MEAL_TYPES.filter(t => day[t]).map(t => mealCard(t, day[t])));
}

function mealCard(type, meal) {
    return h('button', { type: 'button', class: 'meal-card', onclick: () => openRecipeSheet(type, meal) },
        h('div', { class: `meal-image meal-image-${type}` }, h('span', { class: 'meal-emoji', text: MEAL_EMOJI[type] })),
        h('div', { class: 'meal-content' },
            h('div', { class: 'meal-type', text: MEAL_LABELS[type] }),
            h('div', { class: 'meal-name', text: meal.name }),
            h('div', { class: 'meal-badges' },
                h('span', { class: 'meal-badge', text: `⏱ ${formatMinutes(meal.time_minutes)}` }),
                h('span', { class: 'meal-badge', text: `${formatCalories(meal.nutrition?.calories)} cal` }))));
}

function updateCalorieRing(consumed, target) {
    const circumference = 2 * Math.PI * 70;
    const fraction = target > 0 ? Math.min(consumed / target, 1) : 0;
    document.getElementById('calorieProgress').style.strokeDasharray = `${circumference * fraction} ${circumference}`;
}

// === PLAN SCREEN ===
function updatePlanScreen() {
    const container = document.getElementById('planAccordions');
    if (!daysData.length) {
        setChildren(container, h('div', { class: 'empty-note' },
            h('p', { text: 'No meal plan yet' }),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: showGenerateSheet }, 'Generate Meal Plan')));
        return;
    }
    setChildren(container, ...daysData.map((day, idx) => {
        const content = h('div', { class: 'accordion-content', hidden: true },
            MEAL_TYPES.filter(t => day[t]).map(t => h('button', {
                type: 'button', class: 'plan-meal', 'data-meal-type': t, onclick: () => openRecipeSheet(t, day[t]),
            },
                h('span', { class: 'plan-meal-emoji', text: MEAL_EMOJI[t] }),
                h('span', { class: 'plan-meal-body' },
                    h('span', { class: 'plan-meal-type', text: MEAL_LABELS[t] }),
                    h('span', { class: 'plan-meal-name', text: day[t].name }),
                    h('span', { class: 'plan-meal-meta', text: `⏱ ${formatMinutes(day[t].time_minutes)} • ${formatCalories(day[t].nutrition?.calories)} cal` })))));
        const header = h('button', {
            type: 'button', class: 'accordion-header', 'aria-expanded': 'false',
            onclick: () => {
                const open = header.getAttribute('aria-expanded') === 'true';
                header.setAttribute('aria-expanded', String(!open));
                content.hidden = open;
            },
        },
            h('span', { text: `Day ${idx + 1} · ${DAY_NAMES[idx % 7].slice(0, 3)}` }),
            h('span', { class: 'accordion-cal', text: hasNutrition(day) ? `${formatCalories(sumNutrient(day, 'calories'))} cal` : '' }),
            h('span', { class: 'accordion-arrow', text: '▾' }));
        return h('div', { class: 'accordion' }, header, content);
    }));
}

// === GROCERY SCREEN ===
function groceryItems() {
    const items = {};
    const seen = new Set();
    daysData.forEach(day => MEAL_TYPES.forEach(t => (day[t]?.ingredients || []).forEach(ing => {
        const key = ing.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        (items[categorizeIngredient(ing)] ||= []).push(ing);
    })));
    return items;
}

function updateGroceryScreen() {
    const container = document.getElementById('groceryContainer');
    if (!daysData.length) {
        setChildren(container, h('div', { class: 'empty-note', text: 'No grocery list yet. Generate a meal plan first.' }));
        return;
    }
    const items = groceryItems();
    const categories = Object.keys(items).sort();
    if (!categories.length) {
        setChildren(container, h('div', { class: 'empty-note', text: 'This plan has no ingredient lists.' }));
        return;
    }
    setChildren(container, 
        h('div', {},
            h('div', { class: 'progress-label', id: 'progressLabel' }),
            h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill', id: 'progressFill' }))),
        ...categories.map(cat => h('div', { class: 'grocery-category' },
            h('div', { class: 'category-header', text: cat }),
            items[cat].map(item => h('label', { class: 'grocery-item' + (checkedGrocery.has(item) ? ' checked' : '') },
                h('input', { type: 'checkbox', checked: checkedGrocery.has(item), onchange: e => toggleGrocery(item, e.target) }),
                h('span', { class: 'grocery-item-text', text: item }))))));
    updateProgress();
}

function toggleGrocery(item, checkbox) {
    if (checkbox.checked) checkedGrocery.add(item); else checkedGrocery.delete(item);
    checkbox.closest('.grocery-item')?.classList.toggle('checked', checkbox.checked);
    store('nourish_grocery_checked', [...checkedGrocery]);
    updateProgress();
}

function categorizeIngredient(ing) {
    const lower = ing.toLowerCase();
    if (['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'turkey', 'egg', 'tofu'].some(p => lower.includes(p))) return 'Proteins';
    if (['milk', 'cheese', 'yogurt', 'butter', 'cream'].some(p => lower.includes(p))) return 'Dairy';
    if (['rice', 'pasta', 'bread', 'oat', 'flour', 'quinoa'].some(p => lower.includes(p))) return 'Grains';
    if (['tomato', 'onion', 'garlic', 'lettuce', 'spinach', 'broccoli', 'carrot', 'apple', 'banana', 'lemon', 'lime', 'bell pepper', 'mushroom', 'potato', 'zucchini', 'cucumber', 'celery', 'kale', 'cabbage', 'avocado'].some(p => lower.includes(p))) return 'Produce';
    if (['oil', 'salt', 'pepper', 'spice', 'sauce', 'vinegar', 'soy'].some(p => lower.includes(p))) return 'Pantry';
    return 'Other';
}

function updateProgress() {
    const boxes = document.querySelectorAll('#groceryContainer .grocery-item input[type="checkbox"]');
    const total = boxes.length;
    const checked = [...boxes].filter(cb => cb.checked).length;
    const label = document.getElementById('progressLabel');
    const fill = document.getElementById('progressFill');
    if (label) label.textContent = `${checked} of ${total} items`;
    if (fill) fill.style.width = (total ? checked / total * 100 : 0) + '%';
}

// === PLAN DATA ===
function toNumber(v) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
}
function toStringList(v) {
    return Array.isArray(v) ? v.map(x => typeof x === 'string' ? x.trim() : (x?.name || x?.text || '')).filter(Boolean).map(String) : [];
}

function normalizeMeal(m) {
    if (!m || typeof m !== 'object' || !m.name) return null;
    const n = m.nutrition && typeof m.nutrition === 'object' ? m.nutrition : null;
    return {
        name: String(m.name).trim(),
        time_minutes: toNumber(m.time_minutes),
        nutrition: n ? { calories: toNumber(n.calories), protein_g: toNumber(n.protein_g), carbs_g: toNumber(n.carbs_g), fat_g: toNumber(n.fat_g) } : null,
        ingredients: toStringList(m.ingredients),
        steps: toStringList(m.steps),
        ...safeSource(m),
    };
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
    const days = (Array.isArray(data?.days) ? data.days : Array.isArray(data) ? data : [])
        .filter(d => d && typeof d === 'object')
        .map(d => Object.fromEntries(MEAL_TYPES.map(t => [t, normalizeMeal(d[t])])))
        .filter(d => MEAL_TYPES.some(t => d[t]))
        .slice(0, 7);
    if (strict && !days.length) throw new Error("The response didn't contain any meals. Try again, or try another model.");
    return days;
}

function applyPlan(raw) {
    daysData = normalizePlan(raw);
    selectedDay = 0;
    checkedGrocery.clear();
    store('nourish_plan', daysData);
    store('nourish_grocery_checked', []);
    renderAll();
    switchTab('today');
    showToast(daysData.length < 7 ? `Got ${daysData.length} of 7 days (the response was cut short).` : 'Your meal plan is ready 🎉', daysData.length < 7);
}

// === GENERATE MEAL PLAN ===
async function generateMealPlan() {
    const likes = document.getElementById('inputLikes').value.trim();
    const hates = document.getElementById('inputHates').value.trim();
    if (!goal) { showToast('Pick a goal first'); return; }
    if (!likes && !hates) { showToast('Enter at least one food you like or avoid'); return; }
    if (planJob) { showToast('A plan is already cooking'); return; }
    store('saved_likes', likes);
    store('saved_hates', hates);
    closeGenerateSheet();

    if (source !== 'aiChef') {
        const names = { themealdb: 'TheMealDB', spoonacular: 'Spoonacular', web: 'the web (this can take a minute)' };
        showJobBar('busy', `Searching ${names[source] || source}…`);
        try {
            const generators = { themealdb: generateWithTheMealDB, spoonacular: generateWithSpoonacular, web: generateWithWeb };
            applyPlan(await (generators[source] || generateWithTheMealDB)(likes, hates));
            showJobBar(null);
        } catch (err) {
            showJobBar('error', err?.message || 'Something went wrong');
        }
        return;
    }
    await runPlanJob([
        { role: 'system', content: planSystemPrompt() },
        { role: 'user', content: `Goal: ${goal}. Likes: ${likes || 'anything'}. Avoids: ${hates || 'nothing'}. Generate the 7-day meal plan JSON.` },
    ]);
}

async function generatePlanFromChat() {
    if (planJob) { showToast('A plan is already cooking'); return; }
    if (!chatHistory.some(m => m.role === 'user')) { showToast('Chat with the chef first, then make a plan'); return; }
    await runPlanJob([
        { role: 'system', content: planSystemPrompt() },
        ...cleanHistory([...chatHistory.slice(-CHAT_HISTORY_LIMIT),
            { role: 'user', content: 'Using everything we discussed above, create my 7-day meal plan now. Return only the JSON.' }]),
    ]);
}

// Starts (or, after a reload, resumes) an AI plan job and applies the result.
async function runPlanJob(messages, resume = null) {
    try {
        if (resume) {
            planJob = resume;
        } else {
            showJobBar('busy', 'Preparing…');
            const req = await buildAIRequest(messages);
            planJob = { id: await startJob(req), started: Date.now(), provider: req.provider };
            store('nourish_pending_plan', planJob);
        }
        renderChat();
        showJobBar('busy', 'Cooking your meal plan…');
        const data = await waitForJob(planJob.id);
        applyPlan(parseLLMJSON(extractText(planJob.provider, data)));
        showJobBar(null);
    } catch (err) {
        if (err?.cancelled) { showJobBar(null); showToast('Meal plan cancelled', false); }
        else showJobBar('error', `Couldn't make the plan: ${err?.message || 'unknown error'}`);
    } finally {
        planJob = null;
        unstore('nourish_pending_plan');
        renderChat();
        const btn = document.getElementById('generateBtn');
        btn.disabled = false;
        btn.textContent = 'Generate Plan';
    }
}

async function cancelPlan() {
    if (!planJob) return;
    try { await api(`/api/jobs/${planJob.id}`, { method: 'DELETE' }); } catch (e) { /* the poll will report it */ }
}

function resumePendingJobs() {
    const plan = loadJSON('nourish_pending_plan', null);
    if (plan?.id && !planJob) runPlanJob(null, plan);
    const chat = loadJSON('nourish_pending_chat', null);
    if (chat?.id && !chatBusy) requestChatReply(chat);
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
    return spreadOverWeek(data?.meals || [], r => {
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
            const ing = r?.[`strIngredient${i}`];
            if (ing && ing.trim()) ingredients.push(`${r[`strMeasure${i}`] || ''} ${ing}`.trim());
        }
        const steps = (r?.strInstructions || '').split(/\r?\n|(?<=\.)\s+/).map(s => s.trim()).filter(s => s.length > 3).slice(0, 12);
        // TheMealDB has no nutrition or cooking-time data; leave them unknown rather than invent numbers.
        return { name: r?.strMeal, time_minutes: null, nutrition: null, ingredients, steps };
    });
}

async function generateWithSpoonacular(likes, hates) {
    if (!settings.spoonacular_api_key) throw new Error('Spoonacular needs a free API key. Add it in Settings.');
    const data = await api('/api/recipes/spoonacular', {
        method: 'POST', timeoutMs: 45000,
        body: {
            api_key: settings.spoonacular_api_key, query: likes || 'chicken', exclude: hates, number: 21,
            diet: SPOONACULAR_DIETS[settings.diet], intolerances: settings.allergies || undefined,
            max_ready_time: Number(settings.max_cook_time) || undefined,
        },
    });
    return spreadOverWeek(data?.results || [], r => {
        const nutrient = name => (r?.nutrition?.nutrients || []).find(n => n?.name === name)?.amount;
        return {
            name: r?.title,
            time_minutes: r?.readyInMinutes,
            nutrition: r?.nutrition ? { calories: nutrient('Calories'), protein_g: nutrient('Protein'), carbs_g: nutrient('Carbohydrates'), fat_g: nutrient('Fat') } : null,
            ingredients: (r?.extendedIngredients || []).map(i => i?.original),
            steps: (r?.analyzedInstructions?.[0]?.steps || []).map(s => s?.step).slice(0, 12),
        };
    });
}

async function generateWithWeb(likes, hates) {
    const base = [likes || 'healthy', settings.diet !== 'No restriction' ? settings.diet : '', settings.cuisines].filter(Boolean).join(' ');
    const body = mealType => ({
        query: `${base} ${mealType} recipe`, number: 7, exclude: joinList(hates, settings.allergies),
        brave_key: settings.web_engine === 'brave' ? settings.brave_api_key || undefined : undefined,
    });
    const results = await Promise.allSettled(MEAL_TYPES.map(t => api('/api/recipes/web', { method: 'POST', timeoutMs: 120000, body: body(t) })));
    const byType = Object.fromEntries(MEAL_TYPES.map((t, i) => [t, results[i].status === 'fulfilled' ? results[i].value?.recipes || [] : []]));
    if (!MEAL_TYPES.some(t => byType[t].length)) {
        const err = results.find(r => r.status === 'rejected');
        throw new Error(err?.reason?.message || 'No recipes found on the web for those foods. Try different "likes".');
    }
    // Fill each slot from its own search; borrow from the others if one came back empty.
    const all = MEAL_TYPES.flatMap(t => byType[t]);
    return {
        days: Array.from({ length: 7 }, (_, d) => Object.fromEntries(MEAL_TYPES.map(t => {
            const pool = byType[t].length ? byType[t] : all;
            return [t, pool[d % pool.length]];
        }))),
    };
}

function showImportSheet() {
    const days = Math.max(daysData.length, 1);
    setChildren(document.getElementById('importDay'), Array.from({ length: Math.min(days + (days < 7 ? 1 : 0), 7) }, (_, i) =>
        h('option', { value: String(i), selected: i === selectedDay }, `Day ${i + 1} · ${DAY_NAMES[i].slice(0, 3)}${i >= daysData.length ? ' (new)' : ''}`)));
    document.getElementById('importError').hidden = true;
    document.getElementById('importSheet').classList.add('active');
}

function closeImportSheet() {
    document.getElementById('importSheet').classList.remove('active');
}

async function importFromLink() {
    const url = document.getElementById('importUrl').value.trim();
    const errorBox = document.getElementById('importError');
    const btn = document.getElementById('importBtn');
    errorBox.hidden = true;
    if (!url) { errorBox.textContent = 'Paste the address of a recipe page first.'; errorBox.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = 'Reading the recipe…';
    try {
        const recipe = normalizeMeal(await api('/api/recipes/import', { method: 'POST', timeoutMs: 45000, body: { url } }));
        if (!recipe) throw new Error('No recipe was found on that page.');
        const dayIndex = Number(document.getElementById('importDay').value) || 0;
        const mealType = document.getElementById('importMeal').value;
        while (daysData.length <= dayIndex) daysData.push({ breakfast: null, lunch: null, dinner: null });
        daysData[dayIndex][mealType] = recipe;
        store('nourish_plan', daysData);
        document.getElementById('importUrl').value = '';
        closeImportSheet();
        selectedDay = dayIndex;
        renderAll();
        showToast(`Added "${recipe.name}" to Day ${dayIndex + 1}`, false);
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add recipe';
    }
}

// === CHAT ===
function initChat() {
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    form.addEventListener('submit', e => { e.preventDefault(); sendChat(input.value); });
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', e => {
        // Enter sends on a computer keyboard; Shift+Enter makes a new line. The send button works everywhere.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(input.value); }
    });
    document.getElementById('chatPlanBtn').addEventListener('click', generatePlanFromChat);
}

function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function saveChat() {
    chatHistory = chatHistory.slice(-100);
    store('nourish_chat', chatHistory);
}

function clearChat() {
    if (!chatHistory.length) return;
    if (!confirm('Delete the whole chat history?')) return;
    chatHistory = [];
    chatError = '';
    saveChat();
    renderChat();
    showToast('Chat cleared', false);
}

async function sendChat(text) {
    text = (text || '').trim();
    if (!text || chatBusy) return;
    const input = document.getElementById('chatInput');
    input.value = '';
    autoGrow(input);
    chatHistory.push({ role: 'user', content: text });
    saveChat();
    await requestChatReply();
}

async function requestChatReply(resume = null) {
    chatBusy = true;
    chatError = '';
    renderChat();
    try {
        let pending = resume;
        if (!pending) {
            const req = await buildAIRequest(
                [{ role: 'system', content: chatSystemPrompt() }, ...cleanHistory(chatHistory.slice(-CHAT_HISTORY_LIMIT))],
                { maxTokens: Math.min(Number(settings.max_tokens) || 8000, 2000) });
            pending = { id: await startJob(req), provider: req.provider };
            store('nourish_pending_chat', pending);
        }
        const data = await waitForJob(pending.id);
        chatHistory.push({ role: 'assistant', content: extractText(pending.provider, data).trim() || '(The AI sent an empty reply.)' });
        saveChat();
    } catch (err) {
        chatError = err?.message || 'Something went wrong';
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

function renderChat() {
    const box = document.getElementById('chatMessages');
    const planBtn = document.getElementById('chatPlanBtn');
    if (!box) return;
    planBtn.disabled = !!planJob || !chatHistory.some(m => m.role === 'user');
    planBtn.textContent = planJob ? 'Cooking…' : 'Make plan';
    document.getElementById('chatSend').disabled = chatBusy;

    const items = [];
    if (!chatHistory.length) {
        items.push(h('div', { class: 'chat-welcome' },
            h('div', { class: 'empty-icon', text: '👩‍🍳' }),
            h('div', { class: 'title', text: 'Chat with the chef' }),
            h('p', { class: 'text-dim', text: 'Tell it what you like, what you need, and how you cook. When it sounds right, tap "Make plan" to turn the chat into your 7-day plan.' }),
            h('div', { class: 'chat-suggestions' }, CHAT_SUGGESTIONS.map(s =>
                h('button', { type: 'button', class: 'chat-suggestion', onclick: () => sendChat(s) }, s)))));
    }
    for (const m of chatHistory) {
        items.push(h('div', { class: `chat-bubble chat-${m.role}` },
            m.role === 'assistant' ? formatMessage(m.content) : h('p', { text: m.content })));
    }
    if (chatBusy) items.push(h('div', { class: 'chat-bubble chat-assistant chat-typing', 'aria-label': 'The chef is typing' },
        h('span'), h('span'), h('span')));
    if (chatError) items.push(h('div', { class: 'chat-error', role: 'alert' },
        h('p', { text: chatError }),
        chatHistory[chatHistory.length - 1]?.role === 'user'
            ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => requestChatReply() }, 'Try again') : null));
    setChildren(box, ...items);
    scrollChatToEnd();
}

function scrollChatToEnd() {
    if (document.getElementById('screenChat')?.classList.contains('active')) {
        requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    }
}
