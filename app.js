// === CONFIG ===
// The backend serves this page, so API calls are same-origin. If the page is served
// some other way (a static server on another port), talk to port 8000 on the same host.
const API_BASE = location.protocol === 'file:' ? 'http://localhost:8000'
    : location.port === '8000' ? ''
    : `${location.protocol}//${location.hostname}:8000`;

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const MEAL_EMOJI = { breakfast: '🍳', lunch: '🥗', dinner: '🍝' };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CALORIE_TARGET = 2400;
const PROVIDERS = { lmstudio: 'LM Studio (local)', ollama: 'Ollama (local)', claude: 'Claude', openai: 'OpenAI' };

// === STATE ===
let goal = 'Maintain';
let source = 'aiChef';
let activeModel = '';
let daysData = [];
let selectedDay = 0;
let checkedGrocery = new Set();
let backendOnline = null;
const settings = {
    active_provider: 'lmstudio',
    ollama_model: 'llama3.2',
    claude_api_key: '',
    claude_model: 'claude-haiku-4-5',
    openai_api_key: '',
    openai_model: 'gpt-4o',
    spoonacular_api_key: '',
};

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

// === DOM HELPER: builds elements with textContent, never parses strings as HTML ===
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    daysData = normalizePlan(loadJSON('nourish_plan', null), false);
    checkedGrocery = new Set(loadJSON('nourish_grocery_checked', []));
    initTabs();
    initSheets();
    renderAll();
    if (location.protocol === 'file:') {
        showBanner('Opened as a file. Start the server and open http://localhost:8000 instead.');
    }
    checkBackend().then(ok => { if (ok) loadModel(); });
    window.addEventListener('online', checkBackend);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && backendOnline === false) checkBackend(); });
});

function renderAll() {
    updateTodayScreen();
    updatePlanScreen();
    updateGroceryScreen();
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
    const screenMap = { today: 'screenToday', plan: 'screenPlan', grocery: 'screenGrocery', settings: 'screenSettings' };
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
        t.setAttribute('aria-selected', t.dataset.tab === tabName);
    });
    document.getElementById(screenMap[tabName])?.classList.add('active');
    window.scrollTo(0, 0);
}

// === FEEDBACK ===
let toastTimer;
function showToast(message, isError = true) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 2500);
}

function showBanner(message) {
    const banner = document.getElementById('offlineBanner');
    banner.textContent = message || '';
    banner.hidden = !message;
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
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : `Server error ${res.status}`;
        throw new Error(detail);
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
    showBanner(backendOnline === false ? "Can't reach the Nourish server. Your saved plan still works; generating needs the server." : '');
    const status = document.getElementById('serverStatus');
    if (status) status.textContent = backendOnline ? 'Connected' : backendOnline === false ? 'Not reachable' : 'Checking…';
}

// === SETTINGS ===
function loadSettings() {
    for (const key of Object.keys(settings)) settings[key] = load(key, settings[key]);
    if (!PROVIDERS[settings.active_provider]) settings.active_provider = 'lmstudio';
    goal = load('saved_goal', goal);
    source = load('saved_source', source);
    document.getElementById('inputLikes').value = load('saved_likes', '');
    document.getElementById('inputHates').value = load('saved_hates', '');
}

function setSetting(key, value) {
    settings[key] = value;
    store(key, value);
}

// Picks the first chat model LM Studio has loaded. Throws if the server or LM Studio is unreachable.
async function fetchLMStudioModel() {
    const data = await api('/api/models', { timeoutMs: 6000 });
    const models = (data?.data || []).map(m => m?.id).filter(id => id && !/embed/i.test(id));
    return models[0] || '';
}

async function loadModel() {
    if (settings.active_provider !== 'lmstudio') return;
    let status;
    try {
        activeModel = await fetchLMStudioModel();
        status = activeModel || 'No model loaded in LM Studio';
    } catch (e) {
        activeModel = '';
        status = e.message;
    }
    const el = document.getElementById('lmstudioModel');
    if (el) el.textContent = status;
}

function settingsRow(label, control) {
    return h('label', { class: 'settings-row' }, h('span', { class: 'settings-label', text: label }), control);
}

function settingsInput(key, { type = 'text', placeholder = '' } = {}) {
    return h('input', {
        type, placeholder, value: settings[key], autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        class: 'settings-input',
        onchange: e => setSetting(key, e.target.value.trim()),
    });
}

