// Nutrition from ingredients (nutrition.js), likes/avoids (prefs.js) and building the week (planner.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const P = require('../prefs.js');
const PL = require('../planner.js');

const near = (got, want, pct) => assert.ok(Math.abs(got - want) / want <= pct, `${got} not within ${pct * 100}% of ${want}`);

test('nutrition is calculated from ingredients with the bundled USDA table', () => {
    near(N.calculate(['1/2 cup rolled oats'], 1).nutrition.calories, 150, 0.1);
    near(N.calculate(['2 tbsp olive oil'], 1).nutrition.calories, 240, 0.05);
    near(N.calculate(['1 lb boneless skinless chicken breast'], 1).nutrition.protein_g, 102, 0.05);
    near(N.calculate(['200 g Greek yogurt'], 1).nutrition.calories, 118, 0.1);
    assert.equal(N.calculate(['salt and pepper to taste'], 1).nutrition.calories, 0);
    const r = N.calculate(['2 tbsp olive oil', '1 cup unicorn dust'], 2);
    near(r.nutrition.calories, 120, 0.05);
    assert.deepEqual(r.unmatched, ['1 cup unicorn dust']);
    assert.equal(r.approximate, true);
});

test('source nutrition is kept when close and replaced when it is more than 15% off', () => {
    const base = { servings: 1, ingredients: ['2 tbsp olive oil', '1 lb boneless skinless chicken breast'] };
    const close = N.settle(Object.assign({ nutrition: { calories: 800, protein_g: 100, carbs_g: 0, fat_g: 40 } }, base));
    assert.equal(close.nutrition_basis, 'source');
    const off = N.settle(Object.assign({ nutrition: { calories: 400, protein_g: 50, carbs_g: 0, fat_g: 5 } }, base));
    assert.equal(off.nutrition_basis, 'calculated');
    near(off.nutrition.calories, 783, 0.05);
});

test('"All food" and friends mean no restriction, never a search for "all"', () => {
    for (const t of ['All food', 'all', 'everything', 'anything', 'whatever', '', '  ']) {
        assert.equal(P.parse(t).any, true, t);
        assert.deepEqual(P.searchTerms(t), [], t);
    }
});

test('likes understand typos, plurals, lists and sentences', () => {
    assert.deepEqual(P.parse('chiken, broccolli and rice').terms, ['chicken', 'broccoli', 'rice']);
    assert.deepEqual(P.parse('I love salmon and tacos').terms, ['salmon', 'tacos']);
    assert.ok(P.searchTerms('I like chicken, thai food and brocoli').includes('broccoli'));
});

test('avoids and allergies are hard exclusions that include related foods', () => {
    const ex = P.excluder({ avoid: 'cucumbers', allergies: 'peanuts', diet: 'Vegetarian' });
    assert.ok(ex({ name: 'Burger', ingredients: ['4 dill pickle slices'] }));
    assert.ok(ex({ name: 'Bowl', ingredients: ['1/2 cup tzatziki'] }));
    assert.ok(ex({ name: 'Noodles', ingredients: ['2 tbsp peanut butter'] }));
    assert.ok(ex({ name: 'Salad', ingredients: ['1 chicken breast'] }));
    assert.equal(ex({ name: 'Eggplant parmesan', ingredients: ['1 eggplant', '1/2 cup parmesan'] }), null);
    const ok = P.excluder({ avoid: 'cucumber, pickles are fine', allergies: '', diet: '' });
    assert.equal(ok({ name: 'x', ingredients: ['2 pickles'] }), null);
    assert.ok(ok({ name: 'x', ingredients: ['1 cucumber'] }));
});

test('meal types: no lamb chops for breakfast, no oats for dinner, no cake at all', () => {
    const lamb = PL.mealFit({ name: 'Lamb Chops with Asparagus', ingredients: ['4 lamb chops', '1 lb asparagus'] });
    assert.equal(lamb.breakfast, false);
    assert.equal(lamb.dinner, true);
    const oats = PL.mealFit({ name: 'Overnight Oats', ingredients: ['1 cup oats', '1 cup milk'] });
    assert.equal(oats.breakfast, true);
    assert.equal(oats.dinner, false);
    const cake = PL.mealFit({ name: 'Chocolate Cake', ingredients: ['2 cups flour', '1 cup sugar'] });
    assert.deepEqual([cake.breakfast, cake.lunch, cake.dinner], [false, false, false]);
});

test('dish names are spell-checked', () => {
    assert.equal(PL.fixName('Chiken Shashis Tikka Masla'), 'Chicken Shashlik Tikka Masala');
    assert.equal(PL.fixName('Sticky Sesame Chicken Thighs'), 'Sticky Sesame Chicken Thighs');
    assert.equal(PL.fixName('Brocolli Cheddar Soup'), 'Broccoli Cheddar Soup');
});

