// The ways of finding recipes on a site (finder.js): WordPress search with fallbacks, the site's
// search page, its category pages, its sitemap read a part at a time, and its RSS feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finder.js');

const recipePage = (name, cat = 'Main Course') => JSON.stringify({ name, servings: 2, category: [cat], time_minutes: 20,
    ingredients: ['8 oz chicken breast', '1 cup cooked rice', '1 cup broccoli', '1 tbsp soy sauce', '1/2 tsp salt', '2 cloves garlic'],
    steps: ['Cook the chicken in a hot pan for 6 minutes a side.', 'Steam the broccoli for 4 minutes.', 'Toss everything with the soy sauce and garlic and serve over the rice.'] });
function site(extra) { return Object.assign({ id: 'testsite', name: 'Test Site', domain: 'example-recipes.com', status: 'ok' }, extra); }
function run(siteDef, routes, more = {}) {
    const calls = [];
    const store = {};
    const fetchPage = async url => {
        calls.push(url);
        for (const [re, body] of routes) if (re.test(url)) return typeof body === 'function' ? body(url) : { status: 200, url, body };
        return { status: 404, body: '' };
    };
    const S = require('../sources.js');
    S.SITES.push(siteDef);
    const cache = { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } };
    const o = Object.assign({ settings: { calorie_target: 1800 }, days: 2, enabled: id => id === siteDef.id, fetchPage, readRecipe: b => { try { return JSON.parse(b); } catch (e) { return null; } }, cache, limits: { seconds: 10 } }, more);
    return { calls, store, go: () => F.findRecipes(o), done: () => S.SITES.splice(S.SITES.indexOf(siteDef), 1) };
}

test('a search page: recipe links are read from the results, then each recipe page', async () => {
    const s = site({ find: ['page'], searchUrl: 'https://example-recipes.com/search?q={q}', recipePath: '^/recipe/' });
    const html = '<a href="/recipe/garlic-chicken-rice/">Garlic Chicken Rice</a><a href="/about-us/">About</a><a href="/recipe/broccoli-chicken-bowl">Broccoli Chicken Bowl</a>';
    const r = run(s, [[/search\?q=/, html], [/\/recipe\/garlic/, recipePage('Garlic Chicken Rice')], [/\/recipe\/broccoli/, recipePage('Broccoli Chicken Bowl')]]);
    try {
        const res = await r.go();
        assert.ok(res.pools.dinner.some(x => x.name === 'Garlic Chicken Rice'), JSON.stringify(res.stats.perSource));
        assert.ok(!r.calls.some(u => /about-us/.test(u)));
    } finally { r.done(); }
});

