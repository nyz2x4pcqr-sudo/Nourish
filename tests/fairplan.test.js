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
