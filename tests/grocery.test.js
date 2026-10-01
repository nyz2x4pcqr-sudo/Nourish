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
