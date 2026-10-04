// The one smart source (finder.js), against a pretend web: several recipe sites answering WordPress
// searches and serving recipe pages, one site that refuses everything, and TheMealDB.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finder.js');
const PL = require('../planner.js');
const S = require('../sources.js');

const R = (name, ingredients, extra = {}) => Object.assign({ name, ingredients, steps: ['Prep everything.', 'Cook until done.', 'Serve.'], servings: 2 }, extra);
const RECIPES = [
    R('Spinach Feta Omelette', ['4 large eggs', '2 cups spinach', '1/4 cup feta', '1 tsp olive oil', '1/4 tsp salt', '1/4 tsp black pepper']),
    R('Overnight Oats with Berries', ['1 cup rolled oats', '1 cup milk', '1 cup blueberries', '2 tbsp honey', '1/4 tsp salt']),
    R('Greek Yogurt Parfait', ['2 cups greek yogurt', '1/2 cup granola', '1 cup strawberries', '1 tbsp honey']),
    R('Egg and Avocado Toast', ['2 slices whole wheat bread', '2 large eggs', '1 avocado', '1/4 tsp salt', '1/4 tsp chili flakes']),
    R('Cottage Cheese Pancakes', ['1 cup cottage cheese', '2 large eggs', '1/2 cup oat flour', '1 cup raspberries', 'pinch of salt']),
    R('Veggie Breakfast Burrito', ['4 large eggs', '2 flour tortillas', '1/2 cup black beans', '1/4 cup salsa', '1/4 cup cheddar', '1/4 tsp salt']),
    R('Banana Oatmeal', ['1 cup rolled oats', '2 cups milk', '1 banana', '1 tbsp maple syrup', '1/4 tsp cinnamon', 'pinch of salt']),
    R('Smoked Salmon Bagel', ['2 whole wheat bagels', '4 oz smoked salmon', '2 tbsp cream cheese', '1 tbsp capers', '1/4 red onion', '1 tsp dill']),
    R('Chicken Quinoa Bowl', ['1 lb chicken breast', '1 cup quinoa', '1 cucumber', '1 cup cherry tomatoes', '1 tbsp olive oil', '1 tsp salt', '1 lemon', '1 tsp oregano'], { nutrition: { calories: 640, protein_g: 60, carbs_g: 45, fat_g: 20 } }),
    R('Salmon with Asparagus', ['12 oz salmon', '1 lb asparagus', '1 tbsp olive oil', '1/2 tsp salt', '1 lemon', '2 cloves garlic']),
    R('Black Bean Tacos', ['1 can black beans', '6 corn tortillas', '1 avocado', '1/2 cup salsa', '1 tsp cumin', '1/2 tsp salt', '1 lime']),
    R('Thai Basil Chicken', ['1 lb ground chicken', '2 tbsp fish sauce', '1 tbsp soy sauce', '1 cup basil', '2 cloves garlic', '1 cup jasmine rice', '1 bell pepper', '1 tbsp oil']),
    R('Lentil Soup', ['1 cup lentils', '1 carrot', '1 onion', '2 cloves garlic', '4 cups vegetable broth', '1 tsp cumin', '1 tsp salt', '1 tbsp olive oil']),
    R('Shrimp Stir Fry', ['1 lb shrimp', '2 cups broccoli', '2 tbsp soy sauce', '1 tbsp ginger', '1 tbsp sesame oil', '1 cup brown rice']),
    R('Turkey Chili', ['1 lb ground turkey', '1 can kidney beans', '1 can diced tomatoes', '1 onion', '1 tbsp chili powder', '1 tsp salt', '1 tsp cumin']),
    R('Tofu Curry', ['14 oz tofu', '1 can coconut milk', '2 tbsp curry paste', '2 cups spinach', '1 cup rice', '1/2 tsp salt']),
    R('Beef Bolognese', ['1 lb lean ground beef', '8 oz spaghetti', '1 can crushed tomatoes', '1 onion', '2 cloves garlic', '1 tsp salt', '1 tsp oregano', '1/4 cup parmesan']),
    R('Chickpea Salad', ['1 can chickpeas', '1 cup cherry tomatoes', '1/2 red onion', '1/4 cup feta', '2 tbsp olive oil', '1 lemon', '1/2 tsp salt', '1 tsp oregano']),
    R('Pork Tenderloin with Apples', ['1 lb pork tenderloin', '2 apples', '1 onion', '1 tbsp olive oil', '1 tsp salt', '1 tsp thyme', '1 tbsp dijon mustard']),
    R('Cucumber Tuna Salad', ['2 cans tuna', '1 cucumber', '2 tbsp mayonnaise', '1 tbsp dill', '1/2 tsp salt', '1 lemon']),
    R('Pickle Chicken Wraps', ['1 lb chicken breast', '4 tortillas', '1/2 cup dill pickles', '1/4 cup greek yogurt', '1/2 tsp salt', '1 tsp garlic powder']),
    R('Plain Turkey and Rice', ['1 lb turkey breast', '1 cup rice', '1 tbsp olive oil']),
    R('Chocolate Lava Cake', ['1/2 cup butter', '4 oz chocolate', '2 eggs', '1/4 cup sugar']),
    R('Ginger Garlic Cod', ['1 lb cod', '1 tbsp ginger', '2 cloves garlic', '2 tbsp soy sauce', '2 cups bok choy', '1 cup rice']),
    R('Lamb Kofta with Tzatziki', ['1 lb ground lamb', '1 onion', '2 cloves garlic', '1 tsp cumin', '1 tsp salt', '1/2 cup tzatziki', '4 pita']),
    R('Mushroom Barley Soup', ['1 cup barley', '8 oz mushrooms', '1 carrot', '1 onion', '6 cups vegetable broth', '1 tsp thyme', '1 tsp salt']),
];
// Five of the sites in use (sources.js); wellplated plays the one that refuses.
const SITES = ['skinnytaste', 'thehealthymaven', 'cafedelites', 'wellplated', 'recipetineats'];
const slug = s => s.toLowerCase().replace(/[^a-z]+/g, '-');
const PAGES = {};
// Real recipe pages say what meal they are (recipeCategory); every recipe is on two sites (dedupe).
RECIPES.forEach((r, i) => {
    r.category = i < 8 ? ['Breakfast'] : ['Main Course', 'Dinner'];
    [i, i + 2].forEach(k => { const site = S.byId(SITES[k % SITES.length]); PAGES[`https://${site.domain}/${slug(r.name)}/`] = r; });
});

