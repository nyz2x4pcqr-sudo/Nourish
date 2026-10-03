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
    const MEALS = ['breakfast', 'lunch', 'dinner'];

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
    // Fine for dinner, too much for a quick lunch.
    const HEAVY_LUNCH = /\b(baked (pasta|ziti|penne|rigatoni|macaroni|mac|spaghetti|gnocchi)|pasta bake|mac and cheese bake|stuffed shells|manicotti|cannelloni|pot roast|roast (chicken|turkey|lamb|pork|beef|duck)|whole (chicken|fish|turkey)|beef wellington|pie|gratin|moussaka|pastitsio|osso buco|cassoulet|coq au vin|bourguignon|slow cooker|crock ?pot|braised)\b/i;
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
            lunch: !onlyBrk && !side && !sweetHeavy && !heavy && !HEAVY_LUNCH.test(name) && (hasProtein || /salad|soup|bowl|wrap|sandwich|pita|quesadilla|hummus|pasta|noodle|grain|lentil|bean|chickpea/i.test(name) || /\blunch\b/.test(cat)),
            dinner: !onlyBrk && !side && !sweetHeavy && hasProtein,
            why: heavy && brk ? 'a dinner dish' : '',
        };
    }

    // === WHAT A RECIPE ASKS OF THE COOK: time, effort, meal type ===
    // Every recipe gets: its meal type, its total time (active time: an overnight soak or a long
    // marinade done ahead doesn't count) and a difficulty score from 1 (pour and eat) to 10, from
    // its steps, ingredients and techniques. Recipes that don't fit a slot are rejected in code.
    const STAPLES = /^(salt|kosher salt|sea salt|black pepper|pepper|ground black pepper|water|ice|cooking spray|oil|olive oil|vegetable oil|canola oil|salt and pepper)$/i;
    const TECHNIQUES = [
        ['bake', /\b(bake|baked|baking|oven)\b/i, 20], ['roast', /\broast(ed|ing)?\b/i, 30], ['braise', /\b(braise[ds]?|braising)\b/i, 90],
        ['slow cook', /\b(slow cook(er)?|crock ?pot|low and slow)\b/i, 240], ['deep-fry', /\bdeep[- ]?fr(y|ied|ying)\b/i, 20], ['fry', /\b(fry|fried|frying|pan-fry)\b/i, 8],
        ['sear', /\bsear(ed|ing)?\b/i, 6], ['sauté', /\bsaut[eé](e?d|ing)?\b/i, 6], ['simmer', /\bsimmer(ed|ing)?\b/i, 15], ['boil', /\b(boil|boiled|boiling)\b/i, 10],
        ['grill', /\b(grill|grilled|grilling|broil)\b/i, 12], ['steam', /\bsteam(ed|ing)?\b/i, 8], ['poach', /\bpoach(ed|ing)?\b/i, 8], ['blend', /\b(blend|blender|puree|purée)\b/i, 2],
        ['knead', /\b(knead|dough|proof|rise until)\b/i, 60], ['smoke', /\bsmok(e|ed|ing|er)\b(?! paprika| salmon)/i, 120], ['marinate', /\bmarinat(e|ed|ing)\b/i, 0],
        ['stir-fry', /\bstir[- ]?fr(y|ied)\b/i, 10], ['toast', /\btoast(ed|er|ing)?\b/i, 3], ['microwave', /\bmicrowave\b/i, 2], ['whisk', /\bwhisk\b/i, 1],
    ];
    const HARD = /\b(deep[- ]?fr|knead|dough|proof|laminat|temper(ed|ing)? (the )?chocolate|caramel|sous vide|butterfl(y|ied)|debone|truss|flamb|souffl|reduce by half|candy thermometer|pressure cook|pipe the)\b/i;
    const HEAT = /\b(bake|baked|baking|oven|roast|fry|fried|frying|sear|saut[eé]|simmer|boil|grill|broil|steam|poach|cook|heat|stove|skillet|pan|microwave|preheat)\b/i;
    const PASSIVE = /\b(overnight|refrigerate|chill|soak|marinate|rest|set|freeze|cool)\b/i;
    function countIngredients(r) {
        return (r.ingredients || []).filter(l => {
            const name = String(l).toLowerCase().replace(/\([^)]*\)/g, '').replace(/^[\d\s/.½¼¾⅓⅔-]+(cups?|tbsp|tsp|tablespoons?|teaspoons?|g|ml|oz|lb|pinch|dash)?\s*(of\s+)?/, '').replace(/,.*$/, '').trim();
            return name && !STAPLES.test(name) && !/\bto taste\b|for serving|for garnish|optional/.test(String(l).toLowerCase());
        }).length;
    }
    // Minutes the steps spell out ("bake for 25 minutes", "simmer 1 hour"), passive waiting left out.
    function stepMinutes(steps) {
        let active = 0, passive = 0;
        (steps || []).forEach(st => String(st).split(/(?<=[.;])\s+/).forEach(sentence => {
            const m = sentence.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)?\s*(\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/i);
            if (!m) return;
            const n = Number(m[2] || m[1]) * (/^h/i.test(m[3]) ? 60 : 1);
            if (PASSIVE.test(sentence) && !HEAT.test(sentence)) passive += n; else active += n;
        }));
        return { active, passive };
    }
    function recipeProfile(r) {
        const steps = (r.steps || []).map(String);
        const text = `${r.name || ''} ${steps.join(' ')}`;
        const techniques = TECHNIQUES.filter(([, re]) => re.test(text)).map(([name, , min]) => ({ name, min }));
        const ingredients = countIngredients(r);
        const fromSteps = stepMinutes(steps);
        const prep = Math.round(ingredients * 1.5 + steps.length);
        // The longest technique sets a floor ("roast" can't take 5 minutes), the steps' own times add up.
        const floor = techniques.reduce((m, t) => Math.max(m, t.min), 0);
        const estimate = Math.max(prep + fromSteps.active, prep + floor);
        const given = Number(r.active_minutes) > 0 ? Number(r.active_minutes) : Number(r.time_minutes) > 0 ? Number(r.time_minutes) : null;
        // A recipe's own total that includes an overnight wait is replaced by the active time.
        let minutes = given != null ? given : estimate;
        if (given != null && fromSteps.passive >= 60 && given >= fromSteps.passive) minutes = Math.max(5, given - fromSteps.passive);
        const hard = HARD.test(text);
        const heat = HEAT.test(text) && !/^(no[- ]cook|overnight)/i.test(r.name || '');
        const score = 1 + Math.max(0, steps.length - 3) * 0.45 + Math.max(0, ingredients - 5) * 0.3
            + techniques.filter(t => !['whisk', 'toast', 'microwave', 'blend', 'marinate'].includes(t.name)).length * 0.6 + (hard ? 2 : 0) + (minutes > 60 ? 1 : 0);
        const fit = mealFit(r);
        return {
            mealType: fit.breakfast && !fit.dinner ? 'breakfast' : fit.dinner && !fit.lunch ? 'dinner' : fit.lunch ? 'lunch' : fit.breakfast ? 'breakfast' : fit.dinner ? 'dinner' : 'none',
            fits: { breakfast: fit.breakfast, lunch: fit.lunch, dinner: fit.dinner },
            minutes: Math.round(minutes), timeEstimated: given == null, steps: steps.length, ingredients,
            techniques: techniques.map(t => t.name), hard, cooked: heat,
            difficulty: Math.round(Math.min(10, score) * 10) / 10,
        };
    }

    // The defaults for each slot (Part of "breakfast is breakfast"): quick and simple in the
    // morning, quick and light at lunch, anything goes at dinner. My schedule (settings) overrides
    // the minutes; "I don't cook this meal" allows only no-cook food.
    const SLOT_DEFAULTS = {
        breakfast: { minutes: 15, ingredients: 8, steps: 6, difficulty: 4.5 },
        lunch: { minutes: 25, ingredients: 11, steps: 7, difficulty: 5.5 },
        dinner: { minutes: Infinity, ingredients: 22, steps: 16, difficulty: 10 },
    };
    // Settings → My schedule: the time someone has to make AND eat each meal ("5", "10", "20", "30",
    // "45", "60", "norush", "nocook"; '' = the default), for every day, for the weekend, or per day.
    // The cooking limit is that time less a few minutes to eat.
    const EAT_MINUTES = { breakfast: 5, lunch: 5, dinner: 10 };
    function scheduleChoice(settings, meal, weekday) {
        const s = settings || {};
        const perDay = weekday != null ? s[`sched_d${weekday}_${meal}`] : '';
        if (perDay) return String(perDay);
        if (weekday != null && weekday >= 5 && s.sched_weekend === 'on' && s[`sched_we_${meal}`]) return String(s[`sched_we_${meal}`]);
        return String(s[`sched_${meal}`] || '');
    }
    function slotLimits(settings, meal, weekday) {
        const base = Object.assign({}, SLOT_DEFAULTS[meal] || SLOT_DEFAULTS.dinner, { noCook: false, choice: '' });
        const c = scheduleChoice(settings, meal, weekday);
        base.choice = c;
        if (c === 'nocook') return Object.assign(base, { minutes: 10, noCook: true, steps: Math.min(base.steps, 5), difficulty: Math.min(base.difficulty, 3) });
        if (c === 'norush') return Object.assign(base, { minutes: Infinity, ingredients: SLOT_DEFAULTS.dinner.ingredients, steps: SLOT_DEFAULTS.dinner.steps, difficulty: meal === 'dinner' ? 10 : 7 });
        const total = Number(c);
        if (total > 0) {
            const cook = Math.max(3, total - (EAT_MINUTES[meal] || 5));
            base.minutes = cook;
            if (cook <= 5) Object.assign(base, { noCook: true, steps: Math.min(base.steps, 4), difficulty: Math.min(base.difficulty, 2.5), ingredients: Math.min(base.ingredients, 6) });
            else if (cook <= 15) Object.assign(base, { steps: Math.min(base.steps, 6), difficulty: Math.min(base.difficulty, 4.5) });
            else if (cook >= 40 && meal !== 'dinner') Object.assign(base, { difficulty: 7, steps: 10, ingredients: 15 });
        }
        return base;
    }
    // Why a recipe doesn't fit a slot ('' when it does), in plain words.
    function slotProblem(r, meal, limits) {
        const L = limits || slotLimits({}, meal);
        const p = recipeProfile(r);
        if (!p.fits[meal]) {
            const fit = mealFit(r);
            if (meal === 'breakfast') return fit.why === 'a dinner dish' || DINNER_ONLY.test(r.name || '') ? `"${r.name}" is a dinner dish, not breakfast` : `"${r.name}" isn't a breakfast food`;
            if (meal === 'lunch') return DINNER_ONLY.test(r.name || '') || HEAVY_LUNCH.test(r.name || '') ? `"${r.name}" is too heavy for lunch (a dinner dish)` : `"${r.name}" isn't a lunch`;
            return fit.why ? `"${r.name}" is ${fit.why}` : `"${r.name}" isn't a ${meal}`;
        }
        if (L.noCook && p.cooked && !/^(toast|microwave)$/.test(p.techniques.join(''))) {
            const cooking = p.techniques.filter(t => !['whisk', 'toast', 'microwave', 'blend', 'marinate'].includes(t));
            if (cooking.length || /\b(cook|heat|stove|skillet|preheat)\b/i.test((r.steps || []).join(' '))) return `needs cooking (${cooking[0] || 'heat'}), and this meal is no-cook`;
        }
        if (p.minutes > L.minutes) return `takes about ${p.minutes} min${p.timeEstimated ? ' (estimated)' : ''}; ${meal} has ${L.minutes} min`;
        if (p.steps > L.steps) return `${p.steps} steps is too many for ${meal} (at most ${L.steps})`;
        if (p.ingredients > L.ingredients) return `${p.ingredients} ingredients is too many for ${meal} (at most ${L.ingredients})`;
        if (p.difficulty > L.difficulty) return `too much work for ${meal} (difficulty ${p.difficulty} of 10${p.hard ? ', advanced technique' : ''})`;
        return '';
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
        else q = q >= 0.3 ? Math.max(0.25, Math.round(q * 4) / 4) : Math.max(0.125, Math.round(q * 8) / 8);   // kitchen fractions: ¼ ½ ¾ (⅛ for pinches)
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
    const SNACK_SHARE = 0.1;   // each snack: about a tenth of the day
    // Which main meals a day has (Settings: "Meals each day"); all three unless some are switched off.
    function mealsOf(settings) {
        const list = String((settings && settings.meal_slots) || 'breakfast,lunch,dinner').split(',').map(x => x.trim()).filter(m => MEALS.indexOf(m) >= 0);
        return list.length ? MEALS.filter(m => list.indexOf(m) >= 0) : MEALS.slice();
    }
    function snacksOf(settings) { return Math.max(0, Math.min(3, Math.round(Number(settings && settings.snacks_per_day) || 0))); }
    // Shares of the day's calories for breakfast, lunch and dinner (0 for a meal switched off), after
    // any snacks take theirs.
    function splitOf(settings) {
        const s = settings || {};
        let v = (SPLITS[s.calorie_split] || SPLITS.dinner).slice();
        if (s.calorie_split === 'custom') {
            const c = [s.split_breakfast, s.split_lunch, s.split_dinner].map(Number);
            if (c.reduce((a, b) => a + (b > 0 ? b : 0), 0) > 0 && c.every(x => x >= 5)) v = c;
        }
        const on = mealsOf(s);
        v = v.map((x, i) => (on.indexOf(MEALS[i]) >= 0 ? x : 0));
        const sum = v.reduce((a, b) => a + b, 0) || 1;
        const mains = 1 - snacksOf(s) * SNACK_SHARE;
        return v.map(x => x / sum * mains);
    }
    function targetsOf(settings) {
        const kcal = Number(settings.calorie_target) || 2000;
        return { kcal, protein: Number(settings.protein_target) || Math.round(kcal * 0.25 / 4), carbs: Math.round(kcal * 0.45 / 4), fat: Math.round(kcal * 0.3 / 9) };
    }

    // === PLANNING ===
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
    function planWeek({ pools, settings, likes, days = 7, people = 1, sourcePenalty, already = [], exclude, weekday, taste }) {
        const targets = targetsOf(settings);
        const split = splitOf(settings);
        const on = m => split[MEALS.indexOf(m)] > 0;
        const used = new Set(already.map(n => normName(n)));
        const ctx = { targets, likes: P.parse(likes || ''), goal: settings.goal || settings.prefsGoal, sourcePenalty, taste, cuisineCount: {} };
        const rejected = {};   // why recipes didn't fit a slot (for the log)
        const out = [];
        const missing = [];
        const report = [];
        for (let d = 0; d < days; d++) {
            const top = {};
            MEALS.forEach((m, i) => {
                const kcal = targets.kcal * split[i];
                if (!on(m)) { top[m] = []; return; }
                // Breakfast is breakfast: anything too slow, too much work or the wrong kind of dish
                // for this slot (with this day's schedule) is out before it can be picked.
                const limits = slotLimits(settings, m, weekday ? weekday(d) : null);
                top[m] = (pools[m] || []).filter(r => !used.has(normName(r.name)) && !(r.sameAs && r.sameAs.some(x => used.has(x))))
                    .filter(r => { const why = slotProblem(r, m, limits); if (why) rejected[`${m}: ${r.name}`] = why; return !why; })
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
                let cost = pick.reduce((s, x, i) => s + (x ? x.cost : on(MEALS[i]) ? 50 : 0), 0);
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
                if (!on(m)) return;
                if (!chosen) { missing.push({ day: d, meal: m, kcal: Math.round(targets.kcal * split[i]) }); return; }
                const r = JSON.parse(JSON.stringify(chosen.r));
                const kcal = targets.kcal * split[i];
                if (kcal / r.nutrition.calories < 0.85) trimAndRecount(r, r.nutrition.calories - kcal / 0.85);
                day[m] = scaleRecipe(r, Math.max(0.5, Math.min(2, kcal / r.nutrition.calories)), people);
                used.add(normName(r.name));
                const c = cuisineOf(r);
                ctx.cuisineCount[c] = (ctx.cuisineCount[c] || 0) + 1;
            });
            addSnacks(day, settings, d, people, exclude);
            fineTune(day, targets.kcal, people, MEALS.filter(on).length);
            out.push(day);
            report.push(dayTotals(day));
        }
        return { days: out, missing, report, targets, split, rejected };
    }
    // Rounding amounts moves calories a little: nudge portions until the day is within 5%.
    // need: how many main meals a complete day has (days with a gap aren't nudged).
    function fineTune(day, kcal, people, need = 3) {
        for (let pass = 0; pass < 4; pass++) {
            const t = dayTotals(day).kcal;
            const meals = MEALS.filter(m => day[m] && day[m].nutrition && day[m].nutrition.calories > 0);
            if (!t || !meals.length || meals.length < need || Math.abs(t - kcal) / kcal <= 0.035) return;
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
    // One meal made about `kcal` lighter: oil and sugar first, then a smaller portion (never below
    // 60% of what it was). Seasoning stays.
    function lighten(meal, kcal, people) {
        const r = JSON.parse(JSON.stringify(meal));
        const n = r.nutrition && r.nutrition.calories;
        if (!n || !(kcal > 0)) return r;
        trimAndRecount(r, kcal);
        const want = Math.max(n * 0.6, n - kcal);
        const f = Math.min(1, want / r.nutrition.calories);
        const prev = meal.scaled ? meal.scaled.portion : 1;
        const out = scaleRecipe(Object.assign({}, r, { servings: people || r.servings || 1 }), f, people || r.servings || 1);
        out.scaled = { from_servings: (meal.scaled && meal.scaled.from_servings) || r.servings || 1, portion: Math.round(prev * f * 100) / 100 };
        return out;
    }
    // Sizes the portions of a day that was made another way (by the AI, or edited) so it lands on the
    // calorie target with the chosen split: oil and sugar are cut before portions, never seasoning.
    function fitDay(day, settings, people) {
        const targets = targetsOf(settings || {});
        const split = splitOf(settings);
        const out = Object.assign({}, day);
        MEALS.forEach((m, i) => {
            const r = out[m];
            if (!r || !r.nutrition || !(r.nutrition.calories > 0) || !(r.ingredients || []).length || !(split[i] > 0)) return;
            const kcal = targets.kcal * split[i];
            let copy = JSON.parse(JSON.stringify(r));
            if (kcal / copy.nutrition.calories < 0.85) trimAndRecount(copy, copy.nutrition.calories - kcal / 0.85);
            const f = kcal / copy.nutrition.calories;
            if (Math.abs(f - 1) <= 0.05 && !copy.trimmed) return;
            out[m] = scaleRecipe(copy, Math.max(0.5, Math.min(2, f)), people || Number(copy.servings) || 1);
        });
        fineTune(out, targets.kcal, people || 1, mealsOf(settings).length);
        return out;
    }
    function dayTotals(day) {
        const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
        const add = r => { const n = r && r.nutrition; if (n) { t.kcal += n.calories; t.protein += n.protein_g; t.carbs += n.carbs_g; t.fat += n.fat_g; } };
        MEALS.forEach(m => add(day[m]));
        (Array.isArray(day.snacks) ? day.snacks : []).forEach(add);
        return t;
    }

    // === SNACKS ===
    // Simple snacks, worked out from their ingredients like everything else, sized to a tenth of the day.
    const SNACKS = [
        ['Greek Yogurt with Berries', ['3/4 cup greek yogurt', '1/2 cup berries', '1 tsp honey'], 'Spoon the yogurt into a bowl and top with the berries and honey.'],
        ['Apple with Peanut Butter', ['1 apple', '1 tbsp peanut butter'], 'Slice the apple and dip the slices in the peanut butter.'],
        ['Hummus and Carrot Sticks', ['1/4 cup hummus', '2 carrots'], 'Cut the carrots into sticks and serve with the hummus.'],
        ['A Handful of Almonds', ['1 oz almonds'], 'Measure out the almonds.'],
        ['Cottage Cheese and Pineapple', ['1/2 cup cottage cheese', '1/2 cup pineapple'], 'Top the cottage cheese with the pineapple.'],
        ['Hard-Boiled Eggs', ['2 eggs', '1 pinch salt', '1 pinch black pepper'], 'Boil the eggs for 10 minutes, cool in cold water, peel and season.'],
        ['Salted Edamame', ['1 cup edamame', '1/4 tsp salt'], 'Steam or microwave the edamame for 3 minutes and sprinkle with salt.'],
        ['Banana', ['1 banana'], 'Peel and enjoy.'],
        ['Cheddar and Crackers', ['1 oz cheddar', '1 oz crackers'], 'Slice the cheese and serve with the crackers.'],
        ['Orange and Pistachios', ['1 orange', '1/2 oz pistachios'], 'Peel the orange and serve with the pistachios.'],
        ['Rice Cakes with Almond Butter', ['2 rice cakes', '1 tbsp almond butter'], 'Spread the almond butter on the rice cakes.'],
        ['Trail Mix', ['1/4 cup trail mix'], 'Measure out the trail mix.'],
    ];
    function snackRecipe([name, ingredients, step]) {
        const r = { name, servings: 1, time_minutes: 5, ingredients: ingredients.slice(), steps: [step], snack: true };
        r.nutrition = N.calculate(r.ingredients, 1).nutrition;
        r.nutrition_basis = 'calculated';
        return r;
    }
    // Adds the day's snacks (Settings: snacks per day), different each day of the week and never
    // something the person avoids.
    function addSnacks(day, settings, d, people = 1, exclude) {
        const n = snacksOf(settings);
        delete day.snacks;
        if (!n) return day;
        const kcal = targetsOf(settings).kcal * SNACK_SHARE;
        const ok = SNACKS.map(snackRecipe).filter(r => r.nutrition.calories > 0 && !(exclude && exclude(r)));
        if (!ok.length) return day;
        const snacks = [];
        for (let i = 0; i < n; i++) {
            const r = ok[(d * n + i) % ok.length];
            if (snacks.some(x => x.name === r.name)) continue;
            snacks.push(scaleRecipe(r, Math.max(0.5, Math.min(2, kcal / r.nutrition.calories)), people));
        }
        day.snacks = snacks;
        return day;
    }
    // === QUICK MEALS ===
    // Simple, reliable meals for when nothing found or written fits a slot's rules (a busy morning,
    // a no-cook lunch). Worked out from their ingredients like everything else.
    const QUICK_MEALS = {
        breakfast: [
            ['Greek Yogurt Bowl with Berries and Granola', ['1 cup greek yogurt', '1/2 cup berries', '1/4 cup granola', '1 tsp honey'], ['Spoon the yogurt into a bowl.', 'Top with the berries, granola and honey and serve.'], 3],
            ['Peanut Butter Banana Toast', ['2 slices whole wheat bread', '2 tbsp peanut butter', '1 banana', '1 pinch cinnamon'], ['Toast the bread.', 'Spread with the peanut butter, top with the sliced banana and cinnamon, and serve.'], 5],
            ['Overnight Oats with Apple', ['1/2 cup rolled oats', '1/2 cup milk', '1/4 cup greek yogurt', '1/2 apple', '1 tsp maple syrup', '1 pinch cinnamon'], ['The night before, stir the oats, milk, yogurt, syrup and cinnamon together in a jar and refrigerate.', 'In the morning, top with the chopped apple and serve.'], 5],
            ['Scrambled Eggs on Toast', ['2 large eggs', '1 slice whole wheat bread', '1 tsp butter', '1/8 tsp salt', '1 pinch black pepper', '1 tbsp chopped chives'], ['Toast the bread.', 'Whisk the eggs with the salt and pepper.', 'Melt the butter in a small pan over low heat, add the eggs and stir gently for 2 minutes until just set.', 'Serve on the toast with the chives.'], 8],
            ['Cottage Cheese with Pineapple and Almonds', ['1 cup cottage cheese', '1/2 cup pineapple', '1 tbsp sliced almonds'], ['Spoon the cottage cheese into a bowl.', 'Top with the pineapple and almonds and serve.'], 3],
            ['Banana Berry Smoothie', ['1 banana', '1 cup frozen berries', '1 cup milk', '1/2 cup greek yogurt', '1 tbsp peanut butter'], ['Blend everything until smooth, about 1 minute.', 'Pour into a glass and serve.'], 4],
        ],
        lunch: [
            ['Tuna Salad Wrap', ['1 can tuna', '1 tbsp mayonnaise', '1 tsp lemon juice', '1/8 tsp salt', '1 pinch black pepper', '1 flour tortilla', '1 cup lettuce', '1/2 tomato'], ['Mix the tuna, mayonnaise, lemon juice, salt and pepper.', 'Lay the tortilla flat, add the lettuce, sliced tomato and tuna.', 'Roll it up tightly, cut in half and serve.'], 8],
            ['Hummus and Veggie Pita', ['1 whole wheat pita', '1/4 cup hummus', '1/2 cucumber', '1/2 bell pepper', '1/4 cup feta', '1 tsp lemon juice', '1/2 tsp dried oregano'], ['Slice the cucumber and pepper.', 'Spread the hummus inside the pita.', 'Fill with the vegetables and feta, sprinkle with oregano and lemon juice, and serve.'], 7],
            ['Chickpea Feta Salad', ['1 can chickpeas', '1 cup cherry tomatoes', '1/2 cucumber', '1/4 cup feta', '1 tbsp olive oil', '1 tbsp lemon juice', '1/4 tsp salt', '1/2 tsp dried oregano'], ['Rinse and drain the chickpeas.', 'Halve the tomatoes and dice the cucumber.', 'Toss everything with the oil, lemon juice, salt and oregano, and serve.'], 10],
            ['Turkey and Cheese Sandwich', ['2 slices whole wheat bread', '3 oz sliced turkey', '1 slice cheddar', '1 tsp mustard', '1 cup lettuce', '1/2 tomato', '1 pinch black pepper'], ['Spread the mustard on the bread.', 'Layer the turkey, cheese, lettuce, sliced tomato and pepper.', 'Close the sandwich, cut in half and serve.'], 5],
            ['Black Bean Quesadilla', ['1 flour tortilla', '1/2 cup black beans', '1/3 cup shredded cheddar', '2 tbsp salsa', '1/4 tsp ground cumin', '1/8 tsp salt'], ['Mash the beans with the cumin and salt.', 'Spread on half the tortilla, add the cheese and fold it over.', 'Cook in a dry pan over medium heat for 3 minutes a side until golden.', 'Cut into wedges and serve with the salsa.'], 12],
            ['Chicken Caesar Salad', ['4 oz cooked chicken breast', '2 cups romaine lettuce', '2 tbsp caesar dressing', '2 tbsp grated parmesan', '1/4 cup croutons', '1 pinch black pepper'], ['Slice the chicken.', 'Toss the lettuce with the dressing.', 'Top with the chicken, parmesan, croutons and pepper, and serve.'], 6],
        ],
        dinner: [
            ['Garlic Lemon Salmon with Rice and Greens', ['6 oz salmon fillet', '1/2 cup rice', '2 cups spinach', '1 tbsp olive oil', '2 cloves garlic', '1/2 lemon', '1/4 tsp salt', '1 pinch black pepper'], ['Cook the rice following the packet, about 15 minutes.', 'Season the salmon with the salt and pepper.', 'Heat the oil in a pan over medium-high heat and cook the salmon for 4 minutes a side.', 'Add the garlic and spinach to the pan for 1 minute until wilted.', 'Serve the salmon on the rice with the spinach and a squeeze of lemon.'], 25],
            ['Chicken Stir-Fry with Vegetables', ['6 oz chicken breast', '2 cups mixed stir-fry vegetables', '1 tbsp low-sodium soy sauce', '1 tsp grated fresh ginger', '1 clove garlic', '1 tbsp vegetable oil', '1/2 cup rice'], ['Cook the rice following the packet.', 'Slice the chicken into strips.', 'Heat the oil in a pan over high heat and stir-fry the chicken for 5 minutes.', 'Add the vegetables, garlic and ginger and stir-fry for 4 minutes, then add the soy sauce.', 'Serve over the rice.'], 25],
        ],
    };
    function quickRecipe([name, ingredients, steps, minutes], meal) {
        const r = { name, servings: 1, time_minutes: minutes, ingredients: ingredients.slice(), steps: steps.slice(), quick: true, category: meal ? [meal] : [] };
        r.nutrition = N.calculate(r.ingredients, 1).nutrition;
        r.nutrition_basis = 'calculated';
        return r;
    }
    // The best quick meal for a slot that fits its limits, isn't avoided and isn't already in the day.
    function quickMeal(meal, limits, { exclude, taken = [], d = 0 } = {}) {
        const names = new Set(taken.map(normName));
        const ok = (QUICK_MEALS[meal] || []).map(q => quickRecipe(q, meal))
            .filter(r => r.nutrition.calories > 0 && !(exclude && exclude(r)) && !names.has(normName(r.name)) && !slotProblem(r, meal, limits));
        return ok.length ? ok[d % ok.length] : null;
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

    const api = { quickMeal, QUICK_MEALS, recipeProfile, slotLimits, slotProblem, scheduleChoice, SLOT_DEFAULTS, countIngredients, fitDay, lighten, addSnacks, mealsOf, snacksOf, SNACKS, mealFit, mainProtein, mainVeg, cuisineOf, flavorCheck, reseason, trimRich, scaleRecipe, scaleLine, splitOf, targetsOf, planWeek, dayTotals, fixName, normName, SPLITS, MEALS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishPlanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
