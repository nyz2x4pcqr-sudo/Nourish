// Bugs the plan audit (tools/plan-audit.js) found in 0.1.12, kept fixed.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const PL = require('../planner.js');
const P = require('../prefs.js');
const { ALL } = require('../tools/audit-recipes.js');
const line = l => N.calculate([l], 1).lines[0];

test('bone marrow is bone marrow (mostly fat), counted by the marrow, and never a meal (0.1.12 planned it as lunch with chicken added)', () => {
    const r0 = ALL.find(r => /Bone Marrow/.test(r.title));
    const r = { name: r0.title, servings: 4, ingredients: r0.ingredients, steps: r0.steps };
    N.settle(r);
    const l = N.calculate(r.ingredients, 4, r.steps).lines.find(x => /marrow/.test(x.line));
    assert.equal(l.key, 'bone marrow');
    assert.ok(l.grams < 300, `${l.grams} g of marrow from 3 lb of bones`);
    assert.ok(r.nutrition.protein_g < 15 && r.nutrition.fat_g > 40, JSON.stringify(r.nutrition));
    const fit = PL.mealFit(r);
    assert.ok(!fit.breakfast && !fit.lunch && !fit.dinner, fit.why);
});

test('what is thrown away is not eaten: brines, soaking buttermilk, the frying oil left in the pan', () => {
    const marrow = ALL.find(r => /Bone Marrow/.test(r.title));
    const lines = N.calculate(marrow.ingredients, 4, marrow.steps).lines;
    assert.ok(lines.filter(x => /water|kosher salt/.test(x.line)).every(x => x.grams === 0));
    const chops = ALL.find(r => /Brined Pork Chops/.test(r.title));
    assert.equal(N.calculate(chops.ingredients, 4, chops.steps).lines.find(x => /sugar/.test(x.line)).kcal, 0);
    const fried = ALL.find(r => /Southern Fried/.test(r.title));
    const oil = N.calculate(fried.ingredients, 6, fried.steps).lines.find(x => /oil/.test(x.line));
    assert.ok(oil.kcal <= 130, `${oil.kcal} kcal of frying oil a serving`);
});

test('bones and shells are not counted as food; cooked grains count as cooked; cans and fillets as they are', () => {
    assert.ok(line('2 pounds bone-in, skin-on chicken thighs').grams < 800);
    assert.ok(line('2 pounds shell-on large shrimp').grams < 800);
    assert.equal(line('2 racks baby back pork ribs (about 4 pounds)').key, 'pork ribs');
    assert.ok(line('2 racks baby back pork ribs (about 4 pounds)').grams < 1400);
    assert.ok(line('1 cup cooked jasmine rice').kcal < 260);
    assert.ok(line('115 g ramen noodles, cooked according to the packet directions').kcal > 350, 'a packet weight is dry');
    assert.equal(line('½ (15 oz.) cans white beans').grams, 213);
    assert.equal(line('1/2 can (15 oz) chickpeas, drained').grams, 213);
    assert.ok(line('2 salmon fillets').grams <= 340);
    assert.equal(line('2 skinless salmon fillets, about 260g, cut into chunks').grams, 260);
    assert.ok(line('½ pinches ground cardamom').kcal < 5);
    assert.ok(line('2 heads garlic').grams <= 100);
});

test('scaling a 4-serving recipe to one small portion never rounds a can up to half a can', () => {
    const r = { name: 'Bean stew', servings: 4, ingredients: ['2 (15 oz.) cans white beans, drained', '2 cans light coconut milk (14-ounce cans)', '1 onion'], steps: ['Simmer.'] };
    N.settle(r);
    const s = PL.scaleRecipe(r, 0.5, 1);
    assert.ok(s.ingredients.some(l => /^3¾ oz white beans/.test(l)), s.ingredients.join(' | '));
    assert.ok(s.ingredients.some(l => /^3½ oz light coconut milk/.test(l)), s.ingredients.join(' | '));
    assert.ok(s.ingredients.some(l => /^¼ onion/.test(l)), s.ingredients.join(' | '));
});

