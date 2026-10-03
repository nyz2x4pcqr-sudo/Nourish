// The one smart source: asks every available recipe source at once (the sites in sources.js,
// TheMealDB, Spoonacular with a key, a custom site, the recipe library), merges what comes back,
// removes duplicates and anything the person avoids, settles nutrition from the ingredients
// (nutrition.js), checks meal type and seasoning (planner.js) and plans the week with the best
// recipe for each slot. Slots it can't fill come back as `missing` for the AI to write.
//
// Gentle on the sites: a few requests at a time, a cap on searches and pages per plan, recipes and
// sitemaps cached on the device, and a site that keeps failing is skipped for a day, silently.
// Everything outside this file (fetching a page, reading recipe data, the AI) is passed in, so the
// same code runs on the phone, on the PC and in the tests.
(function (root) {
    'use strict';

    const req = n => (typeof require === 'function' ? require(n) : null);
    const S = root.NourishSources || req('./sources.js');
    const P = root.NourishPrefs || req('./prefs.js');
    const PL = root.NourishPlanner || req('./planner.js');
    const N = root.NourishNutrition || req('./nutrition.js');

    const LIMITS = { parallel: 4, searches: 24, pages: 42, seconds: 90, cachedRecipes: 400 };
    const CACHE = { recipes: 'nourish_recipe_cache', searches: 'nourish_search_cache', sitemaps: 'nourish_sitemap_cache', failures: 'nourish_source_failures' };
    const DAY = 24 * 3600 * 1000;

    // What to look for when the person has no particular likes (they're never searched on their own:
    // likes only add to these and raise matching recipes).
    const QUERIES = {
        breakfast: ['breakfast', 'eggs', 'oatmeal', 'frittata', 'yogurt', 'breakfast burrito', 'smoothie', 'pancakes'],
        lunch: ['salad', 'soup', 'grain bowl', 'wrap', 'chickpea', 'lentil', 'quinoa', 'sandwich'],
        dinner: ['chicken', 'salmon', 'shrimp', 'turkey', 'beef', 'tofu', 'pork', 'pasta', 'curry', 'stir fry', 'tacos', 'sheet pan'],
    };
    const ROUNDUP = /(\/(category|tag|collections?|recipes?)\/?$|best-|-ideas|ideas-|meal-plan|what-to-(cook|make|eat)|roundup|-challenge|-guide|-101|\d+-(easy|best|healthy|quick)|-recipes\/?$)/i;
    const NOT_RECIPE_TITLE = /\b(best|ideas|recipes|meal plan|meal prep plan|what to|roundup|guide|review|tips|how to (store|freeze)|gift|giveaway|favorites|vs\.?)\b|^\d+\s/i;

    function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
    function decode(s) {
        return String(s || '').replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();
    }
    function slugWords(url) { try { return decodeURIComponent(new URL(url).pathname).toLowerCase().replace(/[^a-z]+/g, ' ').trim(); } catch (e) { return ''; } }
    function shuffle(list, seed) {
        const a = list.slice();
        let s = seed || 1;
        for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    // Runs async jobs a few at a time; stops starting new ones once `stop()` says so.
    async function pool(items, parallel, work, stop) {
        let next = 0;
        const runOne = async () => {
            while (next < items.length && !(stop && stop())) {
                const item = items[next++];
                try { await work(item); } catch (e) { /* one failure never stops the rest */ }
            }
        };
        await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, runOne));
    }

    // A recipe in the shape the app uses, from any source.
    function tidy(r, source) {
        if (!r || !r.name) return null;
        const list = v => (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean);
        const out = {
            name: decode(r.name).slice(0, 120),   // a real recipe's own name; only AI-written names are spell-checked
            servings: Number(r.servings) >= 1 && Number(r.servings) <= 24 ? Math.round(Number(r.servings)) : 4,
            ingredients: list(r.ingredients).slice(0, 40),
            steps: list(r.steps).slice(0, 30),
            time_minutes: Number(r.time_minutes) > 0 ? Math.round(Number(r.time_minutes)) : null,
            nutrition: r.nutrition && Number(r.nutrition.calories) > 0 ? r.nutrition : null,
            category: Array.isArray(r.category) ? r.category.join(', ') : String(r.category || ''),
            source_url: r.source_url || r.url || undefined,
            source_name: r.source_name || (source && source.name) || undefined,
            source_id: (source && source.id) || r.source_id || undefined,
            healthy: !!(source && source.healthy) || undefined,
            library_path: r.library_path || undefined,
        };
        if (out.ingredients.length < 3 || !out.steps.length) return null;
        return out;
    }

    // Checks one recipe; returns it ready to plan with (nutrition settled, seasoning fixed) or null.
    function vet(r, ctx) {
        if (!r) return null;
        if (ctx.exclude(r)) { ctx.stats.excluded++; return null; }
        // The source's numbers are per serving of the recipe as written; settle() checks them.
        if (r.nutrition && !(r.nutrition.calories > 0)) r.nutrition = null;
        N.settle(r);
        if (!r.nutrition || !(r.nutrition.calories > 40)) return null;
        const unmatched = (r.nutrition_unmatched || []).length;
        if (r.nutrition_basis === 'calculated' && unmatched > r.ingredients.length * 0.4) { ctx.stats.unsure++; return null; }
        const fit = PL.mealFit(r);
        if (!fit.breakfast && !fit.lunch && !fit.dinner) return null;
        r._fit = fit;
        if (!PL.flavorCheck(r).ok) {
            PL.reseason(r);
            N.settle(r);
            if (!PL.flavorCheck(r).ok) { ctx.stats.bland++; return null; }
        }
        r.sameAs = [PL.normName(r.name)];
        return r;
    }

    function makeContext(o) {
        const now = o.now || (() => Date.now());
        const cache = o.cache || { get: () => null, set: () => {} };
        const failures = cache.get(CACHE.failures) || {};
        const stats = { started: now(), searches: 0, pages: 0, fromCache: 0, excluded: 0, bland: 0, unsure: 0, perSource: {}, failed: [] };
        return {
            o, now, cache, failures, stats,
            log: o.log || (() => {}),
            exclude: P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' }),
            out: false,
            timeUp() { return this.out || now() - stats.started > (o.limits && o.limits.seconds || LIMITS.seconds) * 1000; },
        };
    }
    function siteOk(ctx, id) { const f = ctx.failures[id]; return !(f && f.n >= 2 && f.until > ctx.now()); }
    function siteFailed(ctx, id, why) {
        const f = ctx.failures[id] || { n: 0 };
        f.n++;
        f.until = ctx.now() + DAY;
        f.why = String(why || '').slice(0, 80);
        ctx.failures[id] = f;
        if (ctx.stats.failed.indexOf(id) < 0) ctx.stats.failed.push(id);
    }
    function siteWorked(ctx, id) { if (ctx.failures[id]) delete ctx.failures[id]; }
    function count(ctx, id, key) { const p = ctx.stats.perSource[id] || (ctx.stats.perSource[id] = { links: 0, recipes: 0 }); p[key]++; }

    // === SEARCHING ===
    async function getPage(ctx, url, browser) {
        const res = await ctx.o.fetchPage(url, { browser });
        if (!res || !res.status) throw new Error('no answer');
        if (res.status === 402 || res.status === 403 || res.status === 405 || res.status === 429 || res.status >= 500) {
            const e = new Error(`HTTP ${res.status}`);
            e.blocked = true;
            throw e;
        }
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        return res;
    }

    async function searchWp(ctx, site, q) {
        const base = `https://${site.domain}`;
        const res = await getPage(ctx, `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&_fields=link,title`, false);
        let list;
        try { list = JSON.parse(res.body); } catch (e) { throw new Error('not a WordPress answer'); }
        if (!Array.isArray(list)) throw new Error('not a WordPress answer');
        return list.map(p => ({ url: p && p.link, title: decode(p && p.title && p.title.rendered) })).filter(x => x.url);
    }

    async function sitemapUrls(ctx, site) {
        const all = ctx.cache.get(CACHE.sitemaps) || {};
        const hit = all[site.id];
        if (hit && hit.at > ctx.now() - 7 * DAY && hit.urls.length) return hit.urls;
        const res = await getPage(ctx, site.sitemap, false);
        let urls = (String(res.body).match(/<loc>([^<]+)<\/loc>/g) || []).map(x => decode(x.replace(/<\/?loc>/g, '')));
        const maps = urls.filter(u => /\.xml/i.test(u) && /recipe/i.test(u)).slice(0, 2);
        for (const m of maps) {
            const r2 = await getPage(ctx, m, false);
            urls = urls.concat((String(r2.body).match(/<loc>([^<]+)<\/loc>/g) || []).map(x => decode(x.replace(/<\/?loc>/g, ''))));
        }
        urls = urls.filter(u => !/\.xml/i.test(u) && !ROUNDUP.test(u)).slice(0, 3000);
        all[site.id] = { at: ctx.now(), urls };
        ctx.cache.set(CACHE.sitemaps, all);
        return urls;
    }
    async function searchSitemap(ctx, site, q) {
        const words = q.toLowerCase().split(/\s+/);
        return (await sitemapUrls(ctx, site)).filter(u => words.every(w => slugWords(u).indexOf(w) >= 0)).slice(0, 10).map(url => ({ url, title: slugWords(url) }));
    }

    async function searchSite(ctx, site, q) {
        if (site.search === 'wp') return searchWp(ctx, site, q);
        if (site.search === 'sitemap') return searchSitemap(ctx, site, q);
        if (site.search === 'web' && ctx.o.webSearch) return ctx.o.webSearch(`site:${site.domain} ${q} recipe`, 8);
        return [];
    }

    // The searches for each meal: the person's likes and cuisines first, then the usual dishes, minus
    // anything they avoid ("chicken" isn't searched for a vegetarian).
    function queriesFor(meal, o) {
        const likes = P.searchTerms(o.likes || '');
        const cuisines = P.searchTerms(String((o.settings && o.settings.cuisines) || '')).filter(t => (P.CUISINES || []).indexOf(t) >= 0);
        const ex = P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' });
        const base = QUERIES[meal];
        const liked = likes.map(t => (meal === 'breakfast' && !PL.mealFit({ name: t, ingredients: [] }).breakfast ? `${t} breakfast` : t));
        const extra = meal === 'breakfast' ? [] : cuisines.map(c => `${c} ${meal === 'lunch' ? 'salad' : ''}`.trim());
        const seen = new Set();
        return liked.concat(extra, base).filter(q => {
            if (seen.has(q) || ex({ name: q, ingredients: [q] })) return false;
            seen.add(q);
            return true;
        });
    }

    function goodLink(link, site, meal, ctx) {
        if (!link || !link.url || !/^https?:\/\//.test(link.url)) return false;
        const host = domainOf(link.url);
        if (site.domain && !(host === site.domain || host.endsWith('.' + site.domain))) return false;
        if (ROUNDUP.test(link.url) || NOT_RECIPE_TITLE.test(link.title || '')) return false;
        const t = link.title || slugWords(link.url);
        if (ctx.exclude({ name: t, ingredients: [] })) return false;
        const fit = PL.mealFit({ name: t, ingredients: [] });
        if (fit.why === 'a dessert' || fit.why === 'not a meal') return false;
        if (meal !== 'breakfast' && /\b(oatmeal|pancakes?|waffles?|granola|smoothie|muffins?|overnight oats)\b/i.test(t)) return false;
        return true;
    }

    // === THE RECIPE APIS ===
    function fromMealDb(m) {
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
            const ing = m[`strIngredient${i}`];
            if (ing && ing.trim()) ingredients.push(`${m[`strMeasure${i}`] || ''} ${ing}`.trim());
        }
        const steps = String(m.strInstructions || '').replace(/\.\s+/g, '.\n').split(/\r?\n/).map(s => s.replace(/^(step\s*)?\d+[.):]?\s*/i, '').trim()).filter(s => s.length > 3).slice(0, 14);
        return { name: m.strMeal, servings: 4, ingredients, steps, category: [m.strCategory, m.strArea].filter(Boolean),
            source_url: `https://www.themealdb.com/meal/${m.idMeal}`, source_name: 'TheMealDB' };
    }
    function fromSpoonacular(r) {
        const nutrient = name => { const f = ((r.nutrition && r.nutrition.nutrients) || []).find(n => n && n.name === name); return f ? f.amount : null; };
        return {
            name: r.title, servings: r.servings, time_minutes: r.readyInMinutes,
            nutrition: r.nutrition ? { calories: nutrient('Calories'), protein_g: nutrient('Protein'), carbs_g: nutrient('Carbohydrates'), fat_g: nutrient('Fat') } : null,
            ingredients: (r.extendedIngredients || []).map(i => i && i.original),
            steps: ((r.analyzedInstructions && r.analyzedInstructions[0] && r.analyzedInstructions[0].steps) || []).map(s => s && s.step),
            category: r.dishTypes || [], source_url: r.sourceUrl || r.spoonacularSourceUrl, source_name: r.sourceName || 'Spoonacular',
        };
    }

    // === FINDING RECIPES ===
    // o: { settings, likes, avoid, goal, days, enabled(id) → bool, fetchPage(url, {browser}) →
    //      {status, body}, readRecipe(html, url) → recipe|null, api(path, body) → json,
    //      webSearch(query, n) → [{url, title}], library() → [recipes], cache {get, set}, log, now,
    //      customSites: [domain], limits }
    // Returns { pools: { breakfast, lunch, dinner }, stats }.
    async function findRecipes(o) {
        const ctx = makeContext(o);
        const days = o.days || 7;
        const mealsOn = PL.mealsOf(o.settings || {});
        const want = Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(m => [m, mealsOn.indexOf(m) >= 0 ? days + 6 : 0]));
        const limits = Object.assign({}, LIMITS, o.limits || {});
        const enabled = o.enabled || (() => true);
        const found = [];
        const names = new Set();
        const add = (raw, source) => {
            const r = vet(tidy(raw, source), ctx);
            if (!r || names.has(r.sameAs[0])) return false;
            names.add(r.sameAs[0]);
            found.push(r);
            count(ctx, (source && source.id) || 'other', 'recipes');
            return true;
        };
        // Tested recipes from the sites (and the person's own) are what we want most; TheMealDB's
        // big batch doesn't count towards "enough", so the sites are still read.
        const have = meal => found.filter(r => r._fit[meal] && r.source_id !== 'themealdb').length;

        // 1. The person's own recipe library and recipes already read on earlier plans (instant).
        if (o.library && enabled('library')) {
            try { (await o.library()).forEach(r => add(Object.assign({ preferred: true }, r), { id: 'library', name: r.source_name || 'Your recipe library' })); } catch (e) { ctx.log('Library: ' + e.message); }
        }
        const recipeCache = ctx.cache.get(CACHE.recipes) || {};
        Object.keys(recipeCache).forEach(url => {
            const c = recipeCache[url];
            if (!c || !c.r || c.at < ctx.now() - 30 * DAY) return;
            const site = S.siteForUrl(url) || (c.r.source_id && S.byId(c.r.source_id));
            if (site && !enabled(site.id)) return;
            if (add(JSON.parse(JSON.stringify(c.r)), site || { id: c.r.source_id || 'other', name: c.r.source_name })) ctx.stats.fromCache++;
        });

        // 2. The recipe APIs (one request each).
        const apiJobs = [];
        if (o.api && enabled('themealdb')) {
            apiJobs.push((async () => {
                const terms = queriesFor('dinner', o).slice(0, 5).join(',');
                const data = await o.api('/api/recipes/themealdb', { query: terms, number: 30 });
                ((data && data.meals) || []).forEach(m => add(fromMealDb(m), S.byId('themealdb')));
            })().catch(e => { siteFailed(ctx, 'themealdb', e.message); }));
        }
        const spoonKey = o.settings && o.settings.spoonacular_api_key;
        if (o.api && enabled('spoonacular') && (spoonKey || o.spoonacularKeySaved)) {
            ['breakfast', 'lunch', 'dinner'].forEach(meal => apiJobs.push((async () => {
                const data = await o.api('/api/recipes/spoonacular', { query: queriesFor(meal, o)[0], number: 10, exclude: o.avoid || '', diet: o.spoonacularDiet, intolerances: (o.settings && o.settings.allergies) || undefined });
                ((data && data.results) || []).forEach(r => add(fromSpoonacular(r), S.byId('spoonacular')));
            })().catch(e => { siteFailed(ctx, 'spoonacular', e.message); })));
        }

        // 3. The recipe sites: searches spread over the sites, a few at a time.
        const goal = o.goal || (o.settings && o.settings.goal);
        let sites = S.usable().filter(s => enabled(s.id));
        (o.customSites || []).forEach(d => {
            const domain = String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
            if (domain && !sites.some(s => s.domain === domain)) sites.push({ id: 'custom:' + domain, name: domain, domain, search: 'wp', custom: true });
        });
        sites = sites.filter(s => siteOk(ctx, s.id));
        sites = shuffle(sites, Math.floor(ctx.now() / DAY));
        // Healthier sites first when losing weight; sites with their own nutrition next; your own sites first of all.
        sites.sort((a, b) => (b.custom ? 2 : 0) - (a.custom ? 2 : 0) + (goal === 'Cut' ? (b.healthy ? 1 : 0) - (a.healthy ? 1 : 0) : 0) + ((b.nutrition ? 0.5 : 0) - (a.nutrition ? 0.5 : 0)));
        const searchCache = ctx.cache.get(CACHE.searches) || {};
        const links = { breakfast: [], lunch: [], dinner: [] };
        const seenLinks = new Set(Object.keys(recipeCache));
        const tasks = [];
        const queries = { breakfast: queriesFor('breakfast', o), lunch: queriesFor('lunch', o), dinner: queriesFor('dinner', o) };
        let si = 0;
        for (let round = 0; round < 8 && tasks.length < limits.searches * 2; round++) {
            ['breakfast', 'lunch', 'dinner', 'dinner'].forEach((meal, k) => {
                if (!want[meal]) return;
                const q = queries[meal][(round * 2 + (k === 3 ? 1 : 0)) % queries[meal].length];
                if (sites.length) tasks.push({ meal, q, site: sites[si++ % sites.length] });
            });
        }
        let searches = 0;
        const enough = () => ['breakfast', 'lunch', 'dinner'].every(m => links[m].length + have(m) >= want[m] * 1.6);
        await Promise.all(apiJobs.concat([pool(tasks, limits.parallel, async t => {
            if (!siteOk(ctx, t.site.id) || enough()) return;
            const key = `${t.site.id}|${t.q}`;
            let list = searchCache[key] && searchCache[key].at > ctx.now() - 3 * DAY ? searchCache[key].links : null;
            if (!list) {
                if (searches >= limits.searches) return;
                searches++;
                ctx.stats.searches++;
                try {
                    list = (await searchSite(ctx, t.site, t.q)).slice(0, 10);
                    siteWorked(ctx, t.site.id);
                    searchCache[key] = { at: ctx.now(), links: list };
                } catch (e) {
                    siteFailed(ctx, t.site.id, e.message);
                    if (!e.blocked) siteFailed(ctx, t.site.id, e.message);   // not WordPress after all: skip it at once
                    return;
                }
            }
            list.filter(l => goodLink(l, t.site, t.meal, ctx)).forEach(l => {
                const url = String(l.url).split('#')[0];
                if (seenLinks.has(url)) return;
                seenLinks.add(url);
                links[t.meal].push({ url, title: l.title, site: t.site, meal: t.meal });
                count(ctx, t.site.id, 'links');
            });
        }, () => ctx.timeUp() || enough())]));

        // 4. Read the recipe pages: the meals that need recipes most first, one site at a time in turn.
        const order = [];
        const queues = Object.fromEntries(Object.keys(links).map(m => [m, links[m].slice()]));
        while (Object.values(queues).some(q => q.length)) {
            ['dinner', 'lunch', 'breakfast', 'dinner'].forEach(m => { if (queues[m].length) order.push(queues[m].shift()); });
        }
        let pages = 0;
        await pool(order, limits.parallel, async l => {
            if (pages >= limits.pages || have(l.meal) >= want[l.meal] || !siteOk(ctx, l.site.id)) return;
            pages++;
            ctx.stats.pages++;
            let res;
            try { res = await getPage(ctx, l.url, true); } catch (e) { if (e.blocked) siteFailed(ctx, l.site.id, e.message); return; }
            const raw = o.readRecipe(res.body, res.url || l.url);
            if (!raw) return;
            raw.source_url = res.url || l.url;
            raw.source_name = l.site.name;
            const t = tidy(raw, l.site);
            if (t) recipeCache[t.source_url] = { at: ctx.now(), r: t };
            add(raw, l.site);
        }, () => ctx.timeUp());

        // Keep the caches small: newest recipes and searches only.
        const trim = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1].at - a[1].at).slice(0, n));
        ctx.cache.set(CACHE.recipes, trim(recipeCache, limits.cachedRecipes));
        ctx.cache.set(CACHE.searches, trim(searchCache, 300));
        ctx.cache.set(CACHE.failures, ctx.failures);

        const pools = { breakfast: [], lunch: [], dinner: [] };
        found.forEach(r => PL.MEALS.forEach(m => { if (r._fit[m]) pools[m].push(r); }));
        ctx.stats.seconds = Math.round((ctx.now() - ctx.stats.started) / 100) / 10;
        ctx.stats.recipes = found.length;
        return { pools, stats: ctx.stats };
    }

    // Finds recipes and plans the week. Returns { days, missing, report, stats, targets }.
    async function planFromSources(o) {
        const { pools, stats } = await findRecipes(o);
        const priority = (o.settings && o.settings.source_priority) ? String(o.settings.source_priority).split(',') : [];
        const sourcePenalty = r => {
            let p = 0;
            if (r.preferred || r.source_id === 'library') p -= 0.6;
            const i = priority.indexOf(r.source_id);
            if (i >= 0) p -= (priority.length - i) * 0.05;
            if (r.nutrition_basis === 'source') p -= 0.1;
            if (r.source_id === 'themealdb') p += 0.3;   // no nutrition of its own, and less tested
            return p;
        };
        const exclude = P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' });
        const plan = PL.planWeek({ pools, settings: Object.assign({ goal: o.goal }, o.settings), likes: o.likes, days: o.days || 7, people: o.people || 1, sourcePenalty, already: o.already || [], exclude });
        plan.days.forEach(d => PL.MEALS.forEach(m => { if (d[m]) { delete d[m]._fit; delete d[m].sameAs; delete d[m].preferred; } }));
        return Object.assign(plan, { stats, pools });
    }

    const api = { findRecipes, planFromSources, queriesFor, goodLink, tidy, vet, fromMealDb, fromSpoonacular, LIMITS, CACHE, QUERIES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishFinder = api;
})(typeof window !== 'undefined' ? window : globalThis);