function renderSettings() {
    const list = document.getElementById('settingsList');
    const p = settings.active_provider;

    const providerSelect = h('select', {
        class: 'settings-input',
        onchange: e => { setSetting('active_provider', e.target.value); renderSettings(); loadModel(); },
    }, Object.entries(PROVIDERS).map(([value, label]) => h('option', { value, selected: value === p }, label)));

    const providerRows = [];
    if (p === 'lmstudio') providerRows.push(settingsRow('Model', h('span', { id: 'lmstudioModel', class: 'settings-value', text: activeModel || 'Detecting…' })));
    if (p === 'ollama') providerRows.push(settingsRow('Model', settingsInput('ollama_model', { placeholder: 'llama3.2' })));
    if (p === 'claude') providerRows.push(
        settingsRow('API key', settingsInput('claude_api_key', { type: 'password', placeholder: 'sk-ant-…' })),
        settingsRow('Model', settingsInput('claude_model', { placeholder: 'claude-haiku-4-5' })));
    if (p === 'openai') providerRows.push(
        settingsRow('API key', settingsInput('openai_api_key', { type: 'password', placeholder: 'sk-…' })),
        settingsRow('Model', settingsInput('openai_model', { placeholder: 'gpt-4o' })));

    list.replaceChildren(
        h('div', { class: 'settings-group-label', text: 'Server' }),
        h('div', { class: 'settings-group' },
            h('div', { class: 'settings-row' },
                h('span', { class: 'settings-label', text: 'Status' }),
                h('span', { id: 'serverStatus', class: 'settings-value' })),
            h('button', { type: 'button', class: 'settings-row settings-button', onclick: () => checkBackend().then(ok => { if (ok) loadModel(); }) }, 'Check again')),
        h('div', { class: 'settings-group-label', text: 'AI provider' }),
        h('div', { class: 'settings-group' }, settingsRow('Provider', providerSelect), providerRows),
        h('div', { class: 'settings-group-label', text: 'Recipe sources' }),
        h('div', { class: 'settings-group' },
            settingsRow('Spoonacular key', settingsInput('spoonacular_api_key', { type: 'password', placeholder: 'free key' }))),
        h('div', { class: 'settings-group-label', text: 'Data' }),
        h('div', { class: 'settings-group' },
            h('button', { type: 'button', class: 'settings-row settings-button danger', onclick: clearPlan }, 'Clear meal plan')),
        h('p', { class: 'settings-note', text: 'Keys are stored only on this device and sent only to your Nourish server.' }),
    );
    updateBackendStatus();
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
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeRecipeSheet(); closeGenerateSheet(); }
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

    content.replaceChildren(
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
    );
    content.scrollTop = 0;
    document.getElementById('recipeSheet').classList.add('active');
}