test('avoided foods: lox is fish, brioche buns are gluten, gluten-free pasta and soy yogurt are fine', () => {
    assert.ok(P.excluder({ diet: 'Vegetarian' })({ name: 'Lox and Eggs', ingredients: ['4 oz lox'] }));
    const g = P.excluder({ allergies: 'gluten' });
    assert.ok(g({ name: 'Burger', ingredients: ['4 brioche buns'] }));
    assert.equal(g({ name: 'x', ingredients: ['8 oz gluten-free pasta', '4 gluten-free buns'] }), null);
    const v = P.excluder({ diet: 'Vegan' });
    assert.equal(v({ name: 'x', ingredients: ['1 cup soy yogurt', '2 cups dairy-free milk'] }), null);
    assert.ok(v({ name: 'x', ingredients: ['2 oz milk chocolate'] }));
});

test('avoided foods: a word ending in y also catches its -ies plural (anchovies are fish)', () => {
    const f = P.excluder({ avoid: 'fish, salmon, tuna' });
    assert.ok(f({ name: 'Caesar Salad Wrap', ingredients: ['1 anchovies in oil'] }));
    assert.ok(f({ name: 'x', ingredients: ['2 anchovy fillets'] }));
    assert.ok(P.excluder({ avoid: 'turkey' })({ name: 'x', ingredients: ['2 turkeys'] }));
});

test('portions stay quarter servings between ¾ and 1½, and the recipe itself never changes (0.1.13 added chicken, eggs and powder to recipes)', () => {
    const r = { name: 'Black Bean Tacos', servings: 4, ingredients: ['2 cans black beans', '8 corn tortillas', '1 avocado', '1/2 cup salsa'], steps: ['Warm the beans.', 'Fill the tortillas.'] };
    N.settle(r);
    for (const kcal of [1200, 1500, 2600, 4000]) {
        const res = PL.balanceDay({ breakfast: null, lunch: PL.scaleRecipe(r, 1, 1), dinner: null }, { calorie_target: kcal, protein_target: 150 }, 1, null, 0);
        const portion = res.day.lunch.scaled ? res.day.lunch.scaled.portion : 1;
        assert.ok(portion >= 0.75 && portion <= 1.5 && Math.abs(portion * 4 - Math.round(portion * 4)) < 0.01, `${kcal}: ${portion}`);
        assert.deepEqual(PL.ingredientFoods(res.day.lunch), PL.ingredientFoods(r), 'the same foods as the recipe');
        assert.ok(!res.day.lunch.protein_added && !res.day.lunch.fiber_added && !res.day.lunch.fat_swapped);
    }
});

test('a description made from the recipe never carries amounts, units or brackets ("Sandwich made with to 4 slices bacon…")', () => {
    const O = require('../ondevice.js');
    const d = O.describeFromRecipe({ name: 'Chicken pasta salad', ingredients: ['4 rashers streaky bacon', '120g/4¼oz farfalle pasta', '150g/5½oz leftover roast chicken', '2 to 4 slices bacon', '1 Tbs. unsalted butter', '93% lean ground beef', '⁠1 tbsp olive oil'], steps: ['Cook the pasta.', 'Mix everything.'] });
    assert.match(d, /^Salad made with /);
    assert.doesNotMatch(d.replace(/About [\d.]+ (minutes|hours)\./, ''), /\d|\b(tbs|tbsp|cups?|rashers)\b|[~/()]/i, d);
    const n = require('../planner.js').scaleLine('4 skinless and boneless (approx. 480g) salmon fillets', 0.25);
    assert.equal(n, '1 skinless and boneless (approx. 120g) salmon fillets');
});

