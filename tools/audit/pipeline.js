// Makes a 7-day plan the way the app does when "Generate Plan" is tapped with no AI (app.js
// runSmartPlan → fillMissingMeals → applyPlan → applyNutritionRules), from:
//   - the recipe database of the test books (books-io.js), as libraryRecipes() / bookSnacks();
//   - the web recipe library saved on disk (web-cache.js), read offline like the app's own library;
//   - Nourish's own recipes (builtins.js).
// The app's own normalizeMeal (app.js) is used as it is, read from app.js, so the audit can't drift
// from what the app does to every meal. Descriptions are made the way the app does without an AI
// (ondevice.js describeFromRecipe).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../../finder.js');
const PL = require('../../planner.js');
const P = require('../../prefs.js');
const N = require('../../nutrition.js');
const B = require('../../builtins.js');
const U = require('../../units.js');
const G = require('../../grocery.js');
const I = require('../../importer.js');
const O = require('../../ondevice.js');

const ROOT = path.join(__dirname, '..', '..');
const MEAL_TYPES = PL.MEALS;
const DAY = 24 * 3600 * 1000;

// === app.js's own functions, loaded from its source ===
function appFunctions(names, sandbox) {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const code = names.map(name => {
        const start = src.indexOf(`\nfunction ${name}(`);
        if (start < 0) throw new Error(`app.js has no function ${name}`);
        let i = src.indexOf('{', start), depth = 0;
        for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
        return src.slice(start, i + 1);
    }).join('\n');
    vm.createContext(sandbox);
    vm.runInContext(`${code}\n;(${JSON.stringify(names)}).forEach(n => { exports[n] = eval(n); });`, sandbox);
    return sandbox.exports;
}
const APP = appFunctions(['toNumber', 'toStringList', 'cleanIngredients', 'ingredientAmounts', 'safeSource', 'normalizeMeal'], {
    exports: {}, URL, String, Number, Array, Object, Math, JSON,
    NourishGrocery: G, NourishUnits: U, NourishPlanner: PL, NourishNutrition: N, NourishImport: I, reportCaps: false, nlog: () => {},
});
const normalizeMeal = APP.normalizeMeal;

