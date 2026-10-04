// Never the same meal twice: no recipe appears twice in a plan (the same dish from two sites, or
// with a slightly different name, counts as the same), recent plans' dishes are avoided, and a
// short pool is never filled by repeating. Nourish's own recipes (builtins.js) make sure there's
// always enough.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');
const F = require('../finder.js');
const B = require('../builtins.js');
const N = require('../nutrition.js');

const MEALS = ['breakfast', 'lunch', 'dinner'];
const names = plan => plan.days.flatMap(d => MEALS.map(m => d[m] && !d[m].leftover && d[m].name).filter(Boolean));
function assertNoRepeats(plan, label) {
    const list = names(plan);
    list.forEach((a, i) => list.forEach((b, j) => {
        if (j > i) assert.ok(!PL.sameDish(a, b), `${label}: "${a}" and "${b}" are the same meal`);
    }));
}
const noWeb = async () => ({ status: 403, body: 'Forbidden' });
const offline = (extra = {}) => Object.assign({ settings: { calorie_target: 1800, protein_target: 110 }, days: 7, people: 1, fetchPage: noWeb, readRecipe: () => null, now: () => 1e12 }, extra);

test('the same dish from different sites or with small wording changes counts as one', () => {
    assert.ok(PL.sameDish('Gochujang Chicken Bowls', 'Easy Gochujang Chicken Rice Bowl'));
    assert.ok(PL.sameDish('Gochujang Chicken Bowls', 'Chicken Gochujang Bowl'));
    assert.ok(PL.sameDish('Overnight Oats', 'The Best Overnight Oats'));
    assert.ok(PL.sameDish('30-Minute Sheet Pan Chicken Fajitas', 'Chicken Fajitas'));
    assert.ok(!PL.sameDish('Chicken Caesar Salad', 'Chicken Caesar Wrap'));
    assert.ok(!PL.sameDish('Peanut Butter Banana Overnight Oats', 'Strawberry Almond Overnight Oats'));
    const list = PL.dishList(['Gochujang Chicken Bowls']);
    assert.ok(list.has('Korean Gochujang Chicken Bowl'));
    assert.ok(!list.has('Teriyaki Salmon Bowl'));
});

test('several plans in a row: no meal ever repeats within a plan, and the next plan brings new ones', async () => {
    let already = [];
    for (let k = 0; k < 4; k++) {
        const plan = await F.planFromSources(offline({ already, settings: { calorie_target: 1500 + k * 300, protein_target: 100 + k * 10 } }));
        assert.equal(plan.missing.length, 0, `plan ${k + 1} left ${plan.missing.length} meals empty`);
        assertNoRepeats(plan, `plan ${k + 1}`);
        // Two weeks of memory: the next plan avoids this one's dishes.
        const now = names(plan);
        if (k > 0) {
            const again = now.filter(n => PL.dishList(already).has(n));
            assert.ok(again.length <= 2, `plan ${k + 1} brought back ${again.length} recent dishes: ${again.join(', ')}`);
        }
        already = already.concat(now);
    }
});

test('near-duplicates from two sites never both make it into a plan', () => {
    const r = (name, cal, protein) => ({ name, servings: 1, ingredients: ['6 oz chicken breast', '1 cup cooked rice', '1 tbsp gochujang', '1 tsp soy sauce', '1/4 tsp salt', '1 clove garlic'],
        steps: ['Cook the chicken.', 'Serve over the rice.'], time_minutes: 20, category: ['lunch', 'dinner'], nutrition: { calories: cal, protein_g: protein, carbs_g: 50, fat_g: 12 } });
    const dupes = [r('Gochujang Chicken Bowls', 520, 40), r('Easy Gochujang Chicken Rice Bowl', 530, 41), r('Chicken Gochujang Bowl', 510, 39), r('Gochujang Chicken Bowl Recipe', 500, 40)];
    const pools = { breakfast: B.forMeal('breakfast'), lunch: dupes.concat(B.forMeal('lunch')), dinner: dupes.concat(B.forMeal('dinner')) };
    const plan = PL.planWeek({ pools, settings: { calorie_target: 1800, protein_target: 110 }, days: 7 });
    assertNoRepeats(plan, 'dupes');
    assert.ok(names(plan).filter(n => /gochujang chicken|chicken gochujang/i.test(n)).length <= 1);
});