test('amount ranges ending in a written fraction, and frozen dumplings counted by the piece', () => {
    const U = require('../units.js');
    assert.deepEqual(U.splitIngredient('¼ -1/2 tsp red pepper flakes'), { qty: 0.25, unit: 'tsp', text: 'red pepper flakes', qtyHigh: 0.5 });
    assert.equal(U.splitIngredient('1/4 - 1/2 tsp chili flakes').unit, 'tsp');
    assert.equal(U.splitIngredient('1-1/2 cups rice').qty, 1.5);
    assert.ok(N.calculate(['¼ -1/2 tsp red pepper flakes'], 1).nutrition.calories < 10);
    const d = N.calculate(['24 frozen chicken potstickers'], 1).lines[0];
    assert.equal(d.key, 'dumplings');
    assert.ok(d.grams <= 700, `${d.grams} g`);
});

test('a day short of protein gets at most two protein extras as items of their own, and says honestly what it reaches', () => {
    const meal = (name, kcal, p, list) => ({ name, servings: 1, ingredients: list, steps: ['Cook.'], nutrition: { calories: kcal, protein_g: p, carbs_g: 60, fat_g: 12, fiber_g: 5 } });
    const day = { breakfast: meal('Porridge', 380, 12, ['1 cup oats', '1 cup milk']), lunch: meal('Lentil Soup', 420, 18, ['1 cup lentils', '1 onion']), dinner: meal('Veggie Pasta', 560, 20, ['4 oz pasta', '1 zucchini']) };
    const s = { calorie_target: 1500, protein_target: 150 };
    const res = PL.balanceDay(day, s, 1, null, 0);
    const extras = (res.day.snacks || []).filter(x => x.protein_extra);
    assert.ok(extras.length >= 1 && extras.length <= 2, `${extras.length} extras`);
    extras.forEach(x => assert.match(x.name, /yogurt|cottage|shake|tuna|eggs|jerky|edamame/i));
    PL.MEALS.forEach(m => assert.deepEqual(PL.ingredientFoods(res.day[m]), PL.ingredientFoods(day[m]), `${m} unchanged`));
    const t = PL.dayTotals(res.day);
    assert.ok(Math.abs(t.kcal / 1500 - 1) <= 0.1, `${Math.round(t.kcal)} kcal`);
    // These recipes can't reach 150 g even with two extras: the honest number is kept for the plan screen.
    assert.ok(res.day.protein_gap && res.day.protein_gap.have === Math.round(t.protein) && res.day.protein_gap.target === 150);
    // A vegan day never gets dairy or tuna.
    const vegan = PL.balanceDay(day, s, 1, require('../prefs.js').excluder({ diet: 'Vegan' }), 0);
    (vegan.day.snacks || []).forEach(x => assert.match(x.name, /plant protein shake|edamame/i));
    // A day that already meets its protein gets none.
    const rich = { breakfast: meal('Egg White Scramble', 380, 45, ['1 cup egg whites']), lunch: meal('Chicken Salad', 450, 50, ['6 oz chicken breast']), dinner: meal('Salmon', 620, 55, ['6 oz salmon']) };
    assert.equal((PL.balanceDay(rich, s, 1, null, 0).day.snacks || []).length, 0);
});

test('a high protein target for the calories gets a plain note with a range real meals reach', () => {
    const note = PL.proteinNote({ calorie_target: 1500, protein_target: 150 });
    assert.equal(note.share, 40);
    assert.equal(note.lo, 95); assert.equal(note.hi, 130);
    assert.match(note.text, /limits which recipes fit/);
    assert.equal(PL.proteinNote({ calorie_target: 2000, protein_target: 120 }), null);
});

test('whole spices with no unit weigh what a berry or a pod weighs, not 100 g', () => {
    assert.ok(N.calculate(['6 allspice berries'], 1).nutrition.calories < 10);
    assert.ok(N.calculate(['10 black peppercorns'], 1).nutrition.calories < 10);
    assert.ok(N.calculate(['1 nutmeg'], 1).nutrition.calories < 40);
});
