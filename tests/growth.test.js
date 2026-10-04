// The web library grows (finder.js "grow"): the 0.1.9 background refresh read 0 pages because it
// asked for the same first page of results as the plans, all already in the library. And Nourish's
// own recipes are a backup by default: web and library recipes fill the plan first.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finder.js');
const PL = require('../planner.js');
const S = require('../sources.js');
const B = require('../builtins.js');

const page = (name, cat) => JSON.stringify({ name, servings: 2, category: [cat], time_minutes: 20,
    ingredients: ['8 oz chicken breast', '1 cup cooked rice', '1 cup broccoli', '1 tbsp soy sauce', '1/2 tsp salt', '2 cloves garlic'],
    steps: ['Cook the chicken in a hot pan for 6 minutes a side.', 'Steam the broccoli for 4 minutes.', 'Toss everything with the soy sauce and garlic and serve over the rice.'] });

test('the background refresh reads the next page of results when the first is already in the library', async () => {
    const site = { id: 'growsite', name: 'Grow Site', domain: 'grow-recipes.com', status: 'ok', find: ['wp'], search: 'wp' };
    S.SITES.push(site);
    const store = {};
    const cache = { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } };
    const dishes = ['Chicken', 'Beef', 'Pork', 'Tofu', 'Shrimp', 'Turkey', 'Salmon', 'Lentil', 'Bean', 'Chickpea'];
    const fetchPage = async url => {
        const u = new URL(url);
        if (u.pathname === '/robots.txt') return { status: 404, body: '' };
        if (u.pathname.endsWith('/categories')) return { status: 200, url, body: '[]' };
        if (u.pathname === '/wp-json/wp/v2/posts') {
            const p = Number(u.searchParams.get('page') || 1);
            const q = (u.searchParams.get('search') || 'x').replace(/\W+/g, '-');
            return { status: 200, url, body: JSON.stringify(dishes.slice(0, 3).map((d, i) => ({ link: `https://grow-recipes.com/${q}-${d.toLowerCase()}-${p}-${i}/`, title: { rendered: `${d} ${q} Rice Bowl ${p}${i}` } }))) };
        }
        const m = u.pathname.match(/^\/(.+)-(\w+)-(\d+)-(\d)\/$/);
        if (m) return { status: 200, url, body: page(`${m[2]} ${m[1]} Rice Bowl ${'ABCDEFGHIJ'[m[3]]}${'KLMNOPQRST'[m[4]]}`, 'Main Course') };
        return { status: 404, body: '' };
    };
    const o = { settings: {}, days: 7, enabled: id => id === site.id, fetchPage, readRecipe: b => { try { return JSON.parse(b); } catch (e) { return null; } }, cache, grow: true, limits: { seconds: 10, searches: 4, pages: 6, parallel: 1 } };
    try {
        const first = await F.findRecipes(o);
        const lib1 = Object.keys(cache.get(F.CACHE.recipes) || {}).length;
        const second = await F.findRecipes(o);
        const lib2 = Object.keys(cache.get(F.CACHE.recipes) || {}).length;
        assert.ok(first.stats.pages > 0 && second.stats.pages > 0, `pages read: ${first.stats.pages}, then ${second.stats.pages}`);
        assert.ok(lib2 > lib1, `the library grew from ${lib1} to ${lib2}`);
    } finally { S.SITES.splice(S.SITES.indexOf(site), 1); }
});

