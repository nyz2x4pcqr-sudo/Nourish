// The food log: what someone ate or drank outside the plan (snacks, extra meals, drinks, a bite of
// something), and which planned meals they ate or skipped. Kept per day (YYYY-MM-DD), so history
// stays, and synced with the PC like everything else (app.js, section "log").
//
// Calories and macros are worked out in code from the USDA table (nutrition.js / nutrition-data.js)
// or Open Food Facts (online fallback and barcodes), never guessed by the AI. They're estimates
// (portion sizes vary), and say so.
(function (root) {
    'use strict';

    const req = n => (typeof require === 'function' ? require(n) : null);
    const N = root.NourishNutrition || req('./nutrition.js');
    const U = root.NourishUnits || req('./units.js');
    const FOODS = N.FOODS;

    // A typical serving when someone just says "a coffee", "some chips", "a slice of pizza", in grams,
    // and the word for one. Used when USDA's own portions don't cover it.
    const SERVINGS = {
        'pepperoni pizza': [107, 'slice'], pizza: [107, 'slice'], hamburger: [110, 'burger'], cheeseburger: [120, 'burger'],
        'french fries': [117, 'medium order'], 'hot dog': [98, 'hot dog'], 'fried chicken': [140, 'piece'],
        'potato chips': [28, 'small bag'], 'tortilla chips': [28, 'handful'], popcorn: [24, '3 cups'], 'buttered popcorn': [40, 'small bag'],
        pretzels: [28, 'handful'], crackers: [28, 'serving (about 6)'], 'trail mix': [38, '¼ cup'], 'beef jerky': [28, 'serving'],
        coffee: [237, 'cup'], tea: [237, 'cup'], 'coffee cream': [15, 'splash'], milk: [60, 'splash'], 'whole milk': [60, 'splash'],
        'oat milk': [60, 'splash'], 'almond milk': [60, 'splash'], 'half and half': [15, 'splash'], sugar: [4, 'tsp'], honey: [7, 'tsp'],
        cola: [370, 'can'], 'diet soda': [355, 'can'], beer: [356, 'can or bottle'], 'light beer': [354, 'can or bottle'],
        'red wine': [147, 'glass'], 'white wine': [147, 'glass'], liquor: [42, 'shot'], lemonade: [248, 'glass'],
        'orange juice': [248, 'glass'], 'apple juice': [248, 'glass'], 'chocolate milk': [250, 'glass'], 'energy drink': [250, 'can'], 'sports drink': [355, 'bottle'],
        'ice cream': [66, '½ cup'], cookie: [16, 'cookie'], donut: [54, 'donut'], 'glazed donut': [60, 'donut'], muffin: [113, 'muffin'],
        croissant: [57, 'croissant'], pancakes: [77, 'pancake'], waffle: [35, 'waffle'], cereal: [30, 'bowl (1 cup)'],
        'milk chocolate': [44, 'bar'], 'candy bar': [57, 'bar'], 'granola bar': [24, 'bar'], 'rice cake': [9, 'rice cake'],
        'string cheese': [28, 'stick'], 'bean burrito': [185, 'burrito'], hummus: [30, '2 tbsp'], 'peanut butter': [32, '2 tbsp'],
        almonds: [28, 'handful'], walnuts: [28, 'handful'], cashews: [28, 'handful'], peanuts: [28, 'handful'], pistachios: [28, 'handful'],
        'greek yogurt': [170, 'pot'], yogurt: [170, 'pot'], 'cottage cheese': [113, '½ cup'], bread: [32, 'slice'], 'white bread': [28, 'slice'],
        bagel: [100, 'bagel'], 'english muffin': [57, 'muffin'], granola: [30, '¼ cup'], oats: [40, '½ cup dry'], egg: [50, 'egg'],
        avocado: [100, 'half'], grapes: [92, 'handful'], berries: [74, '½ cup'], strawberries: [76, '½ cup'], raisins: [28, 'small box'],
        cheddar: [28, 'slice'], 'dark chocolate': [28, 'square or two'], 'cream cheese': [28, '2 tbsp'], butter: [5, 'pat'], jam: [20, 'tbsp'],
        mayonnaise: [14, 'tbsp'], ketchup: [17, 'tbsp'], apple: [182, 'apple'], orange: [131, 'orange'], pear: [178, 'pear'], peach: [150, 'peach'],
        'mac and cheese': [200, 'cup'], cheesecake: [125, 'slice'], brownie: [56, 'brownie'], cake: [95, 'slice'], pie: [125, 'slice'], 'chicken noodle soup': [245, 'bowl'],
    };
    // Things that usually come in "a splash" or "a spoonful" when they're added to something else.
    const ADD_ONS = new Set(['coffee cream', 'milk', 'whole milk', 'oat milk', 'almond milk', 'soy milk', 'half and half', 'sugar', 'honey', 'butter', 'maple syrup', 'heavy cream', 'cream cheese', 'jam', 'peanut butter', 'mayonnaise', 'ketchup']);
    // Words for "how many" that come before the food ("2 slices of", "a bowl of").
    const COUNT_WORDS = /^(slices?|pieces?|cups?|mugs?|cans?|bottles?|glass(?:es)?|bowls?|plates?|bars?|bags?|packets?|handfuls?|shots?|scoops?|splash(?:es)?|servings?|portions?|pots?|sticks?|spoonfuls?|tbsp|tsp|tablespoons?|teaspoons?|squares?|pints?)$/;
    // Things counted in small pieces, whatever food they match.
    const PIECES = [[/\bnuggets?\b/, 16, 'nugget'], [/\btenders?\b|\bstrips?\b/, 45, 'tender'], [/\bwings?\b/, 32, 'wing'], [/\bbites?\b/, 15, 'bite']];
    const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, couple: 2, few: 3, some: 1 };

    function round1(v) { return Math.round(v * 10) / 10; }
    function nutritionOf(per100, grams) {
        const f = grams / 100;
        return { calories: Math.round(per100[0] * f), protein_g: round1(per100[1] * f), carbs_g: round1(per100[2] * f), fat_g: round1(per100[3] * f) };
    }
    function title(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

    // "2 slices pepperoni pizza, a banana and a coffee with cream" → the separate things.
    function splitText(text) {
        let t = ' ' + String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[.!?;]+/g, ',') + ' ';
        // Keep names that contain "and" or "with" together.
        const keep = Object.keys(FOODS).concat(...Object.values(FOODS).map(f => f.a || [])).filter(n => /\b(and|with|&)\b/.test(n));
        keep.concat(['mac and cheese', 'peanut butter and jelly', 'fish and chips', 'salt and vinegar']).forEach((n, i) => { t = t.split(n).join(`\u0001${i}\u0001`); });
        const restore = s => s.replace(/\u0001(\d+)\u0001/g, (m, i) => keep.concat(['mac and cheese', 'peanut butter and jelly', 'fish and chips', 'salt and vinegar'])[Number(i)]);
        const parts = [];
        t.split(/,|\band\b|\bplus\b|&|\+|\bwith\b|\bthen\b|\balso\b/).forEach((p, i, all) => {
            const s = restore(p).replace(/^\s*(i (had|ate|drank)|had|ate|drank|just|also|then)\b/g, '').trim();
            if (s && /[a-z]/.test(s)) parts.push({ text: s, addOn: i > 0 && /\bwith\s*$/.test(restore(all.slice(0, i).join('|'))) });
        });
        // "with" joins an add-on ("coffee with cream"): mark the piece after "with".
        const withRe = /\bwith\b/g;
        if (withRe.test(t)) {
            let idx = 0;
            t.split(/,|\band\b|\bplus\b|&|\+|\bthen\b|\balso\b/).forEach(seg => {
                const bits = seg.split(/\bwith\b/);
                bits.forEach((b, j) => { const s = restore(b).trim(); if (s && /[a-z]/.test(s)) { if (parts[idx]) parts[idx].addOn = j > 0; idx++; } });
            });
        }
        return parts;
    }

    // One thing someone ate → a log item (or { unmatched } when nothing in the table fits).
    function estimate(text, { addOn = false } = {}) {
        let s = String(text || '').toLowerCase().trim().replace(/^(of|the)\s+/, '');
        // "a", "two", "half a", "a couple of" → a number.
        s = s.replace(/^half (a|an)\s+/, '0.5 ').replace(/^(a )?couple( of)?\s+/, '2 ').replace(/^(a )?few\s+/, '3 ');
        const w = s.match(/^([a-z]+)\s+/);
        if (w && WORD_NUMBERS[w[1]] != null) s = `${WORD_NUMBERS[w[1]]} ${s.slice(w[0].length)}`;
        if (!/^\d/.test(s)) s = '1 ' + s;
        // "2 slices of pizza" → amount 2, the word "slice", the food "pizza".
        let unitWord = '';
        s = s.replace(/^(\d+(?:\.\d+)?)\s+([a-z]+)\s+(?:of\s+)?/, (all, n, word) => {
            if (COUNT_WORDS.test(word)) { unitWord = word.replace(/(es|s)$/, '').replace(/^glass$/, 'glass'); return `${n} ${/^(tbsp|tsp|cup|tablespoon|teaspoon|pint)/.test(word) ? word + ' ' : ''}`; }
            return all;
        });
        if (/^glas$/.test(unitWord)) unitWord = 'glass';
        const item = U.splitIngredient(s);
        const name = (item.text || s).replace(/^(of|a|an|some)\s+/, '').trim();
        const m = N.matchFood(name);
        // A match on only a small part of the name ("cheese" in "mac and cheese") isn't this food.
        const core = name.replace(/\b(small|medium|large|big|little|extra|slice|piece|of|some|homemade|leftover)\b/g, '').replace(/\s+/g, ' ').trim();
        if (!m || (m.phrase && m.phrase.length < core.length * 0.5)) return { unmatched: true, text: title(name), line: s };
        const food = FOODS[m.key];
        const serving = SERVINGS[m.key];
        let amount = item.qty != null ? item.qty : 1;
        let unit = item.unit || '';
        let perUnit = null;
        const piece = PIECES.find(([re]) => re.test(name));
        if (piece && !unit) { perUnit = piece[1]; unit = piece[2]; }
        if (!perUnit && unit && N.readLine(`1 ${unit} ${name}`) && !/^(slice|piece|can)$/.test(unit)) {
            const r = N.readLine(`1 ${unit} ${name}`);
            perUnit = r && r.grams;
        }
        if (!perUnit) {
            const word = (unit || unitWord || '').replace(/e?s$/, '');
            const usda = (food.u || []).find(([, d]) => word && new RegExp('\\b' + word).test(d));
            if (usda) { perUnit = usda[0]; unit = word; } else if (addOn && ADD_ONS.has(m.key)) {
                perUnit = (SERVINGS[m.key] || [15])[0]; unit = (SERVINGS[m.key] || [0, 'splash'])[1];
            } else if (serving) { perUnit = serving[0]; unit = serving[1]; } else {
                const r = N.readLine(`1 ${name}`);
                perUnit = (r && r.grams) || 100; unit = r && r.grams && r.grams !== 100 ? 'medium' : 'serving (100 g)';
            }
        }
        const grams = amount * perUnit;
        return {
            name: title(name), key: m.key, amount, unit: unit || 'serving', gramsPerUnit: round1(perUnit), grams: Math.round(grams),
            per100: food.n.slice(), nutrition: nutritionOf(food.n, grams), source: 'USDA', estimate: true,
        };
    }

    // Plain words → items. Unknown pieces come back with { unmatched: true } for an online lookup
    // or for the person to fill in.
    function parse(text) {
        return splitText(text).map(p => estimate(p.text, { addOn: p.addOn }));
    }

    // A different amount: the numbers follow.
    function setAmount(item, amount) {
        const out = Object.assign({}, item, { amount: Math.max(0, Number(amount) || 0) });
        out.grams = Math.round(out.amount * (out.gramsPerUnit || 0));
        if (out.per100) out.nutrition = nutritionOf(out.per100, out.grams);
        else if (item.nutrition && item.amount > 0) {   // typed in by hand: scale what was typed
            const k = out.amount / item.amount;
            out.nutrition = { calories: Math.round(item.nutrition.calories * k), protein_g: round1(item.nutrition.protein_g * k), carbs_g: round1(item.nutrition.carbs_g * k), fat_g: round1(item.nutrition.fat_g * k) };
        }
        return out;
    }

    // Foods matching what someone typed in the search box: names and other names from the table.
    function search(query, limit = 12) {
        const q = String(query || '').toLowerCase().trim();
        if (q.length < 2) return [];
        const hits = [];
        Object.keys(FOODS).forEach(key => {
            const names = [key].concat(FOODS[key].a || []);
            let score = 0;
            names.forEach(n => {
                if (n === q) score = Math.max(score, 100);
                else if (n.startsWith(q)) score = Math.max(score, 80 - n.length / 10);
                else if (n.split(' ').some(w => w.startsWith(q))) score = Math.max(score, 60 - n.length / 10);
                else if (n.indexOf(q) >= 0) score = Math.max(score, 40);
            });
            if (score) hits.push({ key, score });
        });
        if (!hits.length) { const m = N.matchFood(q); if (m) hits.push({ key: m.key, score: 1 }); }
        return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(x => estimate(`1 ${x.key}`));
    }

    // Open Food Facts product (search result or barcode) → an item, per serving when it says one.
    function fromOpenFoodFacts(p, code) {
        const n = (p && p.nutriments) || {};
        const kcal = Number(n['energy-kcal_100g'] != null ? n['energy-kcal_100g'] : (n.energy_100g || 0) / 4.184);
        if (!p || !(kcal > 0)) return null;
        const per100 = [Math.round(kcal), round1(Number(n.proteins_100g) || 0), round1(Number(n.carbohydrates_100g) || 0), round1(Number(n.fat_100g) || 0)];
        const serving = Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : 100;
        const name = [p.product_name || p.generic_name || 'Product', p.brands ? `(${String(p.brands).split(',')[0].trim()})` : ''].join(' ').trim();
        return {
            name: title(name).slice(0, 80), key: null, amount: 1, unit: p.serving_size ? `serving (${String(p.serving_size).slice(0, 24)})` : 'serving (100 g)',
            gramsPerUnit: serving, grams: Math.round(serving), per100, nutrition: nutritionOf(per100, serving),
            source: 'Open Food Facts', barcode: code || p.code || undefined, estimate: true,
        };
    }

    // An item typed in by hand (nothing matched): the person gives the calories.
    function manual(name, calories, macros = {}) {
        return { name: title(name).slice(0, 80), key: null, amount: 1, unit: 'serving', gramsPerUnit: 0, grams: 0, per100: null,
            nutrition: { calories: Math.round(Number(calories) || 0), protein_g: Number(macros.protein_g) || 0, carbs_g: Number(macros.carbs_g) || 0, fat_g: Number(macros.fat_g) || 0 },
            source: 'you', estimate: false };
    }

    // === THE LOG ===
    function dayKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function empty() { return { days: {}, recents: [], favorites: [] }; }
    function cleanItem(x) {
        if (!x || typeof x !== 'object' || !x.name || !x.nutrition) return null;
        const n = x.nutrition;
        const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
        return {
            id: String(x.id || Math.random().toString(36).slice(2, 10)), name: String(x.name).slice(0, 80), key: x.key || null,
            amount: num(x.amount) || 1, unit: String(x.unit || 'serving').slice(0, 40), gramsPerUnit: num(x.gramsPerUnit), grams: num(x.grams),
            per100: Array.isArray(x.per100) && x.per100.length === 4 ? x.per100.map(num) : null,
            nutrition: { calories: Math.round(num(n.calories)), protein_g: num(n.protein_g), carbs_g: num(n.carbs_g), fat_g: num(n.fat_g) },
            source: String(x.source || '').slice(0, 30), barcode: x.barcode ? String(x.barcode).slice(0, 20) : undefined,
            estimate: x.estimate !== false, time: num(x.time) || Date.now(),
        };
    }
    function clean(log) {
        const out = empty();
        if (!log || typeof log !== 'object') return out;
        Object.keys(log.days || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).forEach(k => {
            const d = log.days[k] || {};
            const meals = {};
            Object.keys(d.meals || {}).forEach(m => { if (['eaten', 'skipped'].includes(d.meals[m])) meals[m] = d.meals[m]; });
            const items = (Array.isArray(d.items) ? d.items : []).map(cleanItem).filter(Boolean).slice(0, 100);
            if (items.length || Object.keys(meals).length) out.days[k] = { items, meals };
        });
        // Keep about a year.
        const keys = Object.keys(out.days).sort();
        keys.slice(0, Math.max(0, keys.length - 400)).forEach(k => delete out.days[k]);
        out.recents = (Array.isArray(log.recents) ? log.recents : []).map(cleanItem).filter(Boolean).slice(0, 20);
        out.favorites = (Array.isArray(log.favorites) ? log.favorites : []).map(cleanItem).filter(Boolean).slice(0, 50);
        return out;
    }
    function day(log, key) { return log.days[key] || (log.days[key] = { items: [], meals: {} }); }
    function sameFood(a, b) { return a.name.toLowerCase() === b.name.toLowerCase() && a.unit === b.unit; }
    function add(log, key, item) {
        const it = cleanItem(Object.assign({}, item, { id: undefined, time: Date.now() }));
        day(log, key).items.push(it);
        log.recents = [it].concat(log.recents.filter(r => !sameFood(r, it))).slice(0, 20);
        return it;
    }
    function update(log, key, id, item) {
        const d = day(log, key);
        const i = d.items.findIndex(x => x.id === id);
        if (i >= 0) d.items[i] = cleanItem(Object.assign({}, item, { id, time: d.items[i].time }));
        return d.items[i];
    }
    function remove(log, key, id) { const d = day(log, key); d.items = d.items.filter(x => x.id !== id); }
    function toggleFavorite(log, item) {
        const has = log.favorites.some(f => sameFood(f, item));
        log.favorites = has ? log.favorites.filter(f => !sameFood(f, item)) : [cleanItem(item)].concat(log.favorites).slice(0, 50);
        return !has;
    }
    function isFavorite(log, item) { return log.favorites.some(f => sameFood(f, item)); }
    function setMeal(log, key, meal, status) {
        const d = day(log, key);
        if (status === 'eaten' || status === 'skipped') d.meals[meal] = status; else delete d.meals[meal];
    }

    // The day in numbers. planDay: { breakfast, lunch, dinner, snacks: [] } from the plan.
    // planned: everything planned that isn't skipped, plus extras; eaten: meals marked eaten plus extras.
    function totals(planDay, entry) {
        const z = () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
        const addN = (t, n) => { if (!n) return; t.calories += Number(n.calories) || 0; t.protein_g += Number(n.protein_g) || 0; t.carbs_g += Number(n.carbs_g) || 0; t.fat_g += Number(n.fat_g) || 0; };
        const planned = z(); const eaten = z(); const extras = z();
        const meals = (entry && entry.meals) || {};
        let open = 0;
        slotsOf(planDay).forEach(([slot, meal]) => {
            const st = meals[slot];
            if (st === 'skipped') return;
            addN(planned, meal.nutrition);
            if (st === 'eaten') addN(eaten, meal.nutrition); else open++;
        });
        ((entry && entry.items) || []).forEach(it => { addN(extras, it.nutrition); addN(planned, it.nutrition); addN(eaten, it.nutrition); });
        return { planned, eaten, extras, openMeals: open, tracking: Object.keys(meals).length > 0 || ((entry && entry.items) || []).length > 0 };
    }
    // [slot, meal] pairs of a plan day: breakfast, lunch, dinner and any snacks ("snack-1", …).
    function slotsOf(planDay) {
        if (!planDay) return [];
        const out = [];
        ['breakfast', 'lunch', 'dinner'].forEach(t => { if (planDay[t]) out.push([t, planDay[t]]); });
        (Array.isArray(planDay.snacks) ? planDay.snacks : []).forEach((s, i) => { if (s) out.push([`snack-${i + 1}`, s]); });
        return out;
    }

    const api = { parse, estimate, splitText, setAmount, search, fromOpenFoodFacts, manual, dayKey, empty, clean, cleanItem, add, update, remove, toggleFavorite, isFavorite, setMeal, totals, slotsOf, SERVINGS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishLog = api;
})(typeof window !== 'undefined' ? window : globalThis);
