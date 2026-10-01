// Model ranking for the phone apps: each phone gets its own top-5 list that fits its memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rankModels: rank, assessModel, compareVersions, stripThinking } = require('../ondevice.js');

// Sample models for the ranking tests (the app itself always builds its list live from Hugging Face).
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

const rankModels = specs => rank(specs, MODEL_CATALOG);

const GB = 1024 ** 3;
const phones = {
    'iPhone 16 Pro (normal limit)': { platform: 'ios', ram: 8 * GB, usable: 3.4 * GB, disk_free: 50 * GB, thermal: 'nominal' },
    'iPhone 16 Pro (LiveContainer, more RAM)': { platform: 'ios', ram: 8 * GB, usable: 6.2 * GB, disk_free: 50 * GB, thermal: 'nominal' },
    'Older Android, 4 GB': { platform: 'android', ram: 4 * GB, usable: 1.6 * GB, disk_free: 8 * GB, thermal: 'nominal' },
    'Flagship Android, 16 GB': { platform: 'android', ram: 16 * GB, usable: 11 * GB, disk_free: 200 * GB, thermal: 'nominal' },
};
const ranked = Object.fromEntries(Object.entries(phones).map(([k, s]) => [k, rankModels(s)]));

test('every phone gets at most 5 picks, none of them too big', () => {
    for (const [name, r] of Object.entries(ranked)) {
        assert.ok(r.top.length >= 1 && r.top.length <= 5, name);
        for (const m of r.top) assert.notEqual(m.a.fit, 'too-big', `${name}: ${m.name}`);
        assert.equal(r.top[0].tags[0][0], 'Recommended', name);
    }
});

test('a phone with more memory gets bigger models than a small phone', () => {
    const small = ranked['Older Android, 4 GB'].top;
    const big = ranked['Flagship Android, 16 GB'].top;
    assert.ok(Math.max(...big.map(m => m.size)) > Math.max(...small.map(m => m.size)));
    assert.ok(small.every(m => m.size < 1.5 * GB), 'a 4 GB phone only gets small models');
    assert.ok(big.some(m => m.id === 'qwen35-9b'), 'a 16 GB phone can run the 9B model');
});

test('LiveContainer\'s higher memory limit unlocks bigger models on the same iPhone', () => {
    const normal = ranked['iPhone 16 Pro (normal limit)'];
    const boosted = ranked['iPhone 16 Pro (LiveContainer, more RAM)'];
    assert.ok(normal.tooBig.length > boosted.tooBig.length);
    assert.notDeepEqual(normal.top.map(m => m.id), boosted.top.map(m => m.id));
});

test('a hot phone marks models as "May get warm"', () => {
    const hot = rankModels(Object.assign({}, phones['Flagship Android, 16 GB'], { thermal: 'serious' }));
    assert.ok(hot.top.every(m => m.tags.some(t => t[0] === 'May get warm')));
});

test('not enough storage is flagged', () => {
    const m = MODEL_CATALOG.find(x => x.id === 'qwen35-9b');
    assert.equal(assessModel(m, Object.assign({}, phones['Flagship Android, 16 GB'], { disk_free: 2 * GB })).noDisk, true);
});

test('version comparison orders pre-releases before releases', () => {
    assert.ok(compareVersions('0.4.0-pre-alpha', '0.3.0-pre-alpha') > 0);
    assert.ok(compareVersions('0.3.0', '0.3.0-beta') > 0);
    assert.ok(compareVersions('v0.3.0-pre-alpha', '0.3.0-pre-alpha') === 0);
    assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
});

test('thinking is removed from replies', () => {
    assert.equal(stripThinking('<think>hmm\nok</think>\nHello'), 'Hello');
    assert.equal(stripThinking('Hello'), 'Hello');
});

test('catalog entries are complete', () => {
    for (const m of MODEL_CATALOG) {
        assert.match(m.file, /\.gguf$/);
        assert.match(m.repo, /^[\w.-]+\/[\w.-]+$/);
        assert.ok(m.size > 1e8 && m.params > 0 && m.quality > 0, m.id);
    }
});

