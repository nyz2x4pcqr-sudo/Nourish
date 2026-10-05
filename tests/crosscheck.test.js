// The nutrition cross-check (crosscheck.js): figures, confidence, ingredient-by-ingredient
// comparison, and the free services' answers (Edamam, FatSecret, USDA live) read as they come.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../crosscheck.js');
const N = require('../nutrition.js');
const S = require('../services.js');

const marrow = { name: 'Roasted Bone Marrow', servings: 4, ingredients: ['8 beef marrow bones', '1 cup parsley', '1 tbsp lemon juice', '1 tsp sea salt'], steps: ['Roast the bones.'] };

test('one recipe, one fingerprint: the same recipe from anywhere, never checked twice', () => {
    const a = X.fingerprint({ name: 'Chili', servings: 4, ingredients: ['1 lb beef', '1 can beans'] });
    assert.equal(a, X.fingerprint({ name: ' chili ', servings: 4, ingredients: ['1 lb  beef', '1 can beans'] }));
    assert.notEqual(a, X.fingerprint({ name: 'Chili', servings: 6, ingredients: ['1 lb beef', '1 can beans'] }));
    assert.equal(a.length, 16);
});

test('confidence: High within 10%, Medium within 20%, Low beyond, Estimate with one figure', () => {
    const f = (id, calories) => ({ id, label: id, calories, protein_g: 20 });
    assert.equal(X.compare([f('usda', 500), f('source', 530)]).level, 'high');
    assert.equal(X.compare([f('usda', 500), f('source', 590)]).level, 'medium');
    assert.equal(X.compare([f('usda', 500), f('source', 700)]).level, 'low');
    const one = X.compare([f('usda', 500)]);
    assert.equal(one.level, 'estimate');
    assert.match(one.note, /only one source/);
    // Two of three agree: the odd one out is named and set aside.
    const two = X.compare([f('usda', 820), f('source', 500), f('edamam', 520)]);
    assert.equal(two.level, 'medium');
    assert.equal(two.used.calories, 510);
    assert.match(two.note, /2 of 3 sources agree; usda was off/);
    assert.ok(!X.plannable({ nutrition_check: X.compare([f('usda', 500), f('source', 900)]) }));
    assert.ok(X.plannable({ nutrition_check: one }));
});

test('without any key: Nourish\'s calculation against the site\'s own numbers', () => {
    const r = { name: 'Turkey Chili', servings: 4, ingredients: ['1 lb lean ground turkey', '1 can kidney beans', '1 can crushed tomatoes', '1 onion', '1 tbsp chili powder'], steps: ['Cook.'], nutrition: { calories: 330, protein_g: 30, carbs_g: 28, fat_g: 10 } };
    N.settle(r);
    assert.ok(r.source_nutrition && r.source_nutrition.calories === 330, 'the site\'s own figure is kept');
    const c = X.localCheck(r);
    assert.equal(c.sources, 2);
    assert.ok(['high', 'medium', 'low'].includes(c.level));
    const book = { name: 'Lentil Soup', servings: 4, ingredients: ['1 cup lentils', '1 onion', '4 cups water'], steps: ['Simmer.'], from_book: true };
    N.settle(book);
    assert.equal(X.localCheck(book).level, 'estimate');
    assert.match(X.summary(Object.assign(book, { nutrition_check: X.localCheck(book) })), /Add a free key/);
});

// An answer in Edamam's documented nutrition-details format.
const edamamAnswer = {
    calories: 2240, totalWeight: 900,
    totalNutrients: { ENERC_KCAL: { quantity: 2240 }, PROCNT: { quantity: 24 }, FAT: { quantity: 240 }, CHOCDF: { quantity: 8 } },
    ingredients: [
        { text: '8 beef marrow bones', parsed: [{ quantity: 8, measure: 'bone', food: 'beef marrow', weight: 280, status: 'OK', nutrients: { ENERC_KCAL: { quantity: 2200 }, PROCNT: { quantity: 19 } } }] },
        { text: '1 cup parsley', parsed: [{ food: 'parsley', weight: 60, status: 'OK', nutrients: { ENERC_KCAL: { quantity: 22 }, PROCNT: { quantity: 2 } } }] },
        { text: '1 tbsp lemon juice', parsed: [{ food: 'lemon juice', weight: 15, status: 'OK', nutrients: { ENERC_KCAL: { quantity: 3 }, PROCNT: { quantity: 0 } } }] },
        { text: '1 tsp sea salt', parsed: [{ food: 'salt', weight: 6, status: 'OK', nutrients: { ENERC_KCAL: { quantity: 0 }, PROCNT: { quantity: 0 } } }] },
    ],
};

