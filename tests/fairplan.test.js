// 0.1.12: no source dominates a plan, and meals fit the goal. A barbecue book gave 5 of 21 meals in
// one plan, including "A5 Wagyu Ribeye" on a 1,500 kcal weight-loss plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');
const B = require('../builtins.js');
const N = require('../nutrition.js');

const MEALS = ['breakfast', 'lunch', 'dinner'];
const settled = r => N.settle(r);
// A barbecue book full of rich dinners and lunches, next to recipes from several sites.
const BBQ = ['Smoked Brisket Sandwich', 'Pulled Pork Platter', 'Beef Short Ribs', 'Smoked Sausage Plate', 'Pork Belly Burnt Ends', 'Ribeye Steak with Butter', 'Smoked Chicken Thighs', 'Carnitas Bowl']
    .map((name, i) => settled({ name, servings: 4, from_book: true, book: 'Guga', book_id: 'guga', source_id: 'library',
        ingredients: [`2 lb ${['brisket', 'pork shoulder', 'beef short ribs', 'smoked sausage', 'pork belly', 'ribeye steak', 'chicken thighs', 'pork shoulder'][i]}`, '2 tbsp olive oil', '1 tsp salt', '1 tsp black pepper', '1 tsp smoked paprika', '1 onion'],
        steps: ['Season the meat with the salt, pepper and paprika.', 'Smoke or roast until tender, about 2 hours, then rest and slice.'], time_minutes: 40 }));
function pools() {
    const web = m => B.forMeal(m).map((r, i) => Object.assign(JSON.parse(JSON.stringify(r)), { source_id: `site${i % 9}`, builtin: undefined }));
    return { breakfast: web('breakfast'), lunch: web('lunch').concat(BBQ.map(r => JSON.parse(JSON.stringify(r)))), dinner: web('dinner').concat(BBQ.map(r => JSON.parse(JSON.stringify(r)))) };
}
const picks = plan => plan.days.flatMap(d => MEALS.map(m => d[m])).filter(Boolean);

test('no single source gives more than 3 meals a week (a book, a site, or Nourish\'s own recipes)', () => {
    for (const goal of ['Maintain', 'Gain']) {
        const plan = PL.planWeek({ pools: pools(), settings: { calorie_target: 2600, protein_target: 150, goal }, days: 7 });
        const per = {};
        picks(plan).forEach(r => { const k = PL.sourceKey(r); per[k] = (per[k] || 0) + 1; });
        assert.ok(Object.values(per).every(n => n <= 3), JSON.stringify(per));
        assert.equal(PL.sourceKey(BBQ[0]), 'book:guga');
    }
    // Raised in Advanced: more from one source is allowed.
    const many = PL.planWeek({ pools: pools(), settings: { calorie_target: 2600, protein_target: 150, source_cap: 21 }, days: 7 });
    assert.ok(picks(many).length >= 21);
});

test('losing weight: leaner, lighter dishes first; a rich dish that only fits by shrinking a lot is the wrong dish', () => {
    const plan = PL.planWeek({ pools: pools(), settings: { calorie_target: 1500, protein_target: 110, goal: 'Cut' }, days: 7 });
    const bbq = picks(plan).filter(r => r.book === 'Guga');
    assert.ok(bbq.length <= 1, `rich barbecue dishes on a weight-loss plan: ${bbq.map(r => r.name).join(', ')}`);
    // The cost for the goal: a heavy shrink and a fatty cut both count against a dish.
    const ribeye = BBQ.find(r => /Ribeye/.test(r.name));
    assert.ok(PL.goalCost(ribeye, 0.6, 'Cut') > 2);
    assert.ok(PL.goalCost({ name: 'Lemon Cod with Greens', ingredients: ['2 cod fillets'], nutrition: { calories: 400, fat_g: 8 } }, 1, 'Cut') < 0);
    assert.equal(PL.goalCost(ribeye, 0.6, 'Maintain'), 0);
});

