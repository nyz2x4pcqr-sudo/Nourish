// Saves a snapshot of real web recipes, read from the real recipe sites the way the app does (finder.js,
// as "Refresh recipes now" grows the library), so the plan audit (tools/plan-audit.js) can make plans
// from real web recipes on a computer without the internet. Needs the internet and `npm i linkedom`:
//   node tools/web-snapshot.js [rounds] > web-recipes.json
// The output is the app's own recipe library (the nourish_recipe_cache store) as JSON.
const { DOMParser } = require('linkedom');
globalThis.DOMParser = class { parseFromString(s, type) { s = String(s); return new DOMParser().parseFromString(/<html[\s>]/i.test(s) ? s : `<html>${s}</html>`, type); } };
const I = require('../importer.js');
const F = require('../finder.js');

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

(async () => {
    const rounds = Number(process.argv[2]) || 4;
    const base = { days: 7, readRecipe, fetchPage, api, cache, log: () => {}, trace: () => {}, settings: { calorie_target: 2200 }, likes: '', avoid: '' };
    // A plan first (the searches a plan makes), then library growth rounds like "Refresh recipes now".
    await F.planFromSources(Object.assign({}, base));
    for (let i = 0; i < rounds; i++) {
        const { stats } = await F.findRecipes(Object.assign({}, base, { grow: true, already: [], limits: { seconds: 120, searches: 40, pages: 60, parallel: 3 } }));
        const n = Object.keys(cache.get(F.CACHE.recipes) || {}).length;
        console.error(`round ${i + 1}: ${stats.searches} searches, ${stats.pages} pages; library ${n}`);
    }
    const lib = cache.get(F.CACHE.recipes) || {};
    console.error(`snapshot: ${Object.keys(lib).length} recipes`);
    process.stdout.write(JSON.stringify(lib));
})();
