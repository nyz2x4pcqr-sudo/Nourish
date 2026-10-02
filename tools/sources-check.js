// Checks every candidate recipe site before it goes into sources.js:
//  1. robots.txt: may an ordinary bot read its search and recipe pages?
//  2. terms of use: does it forbid automated access (robots, scrapers, crawlers)?
//  3. can recipes be found (WordPress search, the site's search page, or its sitemap)?
//  4. does a recipe page carry schema.org Recipe data, and does it include nutrition?
// Prints a JSON verdict per site. Run: node tools/sources-check.js   (needs internet; runs in CI)
'use strict';
const UA = 'Mozilla/5.0 (compatible; Nourish meal planner; +https://github.com/nyz2x4pcqr-sudo/Nourish)';
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

// [id, name, domain, group, healthy, search page template (or ''), extra]
const CANDIDATES = [
    ['hellofresh', 'HelloFresh', 'hellofresh.com', 'mealkit', 1, ''],
    ['homechef', 'Home Chef', 'homechef.com', 'mealkit', 1, ''],
    ['everyplate', 'EveryPlate', 'everyplate.com', 'mealkit', 0, ''],
    ['blueapron', 'Blue Apron', 'blueapron.com', 'mealkit', 0, ''],
    ['marleyspoon', 'Marley Spoon', 'marleyspoon.com', 'mealkit', 0, ''],
    ['dinnerly', 'Dinnerly', 'dinnerly.com', 'mealkit', 0, ''],
    ['greenchef', 'Green Chef', 'greenchef.com', 'mealkit', 1, ''],
    ['gousto', 'Gousto', 'gousto.co.uk', 'mealkit', 0, ''],
    ['skinnytaste', 'Skinnytaste', 'skinnytaste.com', 'healthy', 1, ''],
    ['eatingwell', 'EatingWell', 'eatingwell.com', 'healthy', 1, 'https://www.eatingwell.com/search?q={q}'],
    ['budgetbytes', 'Budget Bytes', 'budgetbytes.com', 'healthy', 0, ''],
    ['cookieandkate', 'Cookie and Kate', 'cookieandkate.com', 'healthy', 1, ''],
    ['minimalistbaker', 'Minimalist Baker', 'minimalistbaker.com', 'healthy', 1, ''],
    ['loveandlemons', 'Love and Lemons', 'loveandlemons.com', 'healthy', 1, ''],
    ['wellplated', 'Well Plated', 'wellplated.com', 'healthy', 1, ''],
    ['ambitiouskitchen', 'Ambitious Kitchen', 'ambitiouskitchen.com', 'healthy', 1, ''],
    ['pinchofyum', 'Pinch of Yum', 'pinchofyum.com', 'healthy', 0, ''],
    ['allrecipes', 'Allrecipes', 'allrecipes.com', 'general', 0, 'https://www.allrecipes.com/search?q={q}'],
    ['seriouseats', 'Serious Eats', 'seriouseats.com', 'general', 0, 'https://www.seriouseats.com/search?q={q}'],
    ['bbcgoodfood', 'BBC Good Food', 'bbcgoodfood.com', 'general', 0, 'https://www.bbcgoodfood.com/search?q={q}'],
    ['simplyrecipes', 'Simply Recipes', 'simplyrecipes.com', 'general', 0, 'https://www.simplyrecipes.com/search?q={q}'],
    ['foodnetwork', 'Food Network', 'foodnetwork.com', 'general', 0, 'https://www.foodnetwork.com/search/{q}-'],
    ['epicurious', 'Epicurious', 'epicurious.com', 'general', 0, 'https://www.epicurious.com/search?q={q}'],
    ['delish', 'Delish', 'delish.com', 'general', 0, 'https://www.delish.com/search/?q={q}'],
    ['tasteofhome', 'Taste of Home', 'tasteofhome.com', 'general', 0, 'https://www.tasteofhome.com/search/index?search={q}'],
    ['thekitchn', 'The Kitchn', 'thekitchn.com', 'general', 0, 'https://www.thekitchn.com/search?q={q}'],
    ['food52', 'Food52', 'food52.com', 'general', 0, 'https://food52.com/recipes/search?q={q}'],
    ['recipetineats', 'RecipeTin Eats', 'recipetineats.com', 'general', 0, ''],
    ['tasty', 'Tasty', 'tasty.co', 'general', 0, 'https://tasty.co/search?q={q}'],
    ['justonecookbook', 'Just One Cookbook', 'justonecookbook.com', 'world', 0, ''],
    ['thewoksoflife', 'The Woks of Life', 'thewoksoflife.com', 'world', 0, ''],
    ['maangchi', 'Maangchi', 'maangchi.com', 'world', 0, 'https://www.maangchi.com/?s={q}'],
    ['hotthaikitchen', 'Hot Thai Kitchen', 'hot-thai-kitchen.com', 'world', 0, ''],
    ['swasthi', "Swasthi's Recipes", 'indianhealthyrecipes.com', 'world', 1, ''],
    ['mexicoinmykitchen', 'Mexico in My Kitchen', 'mexicoinmykitchen.com', 'world', 0, ''],
    ['mediterraneandish', 'The Mediterranean Dish', 'themediterraneandish.com', 'world', 1, ''],
    ['myplate', 'MyPlate Kitchen (USDA)', 'myplate.gov', 'public', 1, 'https://www.myplate.gov/myplate-kitchen/recipes?search={q}'],
    ['nhlbi', 'NHLBI Heart-Healthy Recipes', 'nhlbi.nih.gov', 'public', 1, 'https://www.nhlbi.nih.gov/search?keys={q}'],
    ['nhs', 'NHS Healthier Families', 'nhs.uk', 'public', 1, 'https://www.nhs.uk/healthier-families/recipes/?q={q}'],
    ['aha', 'American Heart Association', 'heart.org', 'public', 1, 'https://recipes.heart.org/en/searchresults?search={q}'],
    ['diabetesfoodhub', 'Diabetes Food Hub', 'diabetesfoodhub.org', 'public', 1, 'https://www.diabetesfoodhub.org/all-recipes?search={q}'],
    ['mayoclinic', 'Mayo Clinic', 'mayoclinic.org', 'public', 1, 'https://www.mayoclinic.org/healthy-lifestyle/recipes/search-results?q={q}'],
    // Others worth checking
    ['eatingbirdfood', 'Eating Bird Food', 'eatingbirdfood.com', 'healthy', 1, ''],
    ['feelgoodfoodie', 'FeelGoodFoodie', 'feelgoodfoodie.net', 'healthy', 1, ''],
    ['downshiftology', 'Downshiftology', 'downshiftology.com', 'healthy', 1, ''],
    ['thehealthymaven', 'The Healthy Maven', 'thehealthymaven.com', 'healthy', 1, ''],
    ['gimmesomeoven', 'Gimme Some Oven', 'gimmesomeoven.com', 'general', 0, ''],
    ['sallysbakingaddiction', "Sally's Baking Addiction", 'sallysbakingaddiction.com', 'general', 0, ''],
    ['cafedelites', 'Cafe Delites', 'cafedelites.com', 'general', 0, ''],
    ['spendwithpennies', 'Spend With Pennies', 'spendwithpennies.com', 'general', 0, ''],
    ['wellplatedalt', 'Kitchen Sanctuary', 'kitchensanctuary.com', 'general', 0, ''],
    ['vegrecipesofindia', "Dassana's Veg Recipes", 'vegrecipesofindia.com', 'world', 1, ''],
    ['seonkyoung', 'Seonkyoung Longest', 'seonkyounglongest.com', 'world', 0, ''],
    ['isabeleats', 'Isabel Eats', 'isabeleats.com', 'world', 0, ''],
];
const QUERY = 'chicken';
const TERMS_PATHS = ['/terms', '/terms-of-use', '/terms-of-service', '/terms-and-conditions', '/legal/terms', '/legal', '/about/terms-of-use', '/termsofuse', '/legal/terms-of-use'];
const TERMS_BAN = /(scrap(e|er|ing)|crawl(er|ing)?|spider|data[- ]mining|robot|automated (means|systems?|software|process|access|tools?)|bots?\b)/i;

