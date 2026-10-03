// Honest calories: days aren't forced to the target, portions are realistic and cookable, and the
// numbers come from the ingredients as written (oil, sauces and toppings included).
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const PL = require('../planner.js');

const mk = (name, ingredients, servings = 2, extra = {}) => Object.assign(N.settle({ name, servings, ingredients, steps: ['Prep.', 'Put it together.', 'Serve.'] }), extra);
const POOL = [
    mk('Spinach Feta Omelette', ['4 large eggs', '2 cups spinach', '1/4 cup feta', '1 tsp olive oil', '1/4 tsp salt'], 2, { time_minutes: 10 }),
    mk('Greek Yogurt Parfait', ['2 cups greek yogurt', '1/2 cup granola', '1 cup strawberries', '1 tbsp honey'], 2, { time_minutes: 5 }),
    mk('Overnight Oats with Berries', ['1 cup rolled oats', '1 cup milk', '1 cup blueberries', '2 tbsp honey'], 2, { time_minutes: 5 }),
    mk('Egg and Avocado Toast', ['2 slices whole wheat bread', '2 large eggs', '1 avocado', '1/4 tsp salt'], 2, { time_minutes: 10 }),
    mk('Chicken Quinoa Bowl', ['1 lb chicken breast', '1 cup quinoa', '1 cucumber', '1 tbsp olive oil', '1 tsp salt', '1 lemon'], 2, { time_minutes: 20 }),
    mk('Lentil Soup', ['1 cup lentils', '1 carrot', '1 onion', '4 cups vegetable broth', '1 tsp cumin', '1 tsp salt', '1 tbsp olive oil'], 2, { time_minutes: 20 }),
    mk('Black Bean Tacos', ['1 can black beans', '6 corn tortillas', '1 avocado', '1/2 cup salsa', '1 tsp cumin', '1/2 tsp salt'], 2, { time_minutes: 15 }),
    mk('Salmon with Asparagus', ['12 oz salmon', '1 lb asparagus', '1 tbsp olive oil', '1/2 tsp salt', '1 lemon'], 2, { time_minutes: 25 }),
    mk('Turkey Chili', ['1 lb ground turkey', '1 can kidney beans', '1 can diced tomatoes', '1 onion', '1 tbsp chili powder', '1 tsp salt'], 2, { time_minutes: 40 }),
    mk('Beef Bolognese', ['1 lb lean ground beef', '8 oz spaghetti', '1 can crushed tomatoes', '1 onion', '1 tsp salt', '1/4 cup parmesan'], 2, { time_minutes: 40 }),
    mk('Thai Basil Chicken', ['1 lb ground chicken', '2 tbsp fish sauce', '1 cup basil', '2 cloves garlic', '1 cup jasmine rice', '1 tbsp oil'], 2, { time_minutes: 30 }),
    mk('Tofu Curry', ['14 oz tofu', '1 can coconut milk', '2 tbsp curry paste', '2 cups spinach', '1 cup rice', '1/2 tsp salt'], 2, { time_minutes: 35 }),
];
const pools = Object.fromEntries(PL.MEALS.map(m => [m, POOL.filter(r => PL.mealFit(r)[m])]));

test("days aren't forced to the target: real totals, close to it, and not all the same", () => {
    const totals = [];
    for (const kcal of [1500, 2000]) {
        const res = PL.planWeek({ pools, settings: { calorie_target: kcal, protein_target: 100 }, days: 3, people: 1 });
        res.days.forEach(d => {
            if (!PL.MEALS.every(m => d[m])) return;
            const t = PL.dayTotals(d).kcal;
            totals.push([t, kcal]);
            assert.ok(Math.abs(t - kcal) / kcal <= 0.1, `${t} is more than 10% from ${kcal}`);
            // The day's number is the sum of its meals, each worked out from its own amounts.
            assert.equal(t, PL.MEALS.reduce((s, m) => s + d[m].nutrition.calories, 0));
        });
    }
    assert.ok(totals.length >= 4);
    assert.ok(totals.filter(([t, k]) => t === k).length <= 1, `days forced to the target: ${totals.map(x => x[0])}`);
});

test('portions are realistic: quarter servings, whole eggs, kitchen amounts', () => {
    const res = PL.planWeek({ pools, settings: { calorie_target: 2200, protein_target: 120 }, days: 3, people: 1 });
    res.days.forEach(d => PL.MEALS.forEach(m => {
        const r = d[m];
        if (!r) return;
        if (r.scaled) assert.ok(PL.PORTIONS.includes(r.scaled.portion), `${r.name}: portion ${r.scaled.portion}`);
        r.ingredients.forEach(l => assert.ok(!/(\d*\.\d+|[¼½¾⅓⅔⅛]) (large )?eggs?\b/.test(l), `half an egg: "${l}"`));
        r.ingredients.forEach(l => assert.ok(!/\b0\.\d{2,}|\d\.\d{3}/.test(l), `odd amount: "${l}"`));
    }));
    assert.equal(PL.scaleLine('3 large eggs', 0.6), '2 large eggs');
    assert.equal(PL.scaleLine('1 lb ground chicken', 0.375), '6 oz ground chicken');
    assert.equal(PL.scaleLine('1 cup rice', 0.375), '⅓ cup rice');
    assert.equal(PL.scaleLine('1 tbsp olive oil', 0.75), '2½ tsp olive oil');   // ¾ tbsp = 2¼ tsp, to the nearest ½ tsp
});

test('scaled numbers come from the scaled amounts, not a multiplied target', () => {
    const r = POOL.find(x => /Thai/.test(x.name));
    const three = PL.scaleRecipe(r, 0.75, 1);
    const calc = N.calculate(three.ingredients, 1).nutrition.calories;
    assert.ok(Math.abs(three.nutrition.calories - calc) / calc < 0.1, `${three.nutrition.calories} vs ${calc} from the amounts`);
});

test('oil, sauces and toppings with no amount count with a typical amount, marked as assumed', () => {
    const c = N.calculate(['2 chicken breasts', 'olive oil, for drizzling', 'parmesan to serve', 'oil for frying', 'salt to taste'], 2);
    const by = Object.fromEntries(c.lines.map(l => [l.line, l]));
    assert.ok(by['olive oil, for drizzling'].kcal > 30 && /1 tsp per serving/.test(by['olive oil, for drizzling'].assumed));
    assert.ok(by['parmesan to serve'].kcal > 30);
    assert.ok(by['oil for frying'].kcal > 100, 'frying oil is easy to miss');
    assert.equal(by['salt to taste'].kcal, 0);
    assert.equal(c.assumed.length, 3);
    // Each line carries its own calories, so the breakdown adds up.
    const sum = c.lines.reduce((s, l) => s + l.kcal, 0);
    assert.ok(Math.abs(sum - c.nutrition.calories) <= c.lines.length);
});

test("a site's own numbers are cross-checked and the comparison is kept", () => {
    const close = N.settle({ name: 'x', servings: 1, ingredients: ['6 oz chicken breast', '1 tbsp olive oil'], nutrition: { calories: 330, protein_g: 50, carbs_g: 0, fat_g: 16 } });
    assert.equal(close.nutrition_basis, 'source');
    assert.ok(close.nutrition_check.source === 330 && close.nutrition_check.calculated > 0);
    const far = N.settle({ name: 'y', servings: 1, ingredients: ['6 oz chicken breast', '1 tbsp olive oil'], nutrition: { calories: 150 } });
    assert.equal(far.nutrition_basis, 'calculated');
});
