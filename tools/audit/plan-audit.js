// The plan audit: makes many full 7-day plans the way the app does, with different settings
// (goals, calorie targets, diets, allergies, avoided foods, budgets, schedules, with and without
// cookbooks and web recipes), and checks every meal (checks.js). Run it before every release:
//
//   node tools/audit/plan-audit.js                 audit 25 plans (web library from disk, offline)
//   node tools/audit/plan-audit.js --grow-web      first read more recipes from the sites (internet)
//   node tools/audit/plan-audit.js --books-dir "C:\path\to\Nourish"   also use real books from a
//        Nourish folder (its "Recipe Books" and "My Recipes"); can be given more than once
//   node tools/audit/plan-audit.js --saved nourish-data.json   also audit the plan saved in a data file
//   node tools/audit/plan-audit.js --seed 2         25 different plans (the recipes shuffled differently)
//   node tools/audit/plan-audit.js --only 3        just scenario 3 (1-based)
//   node tools/audit/plan-audit.js --only 3 --show "Pork Chops"   and every line of the meals with that in their name
//
// Writes tools/audit/.cache/report.md (plain English) and report.json; exits with 1 when any plan
// has a failing finding. Test books: tests/fixtures/books (tools/audit/make-test-books.js).
'use strict';
const fs = require('fs');
const path = require('path');
const { loadBooks } = require('./books-io.js');
const { makePlan, normalizeMeal, DAY } = require('./pipeline.js');
const { auditPlan, CHECKS } = require('./checks.js');
const W = require('./web-cache.js');
const PL = require('../../planner.js');
const P = require('../../prefs.js');
const N = require('../../nutrition.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '.cache');

const SCENARIOS = [
    { label: 'Maintain, 2,400 kcal, avoids cucumbers (like your phone)', goal: 'Maintain', avoid: 'cucumbers', settings: { calorie_target: 2400, protein_target: 150 } },
    { label: 'Lose weight, 1,500 kcal', goal: 'Cut', settings: { calorie_target: 1500, protein_target: 120 } },
    { label: 'Gain, 3,200 kcal', goal: 'Gain', settings: { calorie_target: 3200, protein_target: 180 } },
    { label: 'Maintain, 2,000 kcal, books only (no web recipes)', goal: 'Maintain', web: false, settings: { calorie_target: 2000, protein_target: 120 } },
    { label: 'Lose weight, 1,800 kcal, web only (no books)', goal: 'Cut', books: false, settings: { calorie_target: 1800, protein_target: 130 } },
    { label: 'Gain, 2,800 kcal, avoids mushrooms and olives', goal: 'Gain', avoid: 'mushrooms, olives', settings: { calorie_target: 2800, protein_target: 170 } },
    { label: 'Maintain, 2,200 kcal, vegetarian', goal: 'Maintain', settings: { calorie_target: 2200, protein_target: 110, diet: 'Vegetarian' } },
    { label: 'Lose weight, 1,600 kcal, pescatarian', goal: 'Cut', settings: { calorie_target: 1600, protein_target: 110, diet: 'Pescatarian' } },
    { label: 'Maintain, 2,400 kcal, allergic to peanuts and tree nuts', goal: 'Maintain', settings: { calorie_target: 2400, protein_target: 140, allergies: 'peanuts, tree nuts' } },
    { label: 'Gain, 3,000 kcal, allergic to shellfish', goal: 'Gain', settings: { calorie_target: 3000, protein_target: 170, allergies: 'shellfish' } },
    { label: 'Maintain, 2,000 kcal, dairy allergy', goal: 'Maintain', settings: { calorie_target: 2000, protein_target: 120, allergies: 'dairy' } },
    { label: 'Lose weight, 1,700 kcal, gluten-free', goal: 'Cut', settings: { calorie_target: 1700, protein_target: 120, allergies: 'gluten' } },
    { label: 'Maintain, 2,400 kcal, budget-friendly', goal: 'Maintain', settings: { calorie_target: 2400, protein_target: 140, budget: 'Budget-friendly' } },
    { label: 'Maintain, 2,400 kcal, no budget limit', goal: 'Maintain', settings: { calorie_target: 2400, protein_target: 140, budget: 'No limit' } },
    { label: 'Maintain, 2,400 kcal, cooking for 2', goal: 'Maintain', settings: { calorie_target: 2400, protein_target: 140, servings: '2' } },
    { label: 'Maintain, 2,200 kcal, 2 snacks a day', goal: 'Maintain', settings: { calorie_target: 2200, protein_target: 130, snacks_per_day: '2' } },
    { label: 'Lose weight, 2,000 kcal, weighs 90 kg (protein from weight)', goal: 'Cut', settings: { calorie_target: 2000, body_weight_kg: 90, protein_auto: 'on' } },
    { label: 'Gain, 2,600 kcal, calories even across meals', goal: 'Gain', settings: { calorie_target: 2600, protein_target: 160, calorie_split: 'even' } },
    { label: 'Maintain, 2,400 kcal, busy: breakfast 10 min, lunch 20 min', goal: 'Maintain', settings: { calorie_target: 2400, protein_target: 140, sched_breakfast: '10', sched_lunch: '20' } },
    { label: "Maintain, 2,400 kcal, books only, Nourish's recipes mixed in", goal: 'Maintain', web: false, settings: { calorie_target: 2400, protein_target: 140, builtin_mode: 'mix' } },
    { label: 'Maintain, 1,900 kcal, avoids pork and beef', goal: 'Maintain', avoid: 'pork, beef', settings: { calorie_target: 1900, protein_target: 120 } },
    { label: 'Lose weight, 1,500 kcal, vegan', goal: 'Cut', settings: { calorie_target: 1500, protein_target: 90, diet: 'Vegan' } },
    { label: 'Maintain, weekly budget with a 3,200 kcal Saturday', goal: 'Maintain', settings: { calorie_target: 2200, protein_target: 130, calorie_mode: 'weekly', day_kcal: PL.weeklyTargets({ target: 2200, bigDays: [{ weekday: 5, kcal: 3200 }] }).perDay } },
    { label: "Gain, 3,400 kcal, no books, no web (Nourish's own recipes only)", goal: 'Gain', books: false, web: false, settings: { calorie_target: 3400, protein_target: 180 } },
    { label: 'Maintain, 2,400 kcal, lower-carb', goal: 'Maintain', settings: { calorie_target: 2400, protein_target: 150, macro_pref: 'lower-carb' } },
];

function args() {
    const a = process.argv.slice(2);
    const out = { booksDirs: [], saved: [] };
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '--grow-web') out.grow = true;
        else if (a[i] === '--books-dir') out.booksDirs.push(a[++i]);
        else if (a[i] === '--saved') out.saved.push(a[++i]);
        else if (a[i] === '--only') out.only = Number(a[++i]);
        else if (a[i] === '--python') out.python = a[++i];
        else if (a[i] === '--quiet') out.quiet = true;
        else if (a[i] === '--show') out.show = a[++i];
        else if (a[i] === '--seed') out.seed = Number(a[++i]) || 0;
    }
    return out;
}

