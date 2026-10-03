// Recipe checks (recipes.js), the meal-by-meal maker (ondevice.js) and temperatures in steps (units.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recipes.js');
const { makeMeal, MEAL_ATTEMPTS, MEAL_EXTRA_ATTEMPTS } = require('../ondevice.js');
const U = require('../units.js');

// The broken recipe from the bug report.
const TAGINE = {
    name: 'Moroccan-Style Vegetable Tagine with Lamb',
    ingredients: ['1 cup roasted vegetables', 'lean lamb', '1 cup couscous'],
    steps: ['Preheat oven to 400°F (400°F).', 'This Moroccan-style tagine combines tender lamb with roasted vegetables and warm spices for a Moroccan-ve'],
    time_minutes: 55,
    nutrition: { calories: 450, protein_g: 35, carbs_g: 20, fat_g: 30 },
};
const GOOD = {
    name: 'Lamb and Apricot Tagine',
    servings: 2,
    ingredients: ['10 oz boneless lamb shoulder', '1 tbsp olive oil', '1 yellow onion', '2 cloves garlic', '1 tsp ground cumin', '1 tsp ras el hanout',
        '1/2 tsp salt', '1 cup low-sodium chicken broth', '1/2 cup dried apricots', '1 can chickpeas', '2 tbsp chopped cilantro', '1/2 cup couscous'],
    steps: [
        'Cut the lamb into 1-inch cubes and dice the onion; mince the garlic.',
        'Heat the olive oil in a heavy pot over medium-high heat and brown the lamb for 5 minutes.',
        'Add the onion and garlic and cook for 3 minutes until soft.',
        'Stir in the cumin, ras el hanout and salt and cook for 1 minute.',
        'Pour in the broth, add the apricots and drained chickpeas, cover and simmer for 35 minutes.',
        'Meanwhile, pour boiling water over the couscous, cover and let stand 5 minutes, then fluff with a fork.',
        'Divide the couscous between two bowls, spoon the tagine over it and garnish with cilantro.',
    ],
    time_minutes: 55,
    nutrition: { calories: 560, protein_g: 38, carbs_g: 48, fat_g: 24 },
};
const copy = x => JSON.parse(JSON.stringify(x));

test('the broken tagine fails every check it should', () => {
    const p = R.recipeProblems(TAGINE, { type: 'dinner' }).join(' | ');
    for (const want of ['no serving count', '"1 cup roasted vegetables" is too vague', '"lean lamb" has no amount', 'nothing to season it',
        'only 2 steps for a 55-minute recipe', 'step 2 is cut off', 'no step says how to serve it', 'never used in the steps: "1 cup couscous"']) {
        assert.ok(p.includes(want), `missing "${want}" in: ${p}`);
    }
});

test('a complete recipe passes', () => {
    assert.deepEqual(R.recipeProblems(GOOD, { type: 'dinner' }), []);
});

test('a description instead of an instruction is caught', () => {
    const meal = copy(GOOD);
    meal.steps[1] = 'This hearty Moroccan stew is packed with warm spices and tender meat.';
    assert.ok(R.recipeProblems(meal, { type: 'dinner' }).includes('step 2 is a description, not an instruction'));
    assert.ok(R.isInstruction('In a large skillet, heat the oil over medium heat.'));
    assert.ok(R.isInstruction('Meanwhile, cook the rice according to the package.'));
    assert.ok(!R.isInstruction('A light and fresh salad that is perfect for summer.'));
});

test('an ingredient never used in the steps is caught; group words count', () => {
    const meal = copy(GOOD);
    meal.steps[3] = 'Stir in the spices and cook for 1 minute.';   // cumin, ras el hanout and salt are "the spices"
    assert.deepEqual(R.unusedIngredients(meal), []);
    meal.ingredients.push('1 cup frozen peas');
    assert.deepEqual(R.unusedIngredients(meal), ['1 cup frozen peas']);
});

test('calories must roughly match P×4 + C×4 + F×9', () => {
    assert.ok(R.macrosMatch({ calories: 560, protein_g: 38, carbs_g: 48, fat_g: 24 }));   // 560
    assert.ok(R.macrosMatch({ calories: 500, protein_g: 38, carbs_g: 48, fat_g: 24 }));   // within 15%
    assert.ok(!R.macrosMatch({ calories: 300, protein_g: 38, carbs_g: 48, fat_g: 24 }));
    const meal = copy(GOOD);
    meal.nutrition.calories = 300;
    const p = R.recipeProblems(meal, { type: 'dinner' });
    assert.ok(R.onlyCaloriesWrong(p), p.join(' | '));
    assert.equal(R.fixCalories(meal).nutrition.calories, 560);
});

test('longer recipes need more steps', () => {
    assert.equal(R.minSteps(10), 3);
    assert.equal(R.minSteps(25), 4);
    assert.equal(R.minSteps(55), 5);
});

test('a bad recipe is made again and told what was wrong; a good remake is kept', async () => {
    const asks = [];
    let n = 0;
    const tagine = Object.assign(copy(TAGINE), { servings: 2 });
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'Make the dinner.', earlier: [] }, async msgs => {
        asks.push(msgs[1].content);
        return JSON.stringify(n++ === 0 ? tagine : GOOD);
    });
    assert.equal(r.attempts, 2);
    assert.deepEqual(r.problems, []);
    assert.equal(r.meal.name, 'Lamb and Apricot Tagine');
    assert.equal(r.meal.incomplete, undefined);
    assert.match(asks[1], /had these problems/);
    assert.match(asks[1], /"lean lamb" has no amount/);
});

