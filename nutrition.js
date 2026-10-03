// Nutrition worked out in code, never taken from an AI: each ingredient line is read ("1 (15 oz) can
// chickpeas", "2 cloves garlic", "1/2 cup rolled oats"), turned into grams with USDA's own portion
// weights, looked up in the offline table (nutrition-data.js, from USDA FoodData Central), added up
// and divided by the servings. Lines that can't be matched are listed, and the result is then
// "approximate". A site's own numbers are kept only when they agree with ours (within 15%).
(function (root) {
    'use strict';

    const Units = root.NourishUnits || (typeof require === 'function' ? require('./units.js') : null);
    const FOODS = root.NourishFoods || (typeof require === 'function' ? (() => { try { return require('./nutrition-data.js'); } catch (e) { return {}; } })() : {});

    const ML = { tsp: 5, tbsp: 15, cup: 240, 'fl oz': 30, pint: 480, quart: 960, ml: 1, l: 1000 };
    const G = { oz: 28.35, lb: 453.6, g: 1, kg: 1000 };
    // Words that describe how an ingredient is cut or prepared, not what it is.
    const PREP = /\b(chopped|finely|roughly|coarsely|thinly|thickly|diced|minced|sliced|grated|shredded|crushed|peeled|seeded|deseeded|cored|trimmed|halved|quartered|cubed|julienned|torn|packed|loosely|lightly|heaping|level|rounded|softened|melted|room temperature|cold|warm|hot|cooked|uncooked|raw|fresh|freshly|frozen|thawed|drained|rinsed|and rinsed|divided|optional|to taste|for serving|for garnish|garnish|plus more|or more|as needed|about|approximately|large|medium|small|extra|boneless|skinless|skin-on|bone-in|organic|good quality|low[- ]sodium|reduced[- ]sodium|unsalted|salted|whole|ground|dried|toasted|roasted|fat[- ]free|lean|of|the|a|an)\b/g;
    // Herbs, spices and seasonings: almost no calories, so a missing amount doesn't matter.
    const FREE = /\b(salt|pepper|cumin|paprika|chili powder|chilli|cayenne|flakes|turmeric|coriander|cinnamon|oregano|basil|thyme|rosemary|parsley|cilantro|dill|mint|chives|bay lea|garlic powder|onion powder|nutmeg|cloves|cardamom|allspice|seasoning|spice|herbs?|zest|vanilla|water|ice|cooking spray|nonstick spray|baking soda|baking powder|yeast)\b/;

    let INDEX = null;   // [phrase, key], longest phrases first
    function index() {
        if (INDEX) return INDEX;
        INDEX = [];
        Object.keys(FOODS).forEach(key => {
            INDEX.push([key, key]);
            (FOODS[key].a || []).forEach(a => INDEX.push([a.toLowerCase(), key]));
        });
        INDEX.sort((a, b) => b[0].length - a[0].length);
        return INDEX;
    }
    function singular(word) {
        if (/(ss|us|is)$/.test(word) || word.length < 4) return word;
        if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
        if (/(tomato|potato|mango|chili|chilli)es$/.test(word)) return word.slice(0, -2);
        if (/(ches|shes|xes)$/.test(word)) return word.slice(0, -2);
        return word.endsWith('s') ? word.slice(0, -1) : word;
    }
    function clean(text) {
        return String(text || '').toLowerCase()
            .replace(/\([^)]*\)/g, ' ').replace(/,.*$/, ' ')        // "(about 2 cups)", ", chopped"
            .replace(/[^a-z0-9%' -]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // The table entry for an ingredient's words, or null.
    function matchFood(text) {
        const base = clean(text);
        const variants = [base, base.split(' ').map(singular).join(' '), base.replace(PREP, ' ').replace(/\s+/g, ' ').trim()];
        variants.push(variants[2].split(' ').map(singular).join(' '));
        for (const [phrase, key] of index()) {
            const re = new RegExp('(^|[^a-z])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])');
            if (variants.some(v => re.test(v))) return { key, food: FOODS[key], phrase };
        }
        return null;
    }

    // Grams in one of a food's portions, by the words in USDA's portion name.
    function portionGrams(food, words) {
        const list = (food && food.u) || [];
        for (const w of words) {
            const hit = list.find(([, desc]) => new RegExp('\\b' + w + '\\b').test(desc));
            if (hit) return hit[0];
        }
        return null;
    }
    function gramsPerMl(food) {
        const cup = portionGrams(food, ['cup']);
        if (cup) return cup / 240;
        const tbsp = portionGrams(food, ['tbsp', 'tablespoon']);
        if (tbsp) return tbsp / 15;
        const tsp = portionGrams(food, ['tsp', 'teaspoon']);
        if (tsp) return tsp / 5;
        return 1;
    }
    // A whole thing ("2 eggs", "1 onion", "1 chicken breast"): USDA's medium, large or whole size.
    function eachGrams(food, key) {
        return portionGrams(food, ['medium', 'large', 'whole', 'breast', 'thigh', 'fillet', 'chop', 'egg', 'fruit', 'pepper', 'clove', 'stalk', 'small', 'piece', 'slice'])
            || ({ garlic: 3, egg: 50, tortilla: 45, 'corn tortilla': 26, bread: 32, pita: 60, bagel: 100, 'english muffin': 60 }[key]) || 100;
    }

    // "1 (15 oz) can chickpeas", "2 x 400g tins tomatoes", "1 14-ounce can": the size inside.
    const PACK = /(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(oz|ounces?|g|grams?|ml|lb|pounds?)\b\.?\)?\s*(?:cans?|tins?|packages?|packets?|jars?|bags?|containers?|cartons?|blocks?|boxes?)?/i;

    // One ingredient line → { grams, key, free } or { unmatched: true }.
    // Oil, butter, sauces and toppings with no amount ("olive oil, for drizzling", "parmesan to
    // serve") are easy to miss: they count with a typical amount per serving, marked as assumed.
    const ASSUMED = [
        [/\b(for (deep[- ]?)?frying|to fry)\b/, /\b(oil|lard|shortening|ghee|fat)\b/, 14, '1 tbsp per serving (absorbed when frying)'],
        [null, /\b(oil|butter|ghee|margarine|lard|shortening|cooking fat)\b/, 5, '1 tsp per serving'],
        [null, /\b(soy sauce|tamari|fish sauce|ketchup|mayo(nnaise)?|ranch|dressing|vinaigrette|bbq|barbecue|sriracha|hot sauce|salsa|pesto|sauce|aioli|gravy|syrup|honey|jam|tahini|hummus|peanut butter|nut butter)\b/, 15, '1 tbsp per serving'],
        [null, /\b(cheese|parmesan|cheddar|mozzarella|feta|sour cream|cream|yogh?urt|cr[eè]me fra[iî]che|nuts?|almonds?|walnuts?|pecans?|cashews?|peanuts?|seeds?|croutons?|bacon bits|avocado|guacamole|chocolate)\b/, 15, '2 tbsp per serving'],
    ];
    function assumedAmount(raw, key) {
        const text = clean(raw) + ' ' + (key || '');
        const hit = ASSUMED.find(([when, what]) => (!when || when.test(raw.toLowerCase())) && what.test(text));
        return hit ? { grams: hit[2], label: hit[3] } : null;
    }

    function readLine(line, servings = 1) {
        const raw = String(line || '').trim();
        if (!raw) return null;
        const item = Units ? Units.splitIngredient(raw) : { qty: null, unit: '', text: raw };
        const words = (item.text || raw) + (item.note ? ' ' + item.note : '');
        const m = matchFood(words) || matchFood(raw);
        const free = FREE.test(clean(words)) && (!m || (FOODS[m.key].n[0] < 400 && /salt|pepper|spice|seasoning|herb|water|zest|vanilla|powder|flakes|leaves/.test(m.key + ' ' + clean(words))));
        if (!m) return free ? { grams: 0, key: null, free: true } : { unmatched: true, line: raw };
        const food = m.food;
        let qty = item.qty;
        let grams = null;
        const pack = raw.match(PACK);
        if (pack && /\b(cans?|tins?|packages?|packets?|jars?|bags?|containers?|cartons?|blocks?|boxes?)\b/i.test(raw)) {
            const size = Number(pack[1]);
            const unit = pack[2].toLowerCase();
            const each = /^(oz|ounce)/.test(unit) ? size * 28.35 : /^(lb|pound)/.test(unit) ? size * 453.6 : size;
            const count = qty != null && raw.indexOf(pack[0]) > raw.search(/\d/) ? qty : 1;
            grams = each * (count || 1);
        } else if (qty != null) {
            const unit = item.unit;
            if (G[unit]) grams = qty * G[unit];
            else if (ML[unit]) grams = qty * ML[unit] * gramsPerMl(food);
            else if (unit === 'clove') grams = qty * (portionGrams(food, ['clove']) || 3);
            else if (unit === 'can') grams = qty * (portionGrams(food, ['can']) || 400);
            else if (unit === 'slice') grams = qty * (portionGrams(food, ['slice']) || 30);
            else if (unit === 'pinch' || unit === 'dash') grams = qty * 0.4;
            else if (unit === 'handful') grams = qty * 30;
            else if (unit === 'bunch') grams = qty * 100;
            else if (unit === 'sprig') grams = qty * 1;
            else if (unit === 'head') grams = qty * (portionGrams(food, ['head']) || 500);
            else if (unit === 'stick') grams = qty * (m.key === 'butter' ? 113 : m.key === 'celery' ? 40 : 3);
            else if (unit === 'package') grams = qty * 300;
            else if (unit === 'scoop') grams = qty * 30;
            else if (unit === 'fillet') grams = qty * (portionGrams(food, ['fillet']) || 150);
            else if (unit === 'piece') grams = qty * eachGrams(food, m.key);
            else grams = qty * eachGrams(food, m.key);
        } else {
            // No amount ("salt to taste", "cooking spray"): seasonings count as nothing; anything else
            // is a guess, so the recipe is marked approximate.
            if (free) return { grams: 0, key: m.key, free: true };
            const typical = assumedAmount(raw, m.key);
            if (typical) return { grams: typical.grams * Math.max(1, Number(servings) || 1), key: m.key, assumed: typical.label };
            return { unmatched: true, line: raw, key: m.key };
        }
        return { grams: Math.max(0, grams), key: m.key, free };
    }

    // { calories, protein_g, carbs_g, fat_g } per serving, the lines that couldn't be matched, and
    // whether the result is approximate.
    function calculate(ingredients, servings) {
        const per = Math.max(1, Number(servings) || 1);
        const total = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
        const unmatched = [];
        const lines = [];
        const assumed = [];
        (ingredients || []).forEach(line => {
            const r = readLine(line, per);
            if (!r) return;
            if (r.unmatched) { unmatched.push(r.line); return; }
            const n = r.key ? FOODS[r.key].n : [0, 0, 0, 0];
            const f = r.grams / 100;
            total.calories += n[0] * f; total.protein_g += n[1] * f; total.carbs_g += n[2] * f; total.fat_g += n[3] * f;
            // Per line, per serving: the breakdown people can check.
            lines.push({ line, key: r.key, grams: Math.round(r.grams), kcal: Math.round(n[0] * f / per), assumed: r.assumed || undefined });
            if (r.assumed) assumed.push({ line: String(line), amount: r.assumed });
        });
        const round = v => Math.round(v / per);
        return {
            nutrition: { calories: round(total.calories), protein_g: round(total.protein_g), carbs_g: round(total.carbs_g), fat_g: round(total.fat_g) },
            unmatched, lines, assumed, approximate: unmatched.length > 0,
        };
    }

    // A recipe's nutrition, settled: our calculation, unless the source's own numbers agree with it
    // (then the source's are kept). Sets nutrition, nutrition_basis ('calculated' | 'source') and
    // nutrition_unmatched (lines we couldn't match: the numbers are approximate).
    function settle(recipe) {
        if (!recipe || !Array.isArray(recipe.ingredients)) return recipe;
        const servings = Math.max(1, Number(recipe.servings) || 1);
        const c = calculate(recipe.ingredients, servings);
        const own = recipe.nutrition && Number(recipe.nutrition.calories) > 0 ? recipe.nutrition : null;
        const calc = c.nutrition;
        let keepOwn = false;
        if (own && calc.calories > 0) keepOwn = Math.abs(own.calories - calc.calories) / calc.calories <= 0.15;
        else if (own && !c.lines.length) keepOwn = true;   // nothing matched at all: the source's numbers are all we have
        recipe.nutrition = keepOwn ? { calories: Math.round(own.calories), protein_g: own.protein_g != null ? Math.round(own.protein_g) : calc.protein_g, carbs_g: own.carbs_g != null ? Math.round(own.carbs_g) : calc.carbs_g, fat_g: own.fat_g != null ? Math.round(own.fat_g) : calc.fat_g } : calc;
        recipe.nutrition_basis = keepOwn ? 'source' : 'calculated';
        recipe.nutrition_unmatched = c.unmatched.length ? c.unmatched.slice(0, 12) : undefined;
        recipe.nutrition_assumed = c.assumed.length ? c.assumed.slice(0, 12) : undefined;
        // The site's own numbers next to ours, so the breakdown can say how well they agree.
        recipe.nutrition_check = own && calc.calories > 0 ? { source: Math.round(own.calories), calculated: calc.calories } : undefined;
        delete recipe.nutrition_estimated;
        return recipe;
    }

    // Online lookup for an ingredient the table doesn't know (Open Food Facts, no key): per 100 g, cached.
    async function lookupOnline(name, fetchJSON) {
        const key = 'nourish_food_' + clean(name).slice(0, 60);
        try { const hit = root.localStorage && JSON.parse(root.localStorage.getItem(key) || 'null'); if (hit) return hit; } catch (e) { /* no cache */ }
        try {
            const data = await fetchJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(clean(name))}&search_simple=1&json=1&page_size=5&fields=product_name,nutriments`);
            const p = ((data && data.products) || []).find(x => x.nutriments && x.nutriments['energy-kcal_100g'] > 0);
            if (!p) return null;
            const n = p.nutriments;
            const out = [Math.round(n['energy-kcal_100g']), +(n.proteins_100g || 0), +(n.carbohydrates_100g || 0), +(n.fat_100g || 0)];
            try { root.localStorage && root.localStorage.setItem(key, JSON.stringify(out)); } catch (e) { /* full */ }
            return out;
        } catch (e) { return null; }
    }

    const api = { calculate, settle, readLine, matchFood, lookupOnline, FOODS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishNutrition = api;
})(typeof window !== 'undefined' ? window : globalThis);