function fakeWeb({ refuse = 'wellplated' } = {}) {
    const calls = [];
    const fetchPage = async url => {
        calls.push(url);
        const u = new URL(url);
        if (u.hostname.indexOf(refuse) >= 0) return { status: 403, body: 'Forbidden' };
        if (u.pathname === '/wp-json/wp/v2/posts') {
            const q = u.searchParams.get('search').toLowerCase().split(' ');
            const hits = Object.keys(PAGES).filter(p => new URL(p).hostname === u.hostname && q.every(w => JSON.stringify(PAGES[p]).toLowerCase().indexOf(w.replace(/s$/, '')) >= 0));
            hits.push(`https://${u.hostname}/25-best-healthy-dinner-ideas/`);
            return { status: 200, body: JSON.stringify(hits.map(link => ({ link, title: { rendered: (PAGES[link] || { name: '25 Best Healthy Dinner Ideas' }).name } }))) };
        }
        if (PAGES[url]) return { status: 200, url, body: JSON.stringify(PAGES[url]) };
        return { status: 404, body: '' };
    };
    const api = async (path, body) => {
        calls.push(path);
        if (path === '/api/recipes/themealdb') return { meals: [{ idMeal: '1', strMeal: 'Chicken Shawarma Plate', strCategory: 'Chicken', strArea: 'Lebanese', strInstructions: 'Mix the spices. Marinate the chicken. Grill it. Serve with the salad.',
            strIngredient1: 'chicken thighs', strMeasure1: '1 lb', strIngredient2: 'garlic', strMeasure2: '3 cloves', strIngredient3: 'cumin', strMeasure3: '1 tsp', strIngredient4: 'salt', strMeasure4: '1 tsp',
            strIngredient5: 'lemon', strMeasure5: '1', strIngredient6: 'pita', strMeasure6: '2' }] };
        throw new Error('not here');
    };
    const store = {};
    const cache = { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } };
    return { calls, fetchPage, api, cache, store };
}
const readRecipe = body => { try { return JSON.parse(body); } catch (e) { return null; } };
const enabled = id => id === 'themealdb' || id === 'library' || SITES.indexOf(id) >= 0;