test('luxury or hard-to-find ingredients are skipped by default; Budget skips pricier ones too; No limit keeps all', () => {
    const wagyu = { name: 'A5 Wagyu Ribeye', ingredients: ['1 lb A5 wagyu ribeye', '1 tsp salt'] };
    const truffle = { name: 'Mushroom Pasta', ingredients: ['8 oz pasta', '1 tbsp truffle oil'] };
    const scallops = { name: 'Seared Scallops with Peas', ingredients: ['12 scallops', '2 cups peas'] };
    const chicken = { name: 'Lemon Chicken', ingredients: ['2 chicken breasts', '1 lemon'] };
    assert.match(PL.budgetProblem(wagyu, 'normal'), /luxury.*(wagyu|a5)/);
    assert.match(PL.budgetProblem(truffle, 'normal'), /truffle/);
    assert.equal(PL.budgetProblem(scallops, 'normal'), '');
    assert.match(PL.budgetProblem(scallops, 'budget'), /pricier.*scallops/);
    assert.equal(PL.budgetProblem(chicken, 'budget'), '');
    assert.equal(PL.budgetProblem(wagyu, 'any'), '');
    assert.equal(PL.budgetProblem({ name: 'Chocolate Truffle Cake', ingredients: ['200 g chocolate'] }, 'normal'), '');
});

test('the plan finder leaves luxury dishes out of the pool and says so', async () => {
    const F = require('../finder.js');
    const lib = [Object.assign({ source_name: 'Guga' }, { name: 'A5 Wagyu Ribeye', servings: 2, ingredients: ['1 lb A5 wagyu ribeye', '1 tbsp butter', '1 tsp salt', '1 tsp black pepper', '2 cloves garlic'], steps: ['Season the steak and sear it in a hot pan for 3 minutes a side, then rest it.'] })];
    const res = await F.planFromSources({ settings: { calorie_target: 1500, protein_target: 110 }, goal: 'Cut', days: 1, enabled: id => id === 'library' || id === 'builtin', library: async () => lib,
        cache: { get: () => null, set: () => {} }, fetchPage: async () => ({ status: 404 }), readRecipe: () => null, offline: true });
    assert.ok(!res.pools.dinner.some(r => /Wagyu/.test(r.name)));
    assert.ok(res.stats.budget.some(l => /A5 Wagyu Ribeye: a luxury/.test(l)));
});

test('a big week where only one site has dinners big enough: a smaller dinner from another site, not that site\'s 4th', () => {
    // The 0.1.15 plan audit's 3,200 kcal week took a 4th dinner from one site.
    const big = ['Chicken Burrito Platter', 'Beef Lasagne', 'Pork Ramen', 'Lamb Pilaf', 'Turkey Chili Bake', 'Salmon Rice Bake', 'Steak Fajita Plate']
        .map((name, i) => settled({ name, servings: 1, source_id: 'bigsite', time_minutes: 30,
            ingredients: [`12 oz ${['chicken breast', 'lean beef mince', 'pork loin', 'lamb leg', 'turkey mince', 'salmon fillet', 'sirloin steak'][i]}`, '1.5 cups cooked white rice', '1 tbsp olive oil', '1 onion', '1 cup broccoli', '1/2 tsp salt'],
            steps: ['Cook the rice.', 'Cook the meat and vegetables in the oil for 12 minutes and serve with the rice.'] }));
    // Every other site's dinners are light (under 400 kcal): too small for an 1,100 kcal dinner even at 1½.
    const small = ['Lemon Cod with Greens', 'Tofu Stir Fry', 'Chicken Lettuce Cups', 'Shrimp Zucchini Noodles', 'Turkey Vegetable Soup', 'Egg Fried Cauliflower Rice', 'Bean and Kale Stew', 'Chicken and Pepper Skewers', 'Miso Salmon Greens', 'Prawn Tomato Bowl']
        .map((name, i) => settled({ name, servings: 1, source_id: `site${i % 5}`, time_minutes: 20,
            ingredients: [`6 oz ${['cod fillet', 'firm tofu', 'chicken breast', 'shrimp', 'turkey mince', 'eggs', 'canned cannellini beans', 'chicken breast', 'salmon fillet', 'prawns'][i]}`, '2 cups spinach', '1/2 cup cooked white rice', '2 tsp olive oil', '1/2 onion', '1/4 tsp salt'],
            steps: ['Cook the onion in the oil for 3 minutes.', 'Add the rest and cook for 8 minutes, then serve.'] }));
    const p = pools();
    p.dinner = big.concat(small);
    const plan = PL.planWeek({ pools: p, settings: { calorie_target: 3200, protein_target: 170, goal: 'Gain' }, days: 7 });
    const per = {};
    picks(plan).forEach(r => { const k = PL.sourceKey(r); per[k] = (per[k] || 0) + 1; });
    assert.ok((per.bigsite || 0) <= 3, JSON.stringify(per));
    assert.equal(plan.days.filter(d => d.dinner).length, 7);
});

