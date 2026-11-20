// Ideas from studying other apps (in Nourish's own way): repeating snacks, a week's calorie budget
// that counts what was really eaten, cook mode (timers and each step's ingredients) and a pantry.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../foodlog.js');
const PL = require('../planner.js');
const G = require('../grocery.js');

const coffee = () => L.manual('Coffee with milk', 40, { protein_g: 2, carbs_g: 3, fat_g: 2 });

test('a repeating snack is logged by itself on its days, once, and stays off a day it was taken off', () => {
    const log = L.empty();
    L.setRepeat(log, coffee(), L.WEEKDAYS_ONLY, '2026-11-16');
    assert.equal(L.repeatLabel(L.WEEKDAYS_ONLY), 'Weekdays');
    assert.equal(L.repeatLabel(L.EVERY_DAY), 'Every day');
    // Monday (weekday 0): added once, however often the day is opened.
    assert.equal(L.applyRepeats(log, '2026-11-16', 0).length, 1);
    assert.equal(L.applyRepeats(log, '2026-11-16', 0).length, 0);
    assert.equal(log.days['2026-11-16'].items.length, 1);
    // Saturday: not a weekday.
    assert.equal(L.applyRepeats(log, '2026-11-21', 5).length, 0);
    // Taken off Tuesday's log: it doesn't come back that day.
    L.applyRepeats(log, '2026-11-17', 1);
    const id = log.days['2026-11-17'].items[0].id;
    L.remove(log, '2026-11-17', id);
    assert.equal(L.applyRepeats(log, '2026-11-17', 1).length, 0);
    // Never before the day it was set up.
    assert.equal(L.applyRepeats(log, '2026-11-09', 0).length, 0);
    // It survives a save and load (clean), and turning it off stops it.
    const back = L.clean(JSON.parse(JSON.stringify(log)));
    assert.equal(back.repeats.length, 1);
    assert.ok(L.repeatOf(back, coffee()));
    assert.deepEqual(back.days['2026-11-17'].repeated, log.days['2026-11-17'].repeated);
    L.setRepeat(back, coffee(), []);
    assert.equal(L.repeatOf(back, coffee()), null);
    assert.equal(L.applyRepeats(back, '2026-11-18', 2).length, 0);
});

test('setting a repeat on something already logged today counts that as today\'s', () => {
    const log = L.empty();
    L.add(log, '2026-11-19', coffee());
    L.setRepeat(log, coffee(), L.EVERY_DAY, '2026-11-19');
    assert.equal(L.applyRepeats(log, '2026-11-19', 3).length, 0);
    assert.equal(log.days['2026-11-19'].items.length, 1);
});

const meal = kcal => ({ name: `Meal ${kcal}`, nutrition: { calories: kcal, protein_g: 30, carbs_g: 50, fat_g: 20 } });
const planDay = () => ({ breakfast: meal(500), lunch: meal(700), dinner: meal(800) });

test('the week\'s budget counts snacks and skipped meals, and says when it\'s within range', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ target: 2000, planDay: planDay(), entry: null, when: i < 3 ? 'past' : i === 3 ? 'today' : 'future' }));
    let b = L.weekBalance(days);
    assert.equal(b.budget, 14000);
    assert.equal(b.status, 'on-track');
    assert.deepEqual(b.range, [13300, 14700]);
    // A 900 kcal night of snacks on Tuesday and pizza on top today.
    days[1].entry = { items: [{ nutrition: { calories: 900 } }], meals: {} };
    days[3].entry = { items: [{ nutrition: { calories: 400 } }], meals: { breakfast: 'eaten' } };
    b = L.weekBalance(days);
    assert.equal(b.diff, 1300);
    assert.equal(b.extras, 1300);
    assert.equal(b.status, 'over');
    assert.deepEqual(b.futureDays, [4, 5, 6]);
    assert.equal(b.perFutureDay, -433);
    // A skipped dinner brings it back towards the budget.
    days[2].entry = { items: [], meals: { dinner: 'skipped' } };
    b = L.weekBalance(days);
    assert.equal(b.diff, 500);
    assert.equal(b.skipped, 800);
    assert.equal(b.status, 'on-track');
});