test('Nourish recipes are a backup: with enough web recipes, a plan uses none; "Mix in" uses some; "Off" none at all', () => {
    // A pool of web recipes for every meal (from the built-in set, relabelled as eight websites: at most 3 meals a week come from any one source, so 8 sites cover 21 meals).
    const web = m => B.forMeal(m).map((r, i) => Object.assign(JSON.parse(JSON.stringify(r)), { source_id: `site${i % 8}`, builtin: undefined, name: r.name }));
    const own = m => B.forMeal(m).slice(0, 30).map(r => Object.assign(JSON.parse(JSON.stringify(r)), { name: 'Nourish ' + r.name }));
    const pools = Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(m => [m, web(m).concat(own(m))]));
    const count = mode => PL.planWeek({ pools, settings: { calorie_target: 1800, protein_target: 110, builtin_mode: mode }, days: 7 })
        .days.flatMap(d => ['breakfast', 'lunch', 'dinner'].map(m => d[m])).filter(r => r && r.source_id === 'builtin').length;
    assert.equal(count('backup'), 0);
    assert.ok(count('mix') > 0);
    // Off: finder leaves them out of the pool altogether.
    return F.findRecipes({ settings: { builtin_mode: 'off' }, days: 7, enabled: () => true, fetchPage: async () => ({ status: 403 }), readRecipe: () => null, offline: true })
        .then(res => assert.ok(!res.pools.breakfast.concat(res.pools.lunch, res.pools.dinner).some(r => r.source_id === 'builtin')));
});

test('a plan still tries a few fresh searches when the library already covers every meal (0.1.10 searched nothing)', async () => {
    const site = { id: 'freshsite', name: 'Fresh Site', domain: 'fresh-recipes.com', status: 'ok', find: ['wp'], search: 'wp' };
    S.SITES.push(site);
    const store = {};
    const cache = { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } };
    // A library that already holds plenty for every meal.
    const lib = {};
    const kinds = [['Breakfast', 'Egg Scramble'], ['Lunch', 'Chicken Salad Bowl'], ['Main Course', 'Beef Stir Fry']];
    const words = ['Smoky', 'Herby', 'Spicy', 'Lemony', 'Garlicky', 'Gingery', 'Zesty', 'Golden', 'Crispy', 'Saucy', 'Rustic', 'Sunny', 'Bright', 'Cozy', 'Fiery', 'Tangy', 'Savory', 'Toasty', 'Fresh', 'Classic', 'Hearty', 'Simple', 'Quick', 'Easy'];
    kinds.forEach(([cat, dish], k) => words.forEach((w, i) => {
        const r = JSON.parse(page(`${w} ${dish}`, cat));
        if (k === 0) { r.ingredients = ['3 large eggs', '1 slice whole wheat bread', '1/2 avocado', '1 tsp olive oil', '1/4 tsp salt', '1 cup spinach']; r.steps = ['Whisk the eggs with the salt.', 'Scramble them in the oil with the spinach for 3 minutes.', 'Serve with the toast and avocado.']; }
        const url = `https://fresh-recipes.com/saved-${k}-${i}/`;
        lib[url] = { at: Date.now(), r: F.tidy(Object.assign(r, { source_url: url, source_name: 'Fresh Site' }), site) };
    }));
    store[F.CACHE.recipes] = JSON.stringify(lib);
    const asked = [];
    const fetchPage = async url => {
        const u = new URL(url);
        if (u.pathname === '/robots.txt') return { status: 404, body: '' };
        if (u.pathname.endsWith('/categories')) return { status: 200, url, body: '[]' };
        if (u.pathname === '/wp-json/wp/v2/posts') { asked.push(url); return { status: 200, url, body: '[]' }; }
        return { status: 404, body: '' };
    };
    try {
        const res = await F.findRecipes({ settings: {}, days: 7, enabled: id => id === site.id, fetchPage, readRecipe: () => null, cache, limits: { seconds: 10 } });
        assert.ok(res.stats.fromCache >= 60, `library: ${res.stats.fromCache}`);
        assert.ok(res.stats.searches >= 3 && res.stats.searches <= 6, `searches: ${res.stats.searches}`);
    } finally { S.SITES.splice(S.SITES.indexOf(site), 1); }
});

test('TheMealDB: the same searches are asked once, then kept for 3 days', async () => {
    const store = {};
    const cache = { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } };
    let calls = 0;
    const api = async path => { if (path === '/api/recipes/themealdb') { calls++; return { meals: [] }; } throw new Error('no'); };
    const o = { settings: {}, days: 7, enabled: id => id === 'themealdb', fetchPage: async () => ({ status: 404, body: '' }), readRecipe: () => null, cache, api, limits: { seconds: 5 } };
    await F.findRecipes(o);
    await F.findRecipes(o);
    await F.findRecipes(o);
    assert.equal(calls, 1);
});