test('category pages are browsed by meal, and a feed is read', async () => {
    const s = site({ id: 'cats', find: ['category', 'rss'], categories: { dinner: ['/recipes/dinner/'] }, feed: 'https://example-recipes.com/feed/', recipePath: '^/recipe/' });
    const r = run(s, [[/\/recipes\/dinner\//, '<a href="/recipe/lemon-chicken-skillet/">Lemon Chicken Skillet</a>'], [/\/recipe\/lemon/, recipePage('Lemon Chicken Skillet')],
        [/\/feed\//, '<rss><channel><item><title>Garlic Shrimp Bowl</title><link>https://example-recipes.com/recipe/garlic-shrimp-bowl/</link></item></channel></rss>'], [/\/recipe\/garlic-shrimp/, recipePage('Garlic Shrimp Bowl', 'Lunch')]]);
    try {
        const res = await r.go();
        const names = res.pools.dinner.concat(res.pools.lunch).map(x => x.name);
        assert.ok(names.includes('Lemon Chicken Skillet'), names.join(', '));
        assert.ok(r.calls.some(u => /\/feed\//.test(u)), 'the feed is used when a meal has no category page');
    } finally { r.done(); }
});

test('a sitemap is read a part at a time: the index once, then one more part per run', async () => {
    const parts = Array.from({ length: 4 }, (_, i) => `https://example-recipes.com/sitemap-recipes-${i + 1}.xml`);
    const s = site({ id: 'maps', find: ['sitemap'], sitemap: 'https://example-recipes.com/sitemap.xml', recipePath: '^/recipe/' });
    const r = run(s, [[/sitemap\.xml$/, `<sitemapindex>${parts.map(p => `<sitemap><loc>${p}</loc></sitemap>`).join('')}</sitemapindex>`],
        [/sitemap-recipes-(\d)/, url => ({ status: 200, url, body: `<urlset><url><loc>https://example-recipes.com/recipe/chicken-dish-${url.match(/(\d)\.xml/)[1]}/</loc></url></urlset>` })],
        [/\/recipe\/chicken-dish/, url => ({ status: 200, url, body: recipePage('Chicken Dish ' + url.match(/dish-(\d)/)[1]) })]]);
    try {
        await r.go();
        await r.go();
        const index = r.calls.filter(u => /sitemap\.xml$/.test(u)).length;
        const read = r.calls.filter(u => /sitemap-recipes-/.test(u)).length;
        assert.equal(index, 1, 'the index is read once');
        assert.equal(read, 2, 'one more part per run');
    } finally { r.done(); }
});

test('an empty title search falls back: the whole text, then the main word', async () => {
    const s = site({ id: 'wpfall', find: ['wp'], search: 'wp' });
    const r = run(s, [[/categories\?search/, '[]'],
        [/search_columns=post_title/, '[]'],
        [/search=breakfast%20tacos(?!.*search_columns)/, '[]'],
        [/search=tacos/, JSON.stringify([{ link: 'https://example-recipes.com/egg-breakfast-tacos/', title: { rendered: 'Egg Breakfast Tacos' } }])],
        [/wp-json\/wp\/v2\/posts/, '[]'],
        [/egg-breakfast-tacos/, recipePage('Egg Breakfast Tacos', 'Breakfast')]], { likes: 'breakfast tacos' });
    try {
        assert.equal(F.mainWord('breakfast tacos'), 'tacos');
        const res = await r.go();
        assert.ok(r.calls.some(u => /search=tacos/.test(u)), 'the main word was searched');
        assert.ok(res.pools.breakfast.some(x => x.name === 'Egg Breakfast Tacos'));
    } finally { r.done(); }
});

test('a category page that has moved (404) doesn\'t stop the site: the next page is used and the dead one remembered', async () => {
    const s = site({ id: 'moved', find: ['category'], categories: { dinner: ['/recipes/gone/', '/recipes/dinner/'], lunch: ['/recipes/also-gone/'] }, recipePath: '^/recipe/' });
    const r = run(s, [[/\/recipes\/dinner\//, '<a href="/recipe/lemon-chicken-skillet/">Lemon Chicken Skillet</a><a href="/recipe/garlic-beef-stir-fry/">Garlic Beef Stir Fry</a>'],
        [/\/recipe\/lemon/, recipePage('Lemon Chicken Skillet')], [/\/recipe\/garlic/, recipePage('Garlic Beef Stir Fry')]]);
    try {
        const res = await r.go();
        assert.ok(res.pools.dinner.some(x => x.name === 'Lemon Chicken Skillet'), JSON.stringify(res.stats));
        assert.ok(!res.stats.failed.includes('moved'));
        // The missing page was asked for once, not on every search.
        assert.equal(r.calls.filter(u => /\/recipes\/gone\//.test(u)).length, 1);
    } finally { r.done(); }
});

test('sitemap recipes are named by their dish, not the whole address ("food recipes …" is not a list page)', async () => {
    const s = site({ id: 'bbcish', find: ['sitemap'], sitemap: 'https://example-recipes.com/food/sitemap.xml', recipePath: '^/food/recipes/[a-z0-9_]+$' });
    const urls = ['chicken_and_rice_bowl_31700', 'lemon_chicken_traybake_12'].map(n => `<url><loc>https://example-recipes.com/food/recipes/${n}</loc></url>`).join('');
    const r = run(s, [[/sitemap\.xml/, `<urlset>${urls}</urlset>`], [/chicken_and_rice/, recipePage('Chicken and Rice Bowl')], [/lemon_chicken/, recipePage('Lemon Chicken Traybake')]]);
    try {
        const res = await r.go();
        assert.ok(res.pools.dinner.some(x => x.name === 'Lemon Chicken Traybake' || x.name === 'Chicken and Rice Bowl'), JSON.stringify(res.stats));
    } finally { r.done(); }
});