test('bland savory recipes are re-seasoned with amounts, including salt', () => {
    const r = { name: 'Plain Chicken and Rice', servings: 2, ingredients: ['1 lb chicken breast', '1 cup rice', '1 tbsp olive oil'], steps: ['Cook the chicken.', 'Cook the rice.'] };
    assert.equal(PL.flavorCheck(r).ok, false);
    PL.reseason(r);
    assert.ok(r.reseasoned && r.reseasoned.length);
    assert.ok(r.ingredients.some(l => /^\S+ (tsp|teaspoons?) .*salt/i.test(l)), r.ingredients.join('; '));
    assert.equal(PL.flavorCheck(r).ok, true);
});

test('trimming calories cuts oil and sugar, never seasoning', () => {
    const r = { name: 'x', servings: 1, ingredients: ['1/4 cup olive oil', '2 tbsp sugar', '1 tsp salt', '1 tsp cumin', '1 lb chicken breast'], steps: [] };
    PL.trimRich(r, 400);
    assert.ok(r.ingredients.includes('1 tsp salt'));
    assert.ok(r.ingredients.includes('1 tsp cumin'));
    assert.ok(!r.ingredients.includes('1/4 cup olive oil'));
});

test('calorie split: bigger dinner by default, other choices and custom', () => {
    assert.deepEqual(PL.splitOf({}), [0.25, 0.3, 0.45]);
    assert.deepEqual(PL.splitOf({ calorie_split: 'even' }), [0.33, 0.33, 0.34]);
    assert.deepEqual(PL.splitOf({ calorie_split: 'breakfast' }), [0.4, 0.3, 0.3]);
    assert.deepEqual(PL.splitOf({ calorie_split: 'custom', split_breakfast: 20, split_lunch: 40, split_dinner: 40 }), [0.2, 0.4, 0.4]);
});

const mk = (name, ingredients, servings = 2) => N.settle({ name, servings, ingredients, steps: ['Cook.'] });
const POOL = [
    mk('Lamb Chops with Asparagus', ['4 lamb chops', '1 lb asparagus', '2 tbsp olive oil', '1 tsp salt', '2 cloves garlic', '1 tsp rosemary']),
    mk('Overnight Oats with Berries', ['1 cup rolled oats', '1 cup milk', '1 cup blueberries', '2 tbsp honey', '1/4 tsp salt']),
    mk('Spinach Feta Omelette', ['4 large eggs', '2 cups spinach', '1/4 cup feta', '1 tsp olive oil', '1/4 tsp salt', '1/4 tsp black pepper']),
    mk('Greek Yogurt Parfait', ['2 cups greek yogurt', '1/2 cup granola', '1 cup strawberries', '1 tbsp honey']),
    mk('Chicken Quinoa Bowl', ['1 lb chicken breast', '1 cup quinoa', '1 cucumber', '1 cup cherry tomatoes', '1 tbsp olive oil', '1 tsp salt', '1 lemon', '1 tsp oregano']),
    mk('Salmon with Asparagus', ['12 oz salmon', '1 lb asparagus', '1 tbsp olive oil', '1/2 tsp salt', '1 lemon', '2 cloves garlic']),
    mk('Black Bean Tacos', ['1 can black beans', '6 corn tortillas', '1 avocado', '1/2 cup salsa', '1 tsp cumin', '1/2 tsp salt', '1 lime']),
    mk('Thai Basil Chicken', ['1 lb ground chicken', '2 tbsp fish sauce', '1 tbsp soy sauce', '1 cup basil', '2 cloves garlic', '1 cup jasmine rice', '1 bell pepper', '1 tbsp oil']),
    mk('Lentil Soup', ['1 cup lentils', '1 carrot', '1 onion', '2 cloves garlic', '4 cups vegetable broth', '1 tsp cumin', '1 tsp salt', '1 tbsp olive oil']),
    mk('Shrimp Stir Fry', ['1 lb shrimp', '2 cups broccoli', '2 tbsp soy sauce', '1 tbsp ginger', '1 tbsp sesame oil', '1 cup brown rice']),
    mk('Turkey Chili', ['1 lb ground turkey', '1 can kidney beans', '1 can diced tomatoes', '1 onion', '1 tbsp chili powder', '1 tsp salt', '1 tsp cumin']),
    mk('Tofu Curry', ['14 oz tofu', '1 can coconut milk', '2 tbsp curry paste', '2 cups spinach', '1 cup rice', '1/2 tsp salt']),
    mk('Beef Bolognese', ['1 lb lean ground beef', '8 oz spaghetti', '1 can crushed tomatoes', '1 onion', '2 cloves garlic', '1 tsp salt', '1 tsp oregano', '1/4 cup parmesan']),
    mk('Egg and Avocado Toast', ['2 slices whole wheat bread', '2 large eggs', '1 avocado', '1/4 tsp salt', '1/4 tsp chili flakes']),
    mk('Cottage Cheese Pancakes', ['1 cup cottage cheese', '2 large eggs', '1/2 cup oat flour', '1 cup raspberries', 'pinch of salt']),
];
const pools = Object.fromEntries(PL.MEALS.map(m => [m, POOL.filter(r => PL.mealFit(r)[m])]));

