// Makes real 7-day plans from the real recipe sites (no AI), the way the app does, and reports the
// time taken, where the recipes came from and each day's totals. Run in CI (needs the internet and
// `npm i linkedom`): node tools/plan-live.js
const { DOMParser } = require('linkedom');
// importer.js uses the browser's DOMParser; linkedom needs a whole <html> document to fill <body>.
globalThis.DOMParser = class { parseFromString(s, type) { s = String(s); return new DOMParser().parseFromString(/<html[\s>]/i.test(s) ? s : `<html>${s}</html>`, type); } };
const I = require('../importer.js');
const F = require('../finder.js');
const PL = require('../planner.js');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
async function fetchPage(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'follow', signal: ctl.signal });
        return { status: res.status, url: res.url, body: await res.text() };
    } catch (e) { return { status: 599, body: '' }; } finally { clearTimeout(t); }
}
async function api(path, body) {
    if (path !== '/api/recipes/themealdb') throw new Error('not available here');
    const meals = [];
    for (const term of String(body.query).split(',').slice(0, 5)) {
        const r = await fetchPage(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(term.trim())}`);
        try { (JSON.parse(r.body).meals || []).forEach(m => meals.push(m)); } catch (e) { /* none */ }
    }
    return { meals };
}
const readRecipe = (html, url) => { try { return I.structuredRecipe(new globalThis.DOMParser().parseFromString(html, 'text/html'), url); } catch (e) { return null; } };
const mem = {};
const cache = { get: k => (k in mem ? JSON.parse(mem[k]) : null), set: (k, v) => { mem[k] = JSON.stringify(v); } };

const CASES = [
    { label: 'New user: likes "All food", 1,500 kcal, lose weight', settings: { calorie_target: 1500, protein_target: 110, goal: 'Cut' }, likes: 'All food', avoid: '' },
    { label: 'Same person again (cache warm)', settings: { calorie_target: 1500, protein_target: 110, goal: 'Cut' }, likes: 'All food', avoid: '' },
    { label: 'Likes salmon and thai, avoids cucumber, vegetarian? no; 2,400 kcal', settings: { calorie_target: 2400, protein_target: 150 }, likes: 'salmon, thai food', avoid: 'cucumber, mushrooms' },
    { label: 'Vegetarian, 1,800 kcal, bigger breakfast', settings: { calorie_target: 1800, diet: 'Vegetarian', calorie_split: 'breakfast' }, likes: '', avoid: '' },
];
(async () => {
    for (const c of CASES) {
        const t0 = Date.now();
        const plan = await F.planFromSources(Object.assign({ days: 7, readRecipe, fetchPage, api, cache, log: m => console.log('  log:', m) }, c));
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`\n=== ${c.label}: ${secs} s; ${plan.stats.searches} searches, ${plan.stats.pages} pages, ${plan.stats.recipes} usable recipes (${plan.stats.fromCache} cached); missing ${plan.missing.length} slots`);
        console.log('  per source:', JSON.stringify(plan.stats.perSource));
        console.log('  skipped (failing):', plan.stats.failed.join(', ') || 'none', '| excluded', plan.stats.excluded, '| bland', plan.stats.bland, '| unsure nutrition', plan.stats.unsure);
        plan.days.forEach((d, i) => {
            const t = plan.report[i];
            console.log(`  Day ${i + 1}: ${Math.round(t.kcal)} kcal, P ${Math.round(t.protein)} C ${Math.round(t.carbs)} F ${Math.round(t.fat)}`);
            PL.MEALS.forEach(m => { const r = d[m]; console.log(`    ${m.padEnd(9)} ${r ? `${r.name} (${r.nutrition.calories} kcal, ${r.source_name}${r.reseasoned ? ', re-seasoned' : ''}${r.nutrition_basis === 'calculated' ? ', our numbers' : ''}) ${r.source_url}` : '— (AI writes this one)'}`); });
        });
    }
})();
