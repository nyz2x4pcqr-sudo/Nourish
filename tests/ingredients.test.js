// 0.1.12: ingredient lines the calculator couldn't read (8 recipes were turned away for it, every
// one from Diabetes Food Hub). Metric amounts, British names, ranges, "to taste", fractions, brand
// and packaged items; amounts shown in the chosen units; a recipe kept (nutrition marked
// approximate) when only small things can't be read.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const U = require('../units.js');
const F = require('../finder.js');

const grams = line => { const r = N.readLine(line, 1); assert.ok(r && !r.unmatched, `not read: ${line}`); return Math.round(r.grams); };

test('metric amounts, British names, ranges and brand or packaged items are read', () => {
    assert.equal(grams('300g swede, peeled and diced'), 300);
    assert.equal(grams('150g pot natural yoghurt'), 150);
    assert.equal(grams('1 aubergine, cut into chunks') > 200, true);
    assert.equal(grams('2 courgettes, sliced') > 200, true);
    assert.equal(grams('1.5kg potatoes'), 1500);
    assert.equal(grams('250ml semi-skimmed milk') > 240, true);
    assert.equal(grams('2 tbsp crème fraîche'), 30);
    assert.equal(grams('1 x 400g tin chickpeas, drained'), 400);
    assert.equal(grams('1 (15-oz.) can no-salt-added black beans, rinsed'), 425);
    assert.equal(grams('1/4 cup fat-free, reduced-sodium chicken broth') > 50, true);
    assert.equal(grams('1 Tbsp. Smart Balance spread'), 14);
    assert.equal(grams('Juice of 1 lemon'), 45);
    assert.equal(grams('200-250 g chicken breast'), 225, 'a range counts as its middle');
    assert.equal(grams('1½ tbsp honey') > 20, true);
    for (const free of ['salt and black pepper, to taste', 'small bunch coriander, chopped', '1 tsp Splenda Granulated Sweetener', '2 Tbsp. stevia', '1 tsp Mrs. Dash', 'nonstick cooking spray', 'Zest of 1 lime']) {
        const r = N.readLine(free, 1);
        assert.ok(r && !r.unmatched, free);
    }
});

test('metric amounts are shown in the chosen units, and ranges keep both ends', () => {
    assert.equal(U.formatIngredient('300g swede, peeled', 'imperial'), '11 oz swede, peeled');
    assert.equal(U.formatIngredient('250ml stock', 'imperial'), '1 cup stock');
    assert.equal(U.formatIngredient('2-3 garlic cloves', 'imperial'), '2–3 garlic cloves');
    assert.equal(U.formatIngredient('200-250g chicken', 'imperial'), '7–9 oz chicken');
    assert.equal(U.formatIngredient('1 x 400g tin chickpeas', 'imperial'), '1 x 14 oz tin chickpeas');
    assert.equal(U.formatIngredient('2 cups rice', 'metric'), '480 ml rice');
});

test('a recipe is kept, nutrition marked approximate, when only small things can\'t be read', async () => {
    const page = (name, ingredients) => ({ name, servings: 2, ingredients, steps: ['Cook the chicken in a pan for 10 minutes, then add everything else and simmer for 5 minutes.'] });
    const kept = page('Garlic Chicken with Greens', ['2 chicken breasts', '1 tbsp olive oil', '2 cloves garlic', '200g spinach', '1/2 tsp za\'atar blend from my shop', '1 tsp salt', 'a few edible flowers, to decorate']);
    const bad = page('Mystery Bowl', ['2 cups frobnicated quux', '300 g blarg', '1 lb zorp', '1 tsp salt', '2 cloves garlic']);
    const res = await F.findRecipes({ settings: { calorie_target: 1800 }, days: 1, enabled: id => id === 'library', library: async () => [Object.assign({ source_name: 'Test' }, kept), Object.assign({ source_name: 'Test' }, bad)],
        cache: { get: () => null, set: () => {} }, fetchPage: async () => ({ status: 404, body: '' }), readRecipe: () => null, limits: { seconds: 5, searches: 0, pages: 0, parallel: 1 } });
    const all = [].concat(res.pools.lunch, res.pools.dinner);
    const chicken = all.find(r => r.name === 'Garlic Chicken with Greens');
    assert.ok(chicken, 'kept');
    assert.ok(chicken.nutrition_approximate);
    assert.ok(!all.some(r => r.name === 'Mystery Bowl'), 'real amounts of food it can\'t read: turned away');
    assert.ok(res.stats.unread.some(l => /2 cups frobnicated quux/.test(l)), 'the failing lines are logged word for word');
});
