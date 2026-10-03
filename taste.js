// The app learns the person: a taste profile built from what they do (save, eat, rate, swap away,
// skip or delete recipes; extra foods they log; what they tell the chef; when they eat). It's a
// learned profile plus retrieval, not a retrained model: fast, private (kept on the device and
// synced only to their own PC), and every bit of it can be seen, corrected or deleted.
//
// State (synced as the "taste" section): { on, events: [...], overrides: {...} }. The profile is
// worked out from the events whenever it's needed (newer events count more).
(function (root) {
    'use strict';

    const req = typeof require === 'function' ? require : null;
    const PL = root.NourishPlanner || (req ? req('./planner.js') : null);
    const N = root.NourishNutrition || (req ? req('./nutrition.js') : null);

    const MAX_EVENTS = 400;
    const HALF_LIFE_DAYS = 60;
    const DAY = 86400000;

    // How much each thing someone does says about a recipe they liked (+) or didn't (−).
    const WEIGHTS = { save: 2, eaten: 1, up: 2, loved: 3, down: -2, swap: -1, skip: -0.6, delete: -1.5, log: 0.6, too_bland: -0.3, too_much_work: -0.5, too_small: 0 };
    const TAGS = { loved: 'Loved it', too_bland: 'Too bland', too_much_work: 'Too much work', too_small: 'Too small' };
    const HOT = /\b(chil(i|e|li)|jalape[nñ]o|habanero|cayenne|sriracha|gochujang|harissa|chipotle|hot sauce|red pepper flakes|chili flakes|curry paste|wasabi|scotch bonnet|thai chil|serrano|sambal|peri[- ]?peri|szechuan|sichuan)\b/gi;

    function empty() { return { on: true, events: [], overrides: { ingredients: {}, cuisines: {}, spice: '', effort: '', filling: '', repeats: '' } }; }
    function clean(state) {
        const s = Object.assign(empty(), state && typeof state === 'object' ? state : {});
        s.on = s.on !== false;
        s.events = (Array.isArray(s.events) ? s.events : []).filter(e => e && typeof e === 'object' && WEIGHTS[e.type] != null || (e && e.type === 'rate') || (e && e.type === 'chat')).slice(-MAX_EVENTS);
        s.overrides = Object.assign(empty().overrides, s.overrides && typeof s.overrides === 'object' ? s.overrides : {});
        s.overrides.ingredients = Object.assign({}, s.overrides.ingredients || {});
        s.overrides.cuisines = Object.assign({}, s.overrides.cuisines || {});
        return s;
    }

    // === WHAT A RECIPE IS MADE OF (for learning) ===
    const PLAIN = { 'chicken breast': 'chicken', 'chicken thigh': 'chicken', 'ground chicken': 'chicken', 'ground beef': 'beef', 'lean ground beef': 'beef', 'beef chuck': 'beef', 'ground turkey': 'turkey',
        'ground pork': 'pork', 'pork tenderloin': 'pork', 'salmon fillet': 'salmon', 'smoked salmon': 'salmon', 'greek yogurt': 'yogurt', 'cheddar': 'cheese', 'mozzarella': 'cheese', 'parmesan': 'parmesan',
        'olive oil': '', 'vegetable oil': '', 'canola oil': '', 'salt': '', 'black pepper': '', 'water': '', 'butter': 'butter', 'jasmine rice': 'rice', 'brown rice': 'rice', 'white rice': 'rice' };
    function ingredientWords(recipe) {
        const out = new Set();
        (recipe && recipe.ingredients || []).forEach(line => {
            let key = '';
            try { const m = N && N.matchFood(String(line)); key = m ? m.key : ''; } catch (e) { key = ''; }
            if (!key) {
                key = String(line).toLowerCase().replace(/\([^)]*\)/g, '').replace(/^[\d\s/.½¼¾⅓⅔-]+/, '').replace(/^(cups?|tbsp|tsp|tablespoons?|teaspoons?|g|grams?|ml|oz|ounces?|lbs?|pounds?|cans?|cloves?|slices?|pinch|dash|handful|large|medium|small)\s+(of\s+)?/, '')
                    .replace(/,.*$/, '').replace(/\b(fresh|chopped|diced|minced|sliced|grated|ground|dried|boneless|skinless|low-sodium|to taste|for serving)\b/g, '').replace(/\s+/g, ' ').trim();
                if (key.split(' ').length > 3) key = '';
            }
            key = PLAIN[key] != null ? PLAIN[key] : key;
            if (key && key.length > 2) out.add(key.replace(/s$/, ''));
        });
        return [...out].slice(0, 12);
    }
    function spiceOf(recipe) {
        const text = `${recipe && recipe.name || ''} ${(recipe && recipe.ingredients || []).join(' ')}`;
        return Math.min(3, (text.match(HOT) || []).length);
    }
    // A short description of a recipe, kept with each event (so the profile can be rebuilt).
    function describe(recipe) {
        if (!recipe) return {};
        let p = null;
        try { p = PL && recipe.ingredients ? PL.recipeProfile(recipe) : null; } catch (e) { p = null; }
        return {
            name: String(recipe.name || '').slice(0, 80),
            ings: ingredientWords(recipe),
            cuisine: PL && recipe.ingredients ? PL.cuisineOf(recipe) : 'other',
            protein: PL && recipe.ingredients ? (PL.mainProtein(recipe) || '') : '',
            spice: spiceOf(recipe),
            effort: p ? p.difficulty : null,
            minutes: p ? p.minutes : null,
            kcal: recipe.nutrition && recipe.nutrition.calories ? Math.round(recipe.nutrition.calories) : null,
            protein_g: recipe.nutrition && recipe.nutrition.protein_g ? Math.round(recipe.nutrition.protein_g) : null,
        };
    }

    // === RECORDING ===
    // type: save | eaten | swap | skip | delete | log | rate | chat. For "rate": { rating: 'up'|'down', tags: [...] }.
    function record(state, type, recipe, extra = {}, now = Date.now()) {
        if (!state || state.on === false) return null;
        const e = Object.assign({ t: now, type }, recipe ? describe(recipe) : {}, extra);
        if (type === 'rate' && extra.key) state.events = state.events.filter(x => !(x.type === 'rate' && x.key === extra.key));   // a new rating replaces the old one
        state.events.push(e);
        if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
        return e;
    }
    function ratingOf(state, key) { return state.events.slice().reverse().find(e => e.type === 'rate' && e.key === key) || null; }
    function forget(state, t) { state.events = state.events.filter(e => e.t !== t); }

    // What someone told the chef: "I love salmon", "no more mushrooms", "I hate coriander", "too spicy".
    function fromChat(state, text, now = Date.now()) {
        if (!state || state.on === false) return [];
        const out = [];
        const s = String(text || '').toLowerCase();
        const grab = (re, sign) => {
            let m;
            while ((m = re.exec(s))) {
                (sign > 0 ? m[1].split(/\b(?:but|except|although|though)\b|\b(?:no|not|never|without)\b/)[0] : m[1]).split(/,|\band\b|\bor\b|\bbut\b|\//).map(w => w.replace(/\b(the|a|an|some|any|more|so much|too much|really|very|food|dishes|meals?|please|thanks|anymore|again|though|ever|in it|in them)\b/g, '').replace(/[^a-z\s'-]/g, '').replace(/\s+/g, ' ').trim())
                    .filter(w => w && w.length > 2 && w.split(' ').length <= 3 && !(sign > 0 && /\b(no|not|never|less|without|hate|don'?t|dislike)\b/.test(w))).forEach(w => out.push([w.split(' ').map(x => x.replace(/(?<=[^s])s$/, '')).join(' '), sign]));
            }
        };
        grab(/\b(?:i (?:really )?(?:love|like|enjoy|adore)|i'?m (?:a )?(?:big )?fan of|(?<!no |not |any )more)\s+([a-z ,'/-]{3,60})/g, 1);
        grab(/\b(?:i (?:really )?(?:hate|dislike|can'?t stand|don'?t (?:like|eat|want))|no more|not a fan of|less|without|skip the)\s+([a-z ,'/-]{3,60})/g, -1);
        if (/\btoo spicy|less spic|not spicy|mild\b/.test(s)) out.push(['__spice', -1]);
        if (/\b(spicier|more spice|more heat|extra spicy|love spicy|like it hot)\b/.test(s)) out.push(['__spice', 1]);
        out.forEach(([word, sign]) => record(state, 'chat', null, { word, sign, ings: word.startsWith('__') ? [] : [word] }, now));
        return out;
    }

    // === THE PROFILE ===
    function weightOf(e, now) {
        const age = Math.max(0, (now - (e.t || now)) / DAY);
        return Math.pow(0.5, age / HALF_LIFE_DAYS);
    }
    function profile(state, now = Date.now()) {
        const s = clean(state);
        const ing = {}, cui = {}, prot = {};
        let spiceSum = 0, spiceW = 0, bland = 0, hotComplaints = 0;
        const effortLiked = [], tooMuch = [];
        let small = 0, loved = 0, ratings = 0;
        const times = { breakfast: [], lunch: [], dinner: [] };
        const add = (map, k, v) => { if (k) map[k] = (map[k] || 0) + v; };
        s.events.forEach(e => {
            const w = weightOf(e, now);
            let v = 0;
            if (e.type === 'rate') {
                ratings++;
                v = e.rating === 'up' ? WEIGHTS.up : e.rating === 'down' ? WEIGHTS.down : 0;
                (e.tags || []).forEach(tag => {
                    v += WEIGHTS[tag] || 0;
                    if (tag === 'loved') loved++;
                    if (tag === 'too_bland') bland += w;
                    if (tag === 'too_much_work' && e.effort != null) tooMuch.push(e.effort);
                    if (tag === 'too_small') small += w;
                });
            } else if (e.type === 'chat') {
                if (e.word === '__spice') { if (e.sign > 0) bland += w; else hotComplaints += w; return; }
                v = e.sign > 0 ? 2 : -3;
            } else v = WEIGHTS[e.type] || 0;
            v *= w;
            (e.ings || []).forEach(k => add(ing, k, v / Math.max(1, Math.sqrt((e.ings || []).length / 3))));
            if (e.cuisine && e.cuisine !== 'other') add(cui, e.cuisine, v);
            if (e.protein) add(prot, e.protein, v);
            if (v > 0 && e.spice != null) { spiceSum += e.spice * v; spiceW += v; }
            if (v > 0 && e.effort != null && e.type !== 'log') effortLiked.push(e.effort);
            if (e.type === 'eaten' && e.slot && times[e.slot] && e.hour != null) times[e.slot].push(e.hour);
        });
        const o = s.overrides;
        Object.keys(o.ingredients).forEach(k => { if (o.ingredients[k] === 'like') ing[k] = Math.max(ing[k] || 0, 3); else if (o.ingredients[k] === 'dislike') ing[k] = Math.min(ing[k] || 0, -3); else if (o.ingredients[k] === 'forget') delete ing[k]; });
        Object.keys(o.cuisines).forEach(k => { if (o.cuisines[k] === 'like') cui[k] = Math.max(cui[k] || 0, 3); else if (o.cuisines[k] === 'dislike') cui[k] = Math.min(cui[k] || 0, -3); else if (o.cuisines[k] === 'forget') delete cui[k]; });
        const sorted = (map, sign) => Object.entries(map).filter(([, v]) => sign > 0 ? v >= 1.5 : v <= -1.5).sort((a, b) => sign > 0 ? b[1] - a[1] : a[1] - b[1]).map(([k]) => k);
        // Spice: how hot the food they liked was, nudged by "too bland" and "too spicy".
        let spice = 'unknown';
        if (o.spice) spice = o.spice;
        else if (spiceW >= 3 || bland >= 0.9 || hotComplaints >= 0.9) {
            const level = (spiceW ? spiceSum / spiceW : 0.8) + Math.min(1, bland * 0.5) - Math.min(1.2, hotComplaints * 0.6);
            spice = level < 0.5 ? 'mild' : level < 1.4 ? 'medium' : 'hot';
        }
        // Effort: the work they happily do, capped below what they've called too much.
        let effort = 'unknown', maxEffort = 10;
        if (o.effort) { effort = o.effort; maxEffort = { easy: 3.5, medium: 6, involved: 10 }[o.effort] || 10; }
        else if (effortLiked.length >= 4 || tooMuch.length) {
            const liked = effortLiked.slice().sort((a, b) => a - b);
            maxEffort = liked.length ? liked[Math.floor(liked.length * 0.85)] + 1 : 10;
            if (tooMuch.length) maxEffort = Math.min(maxEffort, Math.min(...tooMuch) - 0.5);
            maxEffort = Math.max(2.5, maxEffort);
            effort = maxEffort <= 3.5 ? 'easy' : maxEffort <= 6 ? 'medium' : 'involved';
        }
        const filling = o.filling || (small >= 1.5 ? 'more' : 'fine');
        const repeats = o.repeats || (loved >= 3 ? 'sometimes' : 'rarely');
        const avgHour = list => (list.length >= 3 ? Math.round(list.reduce((a, b) => a + b, 0) / list.length * 2) / 2 : null);
        return {
            on: s.on, events: s.events.length, ratings,
            likes: sorted(ing, 1).slice(0, 15), dislikes: sorted(ing, -1).slice(0, 15),
            cuisinesLiked: sorted(cui, 1).slice(0, 6), cuisinesDisliked: sorted(cui, -1).slice(0, 6),
            proteins: sorted(prot, 1).slice(0, 5),
            spice, effort, maxEffort, filling, repeats,
            mealTimes: { breakfast: avgHour(times.breakfast), lunch: avgHour(times.lunch), dinner: avgHour(times.dinner) },
            scores: { ing, cui },
            learnedAnything: s.events.length > 0 || Object.keys(o.ingredients).length > 0,
        };
    }

    // How well a recipe suits the person, from −1 to 1 (0 when there's nothing to go on). With
    // explore = true, a recipe from a cuisine they haven't tried gets a small push now and then.
    function score(prof, recipe, { explore = false, seed = 0 } = {}) {
        if (!prof || !prof.on || !recipe) return 0;
        const d = describe(recipe);
        let s = 0;
        const ingS = d.ings.map(k => prof.scores.ing[k] || 0);
        const strongNo = ingS.filter(v => v <= -2.5).length;
        s += Math.tanh(ingS.reduce((a, b) => a + b, 0) / 6) * 0.6;
        if (strongNo) s -= 0.6;   // something they've said no to, clearly
        const c = prof.scores.cui[d.cuisine] || 0;
        s += Math.tanh(c / 4) * 0.3;
        if (prof.spice === 'mild' && d.spice >= 2) s -= 0.3;
        if (prof.spice === 'hot' && d.spice === 0 && d.cuisine !== 'other') s -= 0.1;
        if (prof.spice === 'hot' && d.spice >= 1) s += 0.15;
        if (d.effort != null && d.effort > prof.maxEffort) s -= Math.min(0.5, (d.effort - prof.maxEffort) * 0.2);
        if (prof.filling === 'more' && d.protein_g && d.kcal) s += Math.min(0.2, (d.protein_g * 4 / d.kcal) * 0.6);
        // Something new now and then: a cuisine they haven't had, on about one recipe in five.
        if (explore && !c && d.cuisine !== 'other') {
            let h = seed;
            for (const ch of d.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            if (h % 5 === 0) s += 0.15;
        }
        return Math.max(-1, Math.min(1, s));
    }

    // For the AI writing or adapting a meal (on-device and home-PC AIs only): a few plain lines.
    function guidance(prof) {
        if (!prof || !prof.on || !prof.learnedAnything) return '';
        const parts = [];
        if (prof.likes.length) parts.push(`They enjoy: ${prof.likes.slice(0, 8).join(', ')}.`);
        if (prof.dislikes.length) parts.push(`Avoid if you can: ${prof.dislikes.slice(0, 6).join(', ')}.`);
        if (prof.cuisinesLiked.length) parts.push(`Favourite cuisines: ${prof.cuisinesLiked.slice(0, 3).join(', ')}.`);
        if (prof.spice !== 'unknown') parts.push(`Spice: ${prof.spice}.`);
        if (prof.effort === 'easy') parts.push('Keep it simple: few steps.');
        if (prof.filling === 'more') parts.push('Make it filling (protein, fibre, volume) within the calories.');
        return parts.length ? `What they like (learned from what they cook and rate): ${parts.join(' ')}` : '';
    }

    const api = { empty, clean, record, fromChat, profile, score, guidance, describe, ratingOf, forget, ingredientWords, TAGS, WEIGHTS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishTaste = api;
})(typeof window !== 'undefined' ? window : globalThis);
