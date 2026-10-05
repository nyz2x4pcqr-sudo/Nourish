// 0.1.14: recipes are cooked as written, protein comes from choosing, and meals are meals.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');
const N = require('../nutrition.js');
const F = require('../finder.js');

const recipe = (name, ingredients, servings = 2) => { const r = { name, servings, ingredients, steps: ['Cook it.'] }; N.settle(r); return r; };
const fit = (name, ingredients, servings) => PL.mealFit(recipe(name, ingredients, servings));

test('drinks are never meals, whatever the name: Chocomil, horchata, a latte (0.1.13 planned Chocomil as breakfast)', () => {
    assert.match(fit('Chocomil (Mexican Chocolate Milk)', ['4 cups whole milk', '1/2 cup chocolate syrup', '1 tsp cinnamon']).why, /drink/);
    assert.match(fit('Horchata', ['1 cup rice', '4 cups water', '1/2 cup sugar', '1 tsp cinnamon']).why, /drink/);
    assert.match(fit('Iced Vanilla Latte', ['1 cup milk', '2 shots espresso', '1 tbsp vanilla syrup']).why, /drink/);
    // Mostly milk or juice, whatever it's called.
    assert.match(fit('Cinnamon Dream', ['3 cups milk', '1 tbsp honey', '1 tsp cinnamon']).why, /drink/);
    // A soup is mostly liquid too, and still a meal.
    assert.ok(fit('Red Lentil Soup', ['1 cup red lentils', '6 cups water', '1 onion', '2 carrots', '1 tsp cumin']).lunch);
});

test('sides are never meals: a baked sweet potato, rice, roasted vegetables (0.1.13 planned "Easy Baked Sweet Potato" as lunch)', () => {
    for (const [name, ings] of [['Easy Baked Sweet Potato', ['2 sweet potatoes', '1 tbsp butter']], ['Cilantro Lime Rice', ['2 cups rice', '1 lime']],
        ['Roasted Vegetables', ['2 zucchini', '1 bell pepper', '2 tbsp olive oil']], ['Garlic Butter Green Beans', ['1 lb green beans', '2 tbsp butter']]]) {
        const f = fit(name, ings);
        assert.ok(!f.breakfast && !f.lunch && !f.dinner, name);
    }
    // Stuffed or with a protein, it's a meal.
    assert.ok(fit('Loaded Baked Sweet Potato with Black Beans', ['2 sweet potatoes', '1 can black beans', '1/2 cup greek yogurt', '1/2 cup cheddar']).lunch);
    assert.ok(fit('Chicken and Rice', ['1 lb chicken breast', '2 cups rice']).dinner);
});

test('egg dishes go where people eat them: scrambles and huevos rancheros at breakfast, never dinner', () => {
    const huevos = fit('Huevos Rancheros', ['4 eggs', '4 corn tortillas', '1 cup salsa', '1 can black beans']);
    assert.ok(huevos.breakfast && !huevos.lunch && !huevos.dinner);
    const scramble = fit('Spinach Egg Scramble', ['4 eggs', '2 cups spinach', '1 tbsp butter']);
    assert.ok(scramble.breakfast && !scramble.dinner);
    const shakshuka = fit('Shakshuka', ['6 eggs', '1 can crushed tomatoes', '1 onion', '1 bell pepper']);
    assert.ok(shakshuka.breakfast && shakshuka.lunch && !shakshuka.dinner);
    // Egg fried rice is a rice dish.
    assert.ok(fit('Egg Fried Rice', ['3 cups cooked rice', '3 eggs', '1 cup peas', '2 tbsp soy sauce']).dinner);
});

test('a plan never changes a recipe: the same foods as written, portions ¾ to 1½, at most two protein extras', () => {
    const B = require('../builtins.js');
    const pools = Object.fromEntries(PL.MEALS.map(m => [m, B.forMeal(m).map(r => Object.assign(JSON.parse(JSON.stringify(r)), { builtin: undefined, source_id: `site${r.name.length % 9}` }))]));
    pools.breakfast.forEach(N.settle); pools.lunch.forEach(N.settle); pools.dinner.forEach(N.settle);
    const original = name => PL.MEALS.flatMap(m => pools[m]).find(r => r.name === name);
    const s = { calorie_target: 1500, protein_target: 150 };
    const plan = PL.planWeek({ pools, settings: s, days: 7 });
    plan.days.forEach((d, i) => {
        PL.MEALS.forEach(m => {
            const r = d[m];
            assert.deepEqual(PL.ingredientFoods(r), PL.ingredientFoods(original(r.name)), `day ${i + 1} ${m} ${r.name}`);
            const p = r.scaled ? r.scaled.portion : 1;
            assert.ok(p >= 0.75 && p <= 1.5, `day ${i + 1} ${m}: ${p}`);
        });
        assert.ok((d.snacks || []).filter(x => x.protein_extra).length <= 2);
        const t = PL.dayTotals(d);
        if (t.protein < 150 * 0.97) assert.equal(d.protein_gap.have, Math.round(t.protein));
    });
    // Protein-dense recipes are chosen: the week's meals average well above a typical 20% of calories.
    const meals = plan.days.flatMap(d => PL.MEALS.map(m => d[m]));
    const share = meals.reduce((a, r) => a + r.nutrition.protein_g * 4, 0) / meals.reduce((a, r) => a + r.nutrition.calories, 0);
    assert.ok(share > 0.25, `${Math.round(share * 100)}% of calories from protein`);
});

test('a high protein target searches for high-protein recipes on purpose', () => {
    const high = F.queriesFor('breakfast', { settings: { calorie_target: 1500, protein_target: 150 } }, 0);
    assert.ok(high.slice(0, 4).some(q => /protein|egg white|cottage|greek yogurt/.test(q)), high.slice(0, 6).join(', '));
    const normal = F.queriesFor('breakfast', { settings: { calorie_target: 2200, protein_target: 90 } }, 0);
    assert.ok(!normal.slice(0, 4).some(q => /high protein/.test(q)));
});

test('tofu: a block is 14 oz, and calcium is what supermarket tofu has (0.1.13 credited a tofu dish with 1,830 mg more)', () => {
    const block = N.calculate(['1 block extra firm tofu'], 1);
    assert.equal(block.lines[0].grams, 396);
    assert.ok(block.nutrition.micros.ca < 1000, `${block.nutrition.micros.ca} mg`);
});