test('spreading the difference over the days to come resizes portions, within 75–115% of each day', () => {
    const recipe = kcal => ({ name: `Dish ${kcal}`, servings: 1, ingredients: ['200 g chicken breast', '1 cup cooked rice', '1 tbsp olive oil'], steps: ['Cook.', 'Serve.'], nutrition: { calories: kcal, protein_g: 40, carbs_g: 45, fat_g: 15 } });
    const day = () => ({ breakfast: recipe(500), lunch: recipe(700), dinner: recipe(800) });
    const days = [day(), day(), day(), day()];
    const r = PL.spreadOver(days, { idxs: [2, 3], targets: [2000, 2000, 2000, 2000], change: -600, settings: { calorie_target: 2000 } });
    assert.deepEqual(r.targets, [2000, 2000, 1700, 1700]);
    assert.equal(r.applied, -600);
    assert.equal(r.left, 0);
    assert.equal(r.days[0], days[0], 'days that have passed are left alone');
    assert.ok(PL.dayTotals(r.days[2]).kcal < PL.dayTotals(days[2]).kcal, 'smaller portions');
    assert.equal(r.days[2].dinner.name, days[2].dinner.name, 'the same recipes');
    // A huge overshoot is capped at 75% a day; what's left over is reported, not forced.
    const big = PL.spreadOver(days, { idxs: [3], targets: [2000, 2000, 2000, 2000], change: -3000, settings: { calorie_target: 2000 } });
    assert.equal(big.targets[3], 1500);
    assert.equal(big.left, -2500);
});

test('cook mode: timers from a step\'s words, and the ingredients each step uses', () => {
    assert.deepEqual(PL.stepTimers('Simmer for 20 minutes until thick.'), [{ seconds: 1200, label: '20 min' }]);
    assert.deepEqual(PL.stepTimers('Bake 25–30 min, then rest 5 minutes.').map(t => t.label), ['25 min (to 30 min)', '5 min']);
    assert.equal(PL.stepTimers('Roast for 1 hour 15 minutes.')[0].seconds, 4500);
    assert.equal(PL.stepTimers('Whisk for 30 seconds.')[0].seconds, 30);
    assert.equal(PL.stepTimers('Cook for a minute.')[0].seconds, 60);
    assert.deepEqual(PL.stepTimers('Marinate overnight.'), []);
    assert.deepEqual(PL.stepTimers('Let the dough rise for 2 days.'), []);
    const ing = ['9 oz sirloin steak', '1/4 cup low-sodium soy sauce', '1 tsp honey', '1 clove garlic', '1 tsp grated fresh ginger', '1/3 cup jasmine rice', '1 cucumber', '2 green onions', '1 tsp sesame seeds'];
    const used = s => PL.stepIngredients(ing, s).map(i => ing[i]);
    assert.deepEqual(used('Cook the rice following the packet.'), ['1/3 cup jasmine rice']);
    assert.deepEqual(used('Marinate the steak in the soy sauce, honey, garlic and ginger.'), ing.slice(0, 5));
    assert.deepEqual(used('Slice the cucumber and green onions.'), ['1 cucumber', '2 green onions']);
    assert.deepEqual(used('Serve.'), []);
    // The step says the family, the list names the cut.
    assert.deepEqual(used('Thinly slice the beef.'), ['9 oz sirloin steak']);
});

test('the pantry keeps staples off the shopping list, including more specific names', () => {
    const pantry = G.pantryList('Salt, olive oil\nsoy sauce;  black pepper ');
    assert.deepEqual(pantry, ['salt', 'olive oil', 'soy sauce', 'black pepper']);
    assert.ok(G.inPantry('kosher salt', pantry));
    assert.ok(G.inPantry('low-sodium soy sauce', pantry));
    assert.ok(!G.inPantry('salted butter', pantry));
    assert.ok(!G.inPantry('jasmine rice', pantry));
    assert.ok(!G.inPantry('sesame oil', pantry), 'olive oil is not every oil');
    const rows = G.buildList([{ dinner: { ingredients: ['1 tsp kosher salt', '1 cup jasmine rice', '2 tbsp extra virgin olive oil', '200 g chicken breast'] } }], ['dinner'], 'metric');
    const { buy, have } = G.splitPantry(rows, pantry);
    assert.deepEqual(buy.map(r => r.key), ['jasmine rice', 'chicken breast']);
    assert.deepEqual(have.map(r => r.key), ['kosher salt', 'olive oil']);
    assert.ok(G.PANTRY_STARTER.includes('salt'));
    // "A pinch of salt" is salt, not a separate item called "pinch salt".
    assert.equal(G.parseIngredient('a pinch of salt').key, 'salt');
    assert.equal(G.parseIngredient('dash of soy sauce').key, 'soy sauce');
    assert.equal(G.parseIngredient('pinch cinnamon').key, 'cinnamon');
});

test('a share of something counted reads as one: 1 cucumber, not 1 cucumbers', () => {
    const r = { name: 'Bowl', servings: 4, ingredients: ['2 cucumbers', '2 carrots', '3 green onions', '2 tomatoes', '4 cherries', '2 cups spinach'], steps: ['Mix.'] };
    const lines = PL.scaleRecipe(r, 1, 1).ingredients;
    assert.deepEqual(lines.slice(0, 5), ['½ cucumber', '½ carrot', '1 green onion', '½ tomato', '1 cherry']);
    assert.equal(lines[5], '½ cup spinach');
    assert.equal(PL.scaleRecipe(r, 4, 1).ingredients[0], '2 cucumbers', 'more than one stays plural');
});
