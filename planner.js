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
    const DESSERT = /\b(cakes?|cupcakes?|cookies?|brownies?|blondies?|fudge|candy|frosting|icing|cheesecake|tart|pie crust|ice cream|sorbet|gelato|truffles?|macarons?|meringue|tiramisu|mousse|pudding|cobbler|crumble|custard|donuts?|doughnuts?|cinnamon rolls?|sweet rolls?|dessert)\b/i;
    const NOT_DESSERT = /\b(chia( seed)? pudding|protein pudding|overnight|yorkshire pudding|black pudding|bread pudding|pot pie|shepherd'?s pie|chicken pie|cottage pie|savou?ry|rice cakes?|crab cakes?|fish cakes?|salmon cakes?|tuna cakes?|potato cakes?|pancakes?)\b/i;
    const DINNER_ONLY = /\b(curry|curries|tikka|masala|korma|vindaloo|biryani|roast|roasted (chicken|lamb|pork|beef)|stew|braise[d]?|chops?|steaks?|ribs|lasagna|lasagne|casserole|tagine|pasanda|jalfrezi|rogan josh|goulash|hotpot|cottage pie|shepherd'?s pie|meatloaf|pot roast|bolognese|pot pie|enchiladas|paella|risotto|stroganoff|carbonara|lamb|brisket|pulled pork|short rib|oxtail|pernil|pork shoulder|fried chicken|fish (and|&) chips|beer[- ]battered)\b/i;
    // Fine for dinner, too much for a quick lunch.
    const HEAVY_LUNCH = /\b(baked (pasta|ziti|penne|rigatoni|macaroni|mac|spaghetti|gnocchi)|pasta bake|mac and cheese bake|stuffed shells|manicotti|cannelloni|pot roast|roast (chicken|turkey|lamb|pork|beef|duck)|whole (chicken|fish|turkey)|beef wellington|pie|gratin|moussaka|pastitsio|osso buco|cassoulet|coq au vin|bourguignon|slow cooker|crock ?pot|braised)\b/i;
    const NOT_A_MEAL = /\b(sauce|dressing|dip|marinade|seasoning|spice (mix|blend)|stock|broth|syrup|jam|butter|vinaigrette|gravy|salsa|pesto|chutney|pickle[sd]?|drink|cocktail|mocktail|lemonade|tea|coffee|latte|juice|bread|loaf|rolls|buns|crackers|croutons|bars|bites|energy balls|protein balls|trail mix|popcorn|chips)$/i;
    const SIDE = /\b(side|sides|side dish|appetizers?|starters?|snacks?)\b/i;
    // A starter anywhere in the name; a dip or spread when it's the dish itself ("Smooth Hummus", not "Hummus Toast").
    const STARTER = /\b(bone marrow|marrow bones?|p[âa]t[ée]s?|terrines?|rillettes|crostini|canap[ée]s?|bruschetta)\b/i;
    const SPREAD = /\b(hummus|houmous|tapenade|tzatziki|baba ganoush|guacamole|dips?|spreads?|coleslaw|slaw)$/i;
    // Parts of a meal, not a meal: eggs marinated or boiled to go with something, "how to cook…".
    const COMPONENT = /\b(marinated|pickled|deviled|devilled|hard[- ]?boiled|soft[- ]?boiled|jammy|soy[- ]sauce|tea|ramen|mayak|onsen|scotch) eggs?\b|\bhow to (cook|make|boil|poach|fry|store|freeze)\b/i;
    // A savoury porridge or congee with meat or fish is a lunch or dinner, not a breakfast.
    const MEAT_WORD = /\b(chicken|beef|pork|lamb|turkey|duck|fish|shrimp|prawns?|salmon|sausage|bacon|ham|seafood|crab)\b/i;
    const SAVORY_PORRIDGE = /\b(porridge|congee|jook|juk|oatmeal|grits)\b/i;

    function textOf(r) { return `${r.name || ''} ${(r.category || []).join ? (r.category || []).join(' ') : r.category || ''}`; }

    // Which meals a recipe can be: { breakfast, lunch, dinner, why }.
    // Articles and guides ("How To Build a Better Smoothie", "15 Easy Breakfast Ideas", "A Guide to
    // Meal Prep") are not recipes, even when the page carries recipe data.
    const ARTICLE = /^(how to (build|choose|store|stock|plan|meal prep|pick|use|start)|(a |the )?(beginner'?s |ultimate |complete |quick )?guide\b|(the )?best ways? to|ways to|tips (for|on|to)|everything you need|what (is|are|to eat)|why you should|\d+\s+(easy |quick |healthy |best |simple |delicious )*(ways|tips|ideas|recipes|things|meals|breakfasts|lunches|dinners|smoothies)\b)|\b(guide|101|tips|ideas|round-?up|meal plan)$/i;
    // A smoothie or shake is a breakfast only when it's filling enough to be a meal; otherwise it's a drink.
    const SMOOTHIE = /\b(smoothies?|shakes?|frappes?)\b/i;
    const SMOOTHIE_MEAL = { calories: 250, protein_g: 10 };
    function mealFit(r) {
        const name = String(r.name || '').replace(/\([^)]*\)/g, ' ').replace(/[!?.]+/g, ' ').replace(/\s+/g, ' ').trim();
        const cat = String(Array.isArray(r.category) ? r.category.join(' ') : r.category || '').toLowerCase();
        const ings = (r.ingredients || []).join(' ').toLowerCase();
        if (ARTICLE.test(name)) return { breakfast: false, lunch: false, dinner: false, why: 'an article or guide, not a recipe' };
        if (SMOOTHIE.test(name) && !/\bbowls?\b/i.test(name)) {
            const n = r.nutrition;
            if (n && Number(n.calories) > 0 && (Number(n.calories) < SMOOTHIE_MEAL.calories || Number(n.protein_g || 0) < SMOOTHIE_MEAL.protein_g)) {
                return { breakfast: false, lunch: false, dinner: false, why: `a drink (a smoothie of ${Math.round(n.calories)} kcal and ${Math.round(n.protein_g || 0)} g protein is too light to be a meal)` };
            }
            return { breakfast: true, lunch: false, dinner: false, why: '' };
        }
        const sweetHeavy = /\b(sugar|honey|maple|chocolate|syrup)\b/.test(ings) && !/\b(salt|garlic|onion|soy|pepper)\b/.test(ings);
        // Judged by what the dish is: a site's "Dessert" tag doesn't count when it also files it under a meal.
        const mealCat = /breakfast|brunch|lunch|dinner|main|entr[eé]e|supper/.test(cat);
        if ((DESSERT.test(name) && !NOT_DESSERT.test(name)) || (/dessert|baking|treat/.test(cat) && !mealCat)) return { breakfast: false, lunch: false, dinner: false, why: 'a dessert' };
        if (COMPONENT.test(name)) return { breakfast: false, lunch: false, dinner: false, why: 'a side or component, not a meal' };
        // Starters and spreads: bone marrow on toast, pâté, crostini, hummus. Rich, small and mostly fat.
        const dishName = name.replace(/\s+(with|in|on|over|served with|and a side of)\s+.*$/i, '').trim();
        if (STARTER.test(name) || (SPREAD.test(dishName) && !/\b(chicken|beef|pork|turkey|tuna|salmon|shrimp|prawns?|tofu|tempeh|eggs?|lentils?|beans|chickpeas|steak|fish|crab)\b/i.test(dishName))) return { breakfast: false, lunch: false, dinner: false, why: 'a starter or spread, not a meal' };
        // Whatever it's called: a dish whose calories are mostly fat with little protein is a starter,
        // spread or sauce (bone marrow is 85% fat), never a meal to pad with chicken.
        const nf = r.nutrition;
        // Too light to be a meal even at a double portion: a side (green beans, a small salad).
        if (nf && Number(nf.calories) > 0 && Number(nf.calories) < 150 && Number(nf.protein_g || 0) < 6) return { breakfast: false, lunch: false, dinner: false, why: 'a side: too light to be a meal' };
        if (nf && Number(nf.calories) > 0 && Number(nf.fat_g) * 9 / Number(nf.calories) > 0.7 && Number(nf.protein_g || 0) * 4 / Number(nf.calories) < 0.12) return { breakfast: false, lunch: false, dinner: false, why: 'mostly fat with little protein: a starter, spread or sauce, not a meal' };
        // "Salmon Tacos with Mango Salsa" is tacos and "Eggs in Spicy Tomato Sauce" is eggs: only the
        // dish itself counts, not what it comes with or in.
        const dish = name.replace(/\s+(with|in|on|over|served with|and a side of)\s+.*$/i, '').trim();
        if ((NOT_A_MEAL.test(dish) && !/\b(fish|chicken|steak) (and|&|n'?) chips$/i.test(dish)) || /\b(sauce|drink|beverage|condiment|dressing)\b/.test(cat)) return { breakfast: false, lunch: false, dinner: false, why: 'not a meal' };
        // A dish that says it's a breakfast and is made with eggs ("Breakfast Enchiladas", "Breakfast
        // Casserole") is a breakfast, whatever else it is.
        const eggBreakfast = /\b(breakfast|brunch)\b/i.test(name) && (/\beggs?\b/.test(ings) || /\beggs?\b/i.test(name));
        const savoryPorridge = SAVORY_PORRIDGE.test(name) && MEAT_WORD.test(name);
        // A complete egg dish ("Eggs in Spicy Tomato Sauce", "Baked Eggs with Spinach") is a breakfast too.
        const eggDish = /\beggs?\b/i.test(dish) && !COMPONENT.test(name);
        const brk = eggBreakfast || (!savoryPorridge && (BREAKFAST.test(name) || eggDish || /breakfast|brunch/.test(cat)));
        // A recipe the site files under breakfast only stays at breakfast.
        // But a roast or a pasta bake on a brunch list is still a main dish: judged by what it is.
        const heavy = DINNER_ONLY.test(name) && !eggBreakfast;
        const mainDish = heavy || HEAVY_LUNCH.test(name);
        const brkOnlyCat = /breakfast|brunch/.test(cat) && !/lunch|dinner|main|entr[eé]e|supper/.test(cat) && !mainDish;
        const onlyBrk = !savoryPorridge && (ONLY_BREAKFAST.test(name) || (brk && sweetHeavy) || brkOnlyCat || /\bbreakfast\b/i.test(name));
        const side = SIDE.test(cat) && !/main|breakfast|brunch|lunch|dinner/.test(cat);
        if (side) return { breakfast: false, lunch: false, dinner: false, why: 'a side or snack, not a meal' };
        const hasProtein = !!mainProtein(r);
        return {
            breakfast: brk && !heavy,
            lunch: !onlyBrk && !side && !sweetHeavy && !heavy && !HEAVY_LUNCH.test(name) && (hasProtein || /salad|soup|bowl|wrap|sandwich|pita|quesadilla|hummus|pasta|noodle|grain|lentil|bean|chickpea/i.test(name) || /\blunch\b/.test(cat)),
            // A curry, stew, roast or pie is a dinner by what it is, with or without meat.
            dinner: !onlyBrk && !side && !sweetHeavy && (hasProtein || mainDish),
            why: heavy && brk ? 'a dinner dish' : '',
        };
    }

    // === WHAT A RECIPE ASKS OF THE COOK: time, effort, meal type ===
    // Every recipe gets: its meal type, its total time (active time: an overnight soak or a long
    // marinade done ahead doesn't count) and a difficulty score from 1 (pour and eat) to 10, from
    // its steps, ingredients and techniques. Recipes that don't fit a slot are rejected in code.
    const STAPLES = /^(salt|kosher salt|sea salt|black pepper|pepper|ground black pepper|water|ice|cooking spray|oil|olive oil|vegetable oil|canola oil|salt and pepper)$/i;
    const TECHNIQUES = [
        ['bake', /\b(bake|baked|baking(?! (powder|soda))|oven)\b/i, 20], ['roast', /\broast(ed|ing)?\b/i, 30], ['braise', /\b(braise[ds]?|braising)\b/i, 90],
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
    function recipeProfile(r0) {
        // The recipe as written: what Nourish added (a protein or fiber food, its step) doesn't make it harder.
        // By the food, not the exact line: a resized portion turns "2 eggs" into "3 eggs".
        const food = l => String(l).toLowerCase().replace(/^[\d\s/.½¼¾⅓⅔⅛-]+/, '').replace(/^(cups?|oz|scoops?|tbsp|tsp)\s+/, '').trim();
        const added = new Set([].concat(r0.protein_added || [], r0.fiber_added || []).map(food));
        const addedSteps = new Set((r0.added_steps || []).map(String));
        const r = added.size || addedSteps.size ? Object.assign({}, r0, { ingredients: (r0.ingredients || []).filter(l => !added.has(food(l))), steps: (r0.steps || []).filter(st => !addedSteps.has(String(st))) }) : r0;
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
        // "Refrigerate overnight" with no hours given: the total includes the night, the work doesn't.
        else if (given != null && given >= 120 && /\bovernight\b/i.test(text) && !(Number(r.active_minutes) > 0)) minutes = Math.min(given, estimate);
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
    // Why a recipe can't go in a slot ('' when it can), in plain words. Only real problems: the wrong
    // kind of dish, cooking on a no-cook meal, or well over the time there is (a few minutes over the
    // default is fine; a time the person chose in My schedule is kept to within 2 minutes). One step
    // or ingredient too many is never a reason on its own: slotPenalty() counts those against it.
    function timeAllowed(L) {
        if (!isFinite(L.minutes)) return Infinity;
        return L.choice ? L.minutes + 2 : Math.round(L.minutes * 1.25) + 3;
    }
    // Expensive cuts and shellfish: dinner only, never breakfast, lunch or a snack.
    const DINNER_ONLY_PRICEY = /\b(steaks?|rib[- ]?eye|filet mignon|beef tenderloin|tenderloin steak|fillet steak|sirloin|strip steak|porterhouse|t-bone|tomahawk|flank steak|skirt steak|wagyu|lobster|langoustines?|scallops?|crab(meat)?|king crab|lamb|veal|venison|duck breast|caviar|truffle|foie gras|oysters?)\b/i;
    function pricey(r) {
        const m = `${r.name || ''} ${(r.ingredients || []).join(' ')}`.match(DINNER_ONLY_PRICEY);
        return m ? m[0].toLowerCase() : '';
    }
    const LONG_PREP = /\b(brine|brining)\b|\b(marinate|soak|refrigerate|chill)\b[^.]{0,40}\b(overnight|(\d+|several) (to \d+ )?hours?)\b/i;
    const MAKE_AHEAD_OK = /\b(overnight oats|chia|bircher|soaked oats|refrigerator oats|fridge oats|make[- ]ahead|meal prep|pudding)\b/i;
    function slotProblem(r, meal, limits) {
        const L = limits || slotLimits({}, meal);
        const p = profileOf(r);
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
        if (p.minutes > timeAllowed(L)) return `takes about ${p.minutes} min${p.timeEstimated ? ' (estimated)' : ''}; ${meal} has ${L.minutes} min`;
        // "Involved" (over 6 of 10) is for dinner, or a meal the schedule gives plenty of time.
        if (meal !== 'dinner' && p.difficulty > Math.max(6, L.difficulty)) return `is involved (difficulty ${p.difficulty} of 10) for a ${meal}`;
        // Something that has to brine, marinate or soak for hours first isn't a breakfast or lunch.
        if (meal !== 'dinner' && LONG_PREP.test((r.steps || []).join(' ')) && !MAKE_AHEAD_OK.test(r.name || '')) return `needs hours of brining, marinating or soaking first`;
        if (meal !== 'dinner') { const x = pricey(r); if (x) return `has ${x}, an expensive ingredient kept for dinner`; }
        return '';
    }
    // How far a recipe is over the slot's soft limits (a little over on time, steps, ingredients or
    // effort): 0 when it's within them; added to its cost so simpler recipes win.
    function slotPenalty(r, meal, limits) {
        const L = limits || slotLimits({}, meal);
        const p = profileOf(r);
        let cost = 0;
        if (isFinite(L.minutes) && p.minutes > L.minutes) cost += (p.minutes - L.minutes) / Math.max(5, L.minutes) * 2;
        cost += Math.max(0, p.steps - L.steps) * 0.15 + Math.max(0, p.ingredients - L.ingredients) * 0.12 + Math.max(0, p.difficulty - L.difficulty) * 0.3;
        return cost;
    }
    // A recipe's profile, worked out once (until its steps, ingredients or times change).
    const profiles = new WeakMap();
    function profileOf(r) {
        const c = profiles.get(r);
        if (c && c.steps === r.steps && c.ings === r.ingredients && c.t === r.time_minutes && c.a === r.active_minutes && c.n === r.name) return c.p;
        const p = recipeProfile(r);
        profiles.set(r, { steps: r.steps, ings: r.ingredients, t: r.time_minutes, a: r.active_minutes, n: r.name, p });
        return p;
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
        if (!r._lines) r._lines = N.calculate(r.ingredients || [], r.servings || 1, r.steps).lines;
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
    const SALTY = /\b(salt|soy sauce|tamari|fish sauce|miso|coconut aminos|bouillon|stock cube|anchov|capers|olives|parmesan|feta|halloumi|smoked salmon|bacon|ham|prosciutto|chorizo)\b/i;
    const FLAVOR = /\b(garlic|ginger|onion|shallot|scallion|chili|chilli|jalape|cayenne|paprika|cumin|coriander|turmeric|garam masala|curry|oregano|basil|thyme|rosemary|parsley|cilantro|dill|mint|chives|sage|tarragon|bay lea|lemon|lime|orange zest|vinegar|mustard|soy sauce|fish sauce|miso|gochujang|harissa|sriracha|hot sauce|salsa|pesto|za'?atar|sumac|five spice|cinnamon|nutmeg|smoked|black pepper|pepper flakes|herbs?|spices?|seasoning|zest|worcestershire|tahini|sesame oil)\b/gi;
    const TO_TASTE = /\b(salt|kosher salt|sea salt)\b[^,]*\b(to taste|as needed|for seasoning)\b|^salt( and (black )?pepper)?$|^(kosher |sea )?salt and (freshly )?(ground )?(black )?pepper( to taste)?$/i;
    // Sweet breakfasts (smoothies, oats, pancakes, French toast…) don't need salt and spices.
    const SWEET_BREAKFAST = /\b(smoothie|oats|oatmeal|porridge|muesli|bircher|granola|parfait|chia pudding|pancakes?|waffles?|french toast|crepes?|yogh?urt bowl|acai|smoothie bowl)\b/i;
    function isSavory(r) {
        const fit = r._fit || mealFit(r);
        if (fit.breakfast && SWEET_BREAKFAST.test(r.name || '') && !/\b(savou?ry|egg|eggs|cheddar|feta|parmesan|bacon|masala|soy)\b/i.test(r.name || '')) return false;
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

    // === A LIGHT CHANGE FOR SOMETHING THE PERSON AVOIDS ===
    // A real recipe with one disliked ingredient on the side (not in the dish's name, not an allergy
    // or the diet: those are never adapted) gets a sensible swap: mushrooms → zucchini, cilantro →
    // parsley. The AI may suggest one when this list has none (ondevice.js).
    const SUBS = {
        mushroom: 'zucchini', cilantro: 'parsley', coriander: 'parsley', olive: 'cherry tomatoes', tomato: 'bell pepper', 'bell pepper': 'zucchini', eggplant: 'zucchini',
        zucchini: 'green beans', spinach: 'kale', kale: 'spinach', cauliflower: 'broccoli', broccoli: 'green beans', pea: 'corn', corn: 'peas', celery: 'cucumber',
        cucumber: 'celery', avocado: 'cucumber', feta: 'goat cheese', 'goat cheese': 'feta', 'blue cheese': 'feta', cheddar: 'monterey jack', 'sour cream': 'greek yogurt',
        mayonnaise: 'greek yogurt', mayo: 'greek yogurt', raisin: 'chopped dates', honey: 'maple syrup', jalapeno: 'bell pepper', 'chili flakes': 'smoked paprika',
        'red pepper flakes': 'smoked paprika', cabbage: 'lettuce', radish: 'cucumber', arugula: 'spinach', 'sun-dried tomato': 'bell pepper', walnut: 'pumpkin seeds',
        pecan: 'pumpkin seeds', almond: 'sunflower seeds', cashew: 'sunflower seeds', 'coconut milk': 'milk', ricotta: 'cottage cheese', 'cottage cheese': 'ricotta',
        dill: 'parsley', basil: 'parsley', mint: 'parsley', asparagus: 'green beans', 'brussels sprout': 'broccoli', beet: 'carrot', parsnip: 'carrot', leek: 'green onion',
    };
    function substituteFor(term) {
        const t = String(term || '').toLowerCase().replace(/(e?s)$/, '');
        return SUBS[t] || SUBS[String(term || '').toLowerCase()] || null;
    }
    // Swaps `term` for `sub` in the ingredients and steps. Returns the changed copy, or null when the
    // term is the dish itself (in its name).
    function adapt(r, term, sub) {
        if (!term || !sub) return null;
        const esc = String(term).toLowerCase().replace(/(e?s)$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+');
        const re = new RegExp('\\b' + esc + '(e?s)?\\b', 'gi');
        if (re.test(r.name || '')) return null;
        re.lastIndex = 0;
        const out = JSON.parse(JSON.stringify(r));
        let changed = false;
        out.ingredients = (r.ingredients || []).map(l => { re.lastIndex = 0; if (!re.test(l)) return l; changed = true; re.lastIndex = 0; return String(l).replace(re, sub); });
        if (!changed) return null;
        out.steps = (r.steps || []).map(st => { re.lastIndex = 0; return String(st).replace(re, sub); });
        out.adapted = (r.adapted || []).concat([`${term} → ${sub}`]);
        delete out._lines; delete out.nutrition; delete out._fit;
        return out;
    }

    // === PORTIONS ===
    const FATTY = /\b(oil|butter|ghee|margarine|lard|shortening|mayonnaise|mayo)\b/i;
    const SWEET = /\b(sugar|honey|maple syrup|syrup|agave|molasses|jam|chocolate chips)\b/i;
    const WHOLE = /\b(eggs?|egg whites?|egg yolks?|tortillas?|wraps?|pitas?|buns?|bagels?|english muffins?|muffins?|rolls?|slices?|fillets?|breasts?|thighs?|drumsticks?|wings?|chops?|sausages?|patt(y|ies)|burgers?|hot dogs?|crackers?|rice cakes?|cloves?)\b/i;
    function scaleLine(line, k) {
        const item = U.splitIngredient(line);
        if (item.qty == null || Math.abs(k - 1) < 0.01) return String(line);
        let q = item.qty * k;
        let unit = item.unit;
        // Under a pound reads better (and is more exact) in ounces: 6 oz, not ½ lb. A bit of a cup
        // in tablespoons, a bit of a tablespoon in teaspoons: 2 tsp oil, not ¾ tbsp.
        if (unit === 'lb' && q < 1) { q *= 16; unit = 'oz'; }
        if (unit === 'cup' && q < 0.25) { q *= 16; unit = 'tbsp'; }
        if (unit === 'tbsp' && q < 1 && Math.abs(q * 2 - Math.round(q * 2)) > 0.01) { q *= 3; unit = 'tsp'; }
        if (unit === 'tsp' && q >= 0.5 && item.unit !== 'tsp') q = Math.max(0.5, Math.round(q * 2) / 2);
        // A small share of a can: by weight when the can's size is given ("1¾ oz light coconut milk",
        // not "½ can", four times too much for one portion of a 4-serving recipe); else quarter cans.
        if (unit === 'can') {
            const pack = String(line).match(/(\d+(?:\.\d+)?)\s*-?\s*(oz|ounces?|ounce|g|grams?|ml)\b/i);
            if (q < 0.5 && pack) {
                const u = /^(oz|ounce)/i.test(pack[2]) ? 'oz' : /^g/i.test(pack[2]) ? 'g' : 'ml';
                let w = q * Number(pack[1]);
                w = u === 'oz' ? Math.max(0.25, Math.round(w * 4) / 4) : Math.max(5, Math.round(w / 5) * 5);
                const text = String(item.text || '').replace(/\(+[^()]*\d[^()]*\)+/g, ' ').replace(/^\s*(cans?|tins?)\s+(of\s+)?/i, '').replace(/[()]/g, ' ')
                    .replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
                return `${U.formatAmount(w, u)} ${text}`.trim();
            }
            q = Math.max(0.25, Math.round(q * 4) / 4);
            const amount = U.formatAmount(q, unit);
            return item.note !== undefined ? `${item.text}: ${amount}${item.note ? ' ' + item.note : ''}` : `${amount} ${item.text}`.trim();
        }
        // Things you can't cook half of (eggs, tortillas, slices, fillets…) stay whole.
        if ((!unit || unit === 'slice' || unit === 'piece' || unit === 'fillet') && WHOLE.test(item.text || '')) q = Math.max(1, Math.round(q));
        else if (!unit || unit === 'clove' || unit === 'can' || unit === 'slice' || unit === 'piece' || unit === 'fillet') q = Math.max(0.5, Math.round(q * 2) / 2);
        else if (unit === 'g' || unit === 'ml') q = Math.max(5, Math.round(q / 5) * 5);
        else if (unit === 'oz' && q >= 2) q = Math.round(q);
        else if (unit === 'cup' && q >= 0.25) {
            // Cups: the nearest of ¼ ⅓ ½ ⅔ ¾ (and whole cups plus those).
            const whole = Math.floor(q), part = q - whole;
            const best = [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1].reduce((a, b) => (Math.abs(b - part) < Math.abs(a - part) ? b : a));
            q = whole + best;
        } else q = q >= 0.3 ? Math.max(0.25, Math.round(q * 4) / 4) : Math.max(0.125, Math.round(q * 8) / 8);   // kitchen fractions: ¼ ½ ¾ (⅛ for pinches)
        const amount = U.formatAmount(q, unit);
        return item.note !== undefined ? `${item.text}: ${amount}${item.note ? ' ' + item.note : ''}` : `${amount} ${item.text}`.trim();
    }
    // Cuts oil, butter and sugar (to no less than half, keeping at least a teaspoon of oil) to save
    // up to `kcal` per serving. Seasoning is never touched. Returns the calories saved per serving.
    function trimRich(r, kcal) {
        if (kcal <= 0) return 0;
        const before = N.calculate(r.ingredients, r.servings, r.steps).nutrition.calories;
        r.ingredients = r.ingredients.map(line => {
            if (!(FATTY.test(line) || SWEET.test(line)) || /\b(spray|for greasing)\b/i.test(line)) return line;
            const item = U.splitIngredient(line);
            if (item.qty == null) return line;
            const isTsp = item.unit === 'tsp';
            if (isTsp && item.qty <= 1) return line;
            return scaleLine(line, 0.5);
        });
        delete r._lines;
        const after = N.calculate(r.ingredients, r.servings, r.steps).nutrition.calories;
        if (before - after > 0) r.trimmed = true;
        return before - after;
    }
    // Cuts oil and sugar, then lowers the recipe's numbers by what the cut saved (worked out from the
    // ingredients, so the source's own numbers stay the base).
    function trimAndRecount(r, kcal) {
        const before = N.calculate(r.ingredients, r.servings, r.steps).nutrition;
        trimRich(r, kcal);
        if (!r.trimmed) return;
        const after = N.calculate(r.ingredients, r.servings, r.steps).nutrition;
        const n = r.nutrition;
        r.nutrition = { calories: Math.max(1, n.calories - (before.calories - after.calories)), protein_g: Math.max(0, n.protein_g - (before.protein_g - after.protein_g)),
            carbs_g: Math.max(0, n.carbs_g - (before.carbs_g - after.carbs_g)), fat_g: Math.max(0, n.fat_g - (before.fat_g - after.fat_g)) };
    }
    const baseCalc = new WeakMap();   // a recipe's own calculation, worked out once
    // The recipe made for `people`, each portion `factor` times one of the recipe's servings.
    function scaleRecipe(r, factor, people) {
        const out = JSON.parse(JSON.stringify(r));
        const from = Math.max(1, Number(r.servings) || 1);
        const k = factor * people / from;
        out.ingredients = (r.ingredients || []).map(l => scaleLine(l, k));
        out.servings = people;
        if (Math.abs(factor - 1) > 0.05 || from !== people) out.scaled = { from_servings: from, portion: Math.round(factor * 100) / 100 };
        delete out._lines; delete out._fit;
        // Honest numbers: worked out again from the amounts as written after scaling (2 eggs, not
        // 1.7), as a change to the recipe's settled numbers (which may be the site's own, checked
        // against our calculation). An amount that can't be scaled ("a handful") falls back on the portion.
        const n = r.nutrition || N.calculate(r.ingredients, from, r.steps).nutrition;
        let before = baseCalc.get(r);
        if (!before || before.from !== from || before.list !== r.ingredients) { before = { from, list: r.ingredients, n: N.calculate(r.ingredients, from, r.steps).nutrition }; baseCalc.set(r, before); }
        before = before.n;
        const after = N.calculate(out.ingredients, people, r.steps).nutrition;
        const ratio = key => (before[key] > 0 && after[key] >= 0 ? after[key] / before[key] : factor);
        const kcalRatio = before.calories > 0 && after.calories > 0 ? after.calories / before.calories : factor;
        // Lines the calculator can't see (unmatched) keep scaling with the portion.
        const seen = before.calories / Math.max(1, Number(n.calories) || 1);
        const change = key => (key === 'calories' ? kcalRatio : ratio(key)) * Math.min(1, seen) + factor * Math.max(0, 1 - Math.min(1, seen));
        const val = key => Math.round((Number(n[key]) || 0) * change(key));
        out.nutrition = { calories: val('calories'), protein_g: val('protein_g'), carbs_g: val('carbs_g'), fat_g: val('fat_g') };
        // Fiber, vitamins and minerals follow the amounts too.
        const nowCalc = after;
        if (before.fiber_g != null || n.fiber_g != null) out.nutrition.fiber_g = Math.round((before.fiber_g > 0 ? (Number(n.fiber_g != null ? n.fiber_g : before.fiber_g) || 0) * nowCalc.fiber_g / before.fiber_g : (nowCalc.fiber_g || 0)) * 10) / 10;
        if (nowCalc.micros) out.nutrition.micros = nowCalc.micros;
        return out;
    }

    // Realistic portions: a quarter of a serving at a time, between half and double. Days get near
    // the target by choosing meals that fit, then these small changes; never an odd ×1.37.
    const PORTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    function portionOptions(f) {
        // The realistic portions near what's needed (rounded amounts don't always move the
        // calories, so a few are tried), and the recipe as written when it's close.
        const out = PORTIONS.filter(p => p >= f * 0.7 && p <= f * 1.4);
        if (!out.length) out.push(snapPortion(Math.max(0.5, Math.min(2, f))));
        if (Math.abs(Math.log(f)) < Math.log(1.3)) out.push(1);
        return [...new Set(out)];
    }
    function snapPortion(f) { return PORTIONS.reduce((a, b) => (Math.abs(Math.log(b / f)) < Math.abs(Math.log(a / f)) ? b : a), 1); }
    // Sizes a day's meals together: for each, the realistic portions around what its share of the day
    // needs; then the combination whose real total is closest to the target (a small preference for
    // recipes as written). Totals are never forced or rounded to the target.
    // items: [{ key, r, want }] (r with settled numbers, want: its kcal share). fixed: kcal already in the day.
    function sizeMeals(items, target, people, fixed = 0) {
        // A meal already at a portion (`base`, say ¾) is sized from there, so the portion it ends at is
        // still a quarter serving (¾ × ¾ would be an uncookable 0.56).
        const choices = items.map(it => portionOptions((it.base || 1) * it.want / it.r.nutrition.calories).map(abs => {
            const p = abs / (it.base || 1);
            const out = scaleRecipe(it.r, p, people);
            if (out.scaled) out.scaled.absolute = abs;
            if (Math.abs(p - 1) < 0.01 && Number(it.r.servings) === people) delete out.scaled;
            return { p, out };
        }));
        let best = null;
        const walk = (i, picked, total) => {
            if (i === choices.length) {
                const cost = Math.abs(Math.log(Math.max(1, total) / target)) + picked.reduce((c, x) => c + Math.abs(Math.log(x.p)) * 0.02, 0);
                if (!best || cost < best.cost) best = { cost, picked: picked.slice() };
                return;
            }
            choices[i].forEach(c => { picked.push(c); walk(i + 1, picked, total + c.out.nutrition.calories); picked.pop(); });
        };
        walk(0, [], fixed);
        const out = {};
        items.forEach((it, i) => { out[it.key] = best ? best.picked[i].out : scaleRecipe(it.r, 1, people); });
        return out;
    }

    // === CALORIE SPLIT ===
    const SPLITS = { dinner: [25, 30, 45], even: [33, 33, 34], breakfast: [40, 30, 30], frontload: [33, 37, 30] };   // frontload: "Front-load my day"
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
    // A day's targets. Protein follows body weight when it's known: 1.6 g per kg a day, 2.0 g/kg when
    // losing weight (otherwise the protein target typed in Settings). Every main meal 25–40 g (about
    // 0.4 g/kg), breakfast at least 25 g. Fiber at least 30 g a day. Carbs and fat aren't forced low:
    // "balanced" by default, or "lower-carb" / "lower-fat" (Settings → Profile).
    const FIBER_TARGET = 30;
    const MEAL_PROTEIN = { min: 25, max: 40 };
    function targetsOf(settings) {
        const kcal = Number(settings.calorie_target) || 2000;
        const kg = Number(settings.body_weight_kg) || 0;
        const cut = (settings.goal || settings.prefsGoal) === 'Cut';
        const byWeight = kg >= 30 && settings.protein_auto !== 'off';
        const protein = byWeight ? Math.round(kg * (cut ? 2.0 : 1.6)) : (Number(settings.protein_target) || Math.round(kcal * 0.25 / 4));
        const pref = settings.macro_pref || 'balanced';
        const fatShare = pref === 'lower-fat' ? 0.22 : pref === 'lower-carb' ? 0.4 : 0.3;
        const fat = Math.round(kcal * fatShare / 9);
        const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
        const perMeal = byWeight ? Math.min(MEAL_PROTEIN.max, Math.max(MEAL_PROTEIN.min, Math.round(kg * 0.4))) : 30;
        return { kcal, protein, carbs, fat, fiber: FIBER_TARGET, byWeight, perMeal, mealProtein: MEAL_PROTEIN, pref };
    }

    // === PLANNING ===
    // How well a recipe fits a slot: lower is better. Infinity = can't be used.
    // === WHERE A RECIPE COMES FROM, WHAT IT COSTS, AND WHETHER IT SUITS THE GOAL ===
    // One source = one book, one site, or Nourish's own recipes: at most `source_cap` meals a week
    // from any one of them (Settings → Advanced), so a barbecue book can't fill 5 of 21 meals.
    function sourceKey(r) {
        if (!r) return 'other';
        if (r.from_book) return `book:${r.book_id || r.book || r.source_name || '?'}`;
        // The website, the same way whether the recipe still has its source id or only its link.
        if (r.source_url) { try { return new URL(r.source_url).hostname.replace(/^(www|m)\./, ''); } catch (e) { /* not a link */ } }
        if (r.source_id) return r.source_id;
        return r.ai ? 'ai' : 'other';
    }
    // Luxury or hard-to-find ingredients: left out unless the budget is "No limit".
    const LUXURY = /\b(wagyu|kobe|a5\b|caviar|truffles?(?! (cake|brownies?|balls?))|truffle oil|foie gras|beluga|osetra|uni\b|sea urchin|abalone|langoustines?|king crab|lobster|iberico|ib[eé]rico|jam[oó]n ib|gold leaf|bluefin|toro|matsutake|morels?|white asparagus|dry[- ]aged)\b/i;
    // Pricier everyday ingredients: fine on "Normal", avoided when the budget is "Budget".
    const PRICEY = /\b(rib[- ]?eye|filet mignon|beef tenderloin|fillet steak|sirloin|porterhouse|t-bone|tomahawk|rack of lamb|lamb rack|lamb chops?|scallops?|crab(meat)?|halibut|sea bass|swordfish|tuna steaks?|duck breast|veal|venison|pine nuts|saffron|prosciutto|burrata|pancetta|smoked salmon|salmon fillets?|prawns?|shrimp|macadamia|manchego|gruy[eè]re|parmigiano)\b/i;
    function budgetProblem(r, budget) {
        if (budget === 'any') return '';
        const text = `${r.name || ''} ${(r.ingredients || []).join(' ')}`;
        const lux = text.match(LUXURY);
        if (lux) return `a luxury or hard-to-find ingredient (${lux[0].toLowerCase()})`;
        if (budget === 'budget') { const p = text.match(PRICEY); if (p) return `a pricier ingredient (${p[0].toLowerCase()})`; }
        return '';
    }
    // Very fatty cuts and rich dishes: a poor fit when the goal is to lose weight.
    const FATTY_CUTS = /\b(rib[- ]?eye|pork belly|short ribs?|brisket|prime rib|tomahawk|wagyu|lamb shoulder|duck confit|confit|chorizo|bacon[- ]wrapped|marbled|foie gras|deep[- ]fried|fried chicken|carnitas|pulled pork|pork shoulder|sausages?|salami|pepperoni|cheeseburger|mac and cheese|alfredo|carbonara)\b/i;
    const LEAN = /\b(chicken breast|turkey|white fish|cod|haddock|tilapia|pollock|hake|shrimp|prawns?|tofu|tempeh|lentils?|chickpeas?|beans|egg whites?|cottage cheese|greek yogh?urt|seitan)\b/i;
    // Extra cost of a recipe for the goal: for "Lose weight", leaner and lighter dishes first. A rich
    // dish that only fits by shrinking its portion a lot is the wrong dish, not a small portion.
    function goalCost(r, f, goal) {
        if (goal !== 'Cut') return 0;
        const n = r.nutrition || {};
        let c = 0;
        if (f < 0.85) c += (0.85 - f) * 8;    // a ⅔ portion of a heavy dish costs about 1.5
        const fatShare = n.calories > 0 ? (Number(n.fat_g) || 0) * 9 / n.calories : 0;
        if (fatShare > 0.42) c += (fatShare - 0.42) * 6;
        const text = `${r.name || ''} ${(r.ingredients || []).slice(0, 6).join(' ')}`;
        if (FATTY_CUTS.test(r.name || '') || FATTY_CUTS.test(text)) c += 1.2;
        else if (LEAN.test(text)) c -= 0.25;
        return c;
    }

    function slotCost(r, kcalTarget, ctx) {
        const n = r.nutrition;
        if (!n || !(n.calories > 0)) return Infinity;
        let f = kcalTarget / n.calories;
        const rich = r._richKcal || 0;   // calories trimRich could save per serving
        if (f < 0.6 && n.calories - rich > 0) f = Math.max(f, kcalTarget / (n.calories - rich) * 0.95);
        if (f < 0.55 || f > 2) return Infinity;
        // Recipes that are close to the slot as written come first; a realistic portion that still
        // misses counts against it too.
        const portion = snapPortion(f);
        let cost = Math.abs(Math.log(f)) * 1.5 + Math.abs(Math.log(f / portion)) * 2;
        const share = kcalTarget / ctx.targets.kcal;
        const pTarget = ctx.targets.protein * share;
        const fTarget = ctx.targets.fat * share;
        const p = n.protein_g * f, fat = n.fat_g * f;
        // Protein counts for more when the day's target is a big share of its calories (losing weight, 2 g per kg).
        const pShare = ctx.targets.kcal > 0 ? ctx.targets.protein * 4 / ctx.targets.kcal : 0.2;
        cost += Math.max(0, (pTarget - p) / pTarget) * (1.5 + Math.max(0, pShare - 0.25) * 5) + Math.max(0, (fat - fTarget) / fTarget) * 1.5;
        // A meal with real protein of its own comes before one Nourish would have to add chicken to.
        cost += Math.max(0, (MEAL_PROTEIN.min - p) / MEAL_PROTEIN.min) * (ctx.meal === 'breakfast' ? 1 : 2.5);
        cost -= Math.min(2, P.likeScore(r, ctx.likes)) * 0.5;
        if (ctx.goal === 'Cut' && r.healthy) cost -= 0.3;
        cost += goalCost(r, f, ctx.goal);
        // Fiber: about 30 g a day shared over the meals; meals that bring it come first.
        const fiberWant = (ctx.targets.fiber || 30) * share;
        if (n.fiber_g != null) cost += Math.max(0, (fiberWant - n.fiber_g * f) / fiberWant) * 0.6;
        // Calorie density: lunch and dinner under about 1.5 kcal per gram fill you up for fewer
        // calories (more so when losing weight).
        if (ctx.meal !== 'breakfast' && r.kcal_per_g > 1.5) cost += (r.kcal_per_g - 1.5) * (ctx.goal === 'Cut' ? 1.6 : 0.8);
        // Lower-carb: carbs over the meal's share count against a recipe (fat is already checked).
        if (ctx.targets.pref === 'lower-carb' && ctx.targets.carbs > 0) cost += Math.max(0, (n.carbs_g * f - ctx.targets.carbs * share * 1.1) / (ctx.targets.carbs * share)) * 1.5;
        // Whole ingredients first.
        cost += Math.min(0.6, ((`${(r.ingredients || []).join(' ')}`).match(PROCESSED) || []).length * 0.15);
        // Fatty fish about once a week: favoured until the week has some.
        if (ctx.wantFish && isFattyFish(r)) cost -= 1.2;
        if (r.nutrition_unmatched) cost += 0.2;
        // Highly rated on its own site (with enough ratings to mean something) comes first.
        if (r.rating && r.rating.count >= 5) cost -= Math.max(-0.4, Math.min(0.4, (r.rating.value - 4.2) * 0.5));
        if (r.reseasoned) cost += 0.4;
        cost += (ctx.sourcePenalty && ctx.sourcePenalty(r)) || 0;
        // What the app has learned the person likes (taste.js): −1…1, worth up to about a slot's worth of fit.
        if (ctx.taste) { try { cost -= ctx.taste(r) * 0.8; } catch (e) { /* no profile */ } }
        cost += (ctx.cuisineCount[cuisineOf(r)] || 0) * 0.35;
        // Nourish's own recipes as a backup (the default): only when nothing from the web or the
        // library fits about as well.
        if (r.source_id === 'builtin' && ctx.builtinMode === 'backup') cost += 3;
        // A mix of sources: each meal already taken from the same place counts a little against it.
        if (r.source_id !== 'builtin' || ctx.builtinMode !== 'backup') cost += ((ctx.sourceCount && ctx.sourceCount[sourceKey(r)]) || 0) * 0.15;
        return cost;
    }

    // Picks recipes for each day and sizes the portions. pools: { breakfast: [recipes], … } (already
    // checked: allowed, seasoned, nutrition settled). Returns { days: [{ breakfast, lunch, dinner }],
    // missing: [{ day, meal, kcal }], report: [{ day, kcal, protein, carbs, fat }] }.
    // already: dishes from recent plans (the last 14 days, favourites left out): avoided, and only
    // used when a slot has nothing else. Nothing is ever used twice in one plan (sameDish), except a
    // dinner eaten again as the next day's lunch when Settings → "Allow leftovers" is on.
    function planWeek({ pools, settings, likes, days = 7, people = 1, sourcePenalty, already = [], exclude, weekday, taste, favorites, snackExtras }) {
        // Favourites (recipes they loved) come back, but at most `cap` times a week.
        const favList = dishList(((favorites && favorites.recipes) || []).map(r => r.name));
        const isFav = r => favList.names().length > 0 && favList.has(r.name);
        let favUsed = 0;
        const leftovers = settings.allow_leftovers === 'on';
        const baseTargets = targetsOf(settings);
        // Weekly mode: each day can have its own calories (settings.day_kcal, from weeklyTargets);
        // protein and fiber stay the same every day.
        const targetsFor = d => (Array.isArray(settings.day_kcal) && settings.day_kcal[d] > 0 ? Object.assign({}, baseTargets, { kcal: settings.day_kcal[d] }) : baseTargets);
        let targets = baseTargets;
        const split = splitOf(settings);
        const on = m => split[MEALS.indexOf(m)] > 0;
        const used = dishList();                 // this plan: never twice
        const recent = dishList(already);        // recent plans: avoided
        const ctx = { targets, likes: P.parse(likes || ''), goal: settings.goal || settings.prefsGoal, sourcePenalty, taste, cuisineCount: {}, sourceCount: {}, builtinMode: settings.builtin_mode || 'mix' };
        const rejected = {};   // why recipes didn't fit a slot (for the log)
        const cap = Math.max(1, Number(settings.source_cap) || 3);
        const overCap = r => (ctx.sourceCount[sourceKey(r)] || 0) >= cap;
        // The real calories of a recipe at each realistic portion (amounts rounded as written), so
        // meals are chosen for how close the day can really get, not for a number on paper.
        const portionKcal = new Map();
        const realKcal = (r, p) => {
            const key = `${r.name}|${r.source_url || ''}|${p}`;
            if (!portionKcal.has(key)) portionKcal.set(key, scaleRecipe(r, p, people).nutrition.calories);
            return portionKcal.get(key);
        };
        const reachable = (picks, target) => {
            // The closest real total the picks can reach with realistic portions.
            let best = Infinity;
            const opts = picks.map(x => portionOptions(x.want / x.r.nutrition.calories).map(p => realKcal(x.r, p)));
            const walk = (i, total) => {
                if (i === opts.length) { best = Math.min(best, Math.abs(Math.log(Math.max(1, total) / target))); return; }
                opts[i].forEach(k => walk(i + 1, total + k));
            };
            walk(0, 0);
            return best;
        };
        const out = [];
        const missing = [];
        const report = [];
        for (let d = 0; d < days; d++) {
            targets = targetsFor(d);
            ctx.targets = targets;
            const top = {};
            MEALS.forEach((m, i) => {
                const kcal = targets.kcal * split[i];
                if (!on(m)) { top[m] = []; return; }
                // Breakfast is breakfast: anything too slow, too much work or the wrong kind of dish
                // for this slot (with this day's schedule) is out before it can be picked.
                const limits = slotLimits(settings, m, weekday ? weekday(d) : null);
                const fits = (pools[m] || []).filter(r => !used.has(r.name))
                    .filter(r => !isFav(r) || favUsed < ((favorites && favorites.cap) || 0))
                    .filter(r => { const why = slotProblem(r, m, limits); if (why) rejected[`${m}: ${r.name}`] = why; return !why; })
                    .map(r => { ctx.meal = m; ctx.wantFish = !ctx.hadFish && d >= Math.min(days - 1, 3) && m !== 'breakfast' && !(ctx.fishTried >= 3); return { r, cost: slotCost(r, kcal, ctx) + slotPenalty(r, m, limits) }; }).filter(x => isFinite(x.cost));
                // No source past its weekly share, unless nothing else fits this slot at all.
                const shared = fits.filter(x => !overCap(x.r));
                if (shared.length) { fits.filter(x => overCap(x.r)).forEach(x => { rejected[`${m}: ${x.r.name}`] = `already ${cap} meals from ${x.r.book || x.r.source_name || sourceKey(x.r)} this week`; }); fits.length = 0; shared.forEach(x => fits.push(x)); }
                else fits.forEach(x => { x.cost += 2; });
                // Nourish's own recipes are a backup: with at least 3 web or book recipes that fit this
                // slot, they're not in the running at all (a weaker fit from the web still comes first).
                if (ctx.builtinMode === 'backup' && fits.filter(x => x.r.source_id !== 'builtin').length >= 3) {
                    const web = fits.filter(x => x.r.source_id !== 'builtin');
                    fits.length = 0; web.forEach(x => fits.push(x));
                }
                // Recent plans' dishes only when nothing new fits (favourites are always welcome).
                const fresh = fits.filter(x => isFav(x.r) || !recent.has(x.r.name));
                top[m] = (fresh.length ? fresh : fits.map(x => ({ r: x.r, cost: x.cost + 1 }))).sort((a, b) => a.cost - b.cost).slice(0, 8);
                // Cook once, eat twice: yesterday's dinner as today's lunch (Settings → Allow leftovers).
                const prev = out[d - 1] && out[d - 1].dinner;
                if (m === 'lunch' && leftovers && prev && !prev.leftover && !(exclude && exclude(prev))) {
                    const base = (pools.dinner || []).find(r => r.name === prev.name) || prev;
                    const cost = slotCost(base, kcal, ctx);
                    if (isFinite(cost)) top[m].unshift({ r: Object.assign(JSON.parse(JSON.stringify(base)), { leftover: true }), cost: cost - 0.6 });
                }
            });
            // The best combination: different main proteins and vegetables, closest to the day's macros.
            let best = null;
            const opts = m => (top[m].length ? top[m] : [null]);
            opts('breakfast').forEach(b => opts('lunch').forEach(l => opts('dinner').forEach(dn => {
                const pick = [b, l, dn];
                const rs = pick.filter(Boolean).map(x => x.r);
                if (rs.some((r, i) => rs.some((o, j) => j < i && sameDish(o.name, r.name)))) return;
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
                    // A day short of its protein is a worse day: add-ons can only do so much (one food a meal).
                    cost += Math.max(0, (pT * 0.9 - p) / pT) * 10 + Math.max(0, (f - fT * 1.1) / fT) * 4;
                }
                if (new Set(cuis).size < cuis.length) cost += 0.6;
                // Two meals of one day from the same source, or a day that would take it past its share.
                const keys = rs.map(sourceKey);
                keys.forEach((k, i) => { if (keys.indexOf(k) !== i && k !== 'builtin') cost += 0.8; if ((ctx.sourceCount[k] || 0) + keys.filter(x => x === k).length > cap && k !== 'builtin') cost += 3; });
                // How close the day can really get once portions are realistic: 5% off costs about 0.5.
                const picks = pick.map((x, i) => (x ? { r: x.r, want: targets.kcal * split[i] } : null)).filter(Boolean);
                const wanted = picks.reduce((t, x) => t + x.want, 0);
                if (picks.length && (!best || cost < best.cost)) cost += Math.max(0, reachable(picks, wanted) - 0.02) * 10;
                if (!best || cost < best.cost) best = { pick, cost };
            })));
            const day = {};
            const items = [];
            MEALS.forEach((m, i) => {
                const chosen = best && best.pick[i];
                if (!on(m)) return;
                if (!chosen) { missing.push({ day: d, meal: m, kcal: Math.round(targets.kcal * split[i]) }); return; }
                const r = JSON.parse(JSON.stringify(chosen.r));
                const kcal = targets.kcal * split[i];
                if (kcal / r.nutrition.calories < 0.85) trimAndRecount(r, r.nutrition.calories - kcal / 0.85);
                items.push({ key: m, r, want: kcal });
                if (!r.leftover) used.add(r.name);
                if (isFav(r)) favUsed++;
                const c = cuisineOf(r);
                ctx.cuisineCount[c] = (ctx.cuisineCount[c] || 0) + 1;
                ctx.sourceCount[sourceKey(r)] = (ctx.sourceCount[sourceKey(r)] || 0) + 1;
                if (isFattyFish(r)) { ctx.hadFish = true; ctx.fishDay = ctx.fishDay || `day ${d + 1} ${m}: ${r.name}`; }
            });
            addSnacks(day, Object.assign({}, settings, { calorie_target: targets.kcal }), d, people, exclude, snackExtras);
            const snackKcal = (day.snacks || []).reduce((t, x) => t + x.nutrition.calories, 0);
            // A day with a gap is sized to its own meals' shares only (the AI fills the gap later).
            const target = items.length === MEALS.filter(on).length ? targets.kcal - snackKcal : items.reduce((t, it) => t + it.want, 0);
            Object.assign(day, sizeMeals(items, Math.max(1, target), people));
            out.push(day);
            report.push(dayTotals(day));
        }
        return { days: out, missing, report, targets: baseTargets, split, rejected, fattyFish: ctx.fishDay || '' };
    }
    // One meal made about `kcal` lighter: oil and sugar first, then a smaller portion (never below
    // 60% of what it was). Seasoning stays.
    function lighten(meal, kcal, people) {
        const r = JSON.parse(JSON.stringify(meal));
        const n = r.nutrition && r.nutrition.calories;
        if (!n || !(kcal > 0)) return r;
        trimAndRecount(r, kcal);
        const want = Math.max(n * 0.6, n - kcal);
        const prev = meal.scaled ? meal.scaled.portion : 1;
        // The new portion is a quarter serving (never an odd 1.31), at least ¾ of what it was: still a meal.
        const abs = Math.min(prev, Math.max(snapPortion(prev * 0.75), snapPortion(prev * want / r.nutrition.calories)));
        const f = abs / prev;
        const out = scaleRecipe(Object.assign({}, r, { servings: people || r.servings || 1 }), f, people || r.servings || 1);
        out.scaled = { from_servings: (meal.scaled && meal.scaled.from_servings) || r.servings || 1, portion: abs };
        return out;
    }
    // Sizes the portions of a day that was made another way (by the AI, or edited) so it lands on the
    // calorie target with the chosen split: oil and sugar are cut before portions, never seasoning.
    function fitDay(day, settings, people) {
        const targets = targetsOf(settings || {});
        const split = splitOf(settings);
        const out = Object.assign({}, day);
        const items = [];
        let fixed = (Array.isArray(day.snacks) ? day.snacks : []).reduce((t, x) => t + ((x.nutrition && x.nutrition.calories) || 0), 0);
        MEALS.forEach((m, i) => {
            const r = out[m];
            if (!r || !r.nutrition || !(r.nutrition.calories > 0)) return;
            if (!(r.ingredients || []).length || !(split[i] > 0)) { fixed += r.nutrition.calories; return; }
            let kcal = targets.kcal * split[i];
            const copy = JSON.parse(JSON.stringify(r));
            // What Nourish added (a protein or fiber food) is a side of its own: sizing the portion
            // sizes the dish, never the added chicken or eggs (else protein and calories chase each other).
            const extra = addOns(copy, people);
            // The add-on's calories (a serving's worth) are part of the day already.
            if (extra) { const per = extra.nutrition.calories; fixed += per; kcal = Math.max(kcal * 0.4, kcal - per); }
            // Already sized (amounts are for `people`): work from one serving as it stands.
            if (copy.scaled) copy.servings = people || Number(copy.servings) || 1;
            if (kcal / copy.nutrition.calories < 0.85) trimAndRecount(copy, copy.nutrition.calories - kcal / 0.85);
            items.push({ key: m, r: copy, want: kcal, prev: r, base: r.scaled && r.scaled.portion > 0 ? r.scaled.portion : 1, extra });
        });
        const sized = sizeMeals(items, Math.max(1, targets.kcal - fixed), people || 1);
        items.forEach(it => {
            const s = sized[it.key];
            // Unchanged unless it really moves: a meal at its portion stays exactly as it was.
            if (s.scaled && it.prev.scaled) s.scaled = Object.assign({}, s.scaled, { from_servings: it.prev.scaled.from_servings, portion: s.scaled.absolute || Math.round(it.prev.scaled.portion * s.scaled.portion * 100) / 100 });
            if (s.scaled) delete s.scaled.absolute;
            if (!s.scaled && !it.r.trimmed) return;
            out[it.key] = it.extra ? withAddOns(s, it.extra, people || 1) : s;
        });
        return out;
    }
    // A meal's added foods (protein_added, fiber_added) taken out: { lines, steps, nutrition } for the
    // whole meal, with `meal` left as the dish alone (ingredients, steps, numbers). null when none.
    function addOns(meal, people) {
        const added = [].concat(meal.protein_added || [], meal.fiber_added || []);
        if (!added.length) return null;
        const food = l => String(l).toLowerCase().replace(/^[\d\s/.½¼¾⅓⅔⅛-]+/, '').replace(/^(cups?|oz|scoops?|tbsp|tsp)\s+/, '').trim();
        const want = new Set(added.map(food));
        const lines = (meal.ingredients || []).filter(l => want.has(food(l)));
        if (!lines.length) return null;
        const n = Math.max(1, Number(meal.servings) || people || 1);
        const nut = N.calculate(lines, n).nutrition;
        meal.ingredients = meal.ingredients.filter(l => !want.has(food(l)));
        const steps = new Set((meal.added_steps || []).map(String));
        const stepList = (meal.steps || []).filter(st => steps.has(String(st)));
        meal.steps = (meal.steps || []).filter(st => !steps.has(String(st)));
        const nu = meal.nutrition || {};
        ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].forEach(k => { if (nu[k] != null) nu[k] = Math.max(0, Math.round(((Number(nu[k]) || 0) - (nut[k] || 0)) * 10) / 10); });
        meal.nutrition = nu;
        delete meal._lines;
        return { lines, steps: stepList, nutrition: nut, servings: n };
    }
    // The dish (sized) with its added foods back, for `people` (the add-ons keep their amount a person).
    function withAddOns(dish, extra, people) {
        const out = JSON.parse(JSON.stringify(dish));
        const k = people / extra.servings;
        // Never past the most a person adds (scaling can round 6⅔ oz up to 7).
        const lines = extra.lines.map(l => (Math.abs(k - 1) < 0.01 ? l : scaleLine(l, k))).map(l => {
            const item = U.splitIngredient(l);
            const hit = Object.keys(BOOST_MOST).find(f => String(item.text || '').toLowerCase() === f);
            return hit && item.qty / people > BOOST_MOST[hit] ? `${U.formatAmount(BOOST_MOST[hit] * people, item.unit)} ${item.text}`.trim() : l;
        });
        out.ingredients = (out.ingredients || []).concat(lines);
        out.steps = (out.steps || []).concat(extra.steps);
        const add = N.calculate(lines, people).nutrition;
        const nu = out.nutrition || {};
        ['calories', 'protein_g', 'carbs_g', 'fat_g'].forEach(key => { nu[key] = Math.round((Number(nu[key]) || 0) + (add[key] || 0)); });
        nu.fiber_g = Math.round(((Number(nu.fiber_g) || 0) + (add.fiber_g || 0)) * 10) / 10;
        out.nutrition = nu;
        // The added lines as they now read (the app finds them by their food).
        const food = l => String(l).toLowerCase().replace(/^[\d\s/.½¼¾⅓⅔⅛-]+/, '').replace(/^(cups?|oz|scoops?|tbsp|tsp)\s+/, '').trim();
        ['protein_added', 'fiber_added'].forEach(key => { if (Array.isArray(out[key])) out[key] = out[key].map(a => lines.find(l => food(l) === food(a)) || a); });
        return out;
    }
    // The last check on every plan, whoever made it: a day more than 10% off the calorie target has
    // its furthest-off meal swapped for one that brings it back (from `pools`, never a dish already
    // in the plan, always fitting the slot), then is sized again. Returns the days and what changed.
    function keepToTargets(days, { pools = {}, settings = {}, people = 1, exclude, weekday, tolerance = 0.1, already = [] } = {}) {
        const recent = dishList(already);
        const base = targetsOf(settings);
        const split = splitOf(settings);
        const used = dishList(days.flatMap(d => MEALS.map(m => d && d[m] && d[m].name).filter(Boolean)));
        const changes = [];
        const out = days.map((day, d) => {
            if (!day) return day;
            const targets = Array.isArray(settings.day_kcal) && settings.day_kcal[d] > 0 ? Object.assign({}, base, { kcal: settings.day_kcal[d] }) : base;
            const daySettings = targets === base ? settings : Object.assign({}, settings, { calorie_target: targets.kcal });
            let cur = day;
            for (let round = 0; round < 3; round++) {
                const total = dayTotals(cur).kcal;
                const off = total / targets.kcal - 1;
                if (Math.abs(off) <= tolerance) break;
                // The meal whose calories are furthest from its share, in the direction that's off.
                const meals = MEALS.filter((m, i) => cur[m] && cur[m].nutrition && split[i] > 0 && !cur[m].leftover);
                if (!meals.length) break;
                const worst = meals.map(m => ({ m, ratio: cur[m].nutrition.calories / (targets.kcal * split[MEALS.indexOf(m)]) }))
                    .sort((a, b) => (off > 0 ? b.ratio - a.ratio : a.ratio - b.ratio))[0];
                const want = targets.kcal * split[MEALS.indexOf(worst.m)];
                const limits = slotLimits(settings, worst.m, weekday ? weekday(d) : null);
                const others = MEALS.filter(m => m !== worst.m).map(m => cur[m]).filter(Boolean);
                // Never a source's 4th meal of the week (3 by default) because of a swap.
                const cap = Number(settings.source_cap) > 0 ? Number(settings.source_cap) : 3;
                const bySource = {};
                days.filter((x, i) => i !== d).forEach(x => MEALS.forEach(m => { const y = x && x[m]; if (y) bySource[sourceKey(y)] = (bySource[sourceKey(y)] || 0) + 1; }));
                MEALS.forEach(m => { const y = cur[m]; if (y) bySource[sourceKey(y)] = (bySource[sourceKey(y)] || 0) + 1; });
                const roomFor = r => sourceKey(r) === 'builtin' || sourceKey(r) === sourceKey(cur[worst.m]) || (bySource[sourceKey(r)] || 0) < cap;
                const pick = (pools[worst.m] || []).filter(r => r && r.nutrition && r.nutrition.calories > 0 && !used.has(r.name) && !(exclude && exclude(r)) && roomFor(r) && !slotProblem(r, worst.m, limits)
                    && !others.some(o => mainProtein(o) && mainProtein(o) === mainProtein(r)))
                    .map(r => ({ r, f: want / r.nutrition.calories })).filter(x => x.f >= 0.55 && x.f <= 2)
                    // Recent dishes last; Nourish's own recipes after web and book ones (they're a backup).
                    .sort((a, b) => (recent.has(a.r.name) ? 1 : 0) - (recent.has(b.r.name) ? 1 : 0)
                        || (settings.builtin_mode !== 'mix' ? (a.r.source_id === 'builtin' ? 1 : 0) - (b.r.source_id === 'builtin' ? 1 : 0) : 0)
                        || Math.abs(Math.log(a.f)) - Math.abs(Math.log(b.f)))[0];
                if (!pick) break;
                changes.push(`day ${d + 1}: ${Math.round(total)} kcal against ${targets.kcal}; ${worst.m} "${cur[worst.m].name}" → "${pick.r.name}"`);
                used.add(pick.r.name);
                cur = fitDay(Object.assign({}, cur, { [worst.m]: JSON.parse(JSON.stringify(pick.r)) }), daySettings, people);
            }
            return cur;
        });
        return { days: out, changes };
    }
    function dayTotals(day) {
        const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: { vitd: 0, ca: 0, k: 0, mg: 0 } };
        const add = r => {
            const n = r && r.nutrition;
            if (!n) return;
            t.kcal += n.calories; t.protein += n.protein_g; t.carbs += n.carbs_g; t.fat += n.fat_g; t.fiber += Number(n.fiber_g) || 0;
            if (n.micros) Object.keys(t.micros).forEach(k => { t.micros[k] += Number(n.micros[k]) || 0; });
        };
        MEALS.forEach(m => add(day[m]));
        (Array.isArray(day.snacks) ? day.snacks : []).forEach(add);
        return t;
    }

    // === A WEEKLY CALORIE BUDGET ===
    // Weekly mode: the week's budget is the daily target × 7. "Big days" (a weekday and its calories)
    // get what was set; the other days share what's left evenly. No day goes under 75% of the normal
    // daily target: if the big days would need that, the other days stay at 75% and the week ends up
    // over budget, which the person is shown and must confirm. bigDays: [{ weekday 0–6 (Monday = 0), kcal }];
    // startWeekday: the weekday of the plan's first day. Returns { perDay, budget, floor, planned, overBy, floorHit, message }.
    const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    function weeklyTargets({ target, bigDays = [], startWeekday = 0, days = 7 }) {
        const base = Number(target) || 2000;
        const budget = base * days;
        const floor = Math.round(base * 0.75);
        const big = new Map();
        (bigDays || []).forEach(b => { if (b && b.weekday >= 0 && b.weekday <= 6 && Number(b.kcal) > 0) big.set(Number(b.weekday), Math.round(Number(b.kcal))); });
        const wd = i => (startWeekday + i) % 7;
        const bigTotal = Array.from({ length: days }, (_, i) => big.get(wd(i)) || 0).reduce((a, b) => a + b, 0);
        const others = Array.from({ length: days }, (_, i) => i).filter(i => !big.has(wd(i)));
        let each = others.length ? Math.round((budget - bigTotal) / others.length) : 0;
        const floorHit = others.length > 0 && each < floor;
        if (floorHit) each = floor;
        const perDay = Array.from({ length: days }, (_, i) => big.get(wd(i)) || each);
        const planned = perDay.reduce((a, b) => a + b, 0);
        const overBy = Math.max(0, planned - budget);
        const message = floorHit
            ? `Your big days add up to more than the week can spare: the other days would drop below ${floor} kcal (75% of your ${base} kcal). Nourish keeps them at ${floor} kcal, so this week would be ${overBy} kcal over your budget of ${budget} kcal.`
            : big.size ? `Big days: ${[...big.entries()].map(([d, k]) => `${WEEKDAYS[d]} ${k} kcal`).join(', ')}. The other days get ${each} kcal each, so the week stays at ${budget} kcal.` : '';
        return { perDay, budget, floor, planned, overBy, floorHit, each, message, weekdays: Array.from({ length: days }, (_, i) => WEEKDAYS[wd(i)]) };
    }

    // === PROTEIN IN EVERY MEAL ===
    // A meal short of protein gets a protein food added (and its numbers worked out again), never a
    // protein-less breakfast: a smoothie or oats get protein powder or Greek yogurt, an egg breakfast
    // more eggs or egg whites, a lunch or dinner lean chicken, tofu or tuna. Anything the person
    // avoids, is allergic to or doesn't eat (diet) is never used. `need`: grams of protein per person.
    const BOOST_MOST = { tempeh: 6, 'cooked lentils': 1, eggs: 4, 'egg whites': 1, 'chicken breast': 6, 'firm tofu': 6, 'canned tuna': 5, edamame: 1, 'protein powder': 2, 'greek yogurt': 1.5, 'cottage cheese': 1 };
    const BOOSTERS = {
        sweet: [['protein powder', 'scoop', 24, 'Stir or blend in the protein powder.'], ['greek yogurt', 'cup', 17, 'Serve with the Greek yogurt (stirred in or on the side).'], ['cottage cheese', 'cup', 23, 'Serve with the cottage cheese on the side.']],
        savory: [['eggs', '', 6.3, 'Cook the extra eggs with the rest, or scramble them on the side.'], ['egg whites', 'cup', 26, 'Scramble the egg whites and serve alongside.'], ['cottage cheese', 'cup', 23, 'Serve with the cottage cheese on the side.'], ['greek yogurt', 'cup', 17, 'Serve with the Greek yogurt on the side.']],
        main: [['chicken breast', 'oz', 6.4, 'Season the chicken breast and pan-fry it for 6–7 minutes a side; slice and serve with the dish.'], ['firm tofu', 'oz', 4.9, 'Cube the tofu, pan-fry until golden and add to the dish.'], ['canned tuna', 'oz', 5.4, 'Drain the tuna and serve it on top.'], ['edamame', 'cup', 18, 'Warm the edamame and serve alongside.'], ['tempeh', 'oz', 5.7, 'Slice the tempeh, pan-fry until golden and serve with the dish.'], ['cooked lentils', 'cup', 18, 'Warm the lentils and stir them in or serve alongside.']],
    };
    const SWEET_BREAKFAST_DISH = /\b(smoothie|shake|oat|oats|oatmeal|porridge|granola|muesli|bircher|chia|yogh?urt|parfait|pancakes?|waffles?|crepes?|muffins?|fruit|acai|bowl|toast with (jam|honey|nut))\b/i;
    function boostProtein(meal, need, mealType, people = 1, exclude) {
        if (!meal || !(need > 0.5)) return meal;
        const kind = mealType !== 'breakfast' ? 'main' : SWEET_BREAKFAST_DISH.test(meal.name || '') && !/\b(eggs?|savou?ry|masala|indian|peas|tomato|cheese|spinach|bean|congee|upma|poha)\b/i.test(meal.name || '') ? 'sweet' : 'savory';
        const n = Math.max(1, Number(meal.servings) || people || 1);
        // One added protein food a meal, never two (chicken and tofu in a mango rice bowl): a meal
        // still short gets more of the same food.
        const already = (meal.protein_added || [])[0];
        if (already) {
            const hit = BOOSTERS[kind].concat(BOOSTERS.main, BOOSTERS.sweet, BOOSTERS.savory).find(([food]) => already.indexOf(food) >= 0);
            if (!hit) return meal;
            const [food, unit, perUnit] = hit;
            // The line as it is now (a resized portion changed its amount), found by its food.
            const idx = (meal.ingredients || []).map(String).findIndex(l => l.toLowerCase().indexOf(food) >= 0 && /^[\d½¼¾⅓⅔]/.test(l.trim()));
            if (idx < 0) return meal;
            const now = meal.ingredients[idx];
            const item = U ? U.splitIngredient(now) : null;
            const have = item && item.qty ? item.qty / n : 0;
            const more = unit === 'cup' ? Math.ceil(need / perUnit * 4) / 4 : Math.ceil(need / perUnit);
            // Never more than a sensible amount a person: 4 eggs, 6 oz chicken, 2 scoops, 1½ cups.
            const most = BOOST_MOST[food] || (unit === 'oz' ? 6 : unit === 'cup' ? 1.5 : unit === 'scoop' ? 2 : 4);
            const per = Math.min(most, have + more);
            if (!(per > have)) return meal;
            const qty = per * n;
            const line = `${U ? U.formatQty(qty) : qty}${unit ? ' ' + (unit === 'cup' && qty > 1 ? 'cups' : unit === 'scoop' && qty > 1 ? 'scoops' : unit) : ''} ${food}`.replace(/^1 eggs$/, '1 egg');
            const before = N.calculate([now], n).nutrition, after = N.calculate([line], n).nutrition;
            if (!(after.protein_g > before.protein_g)) return meal;
            const out = JSON.parse(JSON.stringify(meal));
            out.ingredients[idx] = line;
            const nu = out.nutrition || {};
            ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].forEach(k => { if (after[k] != null) nu[k] = Math.round((Number(nu[k]) || 0) - (before[k] || 0) + after[k]); });
            out.nutrition = nu;
            out.protein_added = [line].concat((meal.protein_added || []).slice(1));
            return out;
        }
        // A vegan or vegetarian dish gets a plant protein, never chicken or tuna (whatever the person eats).
        const plantOnly = /\b(vegan|vegetarian|veggie|plant[- ]based|meatless)\b/i.test(meal.name || '');
        for (const [food, unit, perUnit, step] of BOOSTERS[kind]) {
            if (plantOnly && /chicken|tuna|eggs?|egg whites|greek yogurt|cottage cheese/.test(food) && (/vegan|plant/i.test(meal.name || '') || /chicken|tuna/.test(food))) continue;
            // How much, per person, in kitchen amounts: whole eggs, ¼ cups, whole scoops, ounces.
            const units = Math.min(unit === 'cup' ? Math.ceil(need / perUnit * 4) / 4 : Math.ceil(need / perUnit), BOOST_MOST[food] || 4);
            const qty = units * n;
            const line = `${U ? U.formatQty(qty) : qty}${unit ? ' ' + (unit === 'cup' && qty > 1 ? 'cups' : unit === 'scoop' && qty > 1 ? 'scoops' : unit) : ''} ${food}${unit === '' && qty === 1 ? '' : ''}`.replace(/^1 eggs$/, '1 egg');
            if (exclude && exclude({ name: food, ingredients: [line] })) continue;
            const add = N.calculate([line], n);
            if (!(add.nutrition.protein_g > 0)) continue;
            const out = JSON.parse(JSON.stringify(meal));
            out.ingredients = (out.ingredients || []).concat(line);
            out.steps = (out.steps || []).concat(step);
            out.added_steps = (out.added_steps || []).concat(step);
            const nu = out.nutrition || {};
            ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].forEach(k => { if (add.nutrition[k] != null) nu[k] = Math.round((Number(nu[k]) || 0) + add.nutrition[k]); });
            if (add.micros && nu.micros) Object.keys(add.micros).forEach(k => { nu.micros[k] = Math.round(((nu.micros[k] || 0) + add.micros[k]) * 10) / 10; });
            out.nutrition = nu;
            out.protein_added = (out.protein_added || []).concat(line);
            return out;
        }
        return meal;
    }
    // A day made to meet its protein: every meal at least 25 g (breakfast always), the day's target
    // reached by adding protein to the meals with least (up to 40 g each), then the day sized to its
    // calories again. Returns { day, notes } (notes for the log: what was added where and why).
    function balanceProtein(day, settings, people = 1, exclude) {
        const T = targetsOf(settings || {});
        const notes = [];
        let cur = day;
        const meals = () => MEALS.filter(m => cur[m] && cur[m].nutrition && !cur[m].leftover);
        for (let round = 0; round < 3; round++) {
            let changed = false;
            meals().forEach(m => {
                const p = Number(cur[m].nutrition.protein_g) || 0;
                if (p < T.mealProtein.min - 0.5) {
                    const b = boostProtein(cur[m], T.mealProtein.min + (m === 'breakfast' ? 3 : 2) - p, m, people, exclude);
                    if (b !== cur[m]) { notes.push(`${m} "${cur[m].name}": ${Math.round(p)} g protein, under 25 g; added ${b.protein_added[b.protein_added.length - 1]}`); cur = Object.assign({}, cur, { [m]: b }); changed = true; }
                }
            });
            let short = T.protein * 0.97 - dayTotals(cur).protein;
            if (short > 0) {
                meals().sort((a, b) => cur[a].nutrition.protein_g - cur[b].nutrition.protein_g).forEach(m => {
                    if (short <= 0) return;
                    // 40 g a meal, or more when the day's own target needs it (2 g per kg on 1,800 kcal is 170 g).
                    const room = Math.max(T.mealProtein.max, Math.ceil(T.protein / meals().length) + 5) - (Number(cur[m].nutrition.protein_g) || 0);
                    if (room < 5) return;
                    const b = boostProtein(cur[m], Math.min(room, short + 2), m, people, exclude);
                    if (b === cur[m]) return;
                    short -= b.nutrition.protein_g - cur[m].nutrition.protein_g;
                    notes.push(`${m} "${cur[m].name}": the day was short of its ${T.protein} g protein; added ${b.protein_added[b.protein_added.length - 1]}`);
                    cur = Object.assign({}, cur, { [m]: b });
                    changed = true;
                });
            }
            // Every meal already at its 40 g and the day still a little short: the leanest meal gets the rest (up to 15 g).
            if (!changed && short > 0 && short <= 15) {
                const m = meals().sort((a, b) => cur[a].nutrition.protein_g - cur[b].nutrition.protein_g)[0];
                const b = m ? boostProtein(cur[m], short + 2, m, people, exclude) : null;
                if (b && b !== cur[m]) { notes.push(`${m} "${cur[m].name}": the day was short of its ${T.protein} g protein; added ${b.protein_added[0]}`); cur = Object.assign({}, cur, { [m]: b }); changed = true; }
            }
            if (!changed) break;
            cur = fitDay(cur, settings, people);
        }
        // Sizing can shrink a breakfast again: the last word is the 25 g rule (a few kcal over, if so).
        meals().forEach(m => {
            const p = Number(cur[m].nutrition.protein_g) || 0;
            if (p < T.mealProtein.min - 0.5) {
                const b = boostProtein(cur[m], T.mealProtein.min + 1 - p, m, people, exclude);
                if (b !== cur[m]) { notes.push(`${m} "${cur[m].name}": ${Math.round(p)} g protein after sizing; added ${b.protein_added[b.protein_added.length - 1]}`); cur = Object.assign({}, cur, { [m]: b }); }
            }
        });
        return { day: cur, notes };
    }

    // === FIBER, FATS, FISH, VITAMINS AND MINERALS ===
    // Fiber: at least 30 g a day. A day short of it gets a high-fiber food added where it fits:
    // chia seeds or raspberries at breakfast, a side of broccoli or chickpeas at lunch or dinner.
    const FIBER_BOOSTERS = {
        breakfast: [['2 tbsp chia seeds', 'Stir in the chia seeds.'], ['1/2 cup raspberries', 'Top with the raspberries.']],
        main: [['1 cup broccoli', 'Steam the broccoli for 4 minutes and serve on the side.'], ['1/2 cup chickpeas', 'Warm the chickpeas and stir them in or serve alongside.'], ['1 cup spinach', 'Wilt the spinach into the dish at the end.']],
    };
    function addFood(meal, perPersonLine, step, people, key) {
        const n = Math.max(1, Number(meal.servings) || people || 1);
        const item = U ? U.splitIngredient(perPersonLine) : null;
        const line = item && item.qty != null && n > 1 ? `${U.formatQty(item.qty * n)}${item.unit ? ' ' + item.unit : ''} ${item.text}`.replace(/\b(cup|tbsp)\b(?= )/, u => (item.qty * n > 1 && u === 'cup' ? 'cups' : u)) : perPersonLine;
        const add = N.calculate([line], n);
        const out = JSON.parse(JSON.stringify(meal));
        out.ingredients = (out.ingredients || []).concat(line);
        out.steps = (out.steps || []).concat(step);
        out.added_steps = (out.added_steps || []).concat(step);
        const nu = out.nutrition || {};
        ['calories', 'protein_g', 'carbs_g', 'fat_g'].forEach(k => { nu[k] = Math.round((Number(nu[k]) || 0) + (add.nutrition[k] || 0)); });
        nu.fiber_g = Math.round(((Number(nu.fiber_g) || 0) + (add.nutrition.fiber_g || 0)) * 10) / 10;
        if (add.nutrition.micros) { nu.micros = nu.micros || { vitd: 0, ca: 0, k: 0, mg: 0 }; Object.keys(add.nutrition.micros).forEach(k => { nu.micros[k] = Math.round(((Number(nu.micros[k]) || 0) + add.nutrition.micros[k]) * 10) / 10; }); }
        out.nutrition = nu;
        out[key] = (out[key] || []).concat(line);
        return out;
    }
    function balanceFiber(day, settings, people = 1, exclude) {
        const T = targetsOf(settings || {});
        const notes = [];
        let cur = day;
        for (let i = 0; i < 5 && dayTotals(cur).fiber < T.fiber - 0.5; i++) {
            // The meal with the least fiber that can take one more addition.
            const m = MEALS.filter(x => cur[x] && cur[x].nutrition && !cur[x].leftover && (cur[x].fiber_added || []).length < 2)
                .sort((a, b) => (Number(cur[a].nutrition.fiber_g) || 0) - (Number(cur[b].nutrition.fiber_g) || 0))[0];
            if (!m) break;
            const opts = FIBER_BOOSTERS[m === 'breakfast' ? 'breakfast' : 'main'].filter(([line]) => !(exclude && exclude({ name: line, ingredients: [line] })) && !(cur[m].ingredients || []).some(l => l.toLowerCase().includes(line.split(' ').slice(-1)[0])));
            if (!opts.length) break;
            const before = dayTotals(cur).fiber;
            cur = Object.assign({}, cur, { [m]: addFood(cur[m], opts[0][0], opts[0][1], people, 'fiber_added') });
            notes.push(`${m} "${cur[m].name}": the day had ${Math.round(before)} g fiber (aim: at least ${T.fiber} g); added ${opts[0][0]}`);
        }
        return { day: cur, notes };
    }
    // Oil instead of butter or lard for cooking, where the dish allows it (not baking, pastry, a
    // butter sauce, mash or toast). Same amount; the steps say oil too.
    const SOLID_FAT = /\b(unsalted butter|salted butter|butter|lard|shortening|bacon fat|bacon grease|dripping|beef dripping)\b/i;
    const NEEDS_BUTTER = /\b(cakes?|cookies?|biscuits?|scones?|pastry|pastries|pies?|tarts?|crusts?|muffins?|brownies?|croissants?|shortbread|frosting|buttercream|beurre|hollandaise|b[eé]arnaise|roux|b[eé]chamel|mash(ed)?|toast|grilled cheese|pancakes?|waffles?|crumble|crumbs|butter chicken|ghee|garlic butter|brown butter|compound butter|dumplings?|biscuit|cornbread|bread)\b/i;
    function fatSwap(meal) {
        if (!meal || NEEDS_BUTTER.test(meal.name || '')) return meal;
        const steps = (meal.steps || []).join(' ');
        if (/\b(cream (the )?butter|cold butter|softened butter|cut in the butter|rub (in )?the butter|knob of butter to finish|finish with (a )?(knob of )?butter|brush(ed)? with (melted )?butter)\b/i.test(steps) || NEEDS_BUTTER.test(steps)) return meal;
        const idx = (meal.ingredients || []).findIndex(l => SOLID_FAT.test(l) && !/\b(peanut|almond|cashew|nut|apple|cocoa|shea) butter\b/i.test(l));
        if (idx < 0) return meal;
        const old = meal.ingredients[idx];
        const line = old.replace(SOLID_FAT, 'olive oil');
        const before = N.calculate([old], meal.servings || 1).nutrition, after = N.calculate([line], meal.servings || 1).nutrition;
        const out = JSON.parse(JSON.stringify(meal));
        out.ingredients[idx] = line;
        out.steps = (out.steps || []).map(st => st.replace(/\b(melt(ed)? (the )?|heat (the )?)(butter|lard|shortening)\b/gi, (m, a) => `${/melt/i.test(a) ? 'heat the ' : a}olive oil`).replace(/\bthe (butter|lard|shortening)\b/gi, 'the olive oil'));
        const nu = out.nutrition || {};
        ['calories', 'protein_g', 'carbs_g', 'fat_g'].forEach(k => { nu[k] = Math.max(0, Math.round((Number(nu[k]) || 0) - (before[k] || 0) + (after[k] || 0))); });
        out.fat_swapped = `Olive oil instead of ${old.match(SOLID_FAT)[0].toLowerCase()} for cooking (better fats; same amount).`;
        return out;
    }
    const FATTY_FISH = /\b(salmon|mackerel|sardines?|trout|herring|anchov(?:y|ies)|arctic char|sablefish|black cod|kippers?|pilchards?)\b/i;
    const isFattyFish = r => !!r && FATTY_FISH.test(`${r.name || ''} ${(r.ingredients || []).slice(0, 6).join(' ')}`);
    // Ultra-processed shortcuts: whole ingredients come first (protein powder is fine as a tool).
    const PROCESSED = /\b(cake mix|boxed|instant (mashed|noodles|ramen|rice)|cream of (mushroom|chicken|celery) soup|processed cheese|american cheese|velveeta|cheez|hot dogs?|chicken nuggets|fish sticks|frozen (pizza|meal|dinner)|canned soup|ready[- ]made|store[- ]bought (sauce|dough)|bouillon powder|margarine|cool whip|whipped topping|spam|luncheon meat|imitation crab|potato chips|corn chips|soda)\b/gi;
    // The week's vitamin D (µg), calcium, potassium and magnesium (mg) a day, against everyday adult
    // targets; a nutrient under 70% of its target is "low".
    const MICRO_TARGETS = { vitd: 15, ca: 1000, k: 3400, mg: 400 };
    const MICRO_NAMES = { vitd: 'vitamin D', ca: 'calcium', k: 'potassium', mg: 'magnesium' };
    const MICRO_UNITS = { vitd: 'µg', ca: 'mg', k: 'mg', mg: 'mg' };
    const MICRO_FOODS = { vitd: 'oily fish (salmon, sardines, trout), eggs and fortified milk', ca: 'yogurt, milk, cheese, tofu and leafy greens', k: 'beans, potatoes, bananas, spinach and yogurt', mg: 'nuts, seeds, beans, whole grains and leafy greens' };
    function weekMicros(days) {
        const sum = { vitd: 0, ca: 0, k: 0, mg: 0 };
        let n = 0;
        (days || []).forEach(d => { if (!d) return; n++; const t = dayTotals(d); Object.keys(sum).forEach(k => { sum[k] += t.micros[k]; }); });
        const avg = {};
        Object.keys(sum).forEach(k => { avg[k] = n ? Math.round(sum[k] / n * 10) / 10 : 0; });
        const low = Object.keys(MICRO_TARGETS).filter(k => n && avg[k] < MICRO_TARGETS[k] * 0.7);
        return { avg, low, targets: MICRO_TARGETS, names: MICRO_NAMES, units: MICRO_UNITS, foods: MICRO_FOODS };
    }
    // One swap per low nutrient: the meal with least of it is replaced by a recipe from the pools
    // for the same slot that has much more of it, about the same calories, fits the slot and isn't
    // already in the plan. Returns { days, notes, flags } (flags: what's still low, in plain words).
    function fixMicros(days, { pools = {}, settings = {}, people = 1, exclude, weekday } = {}) {
        let out = days.slice();
        const notes = [];
        const used = dishList(out.flatMap(d => MEALS.map(m => d && d[m] && d[m].name).filter(Boolean)));
        // Never more than the week's limit from one source (3 by default) because of a swap.
        const cap = Number(settings.source_cap) > 0 ? Number(settings.source_cap) : 3;
        const perSource = () => { const c = {}; out.forEach(d => MEALS.forEach(m => { const x = d && d[m]; if (x) { const k = sourceKey(x); c[k] = (c[k] || 0) + 1; } })); return c; };
        weekMicros(out).low.forEach(k => {
            const counts = perSource();
            const per = r => ((r.nutrition && r.nutrition.micros && Number(r.nutrition.micros[k])) || 0) / Math.max(1, (r.nutrition && r.nutrition.calories) || 1);
            let best = null;
            out.forEach((d, i) => MEALS.forEach(m => {
                const cur = d && d[m];
                if (!cur || !cur.nutrition || cur.leftover) return;
                const limits = slotLimits(settings, m, weekday ? weekday(i) : null);
                (pools[m] || []).forEach(r => {
                    if (!r || !r.nutrition || used.has(r.name) || (exclude && exclude(r)) || slotProblem(r, m, limits)) return;
                    if ((counts[sourceKey(r)] || 0) >= cap && sourceKey(r) !== sourceKey(cur)) return;
                    const f = cur.nutrition.calories / r.nutrition.calories;
                    if (f < 0.75 || f > 1.33) return;
                    const gain = (per(r) - per(cur)) * cur.nutrition.calories;
                    if (gain > 0 && (!best || gain > best.gain)) best = { gain, i, m, r };
                });
            }));
            if (!best || best.gain < MICRO_TARGETS[k] * 0.1) return;
            const old = out[best.i][best.m];
            // Sized to that day's own calories (a big day in Weekly mode keeps its target).
            const daySettings = Array.isArray(settings.day_kcal) && settings.day_kcal[best.i] > 0 ? Object.assign({}, settings, { calorie_target: settings.day_kcal[best.i] }) : settings;
            out[best.i] = fitDay(Object.assign({}, out[best.i], { [best.m]: JSON.parse(JSON.stringify(best.r)) }), daySettings, people);
            used.add(best.r.name);
            notes.push(`The week was low in ${MICRO_NAMES[k]}: day ${best.i + 1} ${best.m} "${old.name}" swapped for "${best.r.name}" (about ${Math.round(best.gain)} ${MICRO_UNITS[k]} more)`);
        });
        const after = weekMicros(out);
        const flags = after.low.map(k => `Low in ${MICRO_NAMES[k]} this week (about ${after.avg[k]} ${MICRO_UNITS[k]} a day; aim for ${MICRO_TARGETS[k]}). ${MICRO_FOODS[k].charAt(0).toUpperCase() + MICRO_FOODS[k].slice(1)} help.`);
        return { days: out, notes, flags, micros: after };
    }

    // Every rule for one day, in order (app.js runs this on every plan, whoever made it): oil instead
    // of butter or lard where the dish allows, at least 30 g fiber, then protein (every main meal 25 g
    // or more, the day's target met) with the day sized to its calories. Returns { day, notes }.
    function applyDayRules(day, settings, people = 1, exclude, { fatSwapOn = true } = {}) {
        const notes = [];
        let cur = Object.assign({}, day);
        if (fatSwapOn) MEALS.forEach(t => {
            const m = cur[t];
            const swapped = m && !m.fat_swapped ? fatSwap(m) : m;
            if (swapped !== m) { cur[t] = swapped; notes.push(`${t} "${m.name}": ${swapped.fat_swapped}`); }
        });
        const fiber = balanceFiber(cur, settings, people, exclude);
        notes.push(...fiber.notes);
        const protein = balanceProtein(fiber.day, settings, people, exclude);
        notes.push(...protein.notes);
        // Adding protein can shrink a portion, and the day's fiber with it: checked once more.
        let again = balanceFiber(protein.day, settings, people, exclude);
        notes.push(...again.notes);
        // What was added has calories: a day now more than 5% over its target is sized again (whole,
        // half or quarter portions), then protein and fiber are checked one last time.
        const kcal = targetsOf(settings || {}).kcal;
        for (let round = 0; round < 3 && kcal > 0 && dayTotals(again.day).kcal > kcal * 1.05; round++) {
            const resized = fitDay(again.day, settings, people);
            const p2 = balanceProtein(resized, settings, people, exclude);
            const f2 = balanceFiber(p2.day, settings, people, exclude);
            notes.push(...p2.notes, ...f2.notes);
            again = f2;
        }
        return { day: again.day, notes };
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
    // extra: more snack candidates (sides, drinks and desserts from the person's books), on equal terms.
    function addSnacks(day, settings, d, people = 1, exclude, extra = []) {
        const n = snacksOf(settings);
        delete day.snacks;
        if (!n) return day;
        const kcal = targetsOf(settings).kcal * SNACK_SHARE;
        // Every snack has some protein (at least 5 g as served), and nothing expensive (dinner only).
        const ok = SNACKS.map(snackRecipe).concat((extra || []).filter(r => r && r.nutrition && r.nutrition.calories >= 60 && r.nutrition.calories <= 450))
            .filter(r => r.nutrition.calories > 0 && !(exclude && exclude(r)) && !pricey(r)
                && (Number(r.nutrition.protein_g) || 0) * Math.max(0.5, Math.min(2, kcal / r.nutrition.calories)) >= 5);
        if (!ok.length) return day;
        const snacks = [];
        for (let i = 0; i < n; i++) {
            const r = ok[(d * n + i) % ok.length];
            if (snacks.some(x => x.name === r.name)) continue;
            snacks.push(scaleRecipe(r, snapPortion(Math.max(0.5, Math.min(2, kcal / r.nutrition.calories))), people));
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
        const names = dishList(taken);
        const ok = (QUICK_MEALS[meal] || []).map(q => quickRecipe(q, meal))
            .filter(r => r.nutrition.calories > 0 && !(exclude && exclude(r)) && !names.has(r.name) && !slotProblem(r, meal, limits));
        return ok.length ? ok[d % ok.length] : null;
    }

    function normName(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|best|easy|healthy|quick|recipe|my|simple|homemade)\b/g, '').replace(/\s+/g, ' ').trim(); }

    // === THE SAME DISH ===
    // Never the same meal twice: "Gochujang Chicken Bowls" (one site), "Easy Gochujang Chicken Rice
    // Bowl" (another) and "Chicken Gochujang Bowl" are one dish. A dish's words, without filler
    // ("easy", "best", "30-minute", "sheet pan", "recipe") and plurals, in any order; two names are
    // the same dish when they share at least three quarters of their words.
    const DISH_FILLER = new Set(('the a an and with of in on for or to my our your best easy easiest healthy healthier quick quickest simple homemade recipe recipes ultimate perfect ' +
        'favorite favourite classic super really amazing delicious skinny lighter light minute minutes min mins hour one pot pan sheet instant air fryer slow cooker crockpot crock ' +
        'style version copycat weeknight family meal prep make ahead leftover leftovers lunch dinner breakfast day').split(/\s+/));
    const dishCache = new Map();
    function dishWords(name) {
        const key = String(name || '');
        if (dishCache.has(key)) return dishCache.get(key);
        const words = key.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
            .filter(w => w && !/^\d+$/.test(w) && !DISH_FILLER.has(w))
            .map(w => (w.length > 3 && /ies$/.test(w) ? w.slice(0, -3) + 'y' : w.length > 3 && /(ches|shes|oes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
        const out = [...new Set(words)];
        if (dishCache.size > 5000) dishCache.clear();
        dishCache.set(key, out);
        return out;
    }
    function dishKey(name) { return dishWords(name).slice().sort().join(' '); }
    function sameDish(a, b) {
        const x = dishWords(a), y = dishWords(b);
        if (!x.length || !y.length) return normName(a) === normName(b);
        const ys = new Set(y);
        const both = x.filter(w => ys.has(w)).length;
        return both / (x.length + y.length - both) >= 0.75;
    }
    // A list of dishes to check new ones against (the plan so far, recent plans).
    function dishList(names) {
        const list = [];
        const keys = new Set();
        const api = {
            add(name) { if (!name) return api; list.push(name); keys.add(dishKey(name)); return api; },
            has(name) { return !!name && (keys.has(dishKey(name)) || list.some(n => sameDish(n, name))); },
            names: () => list.slice(),
        };
        (names || []).forEach(n => api.add(n));
        return api;
    }

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
    // Real dish words a spell-check must never "correct" ("Mapo Tofu" became "Mayo Tofu" in 0.1.10,
    // and then wasn't recognised as already in the plan).
    const KEEP_WORDS = 'mapo lemony garlicky herby zesty smoky cheesy bulgogi bibimbap japchae tteokbokki kimbap gyudon katsu donburi okonomiyaki yakisoba udon ramen soba pho banh larb laksa rendang nasi goreng satay pozole posole birria chilaquiles tamales tostadas elote shakshuka harissa tagine mujadara fattoush tabbouleh shawarma kofta falafel halloumi spanakopita moussaka souvlaki tzatziki gnocchi orzo farro freekeh dhal chana paneer saag pakora biryani khichdi upma poha idli dosa congee jook arroz habichuelas guisadas sofrito mofongo pastelon picadillo ropa vieja'.split(' ');
    function fixName(name) {
        const vocab = new Set(DISH_WORDS.concat(KEEP_WORDS));
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

    const api = { applyDayRules, weeklyTargets, WEEKDAYS, balanceFiber, fatSwap, isFattyFish, weekMicros, fixMicros, MICRO_TARGETS, PROCESSED, boostProtein, balanceProtein, pricey, FIBER_TARGET, MEAL_PROTEIN, sourceKey, budgetProblem, goalCost, LUXURY, stepMinutes, keepToTargets, sizeMeals, portionOptions, snapPortion, PORTIONS, quickMeal, QUICK_MEALS, recipeProfile, slotLimits, slotProblem, slotPenalty, timeAllowed, scheduleChoice, SLOT_DEFAULTS, countIngredients, fitDay, lighten, addSnacks, mealsOf, snacksOf, SNACKS, mealFit, mainProtein, mainVeg, cuisineOf, flavorCheck, reseason, trimRich, scaleRecipe, scaleLine, splitOf, targetsOf, planWeek, dayTotals, fixName, normName, adapt, substituteFor, SUBS, dishWords, dishKey, sameDish, dishList, SPLITS, MEALS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishPlanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