test('plans a week from several sites at once, skipping the one that refuses', async () => {
    const web = fakeWeb();
    // A fixed day: the searches start at a different word each day, and with this small pretend web
    // some days leave slots for the AI (that's allowed, see plan.missing below).
    const plan = await F.planFromSources({ now: () => Date.UTC(2026, 9, 3, 12), settings: { calorie_target: 1800, protein_target: 110 }, likes: 'All food', avoid: '', days: 3, enabled, readRecipe, fetchPage: web.fetchPage, api: web.api, cache: web.cache });
    const meals = plan.days.flatMap(d => PL.MEALS.map(m => d[m]).filter(Boolean));
    assert.ok(meals.length >= 8, `only ${meals.length} meals`);
    meals.forEach(r => assert.ok(r.source_url && r.source_name, `${r.name} has no source`));
    assert.ok(new Set(meals.map(r => r.source_name)).size >= 3, 'recipes came from only one or two places');
    assert.ok(plan.stats.failed.includes('wellplated'));
    assert.ok(!meals.some(r => /\bcake\b|ideas/i.test(r.name)));
    assert.ok(!web.calls.some(u => /search=all\b/.test(u)), '"All food" was searched for');
    // Complete days hit the target; slots without a good recipe are reported for the AI to write.
    plan.report.forEach((d, i) => { if (PL.MEALS.every(m => plan.days[i][m])) assert.ok(Math.abs(d.kcal - 1800) / 1800 <= 0.05, `day at ${d.kcal} kcal`); });
    assert.equal(plan.missing.length, PL.MEALS.length * 3 - meals.length);
    plan.days.forEach(d => assert.ok(!/lamb/i.test(d.breakfast ? d.breakfast.name : '')));
});

test('avoids are never searched or planned: cucumber also rules out pickles', async () => {
    const web = fakeWeb();
    const res = await F.findRecipes({ settings: { calorie_target: 1800 }, likes: '', avoid: 'cucumber', days: 3, enabled, readRecipe, fetchPage: web.fetchPage, api: web.api, cache: web.cache });
    const all = res.pools.breakfast.concat(res.pools.lunch, res.pools.dinner);
    assert.ok(all.length > 5);
    assert.ok(!all.some(r => /cucumber|pickle/i.test(r.name + r.ingredients.join(' '))));
    assert.ok(!web.calls.some(u => /search=cucumber/.test(u)));
});

test('likes are added to the usual searches, never the only search', () => {
    const q = F.queriesFor('dinner', { likes: 'I love salmon and thai food', settings: {} });
    assert.equal(q[0], 'salmon');
    assert.ok(q.includes('chicken') && q.length > 5);
    const veg = F.queriesFor('dinner', { likes: '', settings: { diet: 'Vegetarian' } });
    assert.ok(!veg.some(x => /chicken|salmon|beef|pork|shrimp|turkey/.test(x)), veg.join(', '));
});

test('a bland recipe is re-seasoned; recipes are cached so the next plan is faster', async () => {
    const web = fakeWeb();
    const first = await F.findRecipes({ settings: {}, likes: 'turkey', avoid: '', days: 3, enabled, readRecipe, fetchPage: web.fetchPage, api: web.api, cache: web.cache });
    const plain = first.pools.dinner.concat(first.pools.lunch).find(r => /plain turkey/i.test(r.name));
    if (plain) assert.ok(plain.reseasoned && plain.ingredients.some(l => /salt/.test(l)));
    const firstCalls = new Set(web.calls.filter(u => /^https:/.test(u)));
    const before = web.calls.length;
    const second = await F.findRecipes({ settings: {}, likes: 'turkey', avoid: '', days: 3, enabled, readRecipe, fetchPage: web.fetchPage, api: web.api, cache: web.cache });
    assert.ok(second.stats.fromCache > 0);
    const again = web.calls.slice(before).filter(u => firstCalls.has(u));
    assert.deepEqual(again, [], 'pages and searches were fetched twice');
});
