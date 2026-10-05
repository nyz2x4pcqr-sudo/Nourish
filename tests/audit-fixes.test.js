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

test('portions stay whole, half or quarter servings, and an added protein food stays within what a person would add', () => {
    const r = { name: 'Black Bean Tacos', servings: 4, ingredients: ['2 cans black beans', '8 corn tortillas', '1 avocado', '1/2 cup salsa'], steps: ['Warm the beans.', 'Fill the tortillas.'] };
    N.settle(r);
    let day = { breakfast: null, lunch: PL.scaleRecipe(r, 1.75, 1), dinner: null };
    day = PL.fitDay(day, { calorie_target: 1500 }, 1);
    const portion = day.lunch.scaled ? day.lunch.scaled.portion : 1;
    assert.ok(Math.abs(portion * 4 - Math.round(portion * 4)) < 0.01, `${portion}`);
    let m = day.lunch;
    for (let i = 0; i < 6; i++) m = PL.boostProtein(m, 30, 'lunch', 1, null);
    const added = m.ingredients.filter(l => /chicken breast|tofu/.test(l));
    assert.equal(added.length, 1, added.join(' | '));
    assert.ok(Number(added[0].match(/^\d+/)[0]) <= 6, added[0]);
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

test('a day over its calories has added foods taken back out, fiber first, never under 90% of its protein', () => {
    const meal = (name, kcal, p) => ({ name, servings: 1, ingredients: ['x'], steps: ['Cook.'], nutrition: { calories: kcal, protein_g: p, carbs_g: 50, fat_g: 10, fiber_g: 5 } });
    let b = meal('Porridge', 400, 30);
    b = Object.assign(b, { ingredients: ['x', '2 tbsp chia seeds'], fiber_added: ['2 tbsp chia seeds'], added_steps: ['Stir in the chia seeds.'], steps: ['Cook.', 'Stir in the chia seeds.'] });
    b.nutrition.calories += 120;
    let l = meal('Salad', 500, 40);
    l = Object.assign(l, { ingredients: ['x', '6 oz firm tofu'], protein_added: ['6 oz firm tofu'] });
    l.nutrition.calories += 140; l.nutrition.protein_g += 15;
    const day = { breakfast: b, lunch: l, dinner: meal('Curry', 600, 40) };
    const before = PL.dayTotals(day);
    const out = PL.trimAddOns(day, before.kcal - 100, 0, 1);
    assert.ok(!out.day.breakfast.fiber_added, 'the chia seeds go first');
    assert.ok(!out.day.breakfast.ingredients.includes('2 tbsp chia seeds'));
    assert.ok(!out.day.breakfast.steps.includes('Stir in the chia seeds.'));
    assert.ok(PL.dayTotals(out.day).kcal < before.kcal - 100);
    const kept = PL.trimAddOns(day, before.kcal - 300, before.protein - 1, 1);
    assert.ok(kept.day.lunch.protein_added, 'protein stays when it would drop under the floor');
});

test('whole spices with no unit weigh what a berry or a pod weighs, not 100 g', () => {
    assert.ok(N.calculate(['6 allspice berries'], 1).nutrition.calories < 10);
    assert.ok(N.calculate(['10 black peppercorns'], 1).nutrition.calories < 10);
    assert.ok(N.calculate(['1 nutmeg'], 1).nutrition.calories < 40);
});
