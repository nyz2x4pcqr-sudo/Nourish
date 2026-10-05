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
    const LIMITS = { parallel: 4, searches: 36, pages: 72, seconds: 25, cachedRecipes: 1200, perSlot: 21 };
    const CACHE = { recipes: 'nourish_recipe_cache', searches: 'nourish_search_cache', sitemaps: 'nourish_sitemap_cache', failures: 'nourish_source_failures', categories: 'nourish_site_categories', pages: 'nourish_search_pages', listings: 'nourish_search_listings', robots: 'nourish_site_robots', mealdb: 'nourish_mealdb_cache' };
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
    // Searched first when the protein target is a big share of the calories (more than about 28%):
    // recipes that already have the protein, so nothing ever needs adding to them.
    const HIGH_PROTEIN = {
        breakfast: ['high protein breakfast', 'egg white', 'cottage cheese', 'greek yogurt', 'protein pancakes', 'egg scramble', 'protein oats', 'breakfast burrito'],
        lunch: ['high protein lunch', 'chicken salad', 'tuna salad', 'turkey wrap', 'chicken bowl', 'shrimp salad', 'lentil salad', 'egg salad'],
        dinner: ['high protein dinner', 'chicken breast', 'lean beef', 'cod', 'shrimp', 'turkey', 'tofu', 'tempeh', 'salmon'],
    };
    function wantsProtein(o) {
        try { const T = PL.targetsOf(Object.assign({ goal: o.goal }, o.settings || {})); return T.kcal > 0 && T.protein * 4 / T.kcal >= 0.28; } catch (e) { return false; }
    }
    const CORE = { breakfast: ['eggs', 'oatmeal', 'yogurt', 'smoothie', 'toast'], lunch: ['salad', 'soup', 'wrap', 'bowl', 'sandwich'], dinner: ['chicken', 'salmon', 'beef', 'tofu', 'shrimp', 'pasta'] };
    const MEAT = /\b(chicken|salmon|shrimp|turkey|beef|pork|fish|meatballs|tuna|steak|lamb|bacon|sausage)\b/i;
    const ROUNDUP = /(\/(category|tag|collections?|recipes?)\/?$|best-|-ideas|ideas-|meal-plan|what-to-(cook|make|eat)|roundup|-challenge|-guide|-101|\d+-(easy|best|healthy|quick)|-recipes\/?$)/i;
    const NOT_RECIPE_TITLE = /\b(best|ideas|recipes|meal plan|meal prep plan|what to|roundup|guide|review|tips|how to (store|freeze)|gift|giveaway|favorites|vs\.?)\b|^\d+\s/i;

    function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
    function decode(s) {
        return String(s || '').replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();
    }
    // The dish's words from the last part of an address: /food/recipes/scrambled_eggs_31700 → "scrambled eggs".
    function dishWords(url) {
        try {
            const last = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '').split('/').pop();
            return last.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\brecipe\b/g, ' ').replace(/\s+/g, ' ').trim();
        } catch (e) { return ''; }
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
            // The source's own description of the dish (whole sentences only), shown instead of one
            // written by the AI.
            description: r.description && !/\.\.\.$|…$/.test(String(r.description).trim()) ? String(r.description).slice(0, 240) : undefined,
            rating: r.rating && Number(r.rating.value) > 0 ? { value: Number(r.rating.value), count: Number(r.rating.count) || 0 } : undefined,
            source_url: r.source_url || r.url || undefined,
            source_name: r.source_name || (source && source.name) || undefined,
            source_id: (source && source.id) || r.source_id || undefined,
            healthy: !!(source && source.healthy) || undefined,
            library_path: r.library_path || undefined,
            // A recipe from the person's books (recipedb.js) keeps where it came from.
            from_book: r.from_book || undefined,
            book: r.book || undefined,
            author: r.author || undefined,
            chapter: r.chapter || undefined,
            page: r.page || undefined,
            book_id: r.book_id || undefined,
            book_recipe_id: r.from_book ? (r.book_recipe_id || r.id) : undefined,
        };
        Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
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
        // Smoothies and shakes are judged by planner.mealFit: a breakfast when filling enough, else a drink.
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
        // Something the person avoids: the recipe is left out. A recipe is never changed to fit.
        const avoided = ctx.exclude(r);
        if (avoided) {
            ctx.stats.excluded++;
            return turnedAway(ctx, 'has something you avoid');
        }
        const kind = notAMeal(r);
        if (kind) return turnedAway(ctx, kind);
        // The source's numbers are per serving of the recipe as written; settle() checks them.
        if (r.nutrition && !(r.nutrition.calories > 0)) r.nutrition = null;
        N.settle(r);
        // Lines the calculator can't read: kept in the log word for word. When they're all small
        // (a teaspoon of something, a garnish, a sweetener), the recipe stays, its nutrition marked
        // approximate; it's turned away only when real amounts of food can't be read.
        const unread = r.nutrition_unmatched || [];
        if (unread.length) {
            const site = r.source_name || r.source_id || '?';
            const list = ctx.stats.unread || (ctx.stats.unread = []);
            unread.forEach(l => { if (list.length < 60) list.push(`${site}: ${l}`); });
        }
        const major = unread.filter(l => !N.isMinor(l));
        if (r.nutrition_basis === 'calculated' && major.length && (major.length >= 3 || major.length > r.ingredients.length * 0.25)) { ctx.stats.unsure++; return turnedAway(ctx, 'ingredients the calculator can\'t read'); }
        if (unread.length) r.nutrition_approximate = true;
        if (!r.nutrition || !(r.nutrition.calories > 40)) return turnedAway(ctx, 'too few calories to be a meal');
        const fit = PL.mealFit(r);
        if (!fit.breakfast && !fit.lunch && !fit.dinner) return turnedAway(ctx, fit.why || 'not a meal');
        r._fit = fit;
        // A recipe that looks bland is kept as written (never re-seasoned); it just comes after others.
        if (!PL.flavorCheck(r).ok) { ctx.stats.bland++; r.bland = true; }
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
            feeds: {},
            robots: cache.get(CACHE.robots) || {},
            robotsReading: {},
            listings: {},   // filled from the cache in findRecipes
            memo: {},
            skip: new Set(),   // sites that failed during this search: not asked again this time
            siteErrors: {},   // errors per site in this search (a few are allowed before it is left alone)
            log: o.log || (() => {}),
            trace: o.trace || (() => {}),
            exclude: P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' }),
            excludeHard: P.excluder({ avoid: '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' }),
            adaptable: [],   // recipes with one disliked side ingredient and no ready swap (the AI may suggest one)
            out: false,
            cap: null,   // seconds, set lower when the library already has enough
            timeUp() { return this.out || now() - stats.started > Math.min(this.cap || Infinity, (o.limits && o.limits.seconds) || LIMITS.seconds) * 1000; },
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
    // Search and list pages are remembered by address for 3 days, so the same address is never
    // asked for twice (lunch and dinner can lead to the same search).
    async function getListing(ctx, url, browser) {
        const hit = ctx.listings[url];
        if (hit && hit.at > ctx.now() - 3 * DAY) return hit.res;
        // One request per address per run, shared by workers asking at the same moment (a missing
        // page is then asked for once, not once per worker).
        if (!ctx.memo[url]) {
            ctx.memo[url] = getPage(ctx, url, browser).then(res => {
                const small = { status: res.status, url: res.url, body: String(res.body || '') };
                if (small.body.length < 60000) ctx.listings[url] = { at: ctx.now(), res: small };
                return small;
            });
        }
        return ctx.memo[url];
    }
    // Each site's robots.txt, read about once a month: a page it asks robots not to read is never
    // fetched. A site that won't even let the app read its robots.txt (403) is treated as refusing.
    function robotsRules(text) {
        const rules = [];
        let mine = false, inGroup = false;
        String(text || '').split(/\r?\n/).forEach(line => {
            const m = line.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
            if (!m) return;
            const k = m[1].toLowerCase(), v = m[2].trim();
            if (k === 'user-agent') { if (!inGroup) mine = false; inGroup = true; if (v === '*' || /nourish/i.test(v)) mine = true; return; }
            inGroup = false;
            if (mine && (k === 'allow' || k === 'disallow') && v) rules.push([k, v]);
        });
        return rules;
    }
    function robotsAllow(rules, path) {
        let best = null;
        (rules || []).forEach(([k, v]) => {
            const re = new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
            if (re.test(path) && (!best || v.length > best[1].length || (v.length === best[1].length && k === 'allow'))) best = [k, v];
        });
        return !best || best[0] === 'allow';
    }
    async function robotsFor(ctx, site, origin) {
        const all = ctx.robots;
        const hit = all[site.id];
        if (hit && hit.at > ctx.now() - 30 * DAY) return hit;
        if (!ctx.robotsReading[site.id]) {
            ctx.robotsReading[site.id] = (async () => {
                let res = null;
                try { res = await ctx.o.fetchPage(`${origin || 'https://' + site.domain}/robots.txt`, { browser: false }); } catch (e) { res = null; }
                const status = res && res.status;
                const entry = { at: ctx.now(), rules: status === 200 ? robotsRules(res.body).slice(0, 300) : [], refused: status === 403 || status === 401 };
                if (status === 200 || status === 403 || status === 401 || status === 404 || status === 410) all[site.id] = entry;   // otherwise asked again next time
                return entry;
            })();
        }
        return ctx.robotsReading[site.id];
    }
    async function getPage(ctx, url, browser) {
        const site = S.siteForUrl(url);
        if (site && !site.custom) {
            let origin = '';
            try { origin = new URL(url).origin; } catch (e) { /* none */ }
            const rb = await robotsFor(ctx, site, origin);
            if (rb.refused) { const e = new Error('refuses to show its robots.txt (403)'); e.blocked = true; throw e; }
            let path = '/';
            try { const u = new URL(url); path = u.pathname + u.search; } catch (e) { /* keep "/" */ }
            if (!robotsAllow(rb.rules, path)) throw new Error('robots.txt asks robots not to read this page');
        }
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

    // === WAYS TO FIND RECIPES ON A SITE (sources.js `find`, best first) ===
    // 'wp'       WordPress search (the site's /wp-json feed)
    // 'page'     the site's own search results page (`searchUrl`, {q} and {page})
    // 'category' its breakfast/lunch/dinner/healthy/quick pages (`categories`)
    // 'sitemap'  its list of recipe addresses (`sitemap`): the index once a month, then one more
    //            part of it per run, never the whole thing every time
    // 'rss'      its public feed (`feed`)
    // Each recipe page is then read with the same structured-data reader (importer.js).
    const GENERIC_WORDS = /^(easy|quick|healthy|best|simple|recipe|recipes|bowl|bowls|salad|soup|breakfast|lunch|dinner|homemade)$/i;
    function mainWord(q) {
        const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        return words.filter(w => !GENERIC_WORDS.test(w)).sort((a, b) => b.length - a.length)[0] || words[0] || q;
    }
    // Links on a page that look like recipe pages on the same site (`recipePath` narrows them down).
    function linksFromHtml(html, site, base) {
        const out = [];
        const seen = new Set();
        const keep = site.recipePath ? new RegExp(site.recipePath, 'i') : null;
        for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
            let u;
            try { u = new URL(decode(m[1]), base); } catch (e) { continue; }
            const host = u.hostname.replace(/^www\./, '').toLowerCase();
            if (!(host === site.domain || host.endsWith('.' + site.domain))) continue;
            const path = u.pathname;
            if (keep ? !keep.test(path) : !(path.length > 12 && /-/.test(path))) continue;
            if (ROUNDUP.test(path) || /\.(css|js|png|jpe?g|gif|svg|webp|xml|json|pdf)$/i.test(path) || /\/(search|login|account|cart|privacy|terms|tag|author|page)\b/i.test(path)) continue;
            const url = u.origin + path;
            if (seen.has(url)) continue;
            seen.add(url);
            const title = decode(m[2]).replace(/\s+/g, ' ').trim().slice(0, 120);
            out.push({ url, title: title && title.length > 3 ? title : dishWords(url) });
        }
        return out;
    }
    // Keeps the links that match the words; when none do, all of them (a category or feed is already about the meal).
    function matching(links, q) {
        const words = String(q || '').toLowerCase().split(/\s+/).filter(w => w.length > 2 && !GENERIC_WORDS.test(w));
        if (!words.length) return links;
        const hit = links.filter(l => words.some(w => (`${l.title} ${slugWords(l.url)}`).toLowerCase().indexOf(w.replace(/s$/, '')) >= 0));
        return hit.length ? hit : links;
    }

    // WordPress search: by title first, best match first, inside the site's own meal category when
    // it has one. A search that finds nothing tries again more broadly: the whole text instead of
    // titles ("breakfast tacos" is rarely a title word for word), then the main word alone
    // ("omelette"), then simply the newest recipes in the meal's category.
    async function wpPosts(ctx, site, params) {
        const base = `https://${site.domain}`;
        const res = await getListing(ctx, `${base}/wp-json/wp/v2/posts?${params}&_fields=link,title`, false);
        let list;
        try { list = JSON.parse(res.body); } catch (e) { throw new Error('not a WordPress answer'); }
        if (!Array.isArray(list)) throw new Error('not a WordPress answer');
        return list.map(p => ({ url: p && p.link, title: decode(p && p.title && p.title.rendered) })).filter(x => x.url);
    }
    async function searchWp(ctx, site, q, meal, page = 1) {
        const cat = meal ? await wpCategory(ctx, site, meal) : null;
        const inCat = cat ? '&categories=' + cat : '';
        const plain = ctx.categories[`${site.id}|plain`];
        const tries = [];
        if (!plain) tries.push([`title "${q}"`, `search=${encodeURIComponent(q)}&search_columns=post_title&orderby=relevance&per_page=10&page=${page}${inCat}`]);
        tries.push([`"${q}"`, `search=${encodeURIComponent(q)}&orderby=relevance&per_page=10&page=${page}${inCat}`]);
        const word = mainWord(q);
        if (word !== q) tries.push([`"${word}"`, `search=${encodeURIComponent(word)}&orderby=relevance&per_page=10&page=${page}${inCat}`]);
        if (cat) tries.push([`its ${meal} recipes`, `categories=${cat}&per_page=10&page=${page + (ctx.seed || 0) % 5}`]);
        for (const [how, params] of tries) {
            let list;
            try { list = await wpPosts(ctx, site, params); } catch (e) {
                // Older WordPress doesn't know search_columns: asked without from now on.
                if (!e.blocked && /HTTP 400/.test(e.message) && /search_columns/.test(params)) { ctx.categories[`${site.id}|plain`] = { at: ctx.now(), id: 1 }; continue; }
                throw e;
            }
            // Roundups ("25 Best Dinner Ideas") don't count: only links that could be a recipe.
            const usable = list.filter(l => !ROUNDUP.test(l.url) && !NOT_RECIPE_TITLE.test(l.title || ''));
            if (usable.length) { ctx.trace(`${site.id}: ${how} (${meal || 'any'}${cat ? ', in its ' + meal + ' category' : ''}): ${usable.length}`); return usable; }
        }
        ctx.trace(`${site.id}: "${q}" (${meal || 'any'}): nothing`);
        return [];
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

    // The site's own search results page.
    async function searchPage(ctx, site, q, meal, page = 1) {
        if (!site.searchUrl) return [];
        const url = site.searchUrl.replace('{q}', encodeURIComponent(q)).replace('{page}', String(page));
        const res = await getListing(ctx, url, true);
        let links = linksFromHtml(res.body, site, res.url || url);
        if (!links.length && q !== mainWord(q)) return searchPage(ctx, site, mainWord(q), meal, page);
        ctx.trace(`${site.id}: search page "${q}": ${links.length}`);
        return links;
    }
    // The site's breakfast, lunch or dinner pages (and healthy or quick ones), a different page each run.
    async function searchCategory(ctx, site, q, meal, page = 1) {
        const list = ((site.categories || {})[meal] || []).concat((site.categories || {}).any || []);
        if (!list.length) return [];
        // A page that isn't there (404) is remembered for a month and the next one is tried: one
        // moved page doesn't stop the site.
        const start = ((ctx.seed || 0) + page - 1) % list.length;
        let lastError = null;
        for (let k = 0; k < list.length; k++) {
            const pick = list[(start + k) % list.length];
            const url = (/^https?:/.test(pick) ? pick : `https://${site.domain}${pick}`).replace('{page}', String(page));
            const dead = ctx.categories[`dead|${url}`];
            if (dead && dead.at > ctx.now() - 30 * DAY) continue;
            let res;
            try { res = await getListing(ctx, url, true); } catch (e) {
                if (e.blocked || !/HTTP (404|410)/.test(e.message)) throw e;
                ctx.categories[`dead|${url}`] = { at: ctx.now(), id: 0 };
                ctx.trace(`${site.id}: ${meal} page ${url}: not there (${e.message}), trying another`);
                lastError = e;
                continue;
            }
            const links = linksFromHtml(res.body, site, res.url || url);
            ctx.trace(`${site.id}: ${meal} page ${url}: ${links.length}`);
            return matching(links, q);
        }
        if (lastError) throw lastError;
        return [];
    }
    // The site's public feed (RSS or Atom), read at most once a day.
    async function searchFeed(ctx, site, q) {
        if (!site.feed) return [];
        let items = ctx.feeds[site.id];
        if (!items) {
            const res = await getListing(ctx, site.feed, false);
            items = [...String(res.body).matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)].map(m => {
                const body = m[2];
                const link = (body.match(/<link>([^<]+)<\/link>/) || body.match(/<link[^>]+href=["']([^"']+)["']/) || [])[1];
                const title = (body.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1];
                return link ? { url: decode(link).trim(), title: decode(title || '') } : null;
            }).filter(Boolean);
            ctx.feeds[site.id] = items;
        }
        ctx.trace(`${site.id}: feed: ${items.length}`);
        return matching(items, q);
    }

    // A site's list of recipe addresses, read a little at a time: the index once a month, then one
    // more part of it per run, kept small (just the paths). Never the whole thing on every run.
    function sitemapUrls(ctx, site) {
        // One read per run, shared by every search that asks at the same time.
        if (!ctx.sitemapsRead[site.id]) ctx.sitemapsRead[site.id] = readSitemap(ctx, site).catch(e => { delete ctx.sitemapsRead[site.id]; throw e; });
        return ctx.sitemapsRead[site.id];
    }
    async function readSitemap(ctx, site) {
        const all = ctx.cache.get(CACHE.sitemaps) || {};
        let st = all[site.id] || {};
        const keep = site.recipePath ? new RegExp(site.recipePath, 'i') : null;
        const paths = list => list.filter(u => !/\.xml/i.test(u) && !ROUNDUP.test(u) && domainOf(u) === site.domain && (!keep || keep.test(new URL(u).pathname)))
            .map(u => { try { return new URL(u).pathname; } catch (e) { return ''; } }).filter(Boolean);
        const locs = body => (String(body).match(/<loc>([^<]+)<\/loc>/g) || []).map(x => decode(x.replace(/<\/?loc>/g, '')).trim());
        let changed = false;
        if (!st.at || st.at < ctx.now() - 30 * DAY || !Array.isArray(st.maps)) {
            const res = await getPage(ctx, site.sitemap, false);
            const found = locs(res.body);
            const maps = found.filter(u => /\.xml/i.test(u));
            // Recipe parts first, newest-looking last parts first (they're the recently added recipes).
            maps.sort((a, b) => (/recipe/i.test(b) ? 1 : 0) - (/recipe/i.test(a) ? 1 : 0));
            st = { at: ctx.now(), maps: maps.slice(0, 60), next: 0, origin: new URL(res.url || site.sitemap).origin, paths: [...new Set((st.paths || []).concat(paths(found)))] };
            if (!maps.length && !st.paths.length) ctx.trace(`${site.id}: sitemap has no recipe addresses; it lists e.g. ${found.slice(0, 3).join(' ')}`);
            changed = true;
        }
        if (st.next < st.maps.length && (st.paths || []).length < 4000) {
            try {
                const res = await getPage(ctx, st.maps[st.next], false);
                st.paths = [...new Set(st.paths.concat(paths(locs(res.body))))].slice(0, 4000);
            } catch (e) { if (e.blocked) throw e; }
            st.next++;
            changed = true;
        }
        if (changed) { all[site.id] = st; saveCache(ctx, CACHE.sitemaps, all); }
        const origin = st.origin || `https://${site.domain}`;
        ctx.trace(`${site.id}: sitemap: ${st.paths.length} recipe addresses (${st.next} of ${st.maps.length} parts read)`);
        return st.paths.map(p => origin + p);
    }
    async function searchSitemap(ctx, site, q, meal, page = 1) {
        const urls = await sitemapUrls(ctx, site);
        const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        let hits = urls.filter(u => words.every(w => slugWords(u).indexOf(w.replace(/s$/, '')) >= 0));
        if (!hits.length) hits = urls.filter(u => slugWords(u).indexOf(mainWord(q).replace(/s$/, '')) >= 0);
        ctx.trace(`${site.id}: sitemap "${q}" (${meal || 'any'}): ${hits.length}`);
        return hits.slice((page - 1) * 10, page * 10).map(url => ({ url, title: dishWords(url) }));
    }

    // Tries the site's ways of finding recipes in order until one finds something.
    async function searchSite(ctx, site, q, meal, page = 1) {
        const ways = site.find || [site.search || 'wp'];
        for (const way of ways) {
            const fn = { wp: searchWp, page: searchPage, category: searchCategory, sitemap: searchSitemap, rss: searchFeed, feed: searchFeed }[way];
            if (way === 'web' && ctx.o.webSearch) return ctx.o.webSearch(`site:${site.domain} ${q} recipe`, 8);
            if (!fn) continue;
            const list = await fn(ctx, site, q, meal, page);
            if (list.length) return list;
        }
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
        // A high protein target: protein-rich searches take every other turn from the start.
        let order = rotated;
        if (wantsProtein(o)) {
            const hp = HIGH_PROTEIN[meal].slice(seed ? seed % HIGH_PROTEIN[meal].length : 0).concat(HIGH_PROTEIN[meal].slice(0, seed ? seed % HIGH_PROTEIN[meal].length : 0));
            order = [];
            for (let i = 0; i < Math.max(hp.length, rotated.length); i++) { if (hp[i]) order.push(hp[i]); if (rotated[i]) order.push(rotated[i]); }
        }
        const seen = new Set();
        return liked.concat(extra, order).filter(q => {
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
        const t = link.title || dishWords(link.url);
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
        // Growing the library (in the background): aim for several hundred web recipes per meal.
        const perSlot = o.grow ? (limits.growTo || 300) : Math.max(3, Math.min(limits.perSlot, days * 3));
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
        const have = m => found.filter(r => r._fit[m] && r.source_id !== 'themealdb' && r.source_id !== 'builtin' && (o.grow || !recent.has(r.name))).length;
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
        // Plans don't wait on slow sites: with a library that already has a day's worth of good web
        // recipes for every meal, live searching gets a few seconds; the background refresh grows it.
        if (!o.grow && MEALS.every(m => !want(m) || have(m) >= days)) ctx.cap = 8;

        // 2a. The recipe APIs (one request each). TheMealDB is searched for every meal, a few each.
        const apiJobs = [];
        if (o.api && enabled('themealdb') && siteOk(ctx, 'themealdb')) {
            apiJobs.push((async () => {
                const seed = Math.floor(ctx.now() / DAY);
                const terms = queriesFor('dinner', o, seed).slice(0, 3).concat(['soup', 'salad']).join(',');
                // The same searches give the same answers: kept for 3 days (0.1.10 asked the same five
                // searches on every plan).
                const saved = ctx.cache.get(CACHE.mealdb) || {};
                let data = saved[terms] && saved[terms].at > ctx.now() - 3 * DAY ? saved[terms].data : null;
                if (data) ctx.trace(`themealdb: "${terms}" from the last 3 days`);
                else {
                    data = await o.api('/api/recipes/themealdb', { query: terms, number: 30 });
                    const keep = Object.fromEntries(Object.entries(saved).filter(([, v]) => v && v.at > ctx.now() - 3 * DAY).sort((a, b) => b[1].at - a[1].at).slice(0, 3));
                    keep[terms] = { at: ctx.now(), data: { meals: ((data && data.meals) || []).slice(0, 30) } };
                    saveCache(ctx, CACHE.mealdb, keep);
                }
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
            // A site that was checked and left out (its terms forbid automated apps, or it refuses
            // them) stays out even when typed in here: its reason is logged instead.
            const known = S.SITES.find(s => S.hostMatches(s, domain));
            if (known && known.status === 'dropped') { (ctx.stats.notUsed || (ctx.stats.notUsed = [])).push(`${known.name}: ${known.why}`); return; }
            if (domain && !sites.some(s => s.domain === domain)) sites.push({ id: 'custom:' + domain, name: domain, domain, search: 'wp', custom: true });
        });
        // Every site that isn't searched, and why ("Allrecipes: terms forbid scrapers and robots"), for the log.
        ctx.stats.notUsed = (ctx.stats.notUsed || []).concat(S.SITES.filter(s => s.status === 'dropped').map(s => `${s.name}: ${s.why}`)).filter((x, i, a) => a.indexOf(x) === i);
        ctx.stats.switchedOff = S.usable().filter(s => !enabled(s.id)).map(s => s.name);
        ctx.stats.blocked = sites.filter(s => !siteOk(ctx, s.id)).map(s => `${s.id} (${(ctx.failures[s.id] || {}).why || 'failed'})`);
        sites = sites.filter(s => siteOk(ctx, s.id));
        const seed = Math.floor(ctx.now() / DAY);
        ctx.seed = seed;
        sites = shuffle(sites, seed);
        // Healthier sites first when losing weight; sites with their own nutrition next; your own sites first of all.
        sites.sort((a, b) => (b.custom ? 2 : 0) - (a.custom ? 2 : 0) + (goal === 'Cut' ? (b.healthy ? 1 : 0) - (a.healthy ? 1 : 0) : 0) + ((b.nutrition ? 0.5 : 0) - (a.nutrition ? 0.5 : 0)));
        const searchCache = ctx.cache.get(CACHE.searches) || {};
        // How deep each search has been read (page 1, 2, 3…), so the library keeps finding new
        // recipes instead of the same first page of results every time.
        const searchPages = ctx.cache.get(CACHE.pages) || {};
        ctx.listings = ctx.cache.get(CACHE.listings) || {};
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
        // A few fresh searches every plan even when the library already has enough (0.1.10 searched
        // nothing once the library covered every meal, so it never grew): new recipes for variety,
        // within the plan's few seconds.
        const freshSearches = o.grow ? 0 : (limits.fresh != null ? limits.fresh : 6);
        const nextTask = () => {
            // Every meal gets its turn, the ones furthest from enough more often.
            let meals = MEALS.filter(m => short(m) > 0).sort((x, y) => short(y) / (1 + spent[y]) - short(x) / (1 + spent[x]));
            let fresh = false;
            if (!meals.length && searches < freshSearches) { meals = MEALS.filter(m => want(m)).sort((x, y) => spent[x] - spent[y]); fresh = true; }
            for (const meal of meals) {
                const suited = sites.filter(s => usableSite(s) && siteSuits(s, meal, '') && (sitePages[s.id] || 0) < fairPages);
                for (let k = 0; k < suited.length; k++) {
                    const site = suited[(turn[meal]++) % suited.length];
                    // Each site starts at a different word, so the sites together cover more dishes.
                    const list = siteQueries(site, meal, queries[meal]);
                    const offset = (sites.indexOf(site) * 3) % Math.max(1, list.length);
                    const q = list.slice(offset).concat(list.slice(0, offset)).find(x => !tried.has(`${site.id}|${meal}|${x}`));
                    if (q) { tried.add(`${site.id}|${meal}|${q}`); spent[meal]++; return { site, meal, q, fresh }; }
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
                const base = `${t.site.id}|${t.meal}|${t.q}`;
                // Pages of results already read through are skipped; the next one is asked for.
                let page = Math.max(1, (searchPages[base] && searchPages[base].page) || 1);
                const maxPage = page + (o.grow ? 3 : 1);
                for (; page <= maxPage && !ctx.timeUp(); page++) {
                    const key = `${base}|${page}`;
                    let list = searchCache[key] && searchCache[key].at > ctx.now() - 3 * DAY ? searchCache[key].links : null;
                    if (!list) {
                        if (searches >= limits.searches) return;
                        searches++;
                        ctx.stats.searches++;
                        try {
                            // The whole list is kept (a category page has 20–30 recipes): only its
                            // first 12 were ever looked at, so once those were in the library the
                            // site gave nothing new (BBC Good Food: 77 links, 1 new recipe).
                            list = (await searchSite(ctx, t.site, t.q, t.meal, page)).slice(0, 60);
                            siteWorked(ctx, t.site.id);
                            searchCache[key] = { at: ctx.now(), links: list };
                        } catch (e) {
                            ctx.trace(`${t.site.id}: "${t.q}" failed: ${e.message}${e.blocked ? ' (the site refuses the app: left alone for a while)' : ''}`);
                            // A refusal stops the site; other errors only after a few in one run.
                            ctx.siteErrors[t.site.id] = (ctx.siteErrors[t.site.id] || 0) + 1;
                            if (e.blocked || ctx.siteErrors[t.site.id] >= 3) { siteFailed(ctx, t.site.id, e.message, e.blocked); ctx.skip.add(t.site.id); }
                            break;
                        }
                    }
                    if (!list.length) { searchPages[base] = { at: ctx.now(), page: 1 }; break; }   // the end: start again next time
                    const good = list.filter(l => goodLink(l, t.site, t.meal, ctx)).map(l => Object.assign({}, l, { url: String(l.url).split('#')[0] })).filter(l => !seenLinks.has(l.url));
                    count(ctx, t.site.id, 'links');
                    for (const l of good.slice(0, o.grow ? 6 : 4)) {
                        if (ctx.timeUp() || pages >= limits.pages || (short(t.meal) <= 0 && !t.fresh) || !usableSite(t.site) || (sitePages[t.site.id] || 0) >= fairPages) break;
                        seenLinks.add(l.url);
                        await readPage(l, t.site, t.meal);
                    }
                    // Everything on this page was already in the library: next time, the next page.
                    if (!good.length) searchPages[base] = { at: ctx.now(), page: page + 1 };
                    if (good.length) break;
                }
            }
        };
        if (!o.offline) await Promise.all(apiJobs.concat(Array.from({ length: limits.parallel }, worker)));

        // 3. Nourish's own recipes: a backup by default (Settings → Advanced → Nourish recipes): the
        // planner only picks them when no web or library recipe fits; "mix" puts them on equal
        // terms; "off" leaves them out.
        const builtinMode = (o.settings && o.settings.builtin_mode) || 'backup';
        if (B && enabled('builtin') && builtinMode !== 'off') {
            MEALS.forEach(m => B.forMeal(m).forEach(r => add(JSON.parse(JSON.stringify(r)), S.byId('builtin'))));
        }

        // The library keeps every recipe read (newest first when it has to be trimmed), and the
        // searches, sitemaps and categories are remembered.
        const trim = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1].at - a[1].at).slice(0, n));
        recipeCache = saveCache(ctx, CACHE.recipes, trim(recipeCache, limits.cachedRecipes));
        ctx.stats.library = Object.keys(recipeCache).length;
        saveCache(ctx, CACHE.searches, trim(searchCache, 600));
        saveCache(ctx, CACHE.pages, trim(searchPages, 800));
        // Listings are kept small: only the links matter, not the whole page.
        Object.keys(ctx.listings).forEach(u => { const l = ctx.listings[u]; if (l.at < ctx.now() - 3 * DAY) delete ctx.listings[u]; });
        saveCache(ctx, CACHE.listings, trim(ctx.listings, 120));
        ctx.cache.set(CACHE.failures, ctx.failures);
        ctx.cache.set(CACHE.categories, ctx.categories);
        saveCache(ctx, CACHE.robots, ctx.robots);

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
        // Luxury or hard-to-find ingredients (wagyu, caviar, truffle…) are left out unless the budget
        // is "No limit"; on "Budget", pricier ones too (Settings → Advanced → Budget).
        const budget = ({ budget: 'budget', normal: 'normal', any: 'any', 'Budget-friendly': 'budget', 'No limit': 'any' })[(o.settings && o.settings.budget) || ''] || 'normal';
        const offBudget = [];
        PL.MEALS.forEach(m => { pools[m] = (pools[m] || []).filter(r => { const why = PL.budgetProblem(r, budget); if (why && offBudget.length < 30) offBudget.push(`${r.name}: ${why}`); return !why; }); });
        if (offBudget.length) stats.budget = offBudget;
        const sourcePenalty = r => sourceCost(r, o);
        const exclude = P.excluder({ avoid: o.avoid || '', allergies: (o.settings && o.settings.allergies) || '', diet: (o.settings && o.settings.diet) || '' });
        const plan = PL.planWeek({ pools, settings: Object.assign({ goal: o.goal, builtin_mode: 'backup' }, o.settings), likes: o.likes, days: o.days || 7, people: o.people || 1, sourcePenalty, already: o.already || [], exclude, weekday: o.weekday, taste: o.taste, favorites: o.favorites, snackExtras: o.snackExtras ? o.snackExtras() : [] });
        plan.days.forEach(d => PL.MEALS.forEach(m => { if (d[m]) { delete d[m]._fit; delete d[m].sameAs; delete d[m].preferred; } }));
        return Object.assign(plan, { stats, pools, adaptable });
    }

    const api = { robotsRules, robotsAllow, linksFromHtml, matching, mainWord, searchSite, findRecipes, planFromSources, sourceCost, notAMeal, balance, siteSuits, siteQueries, queriesFor, goodLink, tidy, vet, fromMealDb, fromSpoonacular, LIMITS, CACHE, QUERIES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishFinder = api;
})(typeof window !== 'undefined' ? window : globalThis);