test('the week plans ahead: a site the later dinners depend on is not spent on breakfasts and lunches', () => {
    // 0.1.15's plan audit: a 3,200 kcal week took a 4th meal from one site. Only three sites have
    // dinners big enough; "maven" also has tempting breakfasts and lunches, which used up its 3
    // meals before the week's last dinners.
    const dinner = (name, src, meat) => settled({ name, servings: 1, source_id: src, time_minutes: 30,
        ingredients: [`10 oz ${meat}`, '2 cups cooked white rice', '1.5 tbsp olive oil', '1 onion', '1 cup broccoli', '1/2 tsp salt'],
        steps: ['Cook the rice.', 'Cook the meat and vegetables in the oil for 12 minutes and serve with the rice.'] });
    const dinners = [['Maven Chicken Rice Bowl', 'maven', 'chicken breast'], ['Maven Beef Rice Plate', 'maven', 'lean beef mince'], ['Maven Turkey Rice', 'maven', 'turkey mince'],
        ['Pork Fried Rice Plate', 'sitea', 'pork loin'], ['Salmon Rice Supper', 'sitea', 'salmon fillet'],
        ['Steak and Rice', 'siteb', 'sirloin steak'], ['Lamb Rice Pilaf', 'siteb', 'lamb leg']].map(x => dinner(...x));
    const maven = (name, meal, food) => settled({ name, servings: 1, source_id: 'maven', time_minutes: 10,
        ingredients: food, steps: ['Mix everything together.', 'Serve.'] });
    const p = pools();
    p.breakfast = p.breakfast.concat(['Maven Protein Oats', 'Maven Yogurt Bowl', 'Maven Egg Plate'].map((n, i) => maven(n, 'breakfast',
        [['1.5 cups rolled oats', '2 cups milk', '2 scoops whey protein', '1 banana'], ['2 cups greek yogurt', '1 cup granola', '1 cup berries', '2 tbsp honey'], ['4 eggs', '2 slices whole wheat bread', '1 avocado', '1 cup milk']][i])));
    p.lunch = p.lunch.filter(r => !r.from_book).concat(['Maven Chicken Wrap', 'Maven Tuna Bowl'].map((n, i) => maven(n, 'lunch',
        [['8 oz chicken breast', '2 large flour tortillas', '1 cup cooked rice', '1/2 cup cheddar cheese'], ['2 cans tuna', '2 cups cooked brown rice', '1 avocado', '1 tbsp olive oil']][i])));
    p.dinner = dinners;
    const plan = PL.planWeek({ pools: p, settings: { calorie_target: 3200, protein_target: 170, goal: 'Gain' }, days: 7 });
    const per = {};
    picks(plan).forEach(r => { const k = PL.sourceKey(r); per[k] = (per[k] || 0) + 1; });
    const week = plan.days.map(d => MEALS.map(m => (d[m] ? `${PL.sourceKey(d[m])}: ${d[m].name}` : '-')).join(' | ')).join('\n');
    assert.ok(Object.entries(per).every(([k, n]) => n <= 3 || k === 'builtin'), `${JSON.stringify(per)}\n${week}`);
    assert.equal(plan.days.filter(d => d.dinner).length, 7, `every day has a dinner\n${week}`);
});