function closeRecipeSheet() {
    document.getElementById('recipeSheet').classList.remove('active');
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
    strip.replaceChildren(...daysData.map((d, idx) => h('button', {
        type: 'button',
        class: 'day-pill' + (idx === selectedDay ? ' active' : ''),
        'aria-pressed': idx === selectedDay,
        onclick: () => { selectedDay = idx; updateTodayScreen(); },
    }, DAY_NAMES[idx % 7].slice(0, 3))));

    const day = daysData[selectedDay];
    document.getElementById('todayTitle').textContent = `Day ${selectedDay + 1} · ${DAY_NAMES[selectedDay % 7]}`;

    const known = hasNutrition(day);
    const totalCal = sumNutrient(day, 'calories');
    document.getElementById('calorieValue').textContent = known ? formatCalories(totalCal) : '—';
    document.getElementById('calorieLabel').textContent = known ? 'calories this day' : 'no nutrition data for these recipes';
    updateCalorieRing(known ? totalCal : 0, CALORIE_TARGET);

    const macros = [['protein_g', 'proteinValue', 200], ['carbs_g', 'carbsValue', 400], ['fat_g', 'fatValue', 120]];
    const fills = document.querySelectorAll('.macro-fill');
    macros.forEach(([key, id, max], i) => {
        const total = sumNutrient(day, key);
        document.getElementById(id).textContent = known ? `${Math.round(total)}g` : '—';
        fills[i].style.width = Math.min(total / max * 100, 100) + '%';
    });

    document.getElementById('mealCards').replaceChildren(...MEAL_TYPES.filter(t => day[t]).map(t => mealCard(t, day[t])));
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
        container.replaceChildren(h('div', { class: 'empty-note' },
            h('p', { text: 'No meal plan yet' }),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: showGenerateSheet }, 'Generate Meal Plan')));
        return;
    }
    container.replaceChildren(...daysData.map((day, idx) => {
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
        container.replaceChildren(h('div', { class: 'empty-note', text: 'No grocery list yet. Generate a meal plan first.' }));
        return;
    }
    const items = groceryItems();
    const categories = Object.keys(items).sort();
    if (!categories.length) {
        container.replaceChildren(h('div', { class: 'empty-note', text: 'This plan has no ingredient lists.' }));
        return;
    }
    container.replaceChildren(
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
    };
}

// Returns a clean array of days. With strict=true, throws a user-readable error if unusable.
function normalizePlan(data, strict = true) {
    const days = (Array.isArray(data?.days) ? data.days : Array.isArray(data) ? data : [])
        .filter(d => d && typeof d === 'object')
        .map(d => Object.fromEntries(MEAL_TYPES.map(t => [t, normalizeMeal(d[t])])))
        .filter(d => MEAL_TYPES.some(t => d[t]))
        .slice(0, 7);
    if (strict && !days.length) throw new Error("The response didn't contain any meals. Try again, or try another provider.");
    return days;
}

// === GENERATE MEAL PLAN ===
async function generateMealPlan() {
    const likes = document.getElementById('inputLikes').value.trim();
    const hates = document.getElementById('inputHates').value.trim();
    if (!goal) { showToast('Pick a goal first'); return; }
    if (!likes && !hates) { showToast('Enter at least one food you like or avoid'); return; }
    store('saved_likes', likes);
    store('saved_hates', hates);

    const btn = document.getElementById('generateBtn');
    const inputs = document.querySelectorAll('#generateSheet input, #generateSheet .segment-btn, #generateSheet .source-btn');
    btn.disabled = true;
    inputs.forEach(i => { i.disabled = true; });
    btn.textContent = 'Cooking… this can take a few minutes';
    try {
        let raw;
        if (source === 'themealdb') raw = await generateWithTheMealDB(likes, hates);
        else if (source === 'spoonacular') raw = await generateWithSpoonacular(likes, hates);
        else raw = await generateWithAI(likes, hates);

        daysData = normalizePlan(raw);
        selectedDay = 0;
        checkedGrocery.clear();
        store('nourish_plan', daysData);
        store('nourish_grocery_checked', []);
        closeGenerateSheet();
        renderAll();
        switchTab('today');
        if (daysData.length < 7) showToast(`Got ${daysData.length} of 7 days (the response was cut short).`);
    } catch (err) {
        showToast(err?.message || 'Something went wrong');
    } finally {
        btn.disabled = false;
        inputs.forEach(i => { i.disabled = false; });
        btn.textContent = 'Generate Plan';
    }
}

const PLAN_SYSTEM_PROMPT = 'You are a meal-planning chef. Return ONLY raw JSON, no markdown, no comments. ' +
    'Write out all 7 days in full. Keep each meal to at most 8 ingredients (with quantities) and 5 short steps. ' +
    'Format: {"days":[{"day":1,"breakfast":{"name":"","time_minutes":0,"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0},"ingredients":[""],"steps":[""]},"lunch":{same},"dinner":{same}}]}';

async function generateWithAI(likes, hates) {
    const p = settings.active_provider;
    let model;
    if (p === 'lmstudio') {
        if (!activeModel) activeModel = await fetchLMStudioModel();
        if (!activeModel) throw new Error('No model loaded in LM Studio. Open LM Studio, load a model and start the server.');
        model = activeModel;
    } else if (p === 'ollama') model = settings.ollama_model || 'llama3.2';
    else if (p === 'claude') model = settings.claude_model || 'claude-haiku-4-5';
    else model = settings.openai_model || 'gpt-4o';

    const data = await api('/api/generate', {
        method: 'POST',
        timeoutMs: 6 * 60 * 1000,
        body: {
            provider: p,
            model,
            api_key: p === 'claude' ? settings.claude_api_key : p === 'openai' ? settings.openai_api_key : undefined,
            max_tokens: 8000,
            messages: [
                { role: 'system', content: PLAN_SYSTEM_PROMPT },
                { role: 'user', content: `Goal: ${goal}. Likes: ${likes || 'anything'}. Avoids: ${hates || 'nothing'}. Generate the 7-day meal plan JSON.` },
            ],
        },
    });
    const text = p === 'claude'
        ? (data?.content || []).filter(b => b?.type === 'text').map(b => b.text).join('')
        : data?.choices?.[0]?.message?.content;
    return parseLLMJSON(text);
}

function spreadOverWeek(meals, toMeal) {
    if (!meals.length) throw new Error('No recipes found for those foods. Try different "likes".');
    return {
        days: Array.from({ length: 7 }, (_, d) => Object.fromEntries(
            MEAL_TYPES.map((t, m) => [t, toMeal(meals[(d * 3 + m) % meals.length])]))),
    };
}

async function generateWithTheMealDB(likes, hates) {
    const data = await api('/api/recipes/themealdb', { method: 'POST', timeoutMs: 45000, body: { query: likes || 'chicken', exclude: hates } });
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
        body: { api_key: settings.spoonacular_api_key, query: likes || 'chicken', exclude: hates, number: 21 },
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