test('Edamam\'s answer is read per serving and per ingredient', () => {
    const f = X.parseEdamam(edamamAnswer, marrow);
    assert.equal(f.calories, 560);
    assert.equal(f.protein_g, 6);
    assert.equal(f.lines.length, 4);
    assert.equal(f.lines[0].kcal, 550);
    assert.equal(f.attribution.url, 'https://developer.edamam.com');
    const req = X.edamamRequest(marrow);
    assert.equal(req.method, 'POST');
    assert.deepEqual(req.body.ingr, marrow.ingredients);
    assert.equal(req.body.yield, '4');
});

test('FatSecret and USDA live answers are read as food per 100 g', () => {
    const fs = X.parseFatSecretSearch({ foods: { food: [
        { food_id: '1', food_name: 'Chicken Breast', food_type: 'Brand', food_description: 'Per 1 serving - Calories: 120kcal | Fat: 2g | Carbs: 0g | Protein: 24g' },
        { food_id: '2', food_name: 'Chicken Breast', food_type: 'Generic', food_description: 'Per 100g - Calories: 165kcal | Fat: 3.57g | Carbs: 0.00g | Protein: 31.02g' },
    ] } });
    assert.deepEqual(fs, { food_id: '2', name: 'Chicken Breast', generic: true, per100: { kcal: 165, fat: 3.57, carbs: 0, protein: 31.02 } });
    const us = X.parseUsdaSearch({ foods: [{ fdcId: 171077, description: 'Chicken, broiler, breast', foodNutrients: [{ nutrientNumber: '208', value: 120 }, { nutrientNumber: '203', value: 22.5 }, { nutrientNumber: '204', value: 2.6 }, { nutrientNumber: '205', value: 0 }] }] });
    assert.equal(us.per100.kcal, 120);
    assert.equal(us.per100.protein, 22.5);
    assert.equal(X.lookupName('2 lbs boneless skinless chicken breasts, cut into cubes'), 'chicken breasts');
});

