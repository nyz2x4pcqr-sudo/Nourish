// Why a recipe site gives (or doesn't give) recipes: runs the app's own recipe finder (finder.js)
// against each site in sources.js on its own, with the same headers the app sends and the same
// recipe reader (importer.js), and prints every step: each search and what it found, each page and
// whether its recipe was kept or why not, and how many good recipes each meal got. Needs internet;
// runs in CI (.github/workflows/sites-diagnose.yml). Run: node tools/sites-diagnose.js [site ids…]
'use strict';
const S = require('../sources.js');
const F = require('../finder.js');
const I = require('../importer.js');

const BOT = { 'User-Agent': 'Mozilla/5.0 (compatible; Nourish meal planner; +https://github.com/nyz2x4pcqr-sudo/Nourish)', 'Accept-Language': 'en' };
const BROWSER = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};

// Just enough of a browser's DOMParser for the recipe reader: the page's JSON-LD scripts and text.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = t => String(t).replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => (ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : e[0] === '#' ? String.fromCharCode(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));
global.DOMParser = class {
    parseFromString(html) {
        const scripts = [];
        String(html).replace(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi, (m, body) => { scripts.push({ textContent: body }); return m; });
        const text = decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
        return { querySelectorAll: sel => (/ld\+json/.test(sel) ? scripts : []), querySelector: () => null, body: { textContent: text }, title: '' };
    }
};

async function fetchPage(url, { browser } = {}) {
    try {
        const res = await fetch(url, { headers: browser === false ? BOT : BROWSER, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        return { status: res.status, url: res.url, body: await res.text() };
    } catch (e) { return { status: 0, body: '' }; }
}
const readRecipe = (html, url) => { try { return I.structuredRecipe(new DOMParser().parseFromString(html), url); } catch (e) { return null; } };

async function diagnose(site) {
    const lines = [];
    const store = {};
    const res = await F.findRecipes({
        settings: { calorie_target: 1800 }, days: 7, enabled: id => id === site.id, fetchPage, readRecipe,
        cache: { get: k => (k in store ? JSON.parse(store[k]) : null), set: (k, v) => { store[k] = JSON.stringify(v); } },
        trace: m => lines.push(m), log: m => lines.push('log: ' + m), limits: { seconds: 45, searches: 12, pages: 18, parallel: 2 },
    });
    const all = [...new Set(res.pools.breakfast.concat(res.pools.lunch, res.pools.dinner))];
    return { lines, stats: res.stats, pools: res.pools, rated: all.filter(r => r.rating).length, ownNutrition: all.filter(r => r.nutrition_basis === 'source').length, failures: res.stats.failed.length ? JSON.parse(store.nourish_source_failures || '{}') : {} };
}

(async () => {
    const only = process.argv.slice(2);
    const sites = S.SITES.filter(s => (only.length ? only.includes(s.id) : s.status === 'ok' || s.recheck));
    const summary = [];
    for (const site of sites) {
        const { lines, stats, rated, ownNutrition, failures } = await diagnose(site);
        const p = stats.perMeal || {};
        const got = ['breakfast', 'lunch', 'dinner'].map(m => `${m} ${(p[m] && p[m].web) || 0}`).join(', ') + ` · ${rated} rated · ${ownNutrition} with the site's own nutrition`;
        const f = failures[site.id];
        const fail = f ? ` · FAILED: ${f.why}${f.blocked ? ' (refuses the app)' : ''}` : '';
        console.log(`\n=== ${site.id} (${site.domain}): ${stats.recipes} recipes [${got}] from ${stats.searches} searches, ${stats.pages} pages${fail}`);
        lines.forEach(l => console.log('  ' + l));
        if (stats.why) console.log('  turned away: ' + JSON.stringify(stats.why));
        summary.push(`${site.id.padEnd(20)} ${String(stats.recipes).padStart(3)} recipes  ${got}${fail}`);
    }
    console.log('\n=== SUMMARY\n' + summary.join('\n'));
})();
