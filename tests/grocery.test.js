// The shopping list: junk the AI made up is dropped, the same thing to buy becomes one row.
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../grocery.js');

test('junk ingredient lines are recognised', () => {
    for (const junk of ['ingredients', 'steps', 'Description', 'use 1 cup', 'use 2 large', 'description of 2 eggs, 1/4 cup avocado, 3 tbsp flour, 1',
        'Add salt', 'soak the beans', 'mix well', '1', 'ab', '½ ¼']) {
        assert.ok(g.junkReason(junk), `should be junk: ${junk}`);
    }
    for (const ok of ['2 large eggs', '1/2 cup fresh spinach', 'chicken breast: 3 oz cooked', 'Salt to taste', 'Butter', '1 tomato, diced']) {
        assert.equal(g.junkReason(ok), '', `should be fine: ${ok}`);
    }
});

test('amounts are read from the start of a line', () => {
    assert.deepEqual(g.parseIngredient('1/2 cup fresh spinach'), { name: 'spinach', key: 'spinach', qty: 0.5, unit: 'cup' });
    assert.deepEqual(g.parseIngredient('1 1/2 cups rolled oats'), { name: 'rolled oats', key: 'rolled oat', qty: 1.5, unit: 'cup' });
    assert.deepEqual(g.parseIngredient('½ cup grilled chicken breast'), { name: 'chicken breast', key: 'chicken breast', qty: 0.5, unit: 'cup' });
    assert.deepEqual(g.parseIngredient('chicken breast: 3 oz cooked'), { name: 'chicken breast', key: 'chicken breast', qty: 3, unit: 'oz' });
    assert.deepEqual(g.parseIngredient('2 large eggs, beaten'), { name: 'eggs', key: 'egg', qty: 2, unit: '' });
});

test('a week of meals becomes one merged list without junk', () => {
    const meal = ingredients => ({ name: 'x', ingredients });
    const day = (b, l, d) => ({ breakfast: meal(b), lunch: meal(l), dinner: meal(d) });
    const days = [
        day(['2 large eggs', 'ingredients', 'use 2 large', '1/2 cup fresh spinach'], ['chicken breast: 3 oz cooked', '1 tbsp olive oil'], ['3 tomatoes', '2 cloves garlic, minced']),
        day(['4 eggs', '1 cup spinach'], ['½ cup grilled chicken breast', '2 tbsp extra virgin olive oil'], ['1 tomato, diced', '1 clove garlic']),
        day(['description of 2 eggs, 1/4 cup mashed avocado, 3 tbsp corn flour, 2 tbsp yogurt, 1', '2 eggs'], ['Salt to taste'], ['Salt']),
    ];
    const rows = g.buildList(days);
    const text = rows.map(r => r.text);
    assert.deepEqual(text, ['Eggs ×8', 'Spinach — 1½ cups', 'Chicken breast — 3 oz + ½ cup', 'Olive oil — 3 tbsp', 'Tomatoes ×4', 'Garlic — 3 cloves', 'Salt ×2']);
    assert.ok(!text.some(t => /ingredients|use |description|, 1$/i.test(t)), text.join(' | '));
    assert.equal(rows.find(r => r.key === 'egg').category, 'Protein');
});

test('aisles: words inside other names don\'t pick the wrong aisle', () => {
    const cases = { 'almond butter': 'Pantry', 'peanut butter': 'Pantry', 'coconut milk': 'Pantry', 'oat milk': 'Pantry', 'eggplant': 'Produce',
        'green bean': 'Produce', 'butternut squash': 'Produce', 'butter': 'Dairy', 'milk': 'Dairy', 'egg': 'Protein', 'black bean': 'Protein' };
    for (const [name, aisle] of Object.entries(cases)) assert.equal(g.categorize(name), aisle, name);
});

test('units: kitchen rounding, text inside steps, both directions, caps', () => {
    const u = require('../units.js');
    assert.equal(u.formatIngredient('1 cup coconut milk', 'metric'), '240 ml coconut milk');
    assert.equal(u.formatIngredient('1 lb lean beef', 'metric'), '450 g lean beef');
    assert.equal(u.formatIngredient('2 tbsp olive oil', 'metric'), '2 tbsp olive oil');
    assert.equal(u.formatIngredient('550 g chicken breast', 'imperial'), '1¼ lb chicken breast');
    assert.equal(u.formatIngredient('250 ml milk', 'imperial'), '1 cup milk');
    assert.equal(u.formatIngredient('chicken breast: 3 oz cooked', 'metric'), 'chicken breast: 85 g cooked');
    assert.equal(u.convertText('Roast tomatoes at 400°F for 20 minutes.', 'metric'), 'Roast tomatoes at 200°C for 20 minutes.');
    assert.equal(u.convertText('Bake at 350 degrees F.', 'metric'), 'Bake at 180°C.');
    assert.equal(u.convertText('Heat the oven to 180°C.', 'imperial'), 'Heat the oven to 350°F.');
    assert.equal(u.convertText('Cut into 2-inch pieces and add 1/2 cup stock.', 'metric'), 'Cut into 5-cm pieces and add 120 ml stock.');
    assert.equal(u.convertText('Simmer 250 ml stock with 200 g rice.', 'imperial'), 'Simmer 1 cup stock with 7 oz rice.');
    assert.equal(u.convertText('Cook for 10 minutes.', 'metric'), 'Cook for 10 minutes.');
    assert.equal(u.clampIngredient('1 cup green curry paste').line, '2 tbsp green curry paste');
    assert.equal(u.clampIngredient('1/2 cup olive oil').line, '¼ cup olive oil');
    assert.equal(u.clampIngredient('2 tbsp salt').line, '1 tbsp salt');
    assert.equal(u.clampIngredient('3 cups fresh basil').line, '1 cup fresh basil');
    assert.equal(u.clampIngredient('1 cup coconut milk').clamped, '');
    assert.equal(u.defaultSystem('en-US'), 'imperial');
    assert.equal(u.defaultSystem('en-GB'), 'metric');
    assert.equal(u.defaultSystem('nl-NL'), 'metric');
});

test('grocery totals follow the chosen unit system', () => {
    const days = [{ breakfast: { ingredients: ['1 cup milk', '8 oz chicken breast'] }, lunch: { ingredients: ['250 ml milk', '550 g chicken breast'] } }];
    assert.deepEqual(g.buildList(days, ['breakfast', 'lunch'], 'metric').map(r => r.text), ['Milk — 490 ml', 'Chicken breast — 780 g']);
    assert.deepEqual(g.buildList(days, ['breakfast', 'lunch'], 'imperial').map(r => r.text), ['Milk — 2 cups', 'Chicken breast — 1¾ lb']);
    // The same thing twice in ONE recipe is a mistake: only the first line counts.
    assert.deepEqual(g.buildList([{ breakfast: { ingredients: ['1 cup milk', '250 ml milk'] } }], ['breakfast'], 'metric').map(r => r.text), ['Milk — 240 ml']);
});
