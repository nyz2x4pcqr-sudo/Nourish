// My schedule → "Eating out": no recipe is planned for that meal, its share of the day is set aside,
// the rest of the day is sized around it, and the grocery list has nothing for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../planner.js');
const B = require('../builtins.js');
const G = require('../grocery.js');

const pools = () => ({ breakfast: B.forMeal('breakfast'), lunch: B.forMeal('lunch'), dinner: B.forMeal('dinner') });
const FRIDAY = 4;   // Monday = 0
const base = { calorie_target: 2000, protein_target: 120 };

test('one evening out: Friday dinner is a marker, every other meal is a real recipe', () => {
    const settings = Object.assign({}, base, { [`sched_d${FRIDAY}_dinner`]: 'out' });
    const plan = PL.planWeek({ pools: pools(), settings, days: 7, weekday: d => d });
    const fri = plan.days[FRIDAY];
    assert.ok(PL.isOut(fri.dinner), 'Friday dinner should be eating out');
    assert.deepEqual(fri.dinner.ingredients, []);
    assert.ok(!plan.missing.some(m => m.day === FRIDAY && m.meal === 'dinner'), 'eating out is not an empty meal to fill');
    plan.days.forEach((d, i) => ['breakfast', 'lunch', 'dinner'].forEach(m => {
        if (i === FRIDAY && m === 'dinner') return;
        assert.ok(d[m] && !PL.isOut(d[m]) && d[m].ingredients.length, `day ${i + 1} ${m} should be a recipe`);
    }));
});

test('the meal out keeps its share of the day, and the day still adds up to the target', () => {
    const settings = Object.assign({}, base, { [`sched_d${FRIDAY}_dinner`]: 'out' });
    const plan = PL.planWeek({ pools: pools(), settings, days: 7, weekday: d => d });
    const share = PL.splitOf(settings)[2];
    const fri = plan.days[FRIDAY];
    assert.equal(fri.dinner.nutrition.calories, Math.round(2000 * share));
    const total = PL.dayTotals(fri).kcal;
    assert.ok(Math.abs(total / 2000 - 1) <= 0.12, `Friday adds up to ${Math.round(total)} kcal`);
    // The cooked meals are sized for their own shares, not stretched to cover the dinner out.
    const cooked = fri.breakfast.nutrition.calories + fri.lunch.nutrition.calories + (fri.snacks || []).reduce((t, x) => t + x.nutrition.calories, 0);
    assert.ok(cooked < 2000 * 0.75, `breakfast and lunch on Friday: ${Math.round(cooked)} kcal`);
});

test('lunch out every day (a work canteen): no lunch recipes, nothing for lunch on the grocery list', () => {
    const settings = Object.assign({}, base, { sched_lunch: 'out' });
    const plan = PL.planWeek({ pools: pools(), settings, days: 7, weekday: d => d });
    plan.days.forEach(d => assert.ok(PL.isOut(d.lunch)));
    const onlyLunch = G.buildList(plan.days, ['lunch'], 'us');
    assert.equal(JSON.stringify(onlyLunch).match(/"name"/g), null, `lunch items: ${JSON.stringify(onlyLunch).slice(0, 200)}`);
    const all = G.buildList(plan.days, ['breakfast', 'lunch', 'dinner'], 'us');
    assert.ok(!/eating out/i.test(JSON.stringify(all)));
    assert.ok(JSON.stringify(all).length > 200, 'breakfast and dinner still shop');
});

test('the later checks leave a meal out alone', () => {
    const settings = Object.assign({}, base, { [`sched_d${FRIDAY}_dinner`]: 'out', calorie_target: 2600 });
    const plan = PL.planWeek({ pools: pools(), settings, days: 7, weekday: d => d });
    const kept = PL.keepToTargets(plan.days, { pools: pools(), settings, weekday: d => d, tolerance: 0.01 });
    assert.ok(PL.isOut(kept.days[FRIDAY].dinner), 'keepToTargets swapped the meal out for a recipe');
    const micros = PL.fixMicros(plan.days, { pools: pools(), settings, weekday: d => d });
    assert.ok(PL.isOut(micros.days[FRIDAY].dinner), 'fixMicros swapped the meal out for a recipe');
    const balanced = PL.balanceDay(plan.days[FRIDAY], settings, 1, null, FRIDAY);
    assert.ok(PL.isOut(balanced.day.dinner));
    assert.ok(Math.abs(PL.dayTotals(balanced.day).kcal / 2600 - 1) <= 0.12, `balanced Friday: ${Math.round(PL.dayTotals(balanced.day).kcal)}`);
});

test('plans made another way (the AI) get the markers too, and a slot no longer out is emptied', () => {
    const days = PL.planWeek({ pools: pools(), settings: base, days: 7, weekday: d => d }).days;
    const settings = Object.assign({}, base, { [`sched_d${FRIDAY}_dinner`]: 'out' });
    const marked = PL.applyEatingOut(days, settings, d => d);
    assert.ok(PL.isOut(marked[FRIDAY].dinner));
    assert.equal(marked[3].dinner.name, days[3].dinner.name, 'other days are untouched');
    const back = PL.applyEatingOut(marked, base, d => d);
    assert.equal(back[FRIDAY].dinner, null);
    assert.equal(PL.outKcal(marked[FRIDAY]), marked[FRIDAY].dinner.nutrition.calories);
});

test('eating out never makes the week look low in vitamins and minerals', () => {
    const plain = PL.planWeek({ pools: pools(), settings: base, days: 7, weekday: d => d }).days;
    const out = PL.applyEatingOut(plain, Object.assign({}, base, { sched_dinner: 'out' }), d => d);
    const a = PL.weekMicros(plain), b = PL.weekMicros(out);
    // Every dinner out, yet each day's average stands on its cooked meals, not on zeros. (Vitamin D
    // really does drop: it comes mostly from fish dinners.)
    ['ca', 'k', 'mg'].forEach(k => assert.ok(b.avg[k] >= a.avg[k] * 0.6, `${k}: ${b.avg[k]} with dinners out against ${a.avg[k]}`));
});