async function main() {
    const o = args();
    const python = o.python || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    fs.mkdirSync(OUT, { recursive: true });
    let web = W.load();
    if (o.grow) { web = await W.grow(web || {}, { log: m => console.log(m) }); W.save(web); }
    // Test books, plus any real ones (copied first: the person's own folders are only read).
    const folders = [{ dir: path.join(ROOT, 'tests', 'fixtures', 'books'), folder: 'Recipe Books' }];
    o.booksDirs.forEach((d, i) => ['Recipe Books', 'My Recipes'].forEach(f => {
        const src = path.join(d, f);
        if (!fs.existsSync(src)) return;
        const copy = path.join(OUT, `real-books-${i}`, f);
        fs.mkdirSync(copy, { recursive: true });
        fs.readdirSync(src).filter(n => !/^read ?me\.txt$/i.test(n)).forEach(n => { const p = path.join(src, n); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(copy, n)); });
        folders.push({ dir: copy, folder: f });
    }));
    const { db, books, notes } = await loadBooks(folders, { python, ocr: 'simulate' });
    // --seed: a different 70% of the web library each time, like another phone's library.
    if (o.seed && web) {
        const F = require('../../finder.js');
        const hash = t => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
        const lib = web[F.CACHE.recipes] || {};
        web = Object.assign({}, web, { [F.CACHE.recipes]: Object.fromEntries(Object.entries(lib).filter(([url]) => hash(`${o.seed}|${url}`) % 10 < 7)) });
    }
    const header = [
        `Books: ${books.map(b => `${b.title} (${b.count} recipes, ${b.meals || 0} meals${b.review ? `, ${b.review} need a look` : ''}${b.note ? `; ${b.note}` : ''})`).join('; ')}`,
        `Web library: ${web ? W.size(web) : 0} recipes${web ? '' : ' (none saved yet: run with --grow-web)'}`,
    ].concat(notes);
    if (!o.quiet) header.forEach(h => console.log(h));

    const list = o.only ? [SCENARIOS[o.only - 1]] : SCENARIOS;
    const results = [];
    // Each plan starts the recipe shuffle on a different day; --seed moves them all (other plans).
    const base = Date.UTC(2026, 9, 5) + (o.seed || 0) * 37 * DAY;
    for (let i = 0; i < list.length; i++) {
        const sc = Object.assign({ books: true, web: true }, list[i]);
        const t0 = Date.now();
        const res = await makePlan(sc, { db, webCache: web, now: base + (o.only ? o.only - 1 : i) * DAY });
        const audit = auditPlan(res, sc);
        const sources = {};
        res.days.forEach(d => PL.MEALS.forEach(m => { const r = d[m]; if (!r) return; const k = r.from_book ? 'books' : r.builtin || r.quick || r.source_id === 'builtin' ? 'nourish' : 'web'; sources[k] = (sources[k] || 0) + 1; }));
        results.push({ n: o.only || i + 1, scenario: sc, res, audit, sources, seconds: (Date.now() - t0) / 1000 });
        if (o.show) res.days.forEach((d, k) => PL.MEALS.forEach(m => {
            const r = d[m];
            if (!r || r.name.indexOf(o.show) < 0) return;
            console.log(`day ${k + 1} ${m}: ${r.name}, serves ${r.servings}, portion ${r.scaled ? r.scaled.portion : 1}, ${r.nutrition_basis || ''} ${JSON.stringify(r.nutrition)}`);
            if (r.protein_added || r.fiber_added) console.log(`  added: ${[].concat(r.protein_added || [], r.fiber_added || []).join('; ')}`);
            N.calculate(r.ingredients, r.servings).lines.forEach(l => console.log(`    ${l.line} → ${l.key || '(not counted)'} ${l.grams} g, ${l.kcal} kcal`));
        }));
        if (!o.quiet) console.log(`${String(o.only || i + 1).padStart(2)}. ${sc.label}: ${audit.fails} failing finding${audit.fails === 1 ? '' : 's'} (web ${sources.web || 0}, books ${sources.books || 0}, Nourish ${sources.nourish || 0})`);
    }
    // A plan saved in a data file (nourish-data.json), audited as it is.
    const saved = o.saved.map(file => {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const settings = Object.assign({}, (data.settings || {}).value || {});
        const prefs = (data.prefs || {}).value || {};
        const days = (((data.plan || {}).value) || []).map(d => Object.assign(Object.fromEntries(PL.MEALS.map(t => [t, d && d[t] ? normalizeMeal(d[t]) : null])), d && d.snacks ? { snacks: d.snacks } : {}));
        const s = Object.assign(settings, { goal: prefs.goal, budget: { 'Budget-friendly': 'budget', 'No limit': 'any' }[settings.budget] || 'normal' });
        const sc = { label: `Saved plan in ${path.basename(file)}`, avoid: prefs.hates || '', goal: prefs.goal };
        const res = { days, pools: {}, settings: s, exclude: P.excluder({ avoid: prefs.hates || '', allergies: s.allergies, diet: s.diet }), targets: PL.targetsOf(s), log: [] };
        const audit = auditPlan(res, sc);
        if (!o.quiet) console.log(`saved: ${sc.label}: ${audit.fails} failing findings`);
        return { n: 'saved', scenario: sc, res, audit, sources: {} };
    });
    const report = writeReport(results, saved, header);
    console.log(`\n${report.summary}`);
    console.log(`Report: ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
    process.exitCode = results.some(r => r.audit.fails) ? 1 : 0;
}

// The report in plain English: totals per check, the worst examples, then every plan.
function writeReport(results, saved, header) {
    const all = results.flatMap(r => r.audit.findings.map(f => Object.assign({ plan: r.n }, f)));
    const fails = all.filter(f => f.severity === 'fail');
    const byCheck = {};
    fails.forEach(f => { (byCheck[f.check] = byCheck[f.check] || []).push(f); });
    const meals = results.reduce((t, r) => t + r.res.days.reduce((s, d) => s + PL.MEALS.filter(m => d[m]).length, 0), 0);
    const cleanPlans = results.filter(r => !r.audit.fails).length;
    const lines = [];
    const summary = fails.length
        ? `Plan audit: ${results.length} plans, ${meals} meals: ${fails.length} problems in ${results.length - cleanPlans} plans (${cleanPlans} clean).`
        : `Plan audit: ${results.length} plans, ${meals} meals: clean (no problems found).`;
    lines.push('# Plan audit', '', summary, '', ...header.map(h => `- ${h}`), '');
    lines.push('## Problems by kind', '', '| Check | Problems | Plans |', '|---|---|---|');
    Object.keys(CHECKS).forEach(k => { const list = byCheck[k] || []; lines.push(`| ${CHECKS[k]} | ${list.length} | ${new Set(list.map(f => f.plan)).size} |`); });
    const notes = all.filter(f => f.severity === 'note');
    if (notes.length) {
        const counts = {};
        notes.forEach(f => { const k = f.check === 'added' ? (/^fiber/.test(f.detail) ? 'fiber added to a meal (disclosed)' : 'protein top-up (disclosed)') : f.check === 'builtin' ? "Nourish's own recipes used where nothing else fitted" : 'protein between 80% and 90% of the target'; counts[k] = (counts[k] || 0) + 1; });
        lines.push('', 'Notes (not problems): ' + Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join('; ') + '.');
    }
    lines.push('', '## Worst examples', '');
    Object.keys(CHECKS).forEach(k => {
        const list = byCheck[k] || [];
        if (!list.length) return;
        const seen = new Set();
        lines.push(`**${CHECKS[k]}**`, '');
        list.filter(f => { const key = `${f.name}|${f.detail}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 5)
            .forEach(f => lines.push(`- Plan ${f.plan}, ${f.day ? `day ${f.day} ` : ''}${f.slot}${f.name ? `: ${f.name}` : ''}${f.source ? ` (${f.source})` : ''}: ${f.detail}`));
        lines.push('');
    });
    lines.push('## Every plan', '');
    results.concat(saved).forEach(r => {
        const sc = r.scenario;
        lines.push(`### ${r.n}. ${sc.label}`, '');
        if (r.sources && Object.keys(r.sources).length) lines.push(`Meals from: web ${r.sources.web || 0}, books ${r.sources.books || 0}, Nourish ${r.sources.nourish || 0}.`, '');
        r.res.days.forEach((d, i) => {
            const t = PL.dayTotals(d);
            lines.push(`- Day ${i + 1} (${Math.round(t.kcal)} kcal, ${Math.round(t.protein)} g protein): ` + PL.MEALS.map(m => d[m] ? `${m} ${d[m].name} [${d[m].nutrition ? d[m].nutrition.calories : '—'} kcal${d[m].scaled ? `, ${d[m].scaled.portion}×` : ''}]` : `${m} —`).join('; '));
        });
        const f = r.audit.findings.filter(x => x.severity === 'fail');
        lines.push('', f.length ? `Problems (${f.length}):` : 'No problems.');
        f.forEach(x => lines.push(`- ${x.day ? `Day ${x.day} ` : ''}${x.slot}${x.name ? ` "${x.name}"` : ''}: [${x.check}] ${x.detail}`));
        lines.push('');
    });
    fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ summary, header, results: results.concat(saved).map(r => ({ n: r.n, label: r.scenario.label, fails: r.audit.fails, findings: r.audit.findings, sources: r.sources, log: r.res.log,
        days: r.res.days.map(d => Object.fromEntries(PL.MEALS.map(m => [m, d[m] && { name: d[m].name, kcal: d[m].nutrition && d[m].nutrition.calories, protein: d[m].nutrition && d[m].nutrition.protein_g, fat: d[m].nutrition && d[m].nutrition.fat_g, portion: d[m].scaled && d[m].scaled.portion, source: d[m].source_name, description: d[m].description, added: d[m].protein_added }]))) })) }, null, 1));
    return { summary };
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { SCENARIOS };