async function get(url, { browser = false, timeout = 20000, max = 2_000_000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': browser ? BROWSER : UA, 'Accept-Language': 'en', Accept: 'text/html,application/json,*/*' }, redirect: 'follow', signal: ctl.signal });
        const body = (await res.text()).slice(0, max);
        return { status: res.status, url: res.url, body };
    } catch (e) {
        return { status: 0, url, body: '', error: String(e.message || e) };
    } finally { clearTimeout(t); }
}

// robots.txt: the rules for "*" (and for "Nourish", if named). Returns { ok(path), aiBan, raw }.
function robots(text) {
    const groups = [];
    let cur = null;
    String(text || '').split(/\r?\n/).forEach(line => {
        const l = line.replace(/#.*/, '').trim();
        const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) return;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
        else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push([k, v]);
    });
    const mine = groups.filter(g => g.agents.some(a => a === '*' || a.indexOf('nourish') >= 0));
    const rules = mine.reduce((a, g) => a.concat(g.rules), []);
    const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    return {
        ok(path) {
            let best = null;
            rules.forEach(([k, v]) => { if (v && toRe(v).test(path) && (!best || v.length > best[1].length || (v.length === best[1].length && k === 'allow'))) best = [k, v]; });
            return !best || best[0] === 'allow';
        },
        blanket: rules.some(([k, v]) => k === 'disallow' && v === '/'),
    };
}

