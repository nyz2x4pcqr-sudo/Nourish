// The small on-device AI's job (ondevice.js): fixing in code instead of remaking, real dish names
// instead of labels, and small tasks (choose, swap, describe) with tiny answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../ondevice.js');

test('labels, days and people are never dish names; a real name is made from what is in it', () => {
    global.settings = { name: 'Jeff' };
    try {
        for (const bad of ['jeff', 'Lunch for Jeff - Day 7', 'Breakfast for Day 5 (Friday)', 'Breakfast of the Day', 'Healthy Morning Bowl', 'Dinner']) {
            assert.ok(O.nameProblem(bad), bad);
        }
        for (const good of ['Lemon Garlic Salmon with Rice', 'Spinach Feta Omelette', 'Morning Glory Muffins', 'Chicken Tikka Masala']) assert.equal(O.nameProblem(good), '', good);
        const meal = { name: 'Lunch for Jeff - Day 7', servings: 1, ingredients: ['6 oz chicken breast', '1 cup cooked rice', '1 cup broccoli florets', '1 tbsp soy sauce', '1/4 tsp salt', '1 clove garlic'],
            steps: ['Cook the chicken in a pan for 6 minutes a side.', 'Steam the broccoli for 4 minutes.', 'Toss everything with the soy sauce, salt and garlic over the rice and serve.'], time_minutes: 20,
            nutrition: { calories: 9999, protein_g: 1, carbs_g: 1, fat_g: 1 } };
        const fixes = O.repairMeal(meal, 'lunch', {});
        assert.match(meal.name, /chicken/i);
        assert.equal(O.nameProblem(meal.name), '');
        assert.ok(fixes.some(f => /renamed/.test(f)));
        // The AI's numbers are thrown away and worked out from the ingredients.
        assert.ok(meal.nutrition.calories > 200 && meal.nutrition.calories < 800, meal.nutrition.calories);
        assert.equal(meal.nutrition_basis, 'calculated');
    } finally { delete global.settings; }
});

test('description steps go, unused garnish is worked in, a missing serving step is added', () => {
    const meal = { name: 'Chickpea Spinach Curry', servings: 2, time_minutes: 30,
        ingredients: ['1 can chickpeas', '2 cups spinach', '1 cup coconut milk', '1 tbsp curry paste', '1/2 tsp salt', '2 tbsp chopped cilantro'],
        steps: ['This curry is a warming weeknight favourite full of flavour.', 'Simmer the curry paste with the coconut milk for 3 minutes.', 'Add the chickpeas and spinach and cook for 5 minutes with the salt.'] };
    const fixes = O.repairMeal(meal, 'dinner', {});
    assert.ok(!meal.steps.some(s => /^This curry/.test(s)));
    assert.ok(meal.steps.some(s => /cilantro/.test(s)));
    assert.ok(meal.steps.some(s => /serve/i.test(s)));
    assert.ok(fixes.length >= 3, fixes.join(' | '));
});

test('one ingredient or step too many is not a reason to remake; cut off, wrong meal type and avoided foods are', () => {
    assert.deepEqual(O.hardProblems(['9 ingredients is too many for breakfast (at most 8)', '8 steps is too many for lunch (at most 7)', '"lean lamb" has no amount', 'only 3 steps for a 25-minute recipe (needs 4)']), []);
    assert.equal(O.hardProblems(['step 2 is cut off', '"Roast Lamb" is a dinner dish, not breakfast', 'has peanuts, which they avoid', 'takes about 60 min; breakfast has 15 min']).length, 4);
});

test('small jobs: choosing between real recipes and suggesting a swap use tiny answers', async () => {
    const asked = [];
    const run = async (msgs, o) => { asked.push(o); return o.id.startsWith('choose') ? '2' : 'zucchini'; };
    assert.equal(await O.aiChoose(run, 'dinner', ['A', 'B', 'C']), 1);
    assert.equal(await O.aiSubstitute(run, 'Chicken Rice Bowl', 'mushrooms'), 'zucchini');
    assert.ok(asked.every(o => o.maxTokens <= 12 && /root ::=/.test(o.grammar)));
    // A suggestion that is the avoided food itself is refused.
    assert.equal(await O.aiSubstitute(async () => 'mushroom caps', 'X', 'mushrooms'), '');
});
