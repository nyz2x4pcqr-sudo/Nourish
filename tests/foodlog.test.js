// The food log (foodlog.js): plain words → USDA-based estimates, amounts, the per-day log and totals.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../foodlog.js');

const one = t => { const r = L.parse(t); assert.equal(r.length, 1, t); return r[0]; };
const near = (got, want, pct, msg) => assert.ok(Math.abs(got - want) / want <= pct, `${msg || ''} ${got} not within ${pct * 100}% of ${want}`);

test('plain words become items with USDA-based calories', () => {
    const pizza = one('2 slices pepperoni pizza');
    assert.equal(pizza.amount, 2);
    assert.equal(pizza.unit, 'slice');
    near(pizza.nutrition.calories, 590, 0.15, 'pizza');
    assert.equal(pizza.estimate, true);
    const [banana, coffee, cream] = L.parse('a banana and a coffee with cream');
    near(banana.nutrition.calories, 105, 0.1, 'banana');
    assert.ok(coffee.nutrition.calories < 10);
    assert.equal(cream.unit, 'splash');
    assert.ok(cream.nutrition.calories > 10 && cream.nutrition.calories < 60);
    near(one('a can of coke').nutrition.calories, 155, 0.1, 'coke');
    near(one('a beer').nutrition.calories, 153, 0.1, 'beer');
    near(one('3 chicken nuggets').grams, 48, 0.2, 'nuggets');
    assert.equal(one('2 shots of vodka').unit, 'shot');
    assert.equal(one('200 g greek yogurt').grams, 200);
});

test('something not in the table is marked unmatched, not guessed', () => {
    assert.equal(one('a slice of quiche lorraine').unmatched, true);
    assert.equal(one('mac and cheese').unmatched || one('mac and cheese').key === 'mac and cheese', true);
});

test('changing the amount changes the numbers', () => {
    const p = one('1 slice pizza');
    const three = L.setAmount(p, 3);
    assert.equal(three.grams, p.grams * 3);
    near(three.nutrition.calories, p.nutrition.calories * 3, 0.02);
    const mine = L.manual('Grandma cookie', 120);
    assert.equal(L.setAmount(mine, 2).nutrition.calories, 240);
});

test('search finds foods by name and other names', () => {
    assert.ok(L.search('pizz').some(i => /pizza/i.test(i.name)));
    assert.ok(L.search('coke').length > 0);
    assert.deepEqual(L.search('x'), []);
});

test('Open Food Facts products and barcodes become items per serving', () => {
    const it = L.fromOpenFoodFacts({ product_name: 'Oat Bar', brands: 'Acme, Other', serving_quantity: 40, serving_size: '40 g', nutriments: { 'energy-kcal_100g': 400, proteins_100g: 8, carbohydrates_100g: 60, fat_100g: 14 } }, '0123');
    assert.equal(it.name, 'Oat Bar (Acme)');
    assert.equal(it.nutrition.calories, 160);
    assert.equal(it.barcode, '0123');
    assert.equal(L.fromOpenFoodFacts({ product_name: 'Nothing', nutriments: {} }), null);
});

test('the log keeps days, recents and favorites; totals follow eaten and skipped meals', () => {
    const log = L.empty();
    const day = L.dayKey(new Date(2026, 9, 3));
    assert.equal(day, '2026-10-03');
    const a = L.add(log, day, one('a banana'));
    L.add(log, day, one('a beer'));
    assert.equal(log.recents.length, 2);
    assert.equal(log.recents[0].name, 'Beer');
    L.add(log, day, one('a banana'));
    assert.equal(log.recents.length, 2, 'recents are not repeated');
    L.remove(log, day, a.id);
    assert.equal(log.days[day].items.length, 2);
    assert.equal(L.toggleFavorite(log, a), true);
    assert.equal(L.isFavorite(log, a), true);
    const plan = { breakfast: { nutrition: { calories: 400, protein_g: 20, carbs_g: 50, fat_g: 10 } }, lunch: { nutrition: { calories: 500, protein_g: 30, carbs_g: 50, fat_g: 15 } },
        dinner: { nutrition: { calories: 600, protein_g: 40, carbs_g: 60, fat_g: 20 } }, snacks: [{ nutrition: { calories: 150, protein_g: 5, carbs_g: 20, fat_g: 5 } }] };
    L.setMeal(log, day, 'breakfast', 'eaten');
    L.setMeal(log, day, 'lunch', 'skipped');
    const t = L.totals(plan, log.days[day]);
    const extras = log.days[day].items.reduce((s, x) => s + x.nutrition.calories, 0);
    assert.equal(t.extras.calories, extras);
    assert.equal(t.planned.calories, 400 + 600 + 150 + extras);
    assert.equal(t.eaten.calories, 400 + extras);
    assert.equal(t.openMeals, 2);
    L.setMeal(log, day, 'lunch', null);
    assert.equal(log.days[day].meals.lunch, undefined);
    const cleaned = L.clean(JSON.parse(JSON.stringify(log)));
    assert.equal(cleaned.days[day].items.length, 2);
    assert.equal(L.clean({ days: { nonsense: {} } }).days.nonsense, undefined);
});
