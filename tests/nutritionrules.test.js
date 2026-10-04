// The nutrition rules on a whole week, as the app runs them (planner.js planWeek, then fitDay and
// applyDayRules on every day): Daily mode, and Weekly mode with one big day.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');
const B = require('../builtins.js');
const N = require('../nutrition.js');
const P = require('../prefs.js');

const MEALS = ['breakfast', 'lunch', 'dinner'];
// Nourish's own recipes as if from nine websites, plus a few that break the slot rules on purpose.
function pools() {
    const out = Object.fromEntries(MEALS.map(m => [m, B.forMeal(m).map((r, i) => { const x = JSON.parse(JSON.stringify(r)); x.builtin = undefined; x.source_id = `site${i % 9}`; N.settle(x); return x; })]));
    const steak = { name: 'Steak and Eggs Breakfast', servings: 2, source_id: 'steaksite', time_minutes: 12, ingredients: ['2 ribeye steaks', '4 eggs', '1 tsp salt', '1 tsp black pepper'], steps: ['Sear the steaks 3 minutes a side.', 'Fry the eggs and serve together.'] };
    const lobster = { name: 'Lobster Roll', servings: 2, source_id: 'lobstersite', time_minutes: 15, ingredients: ['8 oz lobster meat', '2 hot dog buns', '2 tbsp mayonnaise', '1 tsp lemon juice', '1/4 tsp salt'], steps: ['Mix the lobster with the mayonnaise and lemon.', 'Fill the buns and serve.'] };
    const smoothie = { name: 'Strawberry Banana Smoothie', servings: 1, source_id: 'smoothiesite', time_minutes: 5, ingredients: ['1 banana', '1 cup strawberries', '1/2 cup orange juice', '1/2 cup ice'], steps: ['Blend everything until smooth.'] };
    [steak, lobster, smoothie].forEach(r => N.settle(r));
    out.breakfast.push(steak, smoothie);
    out.lunch.push(lobster);
    return out;
}
function runWeek(settings) {
    const exclude = P.excluder({ avoid: '', allergies: '', diet: '' });
    const plan = PL.planWeek({ pools: pools(), settings, days: 7, exclude });
    const notes = [];
    const days = plan.days.map((d, i) => {
        const s = Array.isArray(settings.day_kcal) ? Object.assign({}, settings, { calorie_target: settings.day_kcal[i] }) : settings;
        const res = PL.applyDayRules(PL.fitDay(d, s, 1), s, 1, exclude);
        notes.push(...res.notes);
        return res.day;
    });
    return { days, notes };
}
function checkWeek(days, settings) {
    const T = PL.targetsOf(settings);
    days.forEach((d, i) => {
        const t = PL.dayTotals(d);
        const kcal = Array.isArray(settings.day_kcal) ? settings.day_kcal[i] : T.kcal;
        MEALS.filter(m => m !== 'dinner').forEach(m => assert.equal(PL.pricey(d[m]), '', `day ${i + 1} ${m} "${d[m].name}" has an expensive ingredient`));
        (d.snacks || []).forEach(sn => assert.equal(PL.pricey(sn), '', `snack ${sn.name}`));
        assert.ok(d.breakfast.nutrition.protein_g >= 25, `day ${i + 1} breakfast "${d.breakfast.name}": ${d.breakfast.nutrition.protein_g} g protein`);
        MEALS.forEach(m => assert.ok(d[m].nutrition.protein_g >= 24.5, `day ${i + 1} ${m}: ${d[m].nutrition.protein_g} g protein`));
        assert.ok(t.protein >= T.protein * 0.97, `day ${i + 1}: ${Math.round(t.protein)} g protein of ${T.protein}`);
        assert.ok(t.fiber >= 29.5, `day ${i + 1}: ${Math.round(t.fiber)} g fiber`);
        assert.ok(Math.abs(t.kcal / kcal - 1) <= 0.12, `day ${i + 1}: ${Math.round(t.kcal)} kcal against ${kcal}`);
    });
}

test('Daily mode, a full week: no expensive food outside dinner, every breakfast ≥ 25 g protein, daily protein and fiber met', () => {
    for (const goal of ['Maintain', 'Cut']) {
        const settings = { calorie_target: 2200, body_weight_kg: 80, goal, snacks_per_day: '1' };
        assert.equal(PL.targetsOf(settings).protein, goal === 'Cut' ? 160 : 128, '1.6 g/kg, 2.0 g/kg when losing weight');
        const { days, notes } = runWeek(settings);
        checkWeek(days, settings);
        assert.ok(!days.some(d => /Steak and Eggs|Lobster Roll/.test(d.breakfast.name + d.lunch.name)));
        // The low-protein smoothie never stays protein-less: if chosen, protein is added; the log says so.
        days.filter(d => /Strawberry Banana Smoothie/.test(d.breakfast.name)).forEach(d => assert.ok(d.breakfast.protein_added && d.breakfast.nutrition.protein_g >= 25));
        notes.forEach(n => assert.match(n, /(protein|fiber|olive oil)/i));
    }
});

test('Weekly mode with one big day: the big day gets its calories, the other days share the rest, never under 75%', () => {
    const w = PL.weeklyTargets({ target: 2200, bigDays: [{ weekday: 5, kcal: 3200 }], startWeekday: 0 });
    assert.equal(w.perDay[5], 3200);
    assert.ok(w.perDay.every((k, i) => i === 5 || k === w.each));
    assert.equal(w.overBy, 0);
    assert.ok(Math.abs(w.planned - 2200 * 7) <= 7);
    assert.ok(w.perDay.every(k => k >= 2200 * 0.75));
    const settings = { calorie_target: 2200, body_weight_kg: 80, goal: 'Maintain', snacks_per_day: '1', day_kcal: w.perDay };
    const { days } = runWeek(settings);
    checkWeek(days, settings);
    const totals = days.map(d => PL.dayTotals(d).kcal);
    assert.ok(totals[5] > totals[4] * 1.25, `the big day is bigger: ${totals.map(Math.round).join(', ')}`);
    // Two very big days would push the others under the floor: they stay at 75% and the week is over budget, said plainly.
    const tooBig = PL.weeklyTargets({ target: 2000, bigDays: [{ weekday: 5, kcal: 5000 }, { weekday: 6, kcal: 5000 }] });
    assert.ok(tooBig.floorHit);
    assert.ok(tooBig.perDay.every(k => k >= 1500));
    assert.match(tooBig.message, /would drop below 1500 kcal.*over your budget/);
});
