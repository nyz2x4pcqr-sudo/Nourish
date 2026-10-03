// A plan made with no AI model at all still keeps to the calorie and protein targets, the meal
// types and the time limits (Nourish's own recipes, finder.js, planner.js). The 0.1.8 bug: days of
// about 2,400 kcal against a 1,500 target.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finder.js');
const PL = require('../planner.js');
const B = require('../builtins.js');

const MEALS = ['breakfast', 'lunch', 'dinner'];
const offline = settings => F.planFromSources({ settings, days: 7, people: 1, fetchPage: async () => ({ status: 403 }), readRecipe: () => null, offline: true });

test('no AI: every day within 5% of the calorie target, protein close, every meal fits its slot', async () => {
    for (const s of [{ calorie_target: 1500, protein_target: 100 }, { calorie_target: 1800, protein_target: 120 }, { calorie_target: 2400, protein_target: 150 },
        { calorie_target: 1500, protein_target: 110, snacks_per_day: '2' }, { calorie_target: 1500, protein_target: 100, meal_slots: 'lunch,dinner' }]) {
        const plan = await offline(s);
        assert.equal(plan.missing.length, 0, JSON.stringify(s));
        plan.days.forEach((d, i) => {
            const t = PL.dayTotals(PL.fitDay(d, s, 1));
            assert.ok(Math.abs(t.kcal / s.calorie_target - 1) <= 0.05, `${JSON.stringify(s)} day ${i + 1}: ${Math.round(t.kcal)} kcal`);
            assert.ok(t.protein >= s.protein_target * 0.8, `${JSON.stringify(s)} day ${i + 1}: ${Math.round(t.protein)} g protein`);
            MEALS.forEach(m => { if (d[m]) assert.equal(PL.slotProblem(d[m], m, PL.slotLimits(s, m)), '', `${m}: ${d[m].name}`); });
        });
    }
});

test('no AI: my schedule is kept (no-cook breakfast, 10-minute lunch), and no day is left short', async () => {
    const s = { calorie_target: 2000, protein_target: 140, sched_breakfast: 'nocook', sched_lunch: '10' };
    const plan = await offline(s);
    assert.equal(plan.missing.length, 0);
    plan.days.forEach(d => {
        assert.ok(!PL.recipeProfile(d.breakfast).cooked || /^(toast|microwave)$/.test(PL.recipeProfile(d.breakfast).techniques.join('')), d.breakfast.name);
        assert.equal(PL.slotProblem(d.lunch, 'lunch', PL.slotLimits(s, 'lunch')), '', d.lunch.name);
        assert.ok(Math.abs(PL.dayTotals(PL.fitDay(d, s, 1)).kcal / 2000 - 1) <= 0.05);
    });
});

test('the 2,400 kcal days against a 1,500 target can not happen: heavy meals are swapped back to the target', () => {
    // Three very rich recipes (about 1,400 kcal a serving): even at half portions a day is ~2,100.
    const heavy = (name, cat) => ({ name, servings: 1, category: [cat], time_minutes: 10, ingredients: ['8 oz bacon', '2 cups cooked rice', '3 tbsp butter', '1/2 tsp salt', '1 clove garlic', '1 tsp paprika'],
        steps: ['Fry the bacon for 8 minutes.', 'Stir in the rice, butter, salt, garlic and paprika and serve.'] });
    const words = ['Smoky', 'Maple', 'Cajun', 'Garlic', 'Pepper', 'Ranch', 'Chipotle'];
    const days = words.map(w => ({ breakfast: heavy(`${w} Bacon Breakfast Hash`, 'breakfast'), lunch: heavy(`${w} Bacon Rice Bowl`, 'lunch'), dinner: heavy(`${w} Bacon Fried Rice`, 'dinner') }));
    days.forEach(d => MEALS.forEach(m => require('../nutrition.js').settle(d[m])));
    const s = { calorie_target: 1500, protein_target: 100 };
    const sized = days.map(d => PL.fitDay(d, s, 1));
    assert.ok(PL.dayTotals(sized[0]).kcal > 1500 * 1.25, 'the test needs days that start well over');
    const pools = Object.fromEntries(MEALS.map(m => [m, B.forMeal(m)]));
    const { days: kept, changes } = PL.keepToTargets(sized, { pools, settings: s, people: 1 });
    assert.ok(changes.length > 0);
    kept.forEach((d, i) => assert.ok(Math.abs(PL.dayTotals(d).kcal / 1500 - 1) <= 0.1, `day ${i + 1}: ${Math.round(PL.dayTotals(d).kcal)} kcal`));
    // The meals swapped in are never a repeat.
    const names = kept.flatMap(d => MEALS.map(m => d[m].name)).filter(n => !/Bacon/.test(n));
    names.forEach((a, i) => names.forEach((b, j) => { if (j > i) assert.ok(!PL.sameDish(a, b), `${a} / ${b}`); }));
});