// Small problems (too few steps, an unused ingredient, a missing serving step) are fixed in code
// instead of asking a small model to write the whole recipe again; only real problems (cut off,
// wrong kind of meal, an avoided food) are worth another try.
test('small problems are fixed in code, not remade: the first try without real problems is kept', async () => {
    let calls = 0;
    const worse = Object.assign(copy(TAGINE), { servings: 2 });   // a step is cut off: a real problem
    const better = copy(GOOD);
    better.steps = better.steps.slice(0, 4).concat(['Serve hot.']);   // too few steps, couscous etc. unused: small problems
    const answers = [worse, better, worse];
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: [] }, async () => JSON.stringify(answers[calls++]));
    assert.equal(calls, 2);
    assert.equal(r.meal.name, GOOD.name);
    assert.deepEqual(r.problems, []);
    assert.equal(r.meal.incomplete, undefined);
    // The unused seasoning and garnish are worked into a step; nothing used is lost.
    assert.ok(r.meal.steps.some(st => /cilantro/.test(st)), r.meal.steps.join(' | '));
});

test("the AI's own calories and macros are never used: they're worked out from the ingredients", async () => {
    const meal = copy(GOOD);
    meal.nutrition.calories = 250;
    let calls = 0;
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: [] }, async () => { calls++; return JSON.stringify(meal); });
    assert.equal(calls, 1);
    assert.equal(r.meal.nutrition_basis, 'calculated');
    assert.equal(r.meal.nutrition.calories, require('../nutrition.js').calculate(r.meal.ingredients, 2).nutrition.calories);
    assert.notEqual(r.meal.nutrition.calories, 250);
    assert.equal(r.meal.incomplete, undefined);
});

test('a repeat of an earlier dish is made again', async () => {
    let n = 0;
    const other = Object.assign(copy(GOOD), { name: 'Chickpea and Apricot Lamb Stew' });
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: ['Lamb & Apricot Tagine'] }, async () => JSON.stringify(n++ === 0 ? GOOD : other));
    assert.equal(r.meal.name, 'Chickpea and Apricot Lamb Stew');
});

test('an unreadable first try never stops the plan: a later readable try is kept', async () => {
    let n = 0;
    const weak = Object.assign(copy(TAGINE), { servings: 2 });   // readable, many problems
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: [] }, async () => (n++ === 0 ? 'not json at all' : JSON.stringify(weak)));
    assert.ok(r.meal, 'a readable try must be kept');
    assert.equal(r.meal.name, TAGINE.name);
    assert.ok(r.meal.incomplete.length > 0);
});

test('a try with too few ingredients is kept (marked) rather than failing the plan', async () => {
    const thin = Object.assign(copy(GOOD), { ingredients: ['10 oz boneless lamb shoulder', '1 tbsp olive oil'] });
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: [] }, async () => JSON.stringify(thin));
    assert.ok(r.meal);
    assert.ok(r.meal.incomplete.includes('the answer was incomplete (cut off?)'));
    assert.ok(r.meal.incomplete.some(p => /only 2 ingredients/.test(p)), r.meal.incomplete.join(' | '));
});

test('while no try is usable, up to 2 more tries are made: a later usable one is kept', async () => {
    let n = 0;
    const unusable = Object.assign(copy(GOOD), { ingredients: [] });   // no ingredients left: nothing usable
    const r = await makeMeal({ type: 'dinner', system: 's', ask: 'a', earlier: [] }, async () => JSON.stringify(n++ < MEAL_ATTEMPTS ? unusable : GOOD));
    assert.equal(n, MEAL_ATTEMPTS + 1);
    assert.equal(r.meal.name, GOOD.name);
    assert.deepEqual(r.problems, []);
});

test('nothing readable in any try: reported, not kept', async () => {
    let calls = 0;
    const r = await makeMeal({ type: 'lunch', system: 's', ask: 'a', earlier: [] }, async () => { calls++; return '{"name":""}'; });
    assert.equal(r.meal, null);
    assert.equal(calls, MEAL_ATTEMPTS + MEAL_EXTRA_ATTEMPTS);
});

test('cancelling stops straight away', async () => {
    assert.equal(await makeMeal({ type: 'lunch', system: 's', ask: 'a' }, async () => null), null);
});

test('two temperatures for one thing show once, in the chosen units', () => {
    assert.equal(U.convertText('Preheat oven to 400°F (400°F).', 'imperial'), 'Preheat oven to 400°F.');
    assert.equal(U.convertText('Preheat oven to 400°F (200°C).', 'imperial'), 'Preheat oven to 400°F.');
    assert.equal(U.convertText('Preheat oven to 400°F (200°C).', 'metric'), 'Preheat oven to 200°C.');
    assert.equal(U.convertText('Bake at 200°C / 400°F for 20 min', 'imperial'), 'Bake at 400°F for 20 min');
    assert.equal(U.convertText('Heat to 180 C or 350 F', 'metric'), 'Heat to 180°C');
    assert.equal(U.convertText('Roast at 425F', 'metric'), 'Roast at 220°C');
    assert.equal(U.convertText('Roast at 350°F for 20 minutes, then 425°F for 5.', 'imperial'), 'Roast at 350°F for 20 minutes, then 425°F for 5.');
    assert.equal(U.convertText('Add 2 c milk', 'metric'), 'Add 2 c milk');   // cups, not Celsius
});