// === One plan ===
// scenario: { settings (app settings), goal, likes, avoid, people, books: true|false, web: true|false }
// shared: { db (recipe database of the books), webCache (the saved web library), now }
async function makePlan(scenario, shared) {
    const log = [];
    const s = Object.assign({ calorie_target: 2000, protein_target: 150, meal_slots: 'breakfast,lunch,dinner', snacks_per_day: '0', calorie_split: 'dinner', builtin_mode: 'backup', source_cap: 3, budget: 'Any', diet: 'No restriction', allergies: '' }, scenario.settings || {});
    const goal = scenario.goal || 'Maintain';
    const people = Math.max(1, Math.min(12, Math.round(Number(s.servings || scenario.people) || 1)));
    const budget = { 'Budget-friendly': 'budget', 'No limit': 'any' }[s.budget] || 'normal';
    const plannerSettings = extra => Object.assign({}, s, { goal, body_weight_kg: Number(s.body_weight_kg) || 0, budget }, extra || {});
    const exclude = P.excluder({ avoid: scenario.avoid || '', allergies: s.allergies, diet: s.diet });
    const db = scenario.books ? shared.db : null;
    // The saved web library, as the app's own on-device library (a copy: nothing is written back).
    const mem = scenario.web && shared.webCache ? JSON.parse(JSON.stringify(shared.webCache)) : {};
    const cache = { get: k => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
    const now = shared.now || Date.now();
    const plan = await F.planFromSources({
        settings: plannerSettings(), goal, likes: scenario.likes || '', avoid: scenario.avoid || '', days: 7, people,
        enabled: id => !(s.sources_off || '').split(',').includes(id),
        offline: true, cache, now: () => now,
        library: db ? async () => db.forPlanning() : null,
        snackExtras: () => (db ? db.extras().filter(r => !r.review && r.nutrition && r.nutrition.calories > 0).slice(0, 60) : []),
        weekday: d => d % 7, already: [], log: m => log.push(m),
    });
    // fillMissingMeals, with no AI: a found recipe not used yet, then Nourish's own, then a quick meal.
    const inPlan = () => PL.dishList(plan.days.flatMap(d => MEAL_TYPES.map(t => d[t] && !d[t].leftover && d[t].name).filter(Boolean)));
    const slotCheck = (meal, type, d) => PL.slotProblem(meal, type, PL.slotLimits(s, type, d % 7));
    const closest = (list, slot) => {
        const used = inPlan();
        return list.filter(r => r && r.nutrition && r.nutrition.calories > 0 && slot.kcal / r.nutrition.calories >= 0.55 && slot.kcal / r.nutrition.calories <= 2 && !used.has(r.name) && !exclude(r) && !slotCheck(r, slot.meal, slot.day) && !PL.overCap(r, PL.sourceCounts(plan.days), plannerSettings()))
            .sort((a, b) => Math.abs(Math.log(slot.kcal / a.nutrition.calories)) - Math.abs(Math.log(slot.kcal / b.nutrition.calories)))[0] || null;
    };
    for (const slot of plan.missing) {
        let meal = closest(plan.pools[slot.meal] || [], slot) || (s.builtin_mode !== 'off' ? closest(B.forMeal(slot.meal), slot) : null);
        let how = meal ? 'a found recipe not used yet' : '';
        if (!meal && s.builtin_mode !== 'off') { meal = PL.quickMeal(slot.meal, PL.slotLimits(s, slot.meal, slot.day % 7), { exclude, taken: inPlan().names(), d: slot.day }); how = 'a quick built-in meal'; }
        if (meal) { plan.days[slot.day][slot.meal] = normalizeMeal(JSON.parse(JSON.stringify(meal))) || meal; log.push(`day ${slot.day + 1} ${slot.meal}: ${how} (${meal.name})`); }
        else log.push(`day ${slot.day + 1} ${slot.meal}: nothing fits; left empty`);
    }
    const dayTargets = i => (Array.isArray(s.day_kcal) && s.day_kcal[i] > 0 ? { calorie_target: s.day_kcal[i] } : {});   // app.js dayTargetsFor
    let days = plan.days.map((d, i) => PL.fitDay(d, plannerSettings(dayTargets(i)), people));
    const pools = Object.fromEntries(MEAL_TYPES.map(m => [m, (plan.pools[m] || []).concat(s.builtin_mode !== 'off' ? B.forMeal(m) : [])]));
    const kept = PL.keepToTargets(days, { pools, settings: plannerSettings(), people, exclude, weekday: d => d % 7, already: [] });
    days = kept.days;
    kept.changes.forEach(c => log.push(`kept to target: ${c}`));
    // applyPlan: normalised, no repeats, every meal fits its slot, snacks, then the nutrition rules.
    days = days.map(d => { const out = Object.fromEntries(MEAL_TYPES.map(t => [t, normalizeMeal(d[t])])); if (d.snacks) out.snacks = d.snacks.map(normalizeMeal).filter(Boolean); return out; });
    const names = () => days.flatMap(d => MEAL_TYPES.map(t => d[t] && d[t].name).filter(Boolean));
    const builtinFor = (t, i) => {
        const used = PL.dishList(names());
        const kcal = (Number(s.calorie_target) || 2000) * (PL.splitOf(s)[MEAL_TYPES.indexOf(t)] || 0.33);
        if (s.builtin_mode === 'off') return null;
        const ok = B.forMeal(t).filter(r => !used.has(r.name) && !exclude(r) && !slotCheck(r, t, i))
            .sort((a, b) => Math.abs(Math.log(kcal / a.nutrition.calories)) - Math.abs(Math.log(kcal / b.nutrition.calories)));
        return ok.length ? JSON.parse(JSON.stringify(ok[i % Math.min(5, ok.length)])) : PL.quickMeal(t, PL.slotLimits(s, t, i % 7), { exclude, taken: names(), d: i });
    };
    const seen = PL.dishList();
    days.forEach((d, i) => MEAL_TYPES.forEach(t => {
        const meal = d[t];
        if (!meal || meal.leftover) return;
        if (seen.has(meal.name)) { const other = builtinFor(t, i); log.push(`day ${i + 1} ${t}: "${meal.name}" repeated${other ? `; replaced by "${other.name}"` : ''}`); if (other) d[t] = normalizeMeal(other); }
        seen.add(d[t].name);
    }));
    days.forEach((d, i) => MEAL_TYPES.forEach(t => {
        const misfit = d[t] ? slotCheck(d[t], t, i) : '';
        if (!misfit) return;
        const quick = builtinFor(t, i);
        log.push(`day ${i + 1} ${t}: "${d[t].name}" ${misfit}${quick ? `; replaced by "${quick.name}"` : ''}`);
        if (quick) d[t] = normalizeMeal(quick);
    }));
    if (PL.snacksOf(s)) days.forEach((d, i) => { if (d.snacks && d.snacks.length) return; PL.addSnacks(d, s, i, people, exclude, db ? db.extras().filter(r => !r.review && r.nutrition && r.nutrition.calories > 0).slice(0, 60) : []); if (d.snacks) d.snacks = d.snacks.map(normalizeMeal).filter(Boolean); });
    const dayRules = (d, i) => {
        const res = PL.applyDayRules(d, plannerSettings(dayTargets(i)), people, exclude, { fatSwapOn: s.fat_swap !== 'off' });
        res.notes.forEach(n => log.push(`day ${i + 1}: ${n}`));
        MEAL_TYPES.forEach(t => { if (res.day[t]) res.day[t] = normalizeMeal(res.day[t]); });
        return res.day;
    };
    days = days.map(dayRules);
    const fixed = PL.fixMicros(days, { pools: plan.pools, settings: plannerSettings(), people, exclude, weekday: d => d % 7 });
    fixed.notes.forEach(n => log.push(n));
    fixed.days.forEach((d, i) => { if (d !== days[i]) days[i] = dayRules(d, i); });
    // The description each meal shows (no AI on this PC: made from the recipe, as the app does).
    days.forEach(d => MEAL_TYPES.concat(['snacks']).forEach(t => [].concat(d[t] || []).forEach(m => { if (m && !m.description) { const text = O.describeFromRecipe(m); if (text) { m.description = text; m.description_made = true; } } })));
    return { days, pools: plan.pools, stats: plan.stats, rejected: plan.rejected, settings: plannerSettings(), exclude, people, log, targets: PL.targetsOf(plannerSettings()) };
}

module.exports = { makePlan, normalizeMeal, appFunctions, DAY };