function jsonLdRecipe(html) {
    const blocks = [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const find = d => {
        if (!d) return null;
        if (Array.isArray(d)) { for (const x of d) { const r = find(x); if (r) return r; } return null; }
        if (typeof d !== 'object') return null;
        const t = d['@type'];
        if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return d;
        return find(d['@graph']) || find(d.mainEntity) || null;
    };
    for (const b of blocks) { try { const r = find(JSON.parse(b.trim())); if (r) return r; } catch (e) { /* bad block */ } }
    return null;
}

function linksTo(html, domain, base) {
    const out = new Set();
    for (const m of String(html).matchAll(/href=["']([^"'#]+)["']/g)) {
        let u; try { u = new URL(m[1], base); } catch (e) { continue; }
        const h = u.hostname.replace(/^www\./, '');
        if ((h === domain || h.endsWith('.' + domain)) && u.pathname.length > 12 && /recipe|\/\d{4}\/|-/.test(u.pathname)) out.add(u.href.split('?')[0]);
    }
    return [...out];
}

async function checkSite([id, name, domain, group, healthy, page]) {
    const base = `https://www.${domain}`;
    const v = { id, name, domain, group, healthy: !!healthy };
    const rb = await get(`${base}/robots.txt`);
    const r = robots(rb.status === 200 ? rb.body : '');
    v.robots = rb.status === 200 ? (r.blanket ? 'disallows everything' : 'found') : `none (${rb.status || rb.error})`;
    // Terms
    v.terms = 'not found';
    for (const p of TERMS_PATHS) {
        const t = await get(base + p, { browser: true, timeout: 12000 });
        if (t.status === 200 && /terms|conditions/i.test(t.body)) {
            const text = t.body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const hit = text.match(new RegExp('.{0,140}' + TERMS_BAN.source + '.{0,140}', 'i'));
            v.terms = hit ? 'forbids automated access: "' + hit[0].trim().slice(0, 260) + '"' : 'no ban on automated access found';
            v.termsUrl = t.url;
            break;
        }
    }
    // Finding recipes
    const urls = [];
    const wp = await get(`${base}/wp-json/wp/v2/posts?search=${QUERY}&per_page=6&_fields=link,title`);
    if (wp.status === 200 && wp.body.trim().startsWith('[')) {
        try { JSON.parse(wp.body).forEach(p => p.link && urls.push(p.link)); } catch (e) { /* not json */ }
        if (urls.length) v.search = 'wp';
        v.wpAllowed = r.ok('/wp-json/wp/v2/posts');
    }
    if (!urls.length && page) {
        const sp = await get(page.replace('{q}', QUERY), { browser: true });
        const found = sp.status === 200 ? linksTo(sp.body, domain, sp.url) : [];
        if (found.length) { urls.push(...found.slice(0, 8)); v.search = 'page'; v.searchUrl = page; }
        v.searchPage = `${sp.status || sp.error}, ${found.length} links`;
        try { v.pageAllowed = r.ok(new URL(page.replace('{q}', QUERY)).pathname + new URL(page.replace('{q}', QUERY)).search); } catch (e) { /* bad */ }
    }
    if (!urls.length) {
        for (const sm of ['/sitemap.xml', '/sitemap_index.xml', '/recipe-sitemap.xml', '/sitemaps/recipes.xml']) {
            const s = await get(base + sm, { max: 3_000_000 });
            if (s.status !== 200) continue;
            const locs = [...s.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
            const recipeMaps = locs.filter(l => /recipe/i.test(l) && /\.xml/.test(l));
            let pages = locs.filter(l => !/\.xml/.test(l) && /recipe/i.test(l));
            if (!pages.length && recipeMaps.length) {
                const s2 = await get(recipeMaps[0], { max: 3_000_000 });
                pages = [...s2.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()).filter(l => !/\.xml/.test(l));
            }
            if (pages.length) { urls.push(...pages.filter(p => p.includes(QUERY)).slice(0, 6)); if (!urls.length) urls.push(...pages.slice(0, 6)); v.search = 'sitemap'; v.sitemap = recipeMaps[0] || base + sm; v.sitemapPages = pages.length; break; }
        }
    }
    v.candidates = urls.length;
    // Recipe data
    for (const u of urls.slice(0, 4)) {
        const p = await get(u, { browser: true });
        const rec = p.status === 200 ? jsonLdRecipe(p.body) : null;
        if (rec) {
            v.recipe = { url: u, name: String(rec.name).slice(0, 80), ingredients: (rec.recipeIngredient || []).length, nutrition: !!(rec.nutrition && rec.nutrition.calories), category: rec.recipeCategory || null, pathAllowed: r.ok(new URL(u).pathname) };
            break;
        }
        v.recipeTried = (v.recipeTried || []).concat(`${p.status || p.error} ${u.slice(0, 90)}`);
    }
    const termsBan = /^forbids/.test(v.terms);
    v.verdict = !v.recipe ? 'drop: no recipe data found' : r.blanket ? 'drop: robots.txt disallows everything'
        : termsBan ? 'drop: terms forbid automated access' : v.recipe.pathAllowed === false ? 'drop: robots.txt disallows recipe pages'
        : !v.search ? 'drop: no way to find recipes' : 'ok';
    return v;
}

(async () => {
    const results = [];
    const queue = CANDIDATES.slice();
    await Promise.all([0, 1, 2, 3, 4, 5].map(async () => { while (queue.length) { const c = queue.shift(); results.push(await checkSite(c).catch(e => ({ id: c[0], verdict: 'error: ' + e.message }))); } }));
    results.sort((a, b) => CANDIDATES.findIndex(c => c[0] === a.id) - CANDIDATES.findIndex(c => c[0] === b.id));
    for (const r of results) console.log('SITE ' + JSON.stringify(r));
    console.log('SUMMARY ok=' + results.filter(r => r.verdict === 'ok').map(r => r.id).join(','));
})();
