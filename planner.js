// Turning a pile of recipes into a week that makes sense:
// - every recipe is classed by meal (breakfast food for breakfast, a proper main for lunch and dinner);
// - each day hits the calorie target (within about 5%) by picking the right recipes and setting
//   portion sizes, cutting oil and sugar before portions and never cutting seasoning;
// - macros come close to the targets; no main protein or main vegetable twice in a day, no dish
//   twice in a week, and a mix of cuisines;
// - savory recipes must be properly seasoned (salt with an amount, plus herbs, spices, citrus,
//   vinegar, garlic or chili); bland ones are re-seasoned or passed over.
// Pure functions (no network): the sources (sources.js) find recipes, this file plans with them.
(function (root) {
    'use strict';

    const req = n => (typeof require === 'function' ? require(n) : null);
    const N = root.NourishNutrition || req('./nutrition.js');
    const P = root.NourishPrefs || req('./prefs.js');
    const U = root.NourishUnits || req('./units.js');

    // === MEAL TYPES ===
    const BREAKFAST = /\b(breakfast|brunch|oat|oats|oatmeal|porridge|granola|muesli|bircher|pancakes?|waffles?|crepes?|french toast|omelet+e?s?|frittatas?|scrambled?|scramble|eggs? benedict|shakshuka|smoothie|parfait|yogh?urt bowl|chia (seed )?pudding|muffins?|scones?|breakfast burrito|avocado toast|toast|bagels?|hash browns?|huevos|congee|egg (muffin|cup|bite)s?|egg bake|breakfast bowl|overnight|acai|quiche|dutch baby|cr[eê]pe)\b/i;
    const ONLY_BREAKFAST = /\b(oat|oats|oatmeal|porridge|granola|muesli|bircher|pancakes?|waffles?|french toast|smoothie|parfait|chia (seed )?pudding|muffins?|scones?|overnight|acai|cereal)\b/i;
    const DESSERT = /\b(cake|cupcakes?|cookies?|brownies?|blondies?|fudge|candy|frosting|icing|cheesecake|tart|pie crust|ice cream|sorbet|gelato|truffles?|macarons?|meringue|tiramisu|mousse|pudding|cobbler|crumble|custard|donuts?|doughnuts?|cinnamon rolls?|sweet rolls?|dessert)\b/i;
    const NOT_DESSERT = /\b(chia pudding|yorkshire pudding|black pudding|bread pudding|pot pie|shepherd'?s pie|chicken pie|cottage pie|savou?ry)\b/i;
    const DINNER_ONLY = /\b(curry|curries|tikka|masala|korma|vindaloo|biryani|roast|roasted (chicken|lamb|pork|beef)|stew|braise[d]?|chops?|steaks?|ribs|lasagna|lasagne|casserole|tagine|meatloaf|pot roast|bolognese|pot pie|enchiladas|paella|risotto|stroganoff|carbonara|lamb|brisket|pulled pork|short rib)\b/i;
    const NOT_A_MEAL = /\b(sauce|dressing|dip|marinade|seasoning|spice (mix|blend)|stock|broth|syrup|jam|butter|vinaigrette|gravy|salsa|pesto|chutney|pickle[sd]?|drink|cocktail|mocktail|lemonade|tea|coffee|latte|juice|bread|loaf|rolls|buns|crackers|croutons|bars|bites|energy balls|protein balls|trail mix|popcorn|chips)$/i;
    const SIDE = /\b(side|sides|side dish|appetizers?|starters?|snacks?)\b/i;

    function textOf(r) { return `${r.name || ''} ${(r.category || []).join ? (r.category || []).join(' ') : r.category || ''}`; }

    // Which meals a recipe can be: { breakfast, lunch, dinner, why }.
    function mealFit(r) {
        const name = String(r.name || '').replace(/\([^)]*\)/g, ' ').replace(/[!?.]+/g, ' ').replace(/\s+/g, ' ').trim();
        const cat = String(Array.isArray(r.category) ? r.category.join(' ') : r.category || '').toLowerCase();
        const ings = (r.ingredients || []).join(' ').toLowerCase();
        const sweetHeavy = /\b(sugar|honey|maple|chocolate|syrup)\b/.test(ings) && !/\b(salt|garlic|onion|soy|pepper)\b/.test(ings);
        if ((DESSERT.test(name) && !NOT_DESSERT.test(name)) || /dessert|baking|treat/.test(cat)) return { breakfast: false, lunch: false, dinner: false, why: 'a dessert' };
        if (NOT_A_MEAL.test(name.trim()) || /\b(sauce|drink|beverage|condiment|dressing)\b/.test(cat)) return { breakfast: false, lunch: false, dinner: false, why: 'not a meal' };
        const brk = BREAKFAST.test(name) || /breakfast|brunch/.test(cat);
        // A recipe the site files under breakfast only stays at breakfast.
        const brkOnlyCat = /breakfast|brunch/.test(cat) && !/lunch|dinner|main|entr[eé]e|supper/.test(cat);
        const onlyBrk = ONLY_BREAKFAST.test(name) || (brk && sweetHeavy) || brkOnlyCat || /\bbreakfast\b/i.test(name);
        const heavy = DINNER_ONLY.test(name);
        const side = SIDE.test(cat) && !/main/.test(cat);
        const hasProtein = !!mainProtein(r);
        return {
            breakfast: brk && !heavy,
            lunch: !onlyBrk && !side && !sweetHeavy && (hasProtein || /salad|soup|bowl|wrap|sandwich|pasta|noodle|grain|lentil|bean|chickpea/i.test(name)),
            dinner: !onlyBrk && !side && !sweetHeavy && hasProtein,
            why: heavy && brk ? 'a dinner dish' : '',
        };
    }

    // === MAIN PROTEIN, MAIN VEGETABLE, CUISINE ===
    const PROTEIN = {
        'chicken breast': 'chicken', 'chicken thigh': 'chicken', chicken: 'chicken', 'ground chicken': 'chicken', 'turkey breast': 'turkey', 'ground turkey': 'turkey',
        'ground beef': 'beef', 'lean ground beef': 'beef', 'beef steak': 'beef', 'beef stew meat': 'beef', 'pork tenderloin': 'pork', 'pork chop': 'pork', 'ground pork': 'pork',
        'pork shoulder': 'pork', bacon: 'pork', ham: 'pork', sausage: 'pork', chorizo: 'pork', lamb: 'lamb', 'lamb chop': 'lamb', 'ground lamb': 'lamb',
        salmon: 'salmon', 'smoked salmon': 'salmon', tuna: 'tuna', 'tuna steak': 'tuna', cod: 'white fish', tilapia: 'white fish', shrimp: 'shrimp', scallops: 'shellfish',
        mussels: 'shellfish', crab: 'shellfish', sardines: 'oily fish', egg: 'egg', 'egg white': 'egg', tofu: 'tofu', tempeh: 'tempeh', chickpeas: 'chickpeas',
        'black beans': 'beans', 'kidney beans': 'beans', 'white beans': 'beans', 'pinto beans': 'beans', lentils: 'lentils', 'cooked lentils': 'lentils', edamame: 'soybeans',
        'greek yogurt': 'yogurt', 'cottage cheese': 'cottage cheese', 'protein powder': 'protein powder', halloumi: 'cheese', paneer: 'cheese',
    };
    const VEG = new Set(['tomato', 'cherry tomatoes', 'canned tomatoes', 'bell pepper', 'carrot', 'celery', 'cucumber', 'zucchini', 'eggplant', 'broccoli', 'cauliflower', 'spinach', 'kale',
        'lettuce', 'cabbage', 'brussels sprouts', 'bok choy', 'asparagus', 'green beans', 'mushrooms', 'corn', 'potato', 'sweet potato', 'butternut squash', 'beet', 'radish',
        'avocado', 'artichoke', 'leek', 'fennel', 'snow peas', 'peas']);
    function weighed(r) {
        if (!r._lines) r._lines = N.calculate(r.ingredients || [], r.servings || 1).lines;
        return r._lines;
    }
    function heaviest(r, pick) {
        let best = null;
        weighed(r).forEach(l => { const g = pick(l.key); if (g && (!best || l.grams > best.grams)) best = { group: g, grams: l.grams }; });
        return best ? best.group : null;
    }
    function mainProtein(r) { return heaviest(r, k => PROTEIN[k]); }
    function mainVeg(r) { return heaviest(r, k => (VEG.has(k) ? k.replace(/^(cherry |canned )/, '') : null)); }
    const CUISINE_HINTS = [
        ['italian', /\b(pasta|risotto|parmesan|basil|marinara|pesto|lasagn|gnocchi|italian|caprese|bruschetta|polenta|prosciutto)\b/],
        ['mexican', /\b(tortilla|taco|burrito|enchilada|salsa|jalape|chipotle|cumin.*lime|lime.*cumin|cilantro.*lime|quesadilla|fajita|mexican|guacamole|black beans)\b/],
        ['indian', /\b(garam masala|curry|tikka|masala|dal|dhal|paneer|naan|turmeric.*cumin|biryani|chana|indian|tandoori)\b/],
        ['thai', /\b(thai|fish sauce|lemongrass|coconut milk.*curry|pad |larb|tom yum|green curry|red curry)\b/],
        ['japanese', /\b(miso|teriyaki|soba|udon|japanese|sushi|ramen|katsu|mirin|dashi)\b/],
        ['chinese', /\b(stir[- ]?fry|hoisin|oyster sauce|chinese|kung pao|lo mein|fried rice|szechuan|sichuan|five spice)\b/],
        ['korean', /\b(gochujang|kimchi|bulgogi|bibimbap|korean)\b/],
        ['mediterranean', /\b(feta|hummus|tahini|za'?atar|tzatziki|greek|mediterranean|falafel|shawarma|kalamata|harissa|couscous|tabbouleh|chickpea)\b/],
        ['american', /\b(bbq|barbecue|burger|mac and cheese|cajun|ranch|buffalo|meatloaf|chili)\b/],
    ];
    function cuisineOf(r) {
        if (r.cuisine) return String(Array.isArray(r.cuisine) ? r.cuisine[0] : r.cuisine).toLowerCase();
        const text = `${r.name} ${(r.ingredients || []).join(' ')}`.toLowerCase();
        const hit = CUISINE_HINTS.find(([, re]) => re.test(text));
        return hit ? hit[0] : 'other';
    }

    // === FLAVOR ===
    const SALTY = /\b(salt|soy sauce|tamari|fish sauce|miso|coconut aminos|bouillon|stock cube|anchov|capers|olives|parmesan|feta)\b/i;
    const FLAVOR = /\b(garlic|ginger|onion|shallot|scallion|chili|chilli|jalape|cayenne|paprika|cumin|coriander|turmeric|garam masala|curry|oregano|basil|thyme|rosemary|parsley|cilantro|dill|mint|chives|sage|tarragon|bay lea|lemon|lime|orange zest|vinegar|mustard|soy sauce|fish sauce|miso|gochujang|harissa|sriracha|hot sauce|salsa|pesto|za'?atar|sumac|five spice|cinnamon|nutmeg|smoked|black pepper|pepper flakes|herbs?|spices?|seasoning|zest|worcestershire|tahini|sesame oil)\b/gi;
    const TO_TASTE = /\b(salt|kosher salt|sea salt)\b[^,]*\b(to taste|as needed|for seasoning)\b|^salt( and (black )?pepper)?$|^(kosher |sea )?salt and (freshly )?(ground )?(black )?pepper( to taste)?$/i;
    function isSavory(r) {
        const fit = r._fit || mealFit(r);
        const ings = (r.ingredients || []).join(' ').toLowerCase();
        return (fit.lunch || fit.dinner || !!mainProtein(r)) && !(fit.breakfast && /\b(oat|yogurt|berries|banana|honey|maple|granola|chia)\b/.test(ings) && !/\b(egg|cheese|bacon|sausage|spinach|tomato)\b/.test(ings));
    }
    // { savory, salt (with an amount), flavors (how many), ok }
    function flavorCheck(r) {
        const savory = isSavory(r);
        const lines = (r.ingredients || []).map(String);
        const saltLine = lines.find(l => SALTY.test(l));
        const salt = !!saltLine && !TO_TASTE.test(saltLine.trim());
        const flavors = new Set((lines.join(' ').match(FLAVOR) || []).map(x => x.toLowerCase())).size;
        return { savory, salt, flavors, ok: !savory || (salt && flavors >= 2) };
    }
    const KITS = {
        mexican: ['1 tsp ground cumin', '1 tsp chili powder', '1 lime (juice)', '2 cloves garlic'],
        italian: ['1 tsp dried oregano', '2 cloves garlic', '1 tbsp lemon juice', '2 tbsp chopped fresh basil'],
        indian: ['1 tsp garam masala', '1/2 tsp ground turmeric', '1 tsp grated fresh ginger', '2 cloves garlic'],
        thai: ['1 tbsp fish sauce', '1 lime (juice)', '1 tsp grated fresh ginger', '1/2 tsp chili flakes'],
        japanese: ['1 tbsp low-sodium soy sauce', '1 tsp grated fresh ginger', '1 tsp rice vinegar', '1 green onion'],
        chinese: ['1 tbsp low-sodium soy sauce', '1 tsp grated fresh ginger', '2 cloves garlic', '1/2 tsp chili flakes'],
        korean: ['1 tbsp low-sodium soy sauce', '1 tsp gochujang', '2 cloves garlic', '1 green onion'],
        mediterranean: ['1 tsp dried oregano', '1 tbsp lemon juice', '2 cloves garlic', '1/2 tsp smoked paprika'],
        other: ['2 cloves garlic', '1 tbsp lemon juice', '1/2 tsp smoked paprika', '1/2 tsp dried thyme'],
    };
    // Gives a bland savory recipe real seasoning: salt with an amount, and a few near-zero-calorie
    // flavors that suit its cuisine. Returns what was added.
    function reseason(r) {
        const added = [];
        const people = Math.max(1, Number(r.servings) || 1);
        const lines = r.ingredients.slice();
        const i = lines.findIndex(l => TO_TASTE.test(String(l).trim()));
        const saltAmt = people <= 2 ? '1/2 tsp' : people <= 4 ? '3/4 tsp' : '1 tsp';
        if (i >= 0) { lines[i] = `${saltAmt} salt`; lines.push('1/4 tsp ground black pepper'); added.push(`${saltAmt} salt`); }
        else if (!lines.some(l => SALTY.test(l))) { lines.push(`${saltAmt} salt`); added.push(`${saltAmt} salt`); }
        const kit = KITS[cuisineOf(r)] || KITS.other;
        const have = lines.join(' ').toLowerCase();
        let need = Math.max(0, 2 - new Set((have.match(FLAVOR) || []).map(x => x.toLowerCase())).size);
        for (const k of kit) {
            if (need <= 0) break;
            const word = k.replace(/^[\d/ .]+(tsp|tbsp|cloves?|lime|green onion)?\s*/, '').replace(/\(.*\)/, '').replace(/^(ground|dried|chopped fresh|grated fresh|low-sodium)\s+/, '').trim();
            if (have.indexOf(word.split(' ')[0]) >= 0) continue;
            lines.push(k); added.push(k); need--;
        }
        if (!added.length) return [];
        r.ingredients = lines;
        const steps = (r.steps || []).slice();
        const at = Math.max(0, steps.length - 1);
        steps.splice(at, 0, `Season with ${added.map(a => a.replace(/^[\d/ .]+(tsp|tbsp)\s*/, '')).join(', ')}; taste and adjust before serving.`);
        r.steps = steps;
        r.reseasoned = added;
        delete r._lines;
        return added;
    }

    // === PORTIONS ===
    const FATTY = /\b(oil|butter|ghee|margarine|lard|shortening|mayonnaise|mayo)\b/i;
    const SWEET = /\b(sugar|honey|maple syrup|syrup|agave|molasses|jam|chocolate chips)\b/i;
    function scaleLine(line, k) {
        const item = U.splitIngredient(line);
        if (item.qty == null || Math.abs(k - 1) < 0.01) return String(line);
        let q = item.qty * k;
        const unit = item.unit;
        if (!unit || unit === 'clove' || unit === 'can' || unit === 'slice' || unit === 'piece' || unit === 'fillet') q = Math.max(0.5, Math.round(q * 2) / 2);
        else if (unit === 'g' || unit === 'ml') q = Math.max(5, Math.round(q / 5) * 5);
        else q = Math.max(0.125, Math.round(q * 8) / 8);
        const amount = U.formatAmount(q, unit);
        return item.note !== undefined ? `${item.text}: ${amount}${item.note ? ' ' + item.note : ''}` : `${amount} ${item.text}`.trim();
    }
    // Cuts oil, butter and sugar (to no less than half, keeping at least a teaspoon of oil) to save
    // up to `kcal` per serving. Seasoning is never touched. Returns the calories saved per serving.
    function trimRich(r, kcal) {
        if (kcal <= 0) return 0;
        const before = N.calculate(r.ingredients, r.servings).nutrition.calories;
        r.ingredients = r.ingredients.map(line => {
            if (!(FATTY.test(line) || SWEET.test(line)) || /\b(spray|for greasing)\b/i.test(line)) return line;
            const item = U.splitIngredient(line);
            if (item.qty == null) return line;
            const isTsp = item.unit === 'tsp';
            if (isTsp && item.qty <= 1) return line;
            return scaleLine(line, 0.5);
        });
        delete r._lines;
        const after = N.calculate(r.ingredients, r.servings).nutrition.calories;
        if (before - after > 0) r.trimmed = true;
        return before - after;
    }
    // Cuts oil and sugar, then lowers the recipe's numbers by what the cut saved (worked out from the
    // ingredients, so the source's own numbers stay the base).
    function trimAndRecount(r, kcal) {
        const before = N.calculate(r.ingredients, r.servings).nutrition;
        trimRich(r, kcal);
        if (!r.trimmed) return;
        const after = N.calculate(r.ingredients, r.servings).nutrition;
        const n = r.nutrition;
        r.nutrition = { calories: Math.max(1, n.calories - (before.calories - after.calories)), protein_g: Math.max(0, n.protein_g - (before.protein_g - after.protein_g)),
            carbs_g: Math.max(0, n.carbs_g - (before.carbs_g - after.carbs_g)), fat_g: Math.max(0, n.fat_g - (before.fat_g - after.fat_g)) };
    }
    // The recipe made for `people`, each portion `factor` times one of the recipe's servings.
    function scaleRecipe(r, factor, people) {
        const out = JSON.parse(JSON.stringify(r));
        const from = Math.max(1, Number(r.servings) || 1);
        const k = factor * people / from;
        out.ingredients = (r.ingredients || []).map(l => scaleLine(l, k));
        out.servings = people;
        if (Math.abs(factor - 1) > 0.05 || from !== people) out.scaled = { from_servings: from, portion: Math.round(factor * 100) / 100 };
        delete out._lines; delete out._fit;
        // Per person = one serving of the recipe (as settled) × the portion. Worked out from the
        // settled numbers, not the rounded amounts, so an amount that can't be scaled ("a handful")
        // never leaves the calories unchanged.
        const n = r.nutrition || N.calculate(r.ingredients, from).nutrition;
        const round = v => Math.round((Number(v) || 0) * factor);
        out.nutrition = { calories: round(n.calories), protein_g: round(n.protein_g), carbs_g: round(n.carbs_g), fat_g: round(n.fat_g) };
        return out;
    }

    // === CALORIE SPLIT ===
    const SPLITS = { dinner: [25, 30, 45], even: [33, 33, 34], breakfast: [40, 30, 30] };
    function splitOf(settings) {
        const s = settings || {};
        if (s.calorie_split === 'custom') {
            const v = [s.split_breakfast, s.split_lunch, s.split_dinner].map(Number);
            const sum = v.reduce((a, b) => a + (b > 0 ? b : 0), 0);
            if (sum > 0 && v.every(x => x >= 5)) return v.map(x => x / sum);
        }
        return (SPLITS[s.calorie_split] || SPLITS.dinner).map(x => x / 100);
    }
    function targetsOf(settings) {
        const kcal = Number(settings.calorie_target) || 2000;
        return { kcal, protein: Number(settings.protein_target) || Math.round(kcal * 0.25 / 4), carbs: Math.round(kcal * 0.45 / 4), fat: Math.round(kcal * 0.3 / 9) };
    }

    // === PLANNING ===
    const MEALS = ['breakfast', 'lunch', 'dinner'];
    // How well a recipe fits a slot: lower is better. Infinity = can't be used.
    function slotCost(r, kcalTarget, ctx) {
        const n = r.nutrition;
        if (!n || !(n.calories > 0)) return Infinity;
        let f = kcalTarget / n.calories;
        const rich = r._richKcal || 0;   // calories trimRich could save per serving
        if (f < 0.6 && n.calories - rich > 0) f = Math.max(f, kcalTarget / (n.calories - rich) * 0.95);
        if (f < 0.55 || f > 2) return Infinity;
        let cost = Math.abs(Math.log(f)) * 2;
        const share = kcalTarget / ctx.targets.kcal;
        const pTarget = ctx.targets.protein * share;
        const fTarget = ctx.targets.fat * share;
        const p = n.protein_g * f, fat = n.fat_g * f;
        cost += Math.max(0, (pTarget - p) / pTarget) * 1.5 + Math.max(0, (fat - fTarget) / fTarget) * 1.5;
        cost -= Math.min(2, P.likeScore(r, ctx.likes)) * 0.5;
        if (ctx.goal === 'Cut' && r.healthy) cost -= 0.3;
        if (r.nutrition_unmatched) cost += 0.2;
        if (r.reseasoned) cost += 0.4;
        cost += (ctx.sourcePenalty && ctx.sourcePenalty(r)) || 0;
        cost += (ctx.cuisineCount[cuisineOf(r)] || 0) * 0.35;
        return cost;
    }

    // Picks recipes for each day and sizes the portions. pools: { breakfast: [recipes], … } (already
    // checked: allowed, seasoned, nutrition settled). Returns { days: [{ breakfast, lunch, dinner }],
    // missing: [{ day, meal, kcal }], report: [{ day, kcal, protein, carbs, fat }] }.
    function planWeek({ pools, settings, likes, days = 7, people = 1, sourcePenalty, already = [] }) {
        const targets = targetsOf(settings);
        const split = splitOf(settings);
        const used = new Set(already.map(n => normName(n)));
        const ctx = { targets, likes: P.parse(likes || ''), goal: settings.goal || settings.prefsGoal, sourcePenalty, cuisineCount: {} };
        const out = [];
        const missing = [];
        const report = [];
        for (let d = 0; d < days; d++) {
            const top = {};
            MEALS.forEach((m, i) => {
                const kcal = targets.kcal * split[i];
                top[m] = (pools[m] || []).filter(r => !used.has(normName(r.name)) && !(r.sameAs && r.sameAs.some(x => used.has(x))))
                    .map(r => ({ r, cost: slotCost(r, kcal, ctx) })).filter(x => isFinite(x.cost))
                    .sort((a, b) => a.cost - b.cost).slice(0, 8);
            });
            // The best combination: different main proteins and vegetables, closest to the day's macros.
            let best = null;
            const opts = m => (top[m].length ? top[m] : [null]);
            opts('breakfast').forEach(b => opts('lunch').forEach(l => opts('dinner').forEach(dn => {
                const pick = [b, l, dn];
                const rs = pick.filter(Boolean).map(x => x.r);
                if (new Set(rs.map(r => normName(r.name))).size < rs.length) return;
                const prots = rs.map(mainProtein).filter(Boolean);
                if (new Set(prots).size < prots.length) return;
                const vegs = rs.map(mainVeg).filter(Boolean);
                if (new Set(vegs).size < vegs.length) return;
                const cuis = rs.map(cuisineOf).filter(c => c !== 'other');
                let cost = pick.reduce((s, x) => s + (x ? x.cost : 50), 0);
                // The whole day's protein and fat once each meal is sized to its share of calories.
                let p = 0, f = 0, share = 0;
                pick.forEach((x, i) => { if (!x) return; const k = targets.kcal * split[i] / x.r.nutrition.calories; p += x.r.nutrition.protein_g * k; f += x.r.nutrition.fat_g * k; share += split[i]; });
                if (share > 0) {
                    const pT = targets.protein * share, fT = targets.fat * share;
                    cost += Math.max(0, (pT * 0.9 - p) / pT) * 4 + Math.max(0, (f - fT * 1.1) / fT) * 4;
                }
                if (new Set(cuis).size < cuis.length) cost += 0.6;
                if (!best || cost < best.cost) best = { pick, cost };
            })));
            const day = {};
            MEALS.forEach((m, i) => {
                const chosen = best && best.pick[i];
                if (!chosen) { missing.push({ day: d, meal: m, kcal: Math.round(targets.kcal * split[i]) }); return; }
                const r = JSON.parse(JSON.stringify(chosen.r));
                const kcal = targets.kcal * split[i];
                if (kcal / r.nutrition.calories < 0.85) trimAndRecount(r, r.nutrition.calories - kcal / 0.85);
                day[m] = scaleRecipe(r, Math.max(0.5, Math.min(2, kcal / r.nutrition.calories)), people);
                used.add(normName(r.name));
                const c = cuisineOf(r);
                ctx.cuisineCount[c] = (ctx.cuisineCount[c] || 0) + 1;
            });
            fineTune(day, targets.kcal, people);
            out.push(day);
            report.push(dayTotals(day));
        }
        return { days: out, missing, report, targets, split };
    }
    // Rounding amounts moves calories a little: nudge portions until the day is within 5%.
    function fineTune(day, kcal, people) {
        for (let pass = 0; pass < 4; pass++) {
            const t = dayTotals(day).kcal;
            const meals = MEALS.filter(m => day[m] && day[m].nutrition && day[m].nutrition.calories > 0);
            if (!t || meals.length < 3 || Math.abs(t - kcal) / kcal <= 0.035) return;
            // The biggest meal that can still move in the needed direction (portions stay 0.5×–2×).
            const portion = r => (r.scaled ? r.scaled.portion : 1);
            const up = kcal > t;
            const big = meals.filter(m => (up ? portion(day[m]) < 1.95 : portion(day[m]) > 0.55))
                .sort((a, b) => day[b].nutrition.calories - day[a].nutrition.calories)[0];
            if (!big) return;
            const r = day[big];
            const f = Math.max(0.5 / portion(r), Math.min(2 / portion(r), (r.nutrition.calories + (kcal - t)) / r.nutrition.calories));
            const base = Object.assign({}, r, { servings: people });   // amounts already for `people`; numbers per person
            day[big] = Object.assign(scaleRecipe(base, f, people), { scaled: r.scaled ? Object.assign({}, r.scaled, { portion: Math.round(portion(r) * f * 100) / 100 }) : { from_servings: people, portion: Math.round(f * 100) / 100 } });
        }
    }
    // Sizes the portions of a day that was made another way (by the AI, or edited) so it lands on the
    // calorie target with the chosen split: oil and sugar are cut before portions, never seasoning.
    function fitDay(day, settings, people) {
        const targets = targetsOf(settings || {});
        const split = splitOf(settings);
        const out = Object.assign({}, day);
        MEALS.forEach((m, i) => {
            const r = out[m];
            if (!r || !r.nutrition || !(r.nutrition.calories > 0) || !(r.ingredients || []).length) return;
            const kcal = targets.kcal * split[i];
            let copy = JSON.parse(JSON.stringify(r));
            if (kcal / copy.nutrition.calories < 0.85) trimAndRecount(copy, copy.nutrition.calories - kcal / 0.85);
            const f = kcal / copy.nutrition.calories;
            if (Math.abs(f - 1) <= 0.05 && !copy.trimmed) return;
            out[m] = scaleRecipe(copy, Math.max(0.5, Math.min(2, f)), people || Number(copy.servings) || 1);
        });
        fineTune(out, targets.kcal, people || 1);
        return out;
    }
    function dayTotals(day) {
        const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
        MEALS.forEach(m => { const n = day[m] && day[m].nutrition; if (n) { t.kcal += n.calories; t.protein += n.protein_g; t.carbs += n.carbs_g; t.fat += n.fat_g; } });
        return t;
    }
    function normName(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|best|easy|healthy|quick|recipe|my|simple|homemade)\b/g, '').replace(/\s+/g, ' ').trim(); }

    // === DISH NAMES ===
    const DISH_WORDS = ('shakshuka shashlik sashimi teriyaki bulgogi bibimbap tikka masala korma biryani tagine paella risotto gnocchi frittata quesadilla enchilada fajita burrito taco ' +
        'gyoza ramen udon soba pho laksa satay larb curry stir fry casserole lasagna bolognese carbonara pesto minestrone gazpacho tabbouleh falafel shawarma souvlaki gyro hummus ' +
        'tzatziki moussaka ratatouille omelette porridge granola muesli smoothie parfait pancake waffle crepe hash skillet traybake sheet pan bowl salad soup stew chili wrap ' +
        'sandwich toast skewers kebab kebabs fried rice noodles salmon chicken turkey beef pork lamb shrimp prawns tofu tempeh lentil chickpea quinoa couscous bulgur farro ' +
        'roasted grilled baked braised poached seared spiced zesty herbed garlic lemon honey ginger sesame coconut mediterranean mexican italian indian thai japanese korean ' +
        'chinese greek moroccan spanish vietnamese cajun creamy crispy spicy smoky tangy fresh green power harvest rainbow buddha poke burrito-bowl').split(/\s+/);
    // Ordinary words that must never be "corrected".
    const PLAIN_WORDS = new Set(('with and over under topped stuffed glazed loaded sticky crunchy cheesy marinated pulled charred blackened sweet savory savoury summer winter autumn ' +
        'spring classic style veggie veggies vegetable vegetables breakfast lunch dinner berry berries style pot pan one easy quick healthy simple light lighter best perfect ' +
        'family weeknight minute minutes hour slow cooker instant pressure air fryer oven stovetop grill grilled sauteed steamed smashed whipped mashed fried stir style warm cold ' +
        'grandma grandmas granny nana nanas nonna nonnas mama mamas mom moms mum mums papa dad dads auntie aunt uncle family famous ' +
        'little mini big bites bake bakes plate platter board boats cups rolls sliders burgers patties meatballs nuggets tenders strips wings thighs breast fillets').split(/\s+/));
    // Fixes obvious misspellings in an AI-written dish name ("Chiken Tikka Masla" → "Chicken Tikka Masala").
    function fixName(name) {
        const vocab = new Set(DISH_WORDS);
        return String(name || '').split(/(\s+|-)/).map(tok => {
            const w = tok.toLowerCase();
            if (!/^[a-z]{4,}$/.test(w) || vocab.has(w) || vocab.has(w.replace(/e?s$/, '')) || vocab.has(w.replace(/s$/, '')) || PLAIN_WORDS.has(w) || P.correct(w) === w || P.correct(P.singular(w)) === P.singular(w)) return tok;
            let best = null;
            let bestD = 3;
            const max = w.length >= 7 ? 2 : 1;
            DISH_WORDS.forEach(v => { if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) return; const d = P.distance(w, v, max); if (d < bestD) { best = v; bestD = d; } });
            const fromFoods = !best ? P.correct(w) : null;
            const fix = best && bestD <= max ? best : fromFoods;
            if (!fix || fix === w) return tok;
            return tok[0] === tok[0].toUpperCase() ? fix.replace(/\b[a-z]/g, c => c.toUpperCase()) : fix;
        }).join('');
    }

    const api = { fitDay, mealFit, mainProtein, mainVeg, cuisineOf, flavorCheck, reseason, trimRich, scaleRecipe, scaleLine, splitOf, targetsOf, planWeek, dayTotals, fixName, normName, SPLITS, MEALS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishPlanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