test('junk ingredient lines in a day are found and dropped', () => {
    const { junkRows, dropJunk } = require('../ondevice.js');
    const meal = ingredients => ({ name: 'Dish', nutrition: { calories: 400 }, ingredients, steps: ['Cook it all well.'] });
    const day = {
        breakfast: meal(['2 cups all-purpose flour', 'use 1 cup', '1/2 cup fresh spinach', 'use 1/2 cup', '2 large eggs', 'use 2 large']),
        lunch: meal(['description of 2 eggs, 1/4 cup mashed avocado, 3 tbsp corn flour, 2 tbsp yogurt, 1', 'ingredients']),
        dinner: meal(['1 lb salmon', '1 lemon', '1 lemon']),
    };
    assert.equal(junkRows(day).length, 6);   // 5 junk lines, and lunch (2 lines) is incomplete
    const clean = dropJunk(day);
    assert.deepEqual(clean.breakfast.ingredients, ['2 cups all-purpose flour', '1/2 cup fresh spinach', '2 large eggs']);
    assert.deepEqual(clean.lunch.ingredients, []);
    assert.deepEqual(clean.dinner.ingredients, ['1 lb salmon', '1 lemon']);
    // Lunch had nothing but junk, and dinner only 2 real items: both are now flagged as incomplete.
    assert.deepEqual(junkRows(clean).map(b => `${b.meal}: ${b.reason}`), ['lunch: incomplete (cut off?)', 'dinner: incomplete (cut off?)']);
});

test('near-duplicate dish names are caught', () => {
    const { sameDish } = require('../ondevice.js');
    assert.ok(sameDish('Avocado & Spinach Pancakes', 'Spinach and Avocado Pancake'));
    assert.ok(sameDish('Overnight Oats with Berries and Almond Butter', 'Overnight Oats with Berries & Almond Butter'));
    assert.ok(!sameDish('Overnight Oats with Berries', 'Chicken Tikka Masala'));
    assert.ok(!sameDish('Greek Salad', 'Greek Yogurt Parfait'));
});

test('the plan format keeps each ingredient to one short item and at most 10 per meal', () => {
    const { GBNF_DAY, GBNF_MEAL } = require('../ondevice.js');
    assert.match(GBNF_DAY, /item \(","\s*ws item\)\{2,9\}/);
    assert.match(GBNF_DAY, /item ::= .*\[\^"\\\\\\x7F\\x00-\\x1F,\]\{2,47\}/);
    assert.match(GBNF_MEAL, /^root ::= meal/);
});

test('repeated ingredients and steps that name one twice are caught; amounts are capped', () => {
    const { mealProblems, tidyMeal } = require('../ondevice.js');
    const curry = {
        name: 'Green Curry',
        ingredients: ['1 lb lean beef', '1 cup green curry paste', '1 cup coconut milk', '1/2 cup green curry paste', '1/2 cup green curry paste'],
        steps: ['Add 1/2 cup green curry paste and 1/2 cup green curry paste to the pan.', 'Simmer the beef in coconut milk.'],
    };
    const problems = mealProblems(curry);
    assert.ok(problems.some(p => /green curry paste" listed more than once/.test(p)), problems.join(' | '));
    assert.ok(problems.some(p => /a step names "green curry paste" 2 times/.test(p)), problems.join(' | '));
    assert.deepEqual(mealProblems({ name: 'Fine', ingredients: ['2 eggs', '1 cup spinach'], steps: ['Whisk the eggs, then add the spinach.'] }), []);
    const caps = tidyMeal(curry);
    assert.deepEqual(curry.ingredients, ['1 lb lean beef', '2 tbsp green curry paste', '1 cup coconut milk']);
    assert.equal(caps.length, 1);
});

test('a remade meal cut off at the length limit is not used', () => {
    const { completeMeal } = require('../ondevice.js');
    const whole = { name: 'Curry', nutrition: { calories: 500 }, ingredients: ['1 lb beef', '2 tbsp curry paste', '1 can coconut milk'], steps: ['Simmer it all for 20 minutes.'] };
    assert.ok(completeMeal(whole));
    assert.ok(!completeMeal(Object.assign({}, whole, { steps: [] })));
    assert.ok(!completeMeal(Object.assign({}, whole, { steps: undefined })));
    assert.ok(!completeMeal(Object.assign({}, whole, { ingredients: ['1 lb beef'] })));
    assert.ok(!completeMeal(Object.assign({}, whole, { nutrition: null })));
    assert.ok(!completeMeal(null));
});