test('a full check finds the line that is off and lets the majority decide (no real network: a stand-in service)', async () => {
    // A recipe whose one ingredient Nourish would get badly wrong, simulated by a site figure and two
    // services that agree with each other.
    const r = { name: 'Steak Plate', servings: 2, ingredients: ['12 oz sirloin steak', '2 cups cooked rice', '1 tbsp olive oil'], steps: ['Cook.'], nutrition: { calories: 640, protein_g: 45, carbs_g: 45, fat_g: 25 } };
    N.settle(r);
    const usda = X.usdaFigure(r);
    const sent = [];
    // Edamam says the steak is much heavier in calories than Nourish's line; FatSecret agrees.
    const steakLine = usda.lines.find(l => /steak/.test(l.line));
    const send = async (service, req) => {
        sent.push([service, req.method, new URL(req.url).hostname]);
        if (service === 'edamam') return { status: 200, body: JSON.stringify({ totalNutrients: { ENERC_KCAL: { quantity: (usda.calories + 300) * 2 }, PROCNT: { quantity: 90 } },
            ingredients: usda.lines.map(l => ({ text: l.line, parsed: [{ food: l.food, weight: l.grams, nutrients: { ENERC_KCAL: { quantity: (l === steakLine ? l.kcal + 300 : l.kcal) * 2 }, PROCNT: { quantity: 10 } } }] })) }) };
        if (service === 'fatsecret') {
            const steak = /sirloin|steak/.test(req.query.search_expression);
            const per100 = steak ? Math.round((steakLine.kcal + 300) * 2 / steakLine.grams * 100) : 130;
            return { status: 200, body: JSON.stringify({ foods: { food: [{ food_id: '9', food_name: req.query.search_expression, food_type: 'Generic', food_description: `Per 100g - Calories: ${per100}kcal | Fat: 5g | Carbs: 0g | Protein: 25g` }] } }) };
        }
        return { status: 404, body: '' };
    };
    const store = new Map();
    const { result, session } = await X.fullCheck(r, { send, services: { edamam: true, fatsecret: true }, cache: { get: k => store.get(k), set: (k, v) => store.set(k, v) } });
    assert.ok(sent.every(([, , host]) => ['api.edamam.com', 'platform.fatsecret.com'].includes(host)));
    assert.ok(result.flags && result.flags.some(f => /steak/.test(f.line)), JSON.stringify(result.flags));
    assert.ok(result.sources >= 3);
    assert.ok(session.edamam, 'Edamam\'s own numbers are kept for this session only');
    // What's stored never holds Edamam's per-ingredient data, only the main numbers and Nourish's conclusions.
    assert.ok(!JSON.stringify(result).includes('"lines"'));
    // Looked up once: a second check of a recipe with the same steak reuses FatSecret's answer (within 24 hours).
    const before = sent.length;
    await X.fullCheck(r, { send, services: { fatsecret: true }, cache: { get: k => store.get(k), set: (k, v) => store.set(k, v) } });
    assert.equal(sent.length, before, 'no new lookups');
});

test('free limits are counted and Nourish stops before them', () => {
    const mem = {};
    global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
    try {
        const now = Date.UTC(2026, 9, 5, 12, 0, 0);
        assert.equal(S.limitReached('edamam', { now }), '');
        for (let i = 0; i < 10; i++) S.count('edamam', 1, now);
        assert.equal(S.limitReached('edamam', { now }), 'wait a minute');
        assert.equal(S.limitReached('edamam', { now: now + 61e3 }), '');
        S.count('edamam', 370, now + 61e3);
        assert.match(S.limitReached('edamam', { now: now + 120e3 }), /this month is used up/);
        assert.match(S.usageText('edamam', { now: now + 120e3 }), /380 of 380 this month/);
        for (let i = 0; i < 25; i++) S.count('usda', 1, now);
        assert.match(S.limitReached('usda', { hasKey: false, now }), /this hour/);
        assert.equal(S.limitReached('usda', { hasKey: true, now }), '');
        S.count('spoonacular', 1, now, 46);
        assert.match(S.limitReached('spoonacular', { now }), /points for today/);
    } finally { delete global.localStorage; }
});

test('a phone signs requests itself, only for the service\'s own address', async () => {
    const a = await S.authorize('edamam', { url: 'https://api.edamam.com/api/nutrition-details', query: {} }, { edamam_app_id: 'id1', edamam_app_key: 'k1' });
    assert.match(a.url, /app_id=id1&app_key=k1/);
    await assert.rejects(S.authorize('edamam', { url: 'https://evil.example.com/x' }, { edamam_app_id: 'a', edamam_app_key: 'b' }));
    const u = await S.authorize('usda', { url: 'https://api.nal.usda.gov/fdc/v1/foods/search', query: { query: 'egg' } }, {});
    assert.match(u.url, /api_key=DEMO_KEY/);
    const f = await S.authorize('fatsecret', { url: 'https://platform.fatsecret.com/rest/server.api', query: { method: 'foods.search', search_expression: 'egg', format: 'json' } }, { fatsecret_key: 'k', fatsecret_secret: 's' });
    assert.match(f.url, /oauth_signature=/);
    const sp = await S.authorize('spoonacular', { url: 'https://api.spoonacular.com/recipes/complexSearch', query: { query: 'chicken' } }, { spoonacular_api_key: 'abc' });
    assert.equal(sp.headers['x-api-key'], 'abc');
    assert.ok(!sp.url.includes('abc'), 'never in the address');
});
