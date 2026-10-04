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

test('ingredients written name first and split at commas (Diabetes Food Hub) are put back together and read', () => {
    if (typeof global.DOMParser === 'undefined') global.DOMParser = class { parseFromString(h) { const t = String(h).replace(/<[^>]+>/g, ' '); return { body: { textContent: t } }; } };
    const I = require('../importer.js');
    // As the site's recipe data lists them (from the site check's log).
    const site = ['eggs 4.00 large', 'egg whites 6.00 large', 'deli ham 3.00 oz 4 thick slices', 'reduced-sodium', 'chopped', 'onion(s) 0.25 cup diced', 'salt', '0.25 g',
        'asparagus 1.00 lbs about 16 spears', 'trimmed and cut into 2-inch pieces', 'Canned', 'No Sugar Added Mandarin Oranges 15.00 oz drained', 'boneless', 'skinless chicken breasts 2.00 whole cooked and sliced', 'lettuce 8.00 leaves'];
    const lines = I.ingredientLines(site.slice());
    assert.deepEqual(lines, ['4 large eggs', '6 large egg whites', '3 oz deli ham, 4 thick slices, reduced-sodium, chopped', '0.25 cup onion(s), diced', '0.25 g salt',
        '1 lbs asparagus, about 16 spears, trimmed and cut into 2-inch pieces', '15 oz Canned No Sugar Added Mandarin Oranges, drained', '2 whole boneless skinless chicken breasts, cooked and sliced', '8 leaves lettuce']);
    lines.forEach(l => { const r = N.readLine(l, 4); assert.ok(r && !r.unmatched, l); });
    assert.equal(Math.round(N.readLine('8 leaves lettuce', 1).grams), 80);
    // Normal lists are left exactly as they are.
    assert.deepEqual(I.ingredientLines(['1 cup rice', '2 eggs, beaten', 'salt, to taste']), ['1 cup rice', '2 eggs, beaten', 'salt, to taste']);
});
