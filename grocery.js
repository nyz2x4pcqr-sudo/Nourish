// The shopping list: turns every ingredient line in the plan into one row per thing to buy.
// "2 large eggs" + "4 eggs" become "Eggs ×6"; "3 oz cooked chicken breast" and "½ cup grilled chicken
// breast" become one "Chicken breast" row. Also decides which ingredient lines are junk the AI made up
// ("ingredients", "use 1 cup", a whole list squashed into one line), used when a plan is made too.
(function (root) {
    'use strict';

    // Words that are part of the AI's answer format, never a thing to buy.
    const SCHEMA_WORDS = ['ingredients', 'ingredient', 'steps', 'step', 'name', 'nutrition', 'description', 'time_minutes',
        'calories', 'protein_g', 'carbs_g', 'fat_g', 'breakfast', 'lunch', 'dinner', 'recipe', 'meal'];
    const JUNK_STARTS = ['use ', 'description of ', 'add ', 'soak ', 'mix ', 'stir ', 'cook ', 'serve ', 'combine ', 'then '];

    // Why an ingredient line is junk, or '' when it's a real item.
    function junkReason(line) {
        const text = String(line == null ? '' : line).trim();
        const lower = text.toLowerCase().replace(/[.:;!]+$/, '');
        if (text.length < 3) return 'too short';
        if (SCHEMA_WORDS.indexOf(lower.replace(/^"|"$/g, '')) !== -1) return 'a field name, not an ingredient';
        for (const start of JUNK_STARTS) if (lower.indexOf(start) === 0) return `starts with "${start.trim()}"`;
        if ((text.match(/,/g) || []).length > 2) return 'several items in one line';
        if (!/[a-z]/i.test(text)) return 'no words';
        return '';
    }

    const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
    const UNITS = {
        cup: 'cup', cups: 'cup', c: 'cup', tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
        oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', g: 'g', gram: 'g', grams: 'g', kg: 'kg',
        ml: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
        can: 'can', cans: 'can', pinch: 'pinch', handful: 'handful', handfuls: 'handful', piece: 'piece', pieces: 'piece', stick: 'stick', sticks: 'stick',
        bunch: 'bunch', head: 'head', sprig: 'sprig', sprigs: 'sprig', package: 'package', packages: 'package', pkg: 'package', scoop: 'scoop', scoops: 'scoop',
        fillet: 'fillet', fillets: 'fillet', dash: 'dash',
    };
    // Words that describe how something is prepared or sized, not what to buy.
    const PREP = ['cooked', 'uncooked', 'grilled', 'chopped', 'diced', 'fresh', 'freshly', 'whole', 'room', 'temp', 'temperature', 'sliced', 'minced', 'shredded',
        'grated', 'mashed', 'boneless', 'skinless', 'raw', 'frozen', 'ripe', 'finely', 'roughly', 'thinly', 'peeled', 'crushed', 'ground', 'melted',
        'softened', 'beaten', 'toasted', 'steamed', 'boiled', 'baked', 'roasted', 'large', 'medium', 'small', 'extra', 'virgin', 'low-fat', 'lowfat',
        'fat-free', 'nonfat', 'plain', 'cubed', 'halved', 'quartered', 'rinsed', 'drained', 'packed', 'heaping', 'level', 'optional', 'organic', 'about',
        'approx', 'approximately', 'cold', 'warm', 'hot', 'lean', 'thick', 'thin', 'of', 'a', 'an', 'some', 'to', 'taste', 'for', 'garnish', 'serving'];

    // "1 1/2", "1/2", "1.5", "1½", "½" at the start of a line.
    function parseNumber(text) {
        const frac = text.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)/);
        if (frac && Number(frac[3])) return { value: (frac[1] ? Number(frac[1]) : 0) + Number(frac[2]) / Number(frac[3]), length: frac[0].length };
        const m = text.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])?/);
        if (!m || !(m[1] || m[2])) return null;
        return { value: (m[1] ? Number(m[1]) : 0) + (m[2] ? FRACTIONS[m[2]] : 0), length: m[0].length };
    }

    const PLURAL_UNITS = { cup: 'cups', clove: 'cloves', slice: 'slices', can: 'cans', handful: 'handfuls', piece: 'pieces', stick: 'sticks',
        bunch: 'bunches', head: 'heads', sprig: 'sprigs', package: 'packages', scoop: 'scoops', fillet: 'fillets', pinch: 'pinches', dash: 'dashes' };
    function unitFor(unit, n) { return n > 1 && PLURAL_UNITS[unit] ? PLURAL_UNITS[unit] : unit; }

    function singular(word) {
        if (/ies$/.test(word) && word.length > 4) return word.slice(0, -3) + 'y';
        if (/(oes|ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
        if (/ves$/.test(word) && word.length > 4) return word.slice(0, -3) + 'f';
        if (/[^s]s$/.test(word) && word.length > 3) return word.slice(0, -1);
        return word;
    }

    // "2 large eggs, beaten" → { name: 'eggs', key: 'egg', qty: 2, unit: '' }.
    function parseIngredient(line) {
        let text = String(line).trim().replace(/\s+/g, ' ');
        // "chicken breast: 3 oz cooked" → amount after the colon.
        let amount = '';
        const colon = text.indexOf(':');
        if (colon > 0) { amount = text.slice(colon + 1).trim(); text = text.slice(0, colon).trim(); }
        text = text.replace(/\([^)]*\)/g, ' ').split(',')[0].trim();   // "(about 200 g)", ", diced"
        const source = amount || text;
        let qty = null;
        let unit = '';
        const num = parseNumber(source.replace(/^(\d+)\s*-\s*\d+/, '$1'));
        let rest = num ? source.slice(num.length).trim() : source;
        if (num) qty = num.value;
        const unitWord = (rest.match(/^([a-z]+)\.?\b/i) || [])[1];
        if (num && unitWord && UNITS[unitWord.toLowerCase()]) {
            unit = UNITS[unitWord.toLowerCase()];
            rest = rest.slice(unitWord.length).replace(/^\.\s*/, '').trim();
        }
        if (!amount) text = rest;
        const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(w => w && PREP.indexOf(w) === -1 && !/^\d/.test(w));
        if (!words.length) return null;
        const name = words.join(' ');
        const key = words.map(singular).join(' ');
        return { name, key, qty, unit };
    }

    function formatQty(n) {
        const whole = Math.floor(n + 1e-9);
        const frac = n - whole;
        const marks = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
        for (const [v, mark] of marks) if (Math.abs(frac - v) < 0.04) return (whole ? whole : '') + mark;
        return frac < 0.04 ? String(whole) : String(Math.round(n * 10) / 10);
    }

    const CATEGORIES = [
        ['Protein', ['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'turkey', 'egg', 'tofu', 'tempeh', 'lamb', 'bacon', 'sausage', 'ham', 'lentil', 'chickpea', 'bean']],
        ['Dairy', ['milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'feta', 'parmesan', 'mozzarella']],
        ['Grains & bakery', ['rice', 'pasta', 'noodle', 'bread', 'oat', 'flour', 'quinoa', 'tortilla', 'couscous', 'bagel', 'wrap', 'granola']],
        ['Produce', ['tomato', 'onion', 'garlic', 'lettuce', 'spinach', 'broccoli', 'carrot', 'apple', 'banana', 'berr', 'lemon', 'lime', 'bell pepper', 'mushroom', 'potato', 'zucchini', 'cucumber', 'celery', 'kale', 'cabbage', 'avocado', 'ginger', 'cilantro', 'parsley', 'basil', 'herb', 'pea', 'corn', 'squash', 'asparagus', 'fruit', 'orange', 'vegetable', 'veggie', 'salad']],
        ['Pantry', ['oil', 'salt', 'pepper', 'spice', 'sauce', 'vinegar', 'soy', 'honey', 'sugar', 'stock', 'broth', 'paprika', 'cumin', 'mustard', 'nut', 'seed', 'syrup']],
    ];

    // Names that contain another aisle's word ("almond butter" isn't dairy, "eggplant" isn't protein).
    const EXCEPTIONS = [
        [/\b(almond|peanut|cashew|nut|seed|sunflower|apple) butter\b|\b(coconut|almond|oat|soy|rice) milk\b|coconut cream|cream of tartar/, 'Pantry'],
        [/eggplant|bean sprout|green bean|butternut|butter lettuce|pea shoot/, 'Produce'],
    ];

    function categorize(name) {
        const lower = String(name).toLowerCase();
        for (const [re, cat] of EXCEPTIONS) if (re.test(lower)) return cat;
        for (const [cat, words] of CATEGORIES) if (words.some(w => lower.indexOf(w) !== -1)) return cat;
        return 'Other';
    }

    // The list for a plan: [{ key, text, category, uses }], one per thing to buy, junk left out.
    const Units = root.NourishUnits || (typeof require === 'function' ? require('./units.js') : null);

    // The key that says two lines are the same thing to buy ("2 large eggs" and "4 eggs" → "egg").
    function ingredientKey(line) {
        const item = parseIngredient(line);
        return item ? item.key : String(line).trim().toLowerCase();
    }

    // A recipe's ingredient lines with any later line for the same thing dropped (the first one stays).
    function dedupeIngredients(list) {
        const seen = new Set();
        return (list || []).filter(line => {
            const key = ingredientKey(line);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // The list for a plan: [{ key, text, category, uses }], one per thing to buy, junk left out.
    // Amounts are added up in millilitres / grams and shown in `system` ('imperial' or 'metric').
    function buildList(days, mealTypes, system) {
        const rows = {};
        const order = [];
        (days || []).forEach(day => (mealTypes || ['breakfast', 'lunch', 'dinner']).forEach(type => {
            const meal = day && day[type];
            const list = meal && Array.isArray(meal.ingredients) ? dedupeIngredients(meal.ingredients) : [];
            list.forEach(line => {
                if (typeof line !== 'string' || junkReason(line)) return;
                const capped = Units.clampIngredient(line).line;
                const item = parseIngredient(capped);
                if (!item) return;
                const amount = Units.splitIngredient(capped);
                item.base = Units.toBase(amount.qty, amount.unit);
                if (!rows[item.key]) { rows[item.key] = { key: item.key, name: item.name, parts: [] }; order.push(item.key); }
                rows[item.key].parts.push(item);
            });
        }));
        return order.map(key => {
            const row = rows[key];
            const title = row.name.charAt(0).toUpperCase() + row.name.slice(1);
            // Add up per kind: "2 tomatoes" + "1 tomato" + "1 can tomatoes" → "3 + 1 can"; cups + ml → one volume.
            const totals = {};
            const kinds = [];
            let uncounted = 0;
            row.parts.forEach(p => {
                if (!p.base) { uncounted++; return; }
                if (!(p.base.kind in totals)) { totals[p.base.kind] = 0; kinds.push(p.base.kind); }
                totals[p.base.kind] += p.base.value;
            });
            let amount = '';
            if (kinds.length && kinds.length <= 3) {
                amount = kinds.map(k => Units.formatBase(k, totals[k], system || 'imperial')).join(' + ');
                if (kinds.length === 1 && kinds[0] === 'count' && uncounted) amount = '';
            } else if (row.parts.length > 1) {
                amount = `×${row.parts.length}`;
            }
            if (amount === '' && row.parts.length > 1) amount = `×${row.parts.length}`;
            return { key, text: amount ? `${title} ${amount.charAt(0) === '×' ? amount : '— ' + amount}` : title, category: categorize(key), uses: row.parts.length };
        });
    }

    const api = { junkReason, parseIngredient, ingredientKey, dedupeIngredients, buildList, categorize, CATEGORIES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NourishGrocery = api;
})(typeof window !== 'undefined' ? window : this);
