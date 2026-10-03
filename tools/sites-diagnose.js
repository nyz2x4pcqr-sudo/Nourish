// Why a recipe site gives links but no recipes: for each site in sources.js, runs the searches the
// app runs for each meal (WordPress search, its breakfast/lunch/dinner categories, or its sitemap),
// reads a few of the recipe pages the way the app does (same headers, same recipe reader, same
// checks: finder.js vet) and prints what happened at each step. Needs internet; runs in CI
// (.github/workflows/sites-diagnose.yml). Run: node tools/sites-diagnose.js [site ids…]
'use strict';
const S = require('../sources.js');
const F = require('../finder.js');
const I = require('../importer.js');
const P = require('../prefs.js');

const BOT = { 'User-Agent': 'Mozilla/5.0 (compatible; Nourish meal planner; +https://github.com/nyz2x4pcqr-sudo/Nourish)', 'Accept-Language': 'en' };
const BROWSER = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};
const QUERIES = { breakfast: ['eggs', 'oats'], lunch: ['salad', 'wrap'], dinner: ['chicken', 'salmon'] };

async function get(url, headers) {
    const started = Date.now();
    try {
        const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        const body = await res.text();
        return { status: res.status, url: res.url, body, ms: Date.now() - started, bytes: body.length };
    } catch (e) { return { status: 0, error: e.message, body: '', ms: Date.now() - started }; }
}
// Just enough of a document for the recipe reader: its JSON-LD scripts.
function docOf(html) {
    const scripts = [];
    String(html).replace(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi, (m, body) => { scripts.push({ textContent: body }); return m; });
    return { querySelectorAll: sel => (/ld\+json/.test(sel) ? scripts : []), querySelector: () => null };
}

async function diagnose(site) {
    const out = { id: site.id, domain: site.domain, search: site.search || '', status: site.status, steps: [] };
    const say = x => out.steps.push(x);
    const links = [];
    if (site.search === 'wp' || !site.search) {
        for (const meal of Object.keys(QUERIES)) {
            const cat = await get(`https://${site.domain}/wp-json/wp/v2/categories?search=${meal}&per_page=5&_fields=id,name,slug,count`, BOT);
            let cats = [];
            try { cats = JSON.parse(cat.body); } catch (e) { /* not JSON */ }
            say(`categories "${meal}": ${cat.status}${cat.error ? ' ' + cat.error : ''} ${Array.isArray(cats) ? cats.map(c => `${c.slug}#${c.id}(${c.count})`).join(' ') : String(cat.body).slice(0, 60)}`);
            for (const q of QUERIES[meal]) {
                const r = await get(`https://${site.domain}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&_fields=link,title`, BOT);
                let list = [];
                try { list = JSON.parse(r.body); } catch (e) { /* not JSON */ }
                if (!Array.isArray(list)) list = [];
                const got = list.map(p => ({ url: p.link, title: String((p.title && p.title.rendered) || '').replace(/<[^>]+>/g, '') }));
                const ctx = { exclude: () => '', stats: {} };
                const good = got.filter(l => F.goodLink(l, site, meal, ctx));
                say(`search "${q}" (${meal}): ${r.status}${r.error ? ' ' + r.error : ''} ${r.ms} ms, ${got.length} links, ${good.length} kept: ${got.slice(0, 4).map(l => l.title.slice(0, 40)).join(' | ')}`);
                good.slice(0, 2).forEach(l => links.push(Object.assign({ meal }, l)));
            }
        }
    }
    if (site.search === 'sitemap' && site.sitemap) {
        const r = await get(site.sitemap, BOT);
        const locs = (r.body.match(/<loc>/g) || []).length;
        say(`sitemap: ${r.status} ${r.ms} ms, ${Math.round(r.bytes / 1024)} KB, ${locs} links`);
        const urls = (r.body.match(/<loc>([^<]+)<\/loc>/g) || []).map(x => x.replace(/<\/?loc>/g, '')).filter(u => !/\.xml/.test(u));
        urls.filter(u => /chicken|egg|salad|oat/.test(u)).slice(0, 4).forEach(u => links.push({ meal: 'dinner', url: u, title: u }));
    }
    let recipes = 0;
    for (const l of links.slice(0, 6)) {
        const r = await get(l.url, BROWSER);
        let raw = null;
        try { raw = I.structuredRecipe(docOf(r.body), r.url || l.url); } catch (e) { say(`  reader crashed: ${e.message}`); }
        const challenge = /cf-chl|challenge-platform|captcha|Just a moment/i.test(r.body) ? ' (a bot check page)' : '';
        const ld = (r.body.match(/application\/ld\+json/g) || []).length;
        let verdict = 'no recipe data';
        if (raw) {
            const ctx = { exclude: P.excluder({}), stats: {} };
            const t = F.tidy(Object.assign(raw, { source_url: l.url }), site);
            const v = t ? F.vet(t, ctx) : null;
            verdict = !t ? 'too few ingredients or steps' : v ? `ok: ${v.name} [${['breakfast', 'lunch', 'dinner'].filter(m => v._fit[m]).join('/')}] ${v.nutrition.calories} kcal` : `turned away: ${Object.keys(ctx.stats.why || {}).join(', ') || 'checks'}`;
            if (v) recipes++;
        }
        say(`  page ${r.status}${r.error ? ' ' + r.error : ''}${r.url && r.url !== l.url ? ` → ${r.url}` : ''} ${Math.round((r.bytes || 0) / 1024)} KB, ${ld} JSON-LD${challenge}: ${verdict} ← ${l.url}`);
    }
    out.recipes = recipes;
    out.links = links.length;
    return out;
}

(async () => {
    const only = process.argv.slice(2);
    const sites = S.SITES.filter(s => (only.length ? only.includes(s.id) : (s.status === 'ok' || /refuses|403|405/.test(s.why || '') || ['mediterraneandish', 'pinchofyum', 'cookieandkate', 'wellplated', 'budgetbytes', 'hotthaikitchen', 'feelgoodfoodie'].includes(s.id))));
    for (const site of sites) {
        const d = await diagnose(site);
        console.log(`\n=== ${d.id} (${d.domain}, ${d.status}${d.search ? ', ' + d.search : ''}): ${d.recipes} recipes from ${d.links} links`);
        d.steps.forEach(s => console.log('  ' + s));
    }
})();
