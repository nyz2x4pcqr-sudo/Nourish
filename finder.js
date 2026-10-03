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
    const B = root.NourishBuiltins || req('./builtins.js');
    const N = root.NourishNutrition || req('./nutrition.js');

    // Gentle and quick: a few requests at a time, caps on searches and pages, and a time limit.
    const LIMITS = { parallel: 4, searches: 36, pages: 72, seconds: 40, cachedRecipes: 1200, perSlot: 21 };
    const CACHE = { recipes: 'nourish_recipe_cache', searches: 'nourish_search_cache', sitemaps: 'nourish_sitemap_cache', failures: 'nourish_source_failures', categories: 'nourish_site_categories' };
    const DAY = 24 * 3600 * 1000;

    // What to look for, meal by meal (breakfast words for breakfast, and so on). Each plan starts
    // at a different place in the lists, so the library keeps growing with new recipes. The person's
    // likes and cuisines come first.
    const QUERIES = {
        breakfast: ['eggs', 'overnight oats', 'yogurt bowl', 'smoothie', 'avocado toast', 'breakfast burrito', 'oatmeal', 'pancakes', 'frittata', 'egg muffins',
            'chia pudding', 'breakfast tacos', 'omelette', 'scrambled eggs', 'breakfast sandwich', 'shakshuka', 'french toast', 'breakfast bowl', 'waffles', 'granola', 'smoothie bowl', 'egg bites'],
        lunch: ['salad', 'wrap', 'sandwich', 'grain bowl', 'soup', 'chicken salad', 'quinoa salad', 'lettuce wraps', 'pasta salad', 'pita', 'lentil soup', 'noodle salad',
            'burrito bowl', 'rice bowl', 'quesadilla', 'chickpea salad', 'tuna salad', 'buddha bowl', 'poke bowl', 'panini'],
        dinner: ['chicken', 'salmon', 'shrimp', 'turkey', 'beef', 'tofu', 'pork', 'pasta', 'curry', 'stir fry', 'tacos', 'sheet pan dinner', 'chili', 'fish', 'skillet',
            'meatballs', 'fajitas', 'enchiladas', 'noodles', 'stew', 'lentils', 'risotto', 'casserole'],
    };
    const CORE = { breakfast: ['eggs', 'oatmeal', 'yogurt', 'smoothie', 'toast'], lunch: ['salad', 'soup', 'wrap', 'bowl', 'sandwich'], dinner: ['chicken', 'salmon', 'beef', 'tofu', 'shrimp', 'pasta'] };
    const MEAT = /\b(chicken|salmon|shrimp|turkey|beef|pork|fish|meatballs|tuna|steak|lamb|bacon|sausage)\b/i;
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
            active_minutes: Number(r.active_minutes) > 0 ? Math.round(Number(r.active_minutes)) : undefined,
            wait_minutes: Number(r.wait_minutes) > 0 ? Math.round(Number(r.wait_minutes)) : undefined,
            cuisine: r.cuisine ? String(Array.isArray(r.cuisine) ? r.cuisine[0] : r.cuisine).toLowerCase().slice(0, 30) : undefined,
            builtin: r.builtin || undefined,
            // Nourish's own recipes carry no numbers of their own: they're worked out like any other's.
            nutrition: !r.builtin && r.nutrition && Number(r.nutrition.calories) > 0 ? r.nutrition : null,
            category: Array.isArray(r.category) ? r.category.join(', ') : String(r.category || ''),
            keywords: r.keywords ? String(r.keywords).slice(0, 200) : undefined,
            source_url: r.source_url || r.url || undefined,
            source_name: r.source_name || (source && source.name) || undefined,
            source_id: (source && source.id) || r.source_id || undefined,
            healthy: !!(source && source.healthy) || undefined,
            library_path: r.library_path || undefined,
        };
        if (out.ingredients.length < 3 || !out.steps.length) return null;
        return out;
    }

    // Drinks, desserts, sauces, condiments and sides, from the recipe's own category, course and
    // keywords (its structured data) as well as its name: never counted as meals.
    const DRINK = /\b(drinks?|beverages?|cocktails?|mocktails?|smoothies?|shakes?|juices?|lemonade|agua fresca|horchata|tea|latte|coffee|punch|sangria|spritz|margarita|lassi|kombucha|hot chocolate|cocoa)\b/i;
    const SWEET = /\b(desserts?|sweets?|baking|baked goods|cakes?|cookies?|pies?|tarts?|candy|candies|treats?|puddings?|ice cream|frozen desserts?|pastr(y|ies)|brownies?|bars|cupcakes?|curd|jams?|jellies|preserves|compote|sorbet|fudge|frosting|cobbler|crumble|crisp)\b/i;
    const CONDIMENT = /\b(sauces?|condiments?|dressings?|dips?|spreads?|marinades?|seasonings?|spice (mix|blend|rub)s?|rubs?|salsas?|crema|pesto|chutney|relish|pickles?|vinaigrettes?|gravy|syrups?|stocks?|broths?|butter|aioli|mayo(nnaise)?|oil|chili oil|chili crisp|hack)\b/i;
    const SIDEDISH = /\b(side dish(es)?|sides?|appetizers?|starters?|snacks?|breads?|rolls|biscuits|muffins? \(sweet\)|applesauce|apple sauce|baby food)\b/i;
    function notAMeal(r) {
        // The site's own category and course (keywords are too loose: "garlic butter sauce" on a steak).
        const cat = [].concat(r.category || [], r.course || []).join(', ');
        const name = String(r.name || '');
        const dish = name.replace(/\s+(with|in|on|over|served with)\s+.*$/i, '').replace(/[^\x00-\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
        const mealish = /\b(main( course| dish)?|entr[eé]e|dinner|lunch|breakfast|brunch|supper)\b/i.test(cat);
        // Smoothies stay: they're a breakfast here (the breakfast check decides).
        if ((DRINK.test(dish) && !/smoothie|shake/i.test(dish)) || (/\b(drinks?|beverages?|cocktails?)\b/i.test(cat) && !mealish)) return 'a drink';
        if (/\bcurd\b|\b(applesauce|apple sauce|jam|jelly|compote)$/i.test(dish) || (/\b(desserts?|sweets?|baking|baked goods|treats?)\b/i.test(cat) && !mealish)) return 'a dessert';
        if ((CONDIMENT.test(dish.split(/\s+/).slice(-1)[0] || '') && !/\b(bowls?|pasta|noodles|chicken|salmon|tofu|steak|shrimp)\b/i.test(dish)) || (/\b(sauces?|condiments?|dressings?|dips?|spreads?|marinades?|seasonings?)\b/i.test(cat) && !mealish)) return 'a sauce or condiment';
        if (SIDEDISH.test(dish) && !mealish && /^(side|sides|side dish|appetizer|snack|bread)/i.test(cat || dish)) return 'a side or snack';
        return '';
    }

    // Checks one recipe; returns it ready to plan with (nutrition settled, seasoning fixed) or null.
    function whyChanged(before, now) {
        const was = JSON.parse(before || '{}');
        return Object.keys(now || {}).find(k => (now[k] || 0) > (was[k] || 0)) || '';
    }
    // Why recipes were turned away, counted for the log ("a drink: 3, a dessert: 5…").
    function turnedAway(ctx, why) { const w = ctx.stats.why || (ctx.stats.why = {}); w[why] = (w[why] || 0) + 1; return null; }
    function vet(r, ctx) {
        if (!r) return null;
        const avoided = ctx.exclude(r);
        if (avoided) {
            // Only a disliked side ingredient (never an allergy or the diet): swapped for something
            // similar when there's a sensible swap; otherwise kept aside for the AI to suggest one.
            const hard = ctx.excludeHard(r);
            const sub = !hard && PL.substituteFor(avoided);
            const changed = sub && PL.adapt(r, avoided, sub);
            if (changed && !ctx.exclude(changed)) { ctx.stats.adapted = (ctx.stats.adapted || 0) + 1; return vet(changed, ctx); }
            if (!hard && ctx.adaptable.length < 40 && PL.adapt(r, avoided, 'x')) ctx.adaptable.push({ r, term: avoided });
            ctx.stats.excluded++;
            return turnedAway(ctx, 'has something you avoid');
        }
        const kind = notAMeal(r);
        if (kind) return turnedAway(ctx, kind);
        // The source's numbers are per serving of the recipe as written; settle() checks them.
        if (r.nutrition && !(r.nutrition.calories > 0)) r.nutrition = null;
        N.settle(r);
        if (!r.nutrition || !(r.nutrition.calories > 40)) return turnedAway(ctx, 'too few calories to be a meal');
        const unmatched = (r.nutrition_unmatched || []).length;
        if (r.nutrition_basis === 'calculated' && unmatched > r.ingredients.length * 0.4) { ctx.stats.unsure++; return turnedAway(ctx, 'ingredients the calculator can\'t read'); }
        const fit = PL.mealFit(r);
        if (!fit.breakfast && !fit.lunch && !fit.dinner) return turnedAway(ctx, fit.why || 'not a meal');
        r._fit = fit;
        if (!PL.flavorCheck(r).ok) {
            PL.reseason(r);
            N.settle(r);
            if (!PL.flavorCheck(r).ok) { ctx.stats.bland++; return turnedAway(ctx, 'bland'); }
        }
        r.sameAs = [PL.dishKey(r.name)];
        return r;
    }

    function makeContext(o) {
        const now = o.now || (() => Date.now());
        const cache = o.cache || { get: () => null, set: () => {} };
        const failures = cache.get(CACHE.failures) || {};
        const stats = { started: now(), searches: 0, pages: 0, fromCache: 0, excluded: 0, bland: 0, unsure: 0, perSource: {}, failed: [], blocked: [] };
        return {
            o, now, cache, failures, stats,
            categories: cache.get(CACHE.categories) || {},
            sitemapsRead: {},
            skip: new Set(),   // sites that failed during this search: not asked again this time
            log: o.log || (() => {}),
            trace: o.trace || (() => {}),
            exclude: P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' }),
            excludeHard: P.excluder({ avoid: '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' }),
            adaptable: [],   // recipes with one disliked side ingredient and no ready swap (the AI may suggest one)
            out: false,
            timeUp() { return this.out || now() - stats.started > (o.limits && o.limits.seconds || LIMITS.seconds) * 1000; },
        };
    }
    function siteOk(ctx, id) { const f = ctx.failures[id]; return !(f && f.until > ctx.now()); }
    function siteFailed(ctx, id, why, blocked) {
        const f = ctx.failures[id] || { n: 0 };
        f.n++;
        f.blocked = !!blocked;
        f.until = blocked ? ctx.now() + (f.n >= 2 ? 30 : 7) * DAY : f.n >= 2 ? ctx.now() + DAY : 0;
        f.why = String(why || '').slice(0, 80);
        f.at = ctx.now();
        ctx.failures[id] = f;
        if (ctx.stats.failed.indexOf(id) < 0) ctx.stats.failed.push(id);
    }
    function siteWorked(ctx, id) { if (ctx.failures[id]) delete ctx.failures[id]; }
    function count(ctx, id, key) { const p = ctx.stats.perSource[id] || (ctx.stats.perSource[id] = { links: 0, recipes: 0 }); p[key]++; }

    // === SEARCHING ===
    // 403/405 (refused) and 429 (too many requests) mean "leave us alone": the site is blocked.
    async function getPage(ctx, url, browser) {
        const res = await ctx.o.fetchPage(url, { browser });
        if (!res || !res.status) throw new Error('no answer');
        if (res.status === 402 || res.status === 403 || res.status === 405 || res.status === 429) {
            const e = new Error(`HTTP ${res.status}`);
            e.blocked = true;
            throw e;
        }
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        return res;
    }

    // WordPress search, inside the site's own breakfast/lunch/dinner category when it has one.
    async function searchWp(ctx, site, q, meal) {
        const base = `https://${site.domain}`;
        const cat = meal ? await wpCategory(ctx, site, meal) : null;
        // Best match first, by the recipe's title: WordPress otherwise lists the newest posts that
        // mention the word anywhere ("eggs" → a coconut cake), which is how searches used to bring
        // back drinks, desserts and sauces. Older WordPress doesn't know search_columns: asked without.
        const plain = ctx.categories[`${site.id}|plain`];
        const url = `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&orderby=relevance${plain ? '' : '&search_columns=post_title'}&_fields=link,title${cat ? '&categories=' + cat : ''}`;
        let res;
        try { res = await getPage(ctx, url, false); } catch (e) {
            if (e.blocked || plain || !/HTTP 400/.test(e.message)) throw e;
            ctx.categories[`${site.id}|plain`] = { at: ctx.now(), id: 1 };
            return searchWp(ctx, site, q, meal);
        }
        ctx.trace(`${site.id}: "${q}" (${meal || 'any'}${cat ? ', its ' + meal + ' category' : ''})`);
        let list;
        try { list = JSON.parse(res.body); } catch (e) { throw new Error('not a WordPress answer'); }
        if (!Array.isArray(list)) throw new Error('not a WordPress answer');
        const out = list.map(p => ({ url: p && p.link, title: decode(p && p.title && p.title.rendered) })).filter(x => x.url);
        // Nothing in the category for these words: the whole site.
        if (!out.length && cat) return searchWp(ctx, site, q, null);
        return out;
    }
    // The site's category for a meal ("Breakfast", "Lunch", "Main Course"…), looked up once a month.
    const MEAL_CATEGORY = { breakfast: ['breakfast', 'brunch'], lunch: ['lunch'], dinner: ['dinner', 'main-course', 'main-dishes', 'main-dish', 'mains', 'entrees'] };
    async function wpCategory(ctx, site, meal) {
        const all = ctx.categories;
        const key = `${site.id}|${meal}`;
        const hit = all[key];
        if (hit && hit.at > ctx.now() - 30 * DAY) return hit.id || null;
        let id = 0;
        try {
            const res = await getPage(ctx, `https://${site.domain}/wp-json/wp/v2/categories?search=${MEAL_CATEGORY[meal][0].split('-')[0]}&per_page=20&_fields=id,slug,count`, false);
            const list = JSON.parse(res.body);
            const best = (Array.isArray(list) ? list : []).filter(c => c && MEAL_CATEGORY[meal].some(w => c.slug === w || c.slug === w + '-recipes' || c.slug === 'healthy-' + w)).sort((x, y) => (y.count || 0) - (x.count || 0))[0];
            if (best && best.count >= 10) id = best.id;
        } catch (e) { if (e.blocked) throw e; }
        all[key] = { at: ctx.now(), id };
        return id || null;
    }

    // A site's list of recipe addresses, downloaded at most once a month and kept small (just the
    // paths), so a big sitemap isn't downloaded on every plan.
    async function sitemapUrls(ctx, site) {
        const all = ctx.cache.get(CACHE.sitemaps) || {};
        const hit = all[site.id];
        const prefix = `https://${site.domain}`;
        if (hit && hit.at > ctx.now() - 30 * DAY && hit.paths && hit.paths.length) return hit.paths.map(p => prefix + p);
        if (ctx.sitemapsRead[site.id]) return ctx.sitemapsRead[site.id];
        const res = await getPage(ctx, site.sitemap, false);
        let urls = (String(res.body).match(/<loc>([^<]+)<\/loc>/g) || []).map(x => decode(x.replace(/<\/?loc>/g, '')));
        const maps = urls.filter(u => /\.xml/i.test(u) && /recipe/i.test(u)).slice(0, 2);
        for (const m of maps) {
            const r2 = await getPage(ctx, m, false);
            urls = urls.concat((String(r2.body).match(/<loc>([^<]+)<\/loc>/g) || []).map(x => decode(x.replace(/<\/?loc>/g, ''))));
        }
        urls = urls.filter(u => !/\.xml/i.test(u) && !ROUNDUP.test(u) && domainOf(u) === site.domain).slice(0, 2500);
        ctx.sitemapsRead[site.id] = urls;
        all[site.id] = { at: ctx.now(), paths: urls.map(u => { try { return new URL(u).pathname; } catch (e) { return ''; } }).filter(Boolean) };
        saveCache(ctx, CACHE.sitemaps, all);
        return urls;
    }
    async function searchSitemap(ctx, site, q) {
        const words = q.toLowerCase().split(/\s+/);
        return (await sitemapUrls(ctx, site)).filter(u => words.every(w => slugWords(u).indexOf(w) >= 0)).slice(0, 10).map(url => ({ url, title: slugWords(url) }));
    }

    async function searchSite(ctx, site, q, meal) {
        if (site.search === 'wp') return searchWp(ctx, site, q, meal);
        if (site.search === 'sitemap') return searchSitemap(ctx, site, q);
        if (site.search === 'web' && ctx.o.webSearch) return ctx.o.webSearch(`site:${site.domain} ${q} recipe`, 8);
        return [];
    }

    // The searches for each meal: the person's likes and cuisines first, then the meal's own words,
    // starting at a different place each plan (`seed`), minus anything they avoid ("chicken" isn't
    // searched for a vegetarian).
    function queriesFor(meal, o, seed) {
        const likes = P.searchTerms(o.likes || '');
        const cuisines = P.searchTerms(String((o.settings && o.settings.cuisines) || '')).filter(t => (P.CUISINES || []).indexOf(t) >= 0);
        const ex = P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' });
        // Broad words (lots of results) take turns with more specific ones (variety), and the
        // specific ones start at a different place each day.
        const core = CORE[meal];
        const rest = QUERIES[meal].filter(q => core.indexOf(q) < 0);
        const start = seed ? seed % rest.length : 0;
        const turned = rest.slice(start).concat(rest.slice(0, start));
        const rotated = [];
        for (let i = 0; i < Math.max(core.length, turned.length); i++) { if (core[i]) rotated.push(core[i]); if (turned[i]) rotated.push(turned[i]); }
        const liked = likes.map(t => (meal === 'breakfast' && !PL.mealFit({ name: t, ingredients: [] }).breakfast ? `${t} breakfast` : t));
        const extra = meal === 'breakfast' ? [] : cuisines.map(c => `${c} ${meal === 'lunch' ? 'salad' : ''}`.trim());
        const seen = new Set();
        return liked.concat(extra, rotated).filter(q => {
            if (seen.has(q) || ex({ name: q, ingredients: [q] })) return false;
            seen.add(q);
            return true;
        });
    }
    // Does a search suit a site? Each site gets only the meals it has (sources.js `meals`), its own
    // words if it has them (`terms`), and no meat searches on a vegetarian site.
    function siteSuits(site, meal, q) {
        if (site.meals && site.meals.indexOf(meal) < 0) return false;
        if (site.veg && MEAT.test(q)) return false;
        return true;
    }
    function siteQueries(site, meal, general) {
        const own = site.terms && site.terms[meal];
        return (own ? own.concat(general) : general).filter(q => siteSuits(site, meal, q));
    }

    function goodLink(link, site, meal, ctx) {
        if (!link || !link.url || !/^https?:\/\//.test(link.url)) return false;
        const host = domainOf(link.url);
        if (site.domain && !(host === site.domain || host.endsWith('.' + site.domain))) return false;
        if (ROUNDUP.test(link.url) || NOT_RECIPE_TITLE.test(link.title || '')) return false;
        const t = link.title || slugWords(link.url);
        if (ctx.exclude({ name: t, ingredients: [] })) return false;
        // Drinks, desserts, sauces and condiments are turned away before their pages are read.
        if (notAMeal({ name: t })) return false;
        const fit = PL.mealFit({ name: t, ingredients: [] });
        if (fit.why === 'a dessert' || fit.why === 'not a meal') return false;
        if (meal !== 'breakfast' && /\b(oatmeal|pancakes?|waffles?|granola|smoothie|muffins?|overnight oats)\b/i.test(t)) return false;
        if (meal === 'breakfast' && fit.why === 'a dinner dish') return false;
        return true;
    }

    // Saves a cache; when the phone's storage is full, the oldest quarter goes and it tries again.
    function saveCache(ctx, key, obj) {
        let data = obj;
        for (let i = 0; i < 4; i++) {
            if (ctx.cache.set(key, data) !== false) return data;
            const entries = Object.entries(data).sort((x, y) => ((y[1] && y[1].at) || 0) - ((x[1] && x[1].at) || 0));
            data = Object.fromEntries(entries.slice(0, Math.floor(entries.length * 0.75)));
            ctx.log(`Storage is full: kept the newest ${Object.keys(data).length} of ${entries.length} saved items (${key})`);
        }
        return data;
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
    //      customSites: [domain], limits, already: [dish names from recent plans] }
    // Returns { pools: { breakfast, lunch, dinner }, stats }.
    //
    // 1. The person's files, favourites and the local recipe library (every recipe read on earlier
    //    plans, kept for a year): instant, and work offline.
    // 2. The web, meal by meal, until each meal has at least 3 good candidates per day (21 for a
    //    week) that aren't from recent plans, or the time is up: breakfast words on sites that have
    //    breakfasts, inside the site's own breakfast category when it has one, and so on. Each page
    //    read is checked (a meal, not a drink, dessert or sauce; seasoned; nutrition worked out) and
    //    kept in the library.
    // 3. Nourish's own recipes (builtins.js), so there's always enough.
    async function findRecipes(o) {
        const ctx = makeContext(o);
        const days = o.days || 7;
        const MEALS = ['breakfast', 'lunch', 'dinner'];
        const mealsOn = PL.mealsOf(o.settings || {});
        const limits = Object.assign({}, LIMITS, o.limits || {});
        const perSlot = Math.max(3, Math.min(limits.perSlot, days * 3));
        const want = m => (mealsOn.indexOf(m) >= 0 ? perSlot : 0);
        const enabled = o.enabled || (() => true);
        const recent = PL.dishList(o.already || []);
        const found = [];
        // The same dish from two sites (or with a slightly different name) counts once.
        const names = PL.dishList();
        const add = (raw, source) => {
            const r = vet(tidy(raw, source), ctx);
            if (!r || names.has(r.name)) return false;
            names.add(r.name);
            found.push(r);
            count(ctx, (source && source.id) || 'other', 'recipes');
            return true;
        };
        // Good candidates for a meal: not Nourish's own (always there), not TheMealDB (a few, less
        // tested), not from a recent plan.
        const have = m => found.filter(r => r._fit[m] && r.source_id !== 'themealdb' && r.source_id !== 'builtin' && !recent.has(r.name)).length;
        const short = m => want(m) - have(m);

        // 1. Your files, favourites and the local recipe library.
        if (o.library && enabled('library')) {
            // On equal terms with every other source (no head start): the books mainly teach (pairingScore).
            try { (await o.library()).forEach(r => add(Object.assign({}, r), { id: 'library', name: r.source_name || 'Your recipe library' })); } catch (e) { ctx.log('Library: ' + e.message); }
        }
        // Favourites from the Cookbook (taste.js decides how often they come back): on equal terms.
        if (o.favorites && o.favorites.recipes) {
            o.favorites.recipes.forEach(r => add(JSON.parse(JSON.stringify(r)), { id: r.source_id || 'cookbook', name: r.source_name || 'Your Cookbook' }));
        }
        let recipeCache = ctx.cache.get(CACHE.recipes) || {};
        Object.keys(recipeCache).forEach(url => {
            const c = recipeCache[url];
            if (!c || !c.r || c.at < ctx.now() - 365 * DAY) return;
            const site = S.siteForUrl(url) || (c.r.source_id && S.byId(c.r.source_id));
            if (site && !enabled(site.id)) return;
            if (add(JSON.parse(JSON.stringify(c.r)), site || { id: c.r.source_id || 'other', name: c.r.source_name })) ctx.stats.fromCache++;
        });
        ctx.stats.library = Object.keys(recipeCache).length;

        // 2a. The recipe APIs (one request each). TheMealDB is searched for every meal, a few each.
        const apiJobs = [];
        if (o.api && enabled('themealdb') && siteOk(ctx, 'themealdb')) {
            apiJobs.push((async () => {
                const seed = Math.floor(ctx.now() / DAY);
                const terms = queriesFor('dinner', o, seed).slice(0, 3).concat(['soup', 'salad']).join(',');
                const data = await o.api('/api/recipes/themealdb', { query: terms, number: 30 });
                let n = 0;
                ((data && data.meals) || []).forEach(m => { if (n < 12 && add(fromMealDb(m), S.byId('themealdb'))) n++; });
            })().catch(e => { siteFailed(ctx, 'themealdb', e.message, e.blocked); }));
        }
        const spoonKey = o.settings && o.settings.spoonacular_api_key;
        if (o.api && enabled('spoonacular') && (spoonKey || o.spoonacularKeySaved) && siteOk(ctx, 'spoonacular')) {
            MEALS.filter(m => want(m)).forEach(meal => apiJobs.push((async () => {
                const data = await o.api('/api/recipes/spoonacular', { query: queriesFor(meal, o)[0], number: 10, exclude: o.avoid || '', diet: o.spoonacularDiet, intolerances: (o.settings && o.settings.allergies) || undefined });
                ((data && data.results) || []).forEach(r => add(fromSpoonacular(r), S.byId('spoonacular')));
            })().catch(e => { siteFailed(ctx, 'spoonacular', e.message, e.blocked); })));
        }

        // 2b. The recipe sites, meal by meal: the meal that's furthest from enough goes first, each
        // site gets only searches that suit it, and every site gets its turn (no one site fills the
        // pool: at most a fair share of the pages each).
        const goal = o.goal || (o.settings && o.settings.goal);
        let sites = S.usable().filter(s => enabled(s.id));
        (o.customSites || []).forEach(d => {
            const domain = String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
            if (domain && !sites.some(s => s.domain === domain)) sites.push({ id: 'custom:' + domain, name: domain, domain, search: 'wp', custom: true });
        });
        ctx.stats.blocked = sites.filter(s => !siteOk(ctx, s.id)).map(s => `${s.id} (${(ctx.failures[s.id] || {}).why || 'failed'})`);
        sites = sites.filter(s => siteOk(ctx, s.id));
        const seed = Math.floor(ctx.now() / DAY);
        sites = shuffle(sites, seed);
        // Healthier sites first when losing weight; sites with their own nutrition next; your own sites first of all.
        sites.sort((a, b) => (b.custom ? 2 : 0) - (a.custom ? 2 : 0) + (goal === 'Cut' ? (b.healthy ? 1 : 0) - (a.healthy ? 1 : 0) : 0) + ((b.nutrition ? 0.5 : 0) - (a.nutrition ? 0.5 : 0)));
        const searchCache = ctx.cache.get(CACHE.searches) || {};
        const queries = Object.fromEntries(MEALS.map(m => [m, queriesFor(m, o, seed)]));
        const seenLinks = new Set(Object.keys(recipeCache));
        const tried = new Set();
        const turn = { breakfast: 0, lunch: 0, dinner: 0 };
        const sitePages = {};
        const fairPages = Math.max(4, Math.ceil(limits.pages / Math.max(1, sites.length)) * 2);
        let searches = 0;
        let pages = 0;
        const usableSite = s => siteOk(ctx, s.id) && !ctx.skip.has(s.id);
        // The next search: for the meal that's furthest from enough, the next site in turn that
        // suits it, with a word not tried on that site yet.
        const spent = { breakfast: 0, lunch: 0, dinner: 0 };
        const nextTask = () => {
            // Every meal gets its turn, the ones furthest from enough more often.
            const meals = MEALS.filter(m => short(m) > 0).sort((x, y) => short(y) / (1 + spent[y]) - short(x) / (1 + spent[x]));
            for (const meal of meals) {
                const suited = sites.filter(s => usableSite(s) && siteSuits(s, meal, '') && (sitePages[s.id] || 0) < fairPages);
                for (let k = 0; k < suited.length; k++) {
                    const site = suited[(turn[meal]++) % suited.length];
                    // Each site starts at a different word, so the sites together cover more dishes.
                    const list = siteQueries(site, meal, queries[meal]);
                    const offset = (sites.indexOf(site) * 3) % Math.max(1, list.length);
                    const q = list.slice(offset).concat(list.slice(0, offset)).find(x => !tried.has(`${site.id}|${meal}|${x}`));
                    if (q) { tried.add(`${site.id}|${meal}|${q}`); spent[meal]++; return { site, meal, q }; }
                }
            }
            return null;
        };
        const readPage = async (l, site, meal) => {
            pages++;
            ctx.stats.pages++;
            sitePages[site.id] = (sitePages[site.id] || 0) + 1;
            let res;
            try { res = await getPage(ctx, l.url, true); } catch (e) {
                ctx.trace(`  ${e.message} ${l.url}`);
                if (e.blocked) { siteFailed(ctx, site.id, `recipe pages: ${e.message}`, true); ctx.skip.add(site.id); }
                return;
            }
            const raw = o.readRecipe(res.body, res.url || l.url);
            if (!raw) { count(ctx, site.id, 'unreadable'); ctx.trace(`  no recipe data on ${l.url}`); return; }
            raw.source_url = res.url || l.url;
            raw.source_name = site.name;
            const t = tidy(raw, site);
            if (t) recipeCache[t.source_url] = { at: ctx.now(), r: t };
            const before = JSON.stringify(ctx.stats.why || {});
            const ok = add(raw, site);
            ctx.trace(`  ${ok ? 'kept' : 'not kept'}: ${raw.name}${ok ? '' : ` (${whyChanged(before, ctx.stats.why) || 'already have it'})`}`);
        };
        const worker = async () => {
            while (!ctx.timeUp()) {
                const t = nextTask();
                if (!t) return;
                const key = `${t.site.id}|${t.meal}|${t.q}`;
                let list = searchCache[key] && searchCache[key].at > ctx.now() - 3 * DAY ? searchCache[key].links : null;
                if (!list) {
                    if (searches >= limits.searches) return;
                    searches++;
                    ctx.stats.searches++;
                    try {
                        list = (await searchSite(ctx, t.site, t.q, t.meal)).slice(0, 10);
                        siteWorked(ctx, t.site.id);
                        searchCache[key] = { at: ctx.now(), links: list };
                    } catch (e) {
                        ctx.trace(`${t.site.id}: "${t.q}" failed: ${e.message}${e.blocked ? ' (the site refuses the app: left alone for a while)' : ''}`);
                        siteFailed(ctx, t.site.id, e.message, e.blocked);
                        ctx.skip.add(t.site.id);
                        continue;
                    }
                }
                const good = list.filter(l => goodLink(l, t.site, t.meal, ctx)).map(l => Object.assign({}, l, { url: String(l.url).split('#')[0] })).filter(l => !seenLinks.has(l.url));
                count(ctx, t.site.id, "links");
                for (const l of good.slice(0, 4)) {
                    if (ctx.timeUp() || pages >= limits.pages || short(t.meal) <= 0 || !usableSite(t.site) || (sitePages[t.site.id] || 0) >= fairPages) break;
                    seenLinks.add(l.url);
                    await readPage(l, t.site, t.meal);
                }
            }
        };
        if (!o.offline) await Promise.all(apiJobs.concat(Array.from({ length: limits.parallel }, worker)));

        // 3. Nourish's own recipes, on equal terms with every other source.
        if (B && enabled('builtin')) {
            MEALS.forEach(m => B.forMeal(m).forEach(r => add(JSON.parse(JSON.stringify(r)), S.byId('builtin'))));
        }

        // The library keeps every recipe read (newest first when it has to be trimmed), and the
        // searches, sitemaps and categories are remembered.
        const trim = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1].at - a[1].at).slice(0, n));
        recipeCache = saveCache(ctx, CACHE.recipes, trim(recipeCache, limits.cachedRecipes));
        ctx.stats.library = Object.keys(recipeCache).length;
        saveCache(ctx, CACHE.searches, trim(searchCache, 400));
        ctx.cache.set(CACHE.failures, ctx.failures);
        ctx.cache.set(CACHE.categories, ctx.categories);

        const pools = { breakfast: [], lunch: [], dinner: [] };
        found.forEach(r => MEALS.forEach(m => { if (r._fit[m]) pools[m].push(r); }));
        ctx.stats.seconds = Math.round((ctx.now() - ctx.stats.started) / 100) / 10;
        ctx.stats.recipes = found.length;
        ctx.stats.perMeal = Object.fromEntries(MEALS.map(m => [m, { all: pools[m].length, web: have(m), builtin: pools[m].filter(r => r.source_id === 'builtin').length }]));
        return { pools: balance(pools, perSlot, seed, recent), stats: ctx.stats, adaptable: ctx.adaptable };
    }

    // No one website fills a meal's pool: each keeps at most about a third of the web recipes (a
    // varied pick, recipes from recent plans last). The person's files and Nourish's own recipes
    // are all kept; the planner then spreads a plan's meals across sources (planner.js).
    function balance(pools, perSlot, seed, recent) {
        const out = {};
        const isRecent = r => !!(recent && recent.has(r.name));
        const keepAll = r => ['builtin', 'library', 'cookbook'].indexOf(r.source_id) >= 0;
        Object.keys(pools).forEach(m => {
            const list = pools[m];
            const web = list.filter(r => !keepAll(r));
            const cap = Math.max(10, Math.ceil(web.length * 0.35));
            const bySource = {};
            shuffle(web, seed + m.length).forEach(r => { (bySource[r.source_id || 'other'] = bySource[r.source_id || 'other'] || []).push(r); });
            const kept = list.filter(keepAll);
            Object.values(bySource).forEach(group => kept.push(...group.sort((a, b) => (isRecent(a) ? 1 : 0) - (isRecent(b) ? 1 : 0)).slice(0, cap)));
            out[m] = kept;
        });
        return out;
    }

    // How much a recipe's source counts for or against it (lower is better). Every source is on
    // equal terms except: the sites the person listed first, sites' own nutrition, TheMealDB (less
    // tested) and, for any source, pairings the person's cookbooks use (o.pairingScore).
    function sourceCost(r, o) {
        const priority = (o.settings && o.settings.source_priority) ? String(o.settings.source_priority).split(',') : [];
        let p = 0;
        if (o.pairingScore) { try { p -= Math.min(1, o.pairingScore(r) || 0) * 0.2; } catch (e) { /* no books */ } }
        const i = priority.indexOf(r.source_id);
        if (i >= 0) p -= (priority.length - i) * 0.05;
        if (r.nutrition_basis === 'source') p -= 0.1;
        if (r.source_id === 'themealdb') p += 0.3;   // no nutrition of its own, and less tested
        return p;
    }

    // Finds recipes and plans the week. Returns { days, missing, report, stats, targets }.
    async function planFromSources(o) {
        const { pools, stats, adaptable } = await findRecipes(o);
        const sourcePenalty = r => sourceCost(r, o);
        const exclude = P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' });
        const plan = PL.planWeek({ pools, settings: Object.assign({ goal: o.goal }, o.settings), likes: o.likes, days: o.days || 7, people: o.people || 1, sourcePenalty, already: o.already || [], exclude, weekday: o.weekday, taste: o.taste, favorites: o.favorites });
        plan.days.forEach(d => PL.MEALS.forEach(m => { if (d[m]) { delete d[m]._fit; delete d[m].sameAs; delete d[m].preferred; } }));
        return Object.assign(plan, { stats, pools, adaptable });
    }

    const api = { findRecipes, planFromSources, sourceCost, notAMeal, balance, siteSuits, siteQueries, queriesFor, goodLink, tidy, vet, fromMealDb, fromSpoonacular, LIMITS, CACHE, QUERIES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishFinder = api;
})(typeof window !== 'undefined' ? window : globalThis);
