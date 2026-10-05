// The plan audit's web recipe library: real recipes read from the recipe sites by the app's own
// finder (finder.js, the same searches, pages and recipe-data reader the app uses), kept on disk
// (tools/audit/.cache/web-library.json, not in git) so every audit run plans with the same recipes
// and works offline. Grown with:  node tools/audit/plan-audit.js --grow-web   (needs the internet
// and `npm i --no-save linkedom@0.18`).
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '.cache', 'web-library.json');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function load(file = FILE) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function save(cache, file = FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache));
}
// How many web recipes the library holds.
function size(cache) {
    const F = require('../../finder.js');
    return Object.keys((cache && cache[F.CACHE.recipes]) || {}).length;
}

// Reads more recipes from the sites into the library (finder.js "grow"), meal by meal.
async function grow(cache, { seconds = 120, log = () => {} } = {}) {
    let DOMParser;
    try { ({ DOMParser } = require('linkedom')); } catch (e) { throw new Error('Growing the web library needs linkedom: npm i --no-save linkedom@0.18'); }
    globalThis.DOMParser = class { parseFromString(s, type) { s = String(s); return new DOMParser().parseFromString(/<html[\s>]/i.test(s) ? s : `<html>${s}</html>`, type); } };
    const I = require('../../importer.js');
    const F = require('../../finder.js');
    async function fetchPage(url) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 20000);
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'follow', signal: ctl.signal });
            return { status: res.status, url: res.url, body: await res.text() };
        } catch (e) { return { status: 599, body: '' }; } finally { clearTimeout(t); }
    }
    async function api(p, body) {
        if (p !== '/api/recipes/themealdb') throw new Error('not available here');
        const meals = [];
        for (const term of String(body.query).split(',').slice(0, 5)) {
            const r = await fetchPage(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(term.trim())}`);
            try { (JSON.parse(r.body).meals || []).forEach(m => meals.push(m)); } catch (e) { /* none */ }
        }
        return { meals };
    }
    const readRecipe = (html, url) => { try { return I.structuredRecipe(new globalThis.DOMParser().parseFromString(html, 'text/html'), url); } catch (e) { return null; } };
    const mem = cache || {};
    const store = { get: k => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
    const before = size(mem);
    const { stats } = await F.findRecipes({ grow: true, days: 7, settings: {}, likes: '', avoid: '', fetchPage, readRecipe, api, cache: store, log,
        limits: { seconds, searches: 60, pages: 160, parallel: 4, cachedRecipes: 3000 },
        enabled: id => id !== 'builtin' && id !== 'library' });
    log(`web library: ${before} → ${size(mem)} recipes (${stats.searches} searches, ${stats.pages} pages; per site ${JSON.stringify(stats.perSource)})`);
    return mem;
}

module.exports = { load, save, grow, size, FILE };