test('each planned day lands within 5% of the calorie target, with variety', () => {
    for (const [kcal, days] of [[1500, 4], [2400, 3]]) {
        const res = PL.planWeek({ pools, settings: { calorie_target: kcal, protein_target: 110 }, days, people: 1 });
        assert.equal(res.missing.length, 0);
        const seen = new Set();
        res.days.forEach((day, i) => {
            near(res.report[i].kcal, kcal, 0.05);
            assert.ok(res.report[i].fat <= res.targets.fat * 1.5, `day ${i} fat ${res.report[i].fat}`);
            const meals = PL.MEALS.map(m => day[m]);
            assert.ok(!/lamb/i.test(day.breakfast.name));
            const prots = meals.map(PL.mainProtein).filter(Boolean);
            assert.equal(new Set(prots).size, prots.length, `day ${i} repeats a protein: ${prots}`);
            const vegs = meals.map(PL.mainVeg).filter(Boolean);
            assert.equal(new Set(vegs).size, vegs.length, `day ${i} repeats a vegetable: ${vegs}`);
            meals.forEach(r => { assert.ok(!seen.has(r.name), `${r.name} twice in the week`); seen.add(r.name); });
        });
    }
});

test('when the recipes run out, the empty slot is reported (for the AI to fill) instead of reusing a dish', () => {
    const res = PL.planWeek({ pools, settings: { calorie_target: 2400 }, days: 6, people: 1 });
    assert.ok(res.missing.length > 0);
    assert.ok(res.missing.every(m => m.kcal > 0 && PL.MEALS.includes(m.meal)));
    const names = res.days.flatMap(d => PL.MEALS.map(m => d[m] && d[m].name).filter(Boolean));
    assert.equal(new Set(names).size, names.length);
});

test('portion sizing lowers the numbers even when an amount can\'t be scaled', () => {
    const r = N.settle({ name: 'Herby Bean Bowl', servings: 1, steps: ['Cook.'], ingredients: ['a handful of spinach', '1 can chickpeas', '2 tbsp olive oil', '1 tsp salt', '1 lemon'] });
    const half = PL.scaleRecipe(r, 0.5, 1);
    near(half.nutrition.calories, r.nutrition.calories / 2, 0.02);
    assert.equal(half.scaled.portion, 0.5);
});

test('breads, snack bars and sauces are not meals', () => {
    ['Cheese, Garlic and Herb Quick Bread (no yeast)', 'High Protein Granola Bars', 'Easy Pesto Sauce'].forEach(name => {
        const f = PL.mealFit({ name, ingredients: ['1 cup flour', '1 cup oats'] });
        assert.deepEqual([f.breakfast, f.lunch, f.dinner], [false, false, false], name);
    });
});

test('optional snacks fit inside the day, and meals can be switched off', () => {
    const res = PL.planWeek({ pools, settings: { calorie_target: 1800, protein_target: 110, snacks_per_day: '2' }, days: 3, people: 1 });
    res.days.forEach((day, i) => {
        assert.equal(day.snacks.length, 2);
        assert.notEqual(day.snacks[0].name, day.snacks[1].name);
        near(PL.dayTotals(day).kcal, 1800, 0.05);
        day.snacks.forEach(s => near(s.nutrition.calories, 180, 0.35));
    });
    assert.notEqual(res.days[0].snacks[0].name, res.days[1].snacks[0].name, 'the same snack every day');
    const noNuts = PL.planWeek({ pools, settings: { calorie_target: 1800, snacks_per_day: '3' }, days: 4, exclude: require('../prefs.js').excluder({ avoid: 'nuts', allergies: 'peanuts', diet: '' }) });
    noNuts.days.forEach(d => d.snacks.forEach(s => assert.ok(!/almond|peanut|pistachio|trail mix/i.test(s.name + s.ingredients.join(' ')), s.name)));
    const twoMeals = PL.planWeek({ pools, settings: { calorie_target: 1600, meal_slots: 'lunch,dinner' }, days: 2 });
    twoMeals.days.forEach(day => { assert.equal(day.breakfast, undefined); near(PL.dayTotals(day).kcal, 1600, 0.05); });
    assert.ok(!twoMeals.missing.some(m => m.meal === 'breakfast'));
    assert.deepEqual(PL.splitOf({ meal_slots: 'lunch,dinner' }).map(x => Math.round(x * 100)), [0, 40, 60]);
    assert.deepEqual(PL.splitOf({ snacks_per_day: '1' }).map(x => Math.round(x * 1000)), [225, 270, 405]);
});