test('a short pool is never filled by repeating: the planner leaves the gap instead', () => {
    const few = { breakfast: B.forMeal('breakfast').slice(0, 3), lunch: B.forMeal('lunch').slice(0, 3), dinner: B.forMeal('dinner').slice(0, 3) };
    const plan = PL.planWeek({ pools: few, settings: { calorie_target: 1800, protein_target: 110 }, days: 7 });
    assertNoRepeats(plan, 'short pool');
    assert.ok(plan.missing.length >= 12, `${plan.missing.length} gaps`);
});

test('"Allow leftovers": a dinner can come back as the next day\'s lunch, and nothing else repeats', () => {
    const pools = { breakfast: B.forMeal('breakfast'), lunch: B.forMeal('lunch'), dinner: B.forMeal('dinner') };
    const plan = PL.planWeek({ pools, settings: { calorie_target: 1800, protein_target: 110, allow_leftovers: 'on' }, days: 7 });
    assertNoRepeats(plan, 'leftovers');
    const leftovers = plan.days.filter(d => d.lunch && d.lunch.leftover);
    assert.ok(leftovers.length >= 1, 'no leftover lunches');
    plan.days.forEach((d, i) => { if (d.lunch && d.lunch.leftover) assert.equal(d.lunch.name, plan.days[i - 1].dinner.name); });
    // Off (the default): never.
    const off = PL.planWeek({ pools, settings: { calorie_target: 1800, protein_target: 110 }, days: 7 });
    assert.ok(!off.days.some(d => d.lunch && d.lunch.leftover));
});

test('the built-in recipes: at least 60 per meal, original names, every one fits its slot and is seasoned', () => {
    const c = B.counts();
    assert.ok(c.breakfast >= 60 && c.lunch >= 60 && c.dinner >= 60, JSON.stringify(c));
    const all = B.all();
    all.forEach((r, i) => {
        const meal = r.category[0];
        assert.equal(PL.slotProblem(r, meal), '', `${r.name}: ${PL.slotProblem(r, meal)}`);
        assert.ok(PL.flavorCheck(r).ok, `${r.name} isn't seasoned`);
        assert.deepEqual(r.nutrition, N.calculate(r.ingredients, r.servings).nutrition, `${r.name}: nutrition not from the calculator`);
        assert.ok(!(r.nutrition_unmatched || []).length, `${r.name}: ${r.nutrition_unmatched}`);
        assert.ok(r.steps.length >= 2 && r.steps.every(s => /[.!]$/.test(s)), `${r.name}: steps`);
        all.slice(0, i).forEach(o => assert.ok(!PL.sameDish(o.name, r.name), `"${o.name}" and "${r.name}" are the same dish`));
    });
    // Enough for a week whatever the diet.
    const P = require('../prefs.js');
    ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free'].forEach(diet => {
        const ex = P.excluder({ diet });
        MEALS.forEach(m => assert.ok(B.forMeal(m).filter(r => !ex(r)).length >= 7, `${diet} ${m}`));
    });
});

test('spell-check never changes a real dish name (0.1.10 turned "Mapo Tofu" into "Mayo Tofu", then used it twice)', () => {
    const PL = require('../planner.js');
    const B = require('../builtins.js');
    const names = ['breakfast', 'lunch', 'dinner'].flatMap(m => B.forMeal(m)).map(r => r.name);
    const changed = names.filter(n => PL.fixName(n) !== n).map(n => `${n} → ${PL.fixName(n)}`);
    assert.deepEqual(changed, []);
    assert.equal(PL.fixName('Mapo Tofu'), 'Mapo Tofu');
    // Real typos from an AI are still fixed.
    assert.equal(PL.fixName('Chiken Tikka Masalla'), 'Chicken Tikka Masala');
    // The no-repeat check knows them as the same dish either way.
    assert.ok(PL.dishList(['Mapo Tofu']).has('Mapo Tofu'));
});
