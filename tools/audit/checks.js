// The plan audit's checks: every meal of a finished plan, judged with the audit's own lists and
// rules (not only the app's, so the audit can catch what the app misses). Each finding is
// { check, severity: 'fail' | 'note', day, slot, name, detail }. A plan is clean when it has no
// 'fail'. Notes are things worth knowing that aren't wrong (a disclosed protein top-up at breakfast).
'use strict';
const PL = require('../../planner.js');
const N = require('../../nutrition.js');
const U = require('../../units.js');
const P = require('../../prefs.js');
const F = require('../../finder.js');
const O = require('../../ondevice.js');

const MEALS = PL.MEALS;
const CHECKS = {
    'not-a-meal': 'Not really a meal (appetizer, side, spread, drink, dessert, sauce or article)',
    'wrong-slot': 'Wrong meal slot (a dinner dish at breakfast or lunch, or too slow or too involved for the slot)',
    'nutrition': 'Implausible nutrition for the main ingredient (wrong food matched, or not counted)',
    'added': 'Ingredients the app added to make a recipe pass',
    'discarded': 'Discarded ingredients counted (brine, soaking water, frying oil)',
    'bone-in': 'Bone-in or shell-on food counted by its whole weight instead of the edible part',
    'repeats': 'A dish twice, or more than 3 meals from one source',
    'luxury': 'Luxury ingredient, or an expensive one outside dinner',
    'description': 'Description cut off, invented, or not describing the dish',
    'title': 'Chopped or broken title',
    'servings': 'Odd serving numbers or amounts (like 1.31)',
    'day-totals': 'Daily totals outside the target range, or an empty slot',
    'avoided': 'An avoided food or allergen present',
    'builtin': "Too many of Nourish's own recipes when web or book recipes were available",
};

// === The audit's own word lists ===
const APPETIZER = /\b(bone marrow|marrow bones?|appeti[sz]ers?|starters?|small plates?|tapas|mezze|meze|canap[eé]s?|crostini|bruschetta|p[aâ]t[eé]s?|terrines?|rillettes|deviled eggs|devilled eggs|nibbles|hors d'?oeuvres?|amuse[- ]bouche|finger food|party food)\b/i;
const SPREAD = /\b(hummus|houmous|guacamole|dips?|spreads?|tapenade|baba ganou?sh|tzatziki|salsa|pesto|aioli|compound butter|herb butter|nut butter|queso)\b/i;
const DRINK = /\b(tea|iced tea|sweet tea|coffee|latte|cappuccino|cocktails?|mocktails?|lemonade|limeade|coolers?|punch|sangria|spritz(er)?|juice|lassi|horchata|milkshakes?|agua fresca|hot chocolate|cocoa|kombucha|margaritas?|mojitos?|martinis?|negroni|old fashioned|eggnog|cider|refreshers?|slush(ie|y)?)\b/i;
const DESSERT = /\b(cakes?|cupcakes?|cookies?|brownies?|blondies?|fudge|candy|candies|cheesecakes?|tarts?|ice cream|sorbet|gelato|truffles?|macarons?|meringues?|tiramisu|mousse|puddings?|cobblers?|crumbles?|custards?|panna cotta|cr[eè]me br[uû]l[eé]e|doughnuts?|donuts?|cinnamon rolls?|sweet rolls?|desserts?|sundaes?|parfaits? \(dessert\)|lava cakes?|pies?)\b/i;
const NOT_DESSERT = /\b(pot pies?|shepherd'?s pie|cottage pie|chicken pie|meat pie|pork pie|fish pie|savou?ry|crab cakes?|fish cakes?|salmon cakes?|tuna cakes?|rice cakes?|potato cakes?|pancakes?|chia pudding|protein pudding|yorkshire pudding|black pudding|bread pudding|corn pudding|tamale pie|frito pie|pizza pie)\b/i;
const SAUCE = /\b(sauces?|dressings?|vinaigrettes?|gravy|chimichurri|marinades?|rubs?|seasonings?|spice (mix|blend)|stocks?|broths?|syrups?|jams?|jellies|chutneys?|relish|pickles?|condiments?|mayonnaise|ketchup|hot sauce|chili oil|chili crisp)$/i;
const SIDE_WORDS = /\b(side|sides|side dish|accompaniments?|to serve alongside)\b/i;
const ARTICLE = /^(how to|a guide|the guide|guide to|tips|\d+\s+(ways|tips|ideas|recipes|things))|\b(guide|101|tips|ideas|round-?up|meal plan)$/i;
const MEAL_WORDS = /\b(salad|soup|stew|chili|curry|bowl|wrap|sandwich|burger|tacos?|burrito|quesadilla|pasta|noodles?|rice|risotto|pilaf|grain|lentils?|beans?|chickpeas?|omelet+e?|frittata|eggs|oats|oatmeal|porridge|pancakes?|toast|stir[- ]?fry|casserole|bake|pie|pizza|skillet|traybake|sheet[- ]pan|dumplings?)\b/i;
const VEG_OR_STARCH = /\b(potato(es)?|green beans|beans|carrots?|broccoli|cauliflower|asparagus|brussels sprouts|spinach|kale|zucchini|squash|corn|peas|mushrooms?|onions?|cabbage|slaw|coleslaw|fries|chips|bread|garlic bread|rolls|biscuits|cornbread|rice|couscous|polenta)\b/i;
const PROTEIN_WORDS = /\b(chicken|beef|pork|lamb|turkey|duck|veal|venison|fish|salmon|tuna|cod|halibut|tilapia|trout|shrimp|prawns?|scallops?|crab|lobster|mussels|clams|sausages?|bacon|ham|steak|ribs|tofu|tempeh|seitan|eggs?|lentils?|chickpeas?|beans|edamame|paneer|halloumi|cheese)\b/i;
// Dishes for dinner, not breakfast or lunch (long, heavy or special).
const DINNER_DISH = /\b(ribs|short ribs?|pot roast|roast (chicken|turkey|beef|pork|lamb|duck)|roasted (chicken|turkey|lamb|pork|beef|duck)|whole (chicken|turkey|fish)|braised?|braise|stew|rack of lamb|lamb (shanks?|shoulder|leg)|leg of lamb|fried chicken|brisket|pulled pork|osso buco|lasagna|lasagne|casserole|bone marrow|beef wellington|prime rib|chops?|steaks?)\b/i;
const LUXURY = /\b(wagyu|kobe|caviar|truffles?(?! (cake|brownies?|balls?))|truffle oil|foie gras|lobster|langoustines?|king crab|abalone|sea urchin|uni\b|saffron|iberico|ib[eé]rico|bluefin|toro|morels?|dry[- ]aged|gold leaf)\b/i;
const PRICEY = /\b(steaks?|rib[- ]?eye|filet mignon|tenderloin steak|sirloin|porterhouse|t-bone|tomahawk|rack of lamb|racks? of lamb|lamb chops?|lamb|veal|venison|scallops?|crab(meat)?|lobster|duck breast|halibut|sea bass|swordfish)\b/i;
// Foods whose name changes what they are (a "bone" line isn't steak, a "marrow" line isn't beef).
const NOUNS = /\b(marrow|bones?|ribs?|liver|livers|kidneys?|hearts?|tongue|tripe|oxtails?|cheeks?|shanks?|hocks?|trotters?|feet|necks?|gizzards?|suet|belly)\b/gi;
const BONY = /\b(bone[- ]in|on the bone|shell[- ]on|in (the |their )?shells?|head[- ]on|whole (chicken|turkey|duck|fish|branzino|trout|snapper|bass)|marrow bones?|ribs|spare ?ribs|short ribs?|back ?ribs|rack of|racks? of|wings?|drumsticks?|leg quarters?|chicken legs?|shanks?|oxtails?|hocks?|t-bone|porterhouse|tomahawk|crab legs?|lobsters?\b(?! (meat|tails? meat))|mussels|clams|oysters)\b/i;
const NOT_BONY = /\b(boneless|bone[- ]free|peeled|shelled|meat\b|fillets?|filets?|ground|minced|cooked .* meat|picked)\b/i;
const ALLERGENS = {
    nuts: /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?|nuts?|praline|marzipan|nutella)\b/i,
    peanuts: /\b(peanuts?|peanut butter|groundnuts?)\b/i,
    dairy: /\b(milk|cheese|cheddar|mozzarella|parmesan|feta|ricotta|butter(?!milk squash)|buttermilk|cream|yogh?urt|ghee|whey|casein|gruy[eè]re|paneer|halloumi|mascarpone|quark|kefir)\b/i,
    gluten: /\b(flour|bread|breadcrumbs|panko|pasta|spaghetti|macaroni|noodles|couscous|bulgur|barley|rye|wheat|seitan|pitas?|tortillas?(?! \(corn\))|buns?|bagels?|crackers?|croutons|beer|soy sauce|farro|semolina|orzo)\b/i,
    shellfish: /\b(shrimp|prawns?|crab|lobster|scallops?|mussels|clams|oysters|langoustines?|crayfish)\b/i,
    fish: /\b(fish|salmon|tuna|cod|halibut|tilapia|trout|sardines?|anchov(y|ies)|mackerel|haddock|snapper|bass|swordfish|fish sauce)\b/i,
    eggs: /\b(eggs?|egg whites?|egg yolks?|mayonnaise|mayo|meringue)\b/i,
    soy: /\b(soy|soya|tofu|tempeh|edamame|miso|soy sauce|tamari)\b/i,
    sesame: /\b(sesame|tahini)\b/i,
};
const MEAT = /\b(chicken|beef|pork|lamb|turkey|duck|veal|venison|bacon|ham|sausages?|chorizo|salami|pepperoni|prosciutto|pancetta|steak|ribs|mince|gelatin|lard|bone marrow|marrow bones?|anchov(y|ies)|fish sauce)\b/i;
const SEAFOOD = /\b(fish|salmon|tuna|cod|halibut|tilapia|trout|sardines?|mackerel|shrimp|prawns?|crab|lobster|scallops?|mussels|clams|oysters)\b/i;
const ANIMAL = /\b(eggs?|milk|cheese|butter|cream|yogh?urt|honey|ghee|whey|mayonnaise)\b/i;

// === Helpers ===
const own = m => {
    // The recipe's own ingredients: without what the app added to meet a rule.
    const added = new Set([].concat(m.protein_added || [], m.fiber_added || []));
    return (m.ingredients || []).filter(l => !added.has(l));
};
const kcalOf = n => Number(n && n.calories) || 0;
function textOf(m) { return `${m.name || ''} ${(m.ingredients || []).join(' ')}`; }
function dishPart(name) { return String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+(with|in|on|over|served with|and a side of)\s+.*$/i, '').trim(); }
// Grams the line says it weighs before trimming (a weight in its amount, or in brackets).
function statedGrams(line) {
    const it = U.splitIngredient(String(line));
    const G = { lb: 453.6, oz: 28.35, g: 1, kg: 1000 };
    if (it.qty != null && G[it.unit]) return it.qty * G[it.unit];
    const m = String(line).match(/\((?:about|approx\.?|around)?\s*([\d\s/.½¼¾⅓⅔]+?)\s*(pounds?|lbs?|ounces?|oz|grams?|g|kilograms?|kg)\b(\s+each)?/i);
    if (!m) return null;
    const pn = U.parseNumber(m[1].trim()); const n = pn ? pn.value : 0;
    if (!(n > 0)) return null;
    const unit = /^(pound|lb)/i.test(m[2]) ? 453.6 : /^(ounce|oz)/i.test(m[2]) ? 28.35 : /^k/i.test(m[2]) ? 1000 : 1;
    return n * unit * (m[3] && it.qty ? it.qty : 1);
}
function portionOf(m) { return m.scaled && Number(m.scaled.portion) > 0 ? Number(m.scaled.portion) : 1; }

function checkMeal(m, slot, ctx, add) {
    const name = m.name || '';
    const dish = dishPart(name);
    const cat = String(Array.isArray(m.category) ? m.category.join(' ') : m.category || '');
    const steps = (m.steps || []).join(' ');
    const n = m.nutrition || {};
    const kcal = kcalOf(n);
    const calc = N.calculate(own(m), m.servings || 1, { steps: m.steps });
    const pShare = kcal > 0 ? (Number(n.protein_g) || 0) * 4 / kcal : 0;
    const fShare = kcal > 0 ? (Number(n.fat_g) || 0) * 9 / kcal : 0;

    // --- Not really a meal ---
    const why = [];
    if (ARTICLE.test(name)) why.push('an article or guide');
    if (APPETIZER.test(dish) || (/\b(appeti[sz]ers?|starters?|small plates?|tapas|mezze|snacks?|nibbles)\b/i.test(cat) && !/\b(main|dinner|lunch|breakfast|brunch|entr[eé]e)\b/i.test(cat)) || /\b(as an? (appeti[sz]er|starter|snack|dip|spread)|spread (it )?on (the )?toast)\b/i.test(steps)) why.push('an appetizer or small plate');
    if (SPREAD.test(dish) && !MEAL_WORDS.test(dish)) why.push('a spread or dip');
    if (DRINK.test(dish) && !/\b(smoothie bowl|tea[- ]smoked|tea eggs?)\b/i.test(dish) && !MEAL_WORDS.test(dish)) why.push('a drink');
    if (DESSERT.test(dish) && !NOT_DESSERT.test(dish) && !(slot === 'breakfast' && /\b(pancakes?|muffins?)\b/i.test(dish))) why.push('a dessert');
    if (SAUCE.test(dish)) why.push('a sauce or condiment');
    if (SIDE_WORDS.test(cat) && !/\b(main|dinner|lunch|breakfast)\b/i.test(cat)) why.push('a side dish (its category)');
    if (/\bas a side( dish)?\b|\bside dish\b/i.test(steps) && !PROTEIN_WORDS.test(dish)) why.push('a side dish (its steps say so)');
    if (slot !== 'breakfast' && VEG_OR_STARCH.test(dish) && !PROTEIN_WORDS.test(textOf(m).replace(/\b(green |string )beans\b/gi, '')) && !MEAL_WORDS.test(dish.replace(/\b(beans|rice)\b/gi, ''))) why.push('a vegetable or starch side with no protein');
    if (slot !== 'breakfast' && kcal > 0 && pShare < 0.08 && fShare > 0.6) why.push(`mostly fat (${Math.round(fShare * 100)}% of its calories) with little protein: a spread or appetizer`);
    if (F.notAMeal(m)) why.push(`the app's own check says ${F.notAMeal(m)}`);
    const fit = PL.mealFit(m);
    if (!fit.breakfast && !fit.lunch && !fit.dinner) why.push(`the app's own check says ${fit.why || 'not a meal'}`);
    if (why.length) add('not-a-meal', 'fail', `${[...new Set(why)].join('; ')}`);

    // --- Wrong slot ---
    const prof = PL.recipeProfile(m);
    const limits = PL.slotLimits(ctx.settings, slot, ctx.weekday);
    if (slot !== 'dinner' && DINNER_DISH.test(dish)) add('wrong-slot', 'fail', `a dinner dish ("${dish}") at ${slot}`);
    if (!prof.fits[slot]) add('wrong-slot', 'fail', `the app's own meal type says it isn't a ${slot} (${prof.mealType})`);
    const allowed = PL.timeAllowed(limits);
    if (prof.minutes > allowed) add('wrong-slot', 'fail', `takes about ${prof.minutes} min; ${slot} allows ${isFinite(allowed) ? allowed : 'any'}`);
    if (slot !== 'dinner' && prof.difficulty > 6 && limits.choice !== 'norush') add('wrong-slot', 'fail', `"Involved" (difficulty ${prof.difficulty} of 10) at ${slot}`);

    // --- Nutrition: the right food, counted ---
    const unmatched = calc.unmatched || [];
    unmatched.forEach(l => {
        const g = statedGrams(l);
        if ((g && g >= 100) || (PROTEIN_WORDS.test(l) && !N.isMinor(l))) add('nutrition', 'fail', `"${l}" isn't counted at all (the calculator can't read it)`);
    });
    calc.lines.forEach(x => {
        if (!x.key) return;
        const hit = N.matchFood(x.line);
        const phrase = hit ? hit.phrase : x.key;
        const words = String(U.splitIngredient(x.line).text || x.line).toLowerCase().replace(/\b(lettuce|romaine|palm|artichoke|celery|cabbage|little gem|gem)( lettuce)? hearts?\b|\bhearts? of (palm|romaine|lettuce|artichoke)\b|\b(celery|chard) ribs?\b|\b(rice|pasta|soup|chicken) bones? broth\b/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/,.*$/, '').replace(/\b(bone|shell|skin|head)[- ](in|on)\b/g, ' ').replace(/\bboneless\b|\bskinless\b/g, ' ');
        const nouns = (words.match(NOUNS) || []).map(w => w.toLowerCase().replace(/s$/, ''));
        const covered = `${phrase} ${x.key}`.toLowerCase();
        const missing = nouns.filter(w => covered.indexOf(w) < 0 && !(w === 'breast' && /chicken|turkey|duck/.test(covered)) && !(w === 'thigh' && /chicken/.test(covered)));
        if (missing.length && x.kcal > 15) add('nutrition', 'fail', `"${x.line}" is counted as ${x.key} (it's ${missing.join(', ')})`);
    });
    if (kcal > 0) {
        const per = { kcal, p: Number(n.protein_g) || 0, c: Number(n.carbs_g) || 0, f: Number(n.fat_g) || 0 };
        const fromMacros = per.p * 4 + per.c * 4 + per.f * 9;
        if (Math.abs(fromMacros - kcal) / kcal > 0.25) add('nutrition', 'fail', `calories (${kcal}) don't match its macros (${Math.round(fromMacros)} kcal from P/C/F)`);
        if (/\bmarrow\b/i.test(dish) && fShare < 0.55) add('nutrition', 'fail', `bone marrow is almost pure fat, but only ${Math.round(fShare * 100)}% of the calories are fat (${per.p} g protein)`);
        if (/\b(ribs|short ribs?)\b/i.test(dish) && (fShare < 0.3 || per.p < 10)) add('nutrition', 'fail', `ribs with ${Math.round(fShare * 100)}% fat and ${per.p} g protein`);
        if (/\bfried\b|\bdeep[- ]fried\b|\bbattered\b/i.test(dish) && kcal / portionOf(m) > 1400) add('nutrition', 'fail', `${Math.round(kcal / portionOf(m))} kcal a serving: the frying oil was counted as eaten`);
        if (kcal / portionOf(m) > 1700) add('nutrition', 'fail', `${Math.round(kcal / portionOf(m))} kcal in one serving of the recipe`);
        if (per.p / portionOf(m) > 110) add('nutrition', 'fail', `${Math.round(per.p / portionOf(m))} g protein in one serving`);
        // The dish's main protein (by its name) must be counted.
        const main = (dish.match(/\b(chicken|beef|pork|lamb|turkey|salmon|shrimp|cod|tuna|fish|ribs|steak|sausages?|tofu|lentils?)\b/i) || [])[1];
        if (main && !calc.lines.some(x => x.key && new RegExp(`\\b${main.replace(/s$/, '')}`, 'i').test(`${x.line} ${x.key}`) && x.kcal > 0)) add('nutrition', 'fail', `the dish is ${main}, but no ${main} is counted in its nutrition`);
    }

    // --- Added by the app ---
    const pAdded = m.protein_added || [];
    if (pAdded.length) {
        const addedCalc = N.calculate(pAdded, m.servings || 1);
        const addedP = addedCalc.nutrition.protein_g;
        const ownP = (Number(n.protein_g) || 0) - addedP;
        const dishMain = PL.mainProtein(Object.assign({}, m, { ingredients: own(m), _lines: undefined }));
        const addedMain = PL.mainProtein({ ingredients: pAdded, servings: m.servings || 1 });
        if (slot !== 'breakfast' && ownP < 15) add('added', 'fail', `only ${Math.round(ownP)} g protein of its own; the app added ${pAdded.join(', ')} to make it pass`);
        else if (slot === 'breakfast' && ownP < 8) add('added', 'fail', `only ${Math.round(ownP)} g protein of its own; the app added ${pAdded.join(', ')} to make it pass`);
        else if (addedP > ownP) add('added', 'fail', `more of its protein is added (${pAdded.join(', ')}: ${Math.round(addedP)} g) than its own (${Math.round(ownP)} g)`);
        else if (slot !== 'breakfast' && dishMain && addedMain && dishMain !== addedMain) add('added', 'fail', `${addedMain} added to a ${dishMain} dish (${pAdded.join(', ')})`);
        else add('added', 'note', `protein top-up: ${pAdded.join(', ')} (+${Math.round(addedP)} g; ${Math.round(ownP)} g of its own)`);
    }
    if ((m.fiber_added || []).length) add('added', 'note', `fiber added: ${m.fiber_added.join(', ')}`);

    // --- Discarded ingredients ---
    const brined = /\b(brine|brining|brined)\b/i.test(steps);
    calc.lines.forEach(x => {
        const l = String(x.line);
        const it = U.splitIngredient(l);
        const isOil = /\b(oil|lard|shortening|fat)\b/i.test(l);
        const frying = isOil && (/\bfor (deep[- ]?)?frying\b|\bto fry\b|\bdeep[- ]?fry/i.test(l) || (/\bdeep[- ]?fr(y|ied|ying)\b/i.test(steps) && it.qty != null && /^(cup|quart|pint|l|ml)$/.test(it.unit) && (it.unit !== 'cup' || it.qty >= 1)));
        if (frying && x.kcal > 150) add('discarded', 'fail', `"${l}" counted as ${x.kcal} kcal a serving (frying oil is mostly left in the pot)`);
        const packed = /\b(in|packed in|canned in) brine\b/i.test(l);
        const brineLine = !packed && (/\bfor (the )?(brine|brining|soaking)\b|^brine:/i.test(l) || (brined && /\b(water|salt)\b/i.test(l) && /\b(cups?|quarts?|gallons?|liters?|litres?)\b/i.test(l) && /\b(dissolve|brine)\b/i.test(steps))) || (brined && /\b(sugar|honey|molasses|maple)\b/i.test(l) && /\b(dissolve|stir)[^.]*\b(sugar|honey)\b[^.]*\b(water|brine)\b|\b(sugar|honey)\b[^.]*\binto the water\b/i.test(steps) && !/\b(rub|glaze|sauce)\b/i.test(l));
        if (brineLine && x.kcal > 5) add('discarded', 'fail', `"${l}" counted as ${x.kcal} kcal a serving, but it's in the brine, which is thrown away`);
    });

    // --- Bone-in, shell-on ---
    calc.lines.forEach(x => {
        const l = String(x.line);
        if (!BONY.test(l) || NOT_BONY.test(l.replace(/\bbone[- ]in\b|\bshell[- ]on\b/gi, ''))) return;
        const stated = statedGrams(l);
        if (stated && x.grams >= stated * 0.92) add('bone-in', 'fail', `"${l}" counted as ${Math.round(x.grams)} g of ${x.key}: the whole weight, bones or shells included`);
    });

    // --- Luxury ---
    if (ctx.settings.budget !== 'any') { const lux = textOf(m).match(LUXURY); if (lux) add('luxury', 'fail', `luxury ingredient: ${lux[0].toLowerCase()}`); }
    if (slot !== 'dinner') { const p = textOf(m).match(PRICEY); if (p) add('luxury', 'fail', `${p[0].toLowerCase()} at ${slot} (expensive: dinner only)`); }

    // --- Description ---
    const d = String(m.description || '').trim();
    if (!d) add('description', 'fail', 'no description');
    else {
        const problem = O.descriptionProblem(d, m);
        if (problem && (m.description_made || /cut off|too short/.test(problem))) add('description', 'fail', `"${d}": ${problem}`);
        const invented = inventedFood(d, m);
        if (invented) add('description', 'fail', `"${d}": mentions ${invented}, which isn't in the recipe`);
        if (/\b(recipe video|jump to|click|subscribe|this post|affiliate|pin (it|this)|scroll down|printable)\b/i.test(d)) add('description', 'fail', `"${d}": website text, not a description of the dish`);
        if (/\b\d+(\.\d+)?\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|pounds?|lbs?|oz|ounces?|grams?|g|kg|gallons?|quarts?|pints?|liters?|litres?|ml)\b|\b(gallons?|quarts?|pints?)\b/i.test(d)) add('description', 'fail', `"${d}": reads like an ingredient list (amounts and units)`);
        if (/\b(brine|kosher salt|sea salt|for (deep )?frying|cold water|gallon)\b/i.test(d) || (m.description_made && /\b(water|ice)\b/i.test(d))) add('description', 'fail', `"${d}": mentions water, salt, brine or frying oil, not the dish`);
        const foodWords = new Set(`${name} ${own(m).join(' ')}`.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3));
        if (!d.toLowerCase().split(/[^a-z]+/).some(w => w.length > 3 && foodWords.has(w))) add('description', 'fail', `"${d}": doesn't mention anything in the dish`);
        if (d.length < 25) add('description', 'fail', `"${d}": too short to describe the dish`);
    }

    // --- Title ---
    if (/^untitled/i.test(name) || /^[a-z]/.test(name) || /^(and|with|in|or|of|on|for|to|from|&)\b/i.test(name) || /\b(and|with|in|or|of|on|for|the|a|&)$/i.test(name) || /-$/.test(name)
        || (name.match(/\(/g) || []).length !== (name.match(/\)/g) || []).length || name.length < 4 || (name === name.toUpperCase() && /[A-Z]{4}/.test(name)) || /\bpage \d+\b/i.test(name)) add('title', 'fail', `"${name}" looks chopped or broken`);

    // --- Servings and amounts ---
    const portion = m.scaled ? Number(m.scaled.portion) : 1;
    if (Math.abs(portion * 4 - Math.round(portion * 4)) > 0.01) add('servings', 'fail', `${Math.round(portion * 100) / 100} servings: not a cookable amount (quarters only)`);
    if (portion < 0.5 || portion > 2) add('servings', 'fail', `${portion} servings: outside half to double`);
    if (m.servings != null && !Number.isInteger(Number(m.servings))) add('servings', 'fail', `serves ${m.servings}`);
    (m.ingredients || []).forEach(l => { if (/\d\.\d{2,}/.test(l)) add('servings', 'fail', `"${l}": an odd amount`); });

    // --- Avoided foods and allergens (the app's check and the audit's own words) ---
    const app = ctx.exclude(m);
    if (app) add('avoided', 'fail', `has ${app} (the app's own check)`);
    const text = textOf(m).toLowerCase();
    ctx.avoidTerms.forEach(t => { if (new RegExp(`\\b${t}(e?s)?\\b`, 'i').test(text)) add('avoided', 'fail', `has "${t}", which is avoided`); });
    ctx.allergens.forEach(a => { const re = ALLERGENS[a]; const hit = re && text.replace(/\b(peanut|almond|cashew|coconut|oat|soy|rice|cocoa) (milk|butter)\b/g, s => (a === 'dairy' ? 'x' : s)).match(re); if (hit && !(a === 'dairy' && /\bbutternut\b/.test(hit[0]))) add('avoided', 'fail', `has ${hit[0]} (allergy: ${a})`); });
    if (/vegetarian|vegan/i.test(ctx.diet) && MEAT.test(text.replace(/\b(vegetable|veggie|mushroom) (broth|stock)\b/g, '')) ) add('avoided', 'fail', `has ${text.match(MEAT)[0]} (diet: ${ctx.diet})`);
    if (/vegetarian|vegan/i.test(ctx.diet) && SEAFOOD.test(text)) add('avoided', 'fail', `has ${text.match(SEAFOOD)[0]} (diet: ${ctx.diet})`);
    if (/vegan/i.test(ctx.diet) && ANIMAL.test(text.replace(/\b(peanut|almond|cashew|coconut|oat|soy|rice) (milk|butter|yogh?urt|cream)\b/g, ''))) add('avoided', 'fail', `has ${text.match(ANIMAL)[0]} (diet: vegan)`);
    if (/pescatarian/i.test(ctx.diet) && MEAT.test(text.replace(/\b(anchov(y|ies)|fish sauce)\b/g, ''))) add('avoided', 'fail', `has ${text.match(MEAT)[0]} (diet: pescatarian)`);
}

// Audits one plan (pipeline.makePlan's result). Returns { findings, summary }.
function auditPlan(res, scenario) {
    const findings = [];
    const s = res.settings;
    const ctx = {
        settings: s, exclude: res.exclude, diet: s.diet || '',
        avoidTerms: P.parse(scenario.avoid || '').terms || [],
        allergens: Object.keys(ALLERGENS).filter(a => new RegExp(`\\b${a === 'nuts' ? '(tree )?nuts?' : a === 'peanuts' ? 'peanuts?' : a === 'eggs' ? 'eggs?' : a}\\b`, 'i').test(s.allergies || '')),
    };
    const on = PL.mealsOf(s);
    const sources = {};
    const seen = [];
    res.days.forEach((day, d) => {
        ctx.weekday = d % 7;
        on.forEach(slot => {
            const m = day[slot];
            const add = (check, severity, detail) => findings.push({ check, severity, day: d + 1, slot, name: m ? m.name : '', source: m ? sourceName(m) : '', detail });
            if (!m) { add('day-totals', 'fail', `${slot} is empty`); return; }
            checkMeal(m, slot, ctx, add);
            const twin = seen.find(x => PL.sameDish(x.name, m.name) && !(m.leftover && s.allow_leftovers === 'on'));
            if (twin) add('repeats', 'fail', `the same dish as day ${twin.day} ${twin.slot} ("${twin.name}")`);
            seen.push({ name: m.name, day: d + 1, slot });
            const k = m.builtin || m.quick || m.source_id === 'builtin' ? 'builtin' : PL.sourceKey(m);
            (sources[k] = sources[k] || []).push(`day ${d + 1} ${slot}`);
        });
        (day.snacks || []).forEach(m => {
            const add = (check, severity, detail) => findings.push({ check, severity, day: d + 1, slot: 'snack', name: m.name, source: sourceName(m), detail });
            const app = ctx.exclude(m);
            if (app) add('avoided', 'fail', `has ${app}`);
        });
        // Daily totals.
        const t = PL.dayTotals(day);
        const target = Array.isArray(s.day_kcal) && s.day_kcal[d] > 0 ? s.day_kcal[d] : res.targets.kcal;
        const off = t.kcal / target - 1;
        const add = (check, severity, detail) => findings.push({ check, severity, day: d + 1, slot: 'day', name: '', source: '', detail });
        if (Math.abs(off) > 0.1) add('day-totals', 'fail', `${Math.round(t.kcal)} kcal against a target of ${target} (${off > 0 ? '+' : ''}${Math.round(off * 100)}%)`);
        if (t.protein < res.targets.protein * 0.8) add('day-totals', 'fail', `${Math.round(t.protein)} g protein against a target of ${res.targets.protein} g (under 80%)`);
        else if (t.protein < res.targets.protein * 0.9) add('day-totals', 'note', `${Math.round(t.protein)} g protein against a target of ${res.targets.protein} g`);
    });
    Object.entries(sources).forEach(([k, list]) => {
        if (k !== 'builtin' && list.length > (Number(s.source_cap) || 3)) findings.push({ check: 'repeats', severity: 'fail', day: 0, slot: 'week', name: '', source: k, detail: `${list.length} meals from ${k} (${list.join(', ')}); the most is ${Number(s.source_cap) || 3}` });
    });
    // Nourish's own recipes when others were available.
    const builtins = [];
    res.days.forEach((day, d) => on.forEach(slot => { const m = day[slot]; if (m && (m.builtin || m.quick || m.source_id === 'builtin')) builtins.push({ d, slot, m }); }));
    if (builtins.length) {
        const planNames = PL.dishList(res.days.flatMap(day => on.map(t => day[t] && day[t].name).filter(Boolean)));
        const kcalFor = slot => res.targets.kcal * PL.splitOf(s)[MEALS.indexOf(slot)];
        const alternatives = ({ d, slot }) => (res.pools[slot] || []).filter(r => r.source_id !== 'builtin' && !planNames.has(r.name) && !res.exclude(r)
            && !PL.slotProblem(r, slot, PL.slotLimits(s, slot, d % 7)) && r.nutrition && kcalFor(slot) / r.nutrition.calories >= 0.55 && kcalFor(slot) / r.nutrition.calories <= 2).length;
        const withOthers = builtins.filter(b => alternatives(b) >= 3);
        const msg = `${builtins.length} of Nourish's own recipes (${builtins.map(b => `day ${b.d + 1} ${b.slot}`).join(', ')}); ${withOthers.length} of them had 3 or more unused web or book recipes that fit`;
        findings.push({ check: 'builtin', severity: builtins.length > 3 && withOthers.length >= 2 ? 'fail' : 'note', day: 0, slot: 'week', name: '', source: 'builtin', detail: msg });
    }
    return { findings, fails: findings.filter(f => f.severity === 'fail').length };
}
// A real food named in a description that the recipe doesn't have (the nutrition table's foods).
let FOOD_WORDS = null;
function inventedFood(d, m) {
    if (!FOOD_WORDS) {
        FOOD_WORDS = new Set();
        Object.keys(N.FOODS).forEach(k => [k].concat(N.FOODS[k].a || []).forEach(w => { const t = String(w).toLowerCase(); if (/^[a-z]+$/.test(t) && t.length > 3) FOOD_WORDS.add(t.replace(/(es|s)$/, '')); }));
        ['water', 'salt', 'pepper', 'spice', 'herb', 'sauce', 'dressing', 'seasoning', 'fresh', 'sweet', 'green', 'white', 'black', 'red', 'yellow', 'whole', 'light', 'plain', 'meat', 'fruit', 'veggie', 'vegetable', 'protein', 'grain', 'bread', 'cream', 'stock', 'broth', 'juice', 'syrup', 'flour', 'roll', 'chip', 'crisp', 'butter', 'nut', 'seed', 'bean', 'dip', 'snack', 'leaf', 'loaf'].forEach(w => FOOD_WORDS.delete(w));
    }
    const have = `${m.name || ''} ${(m.ingredients || []).join(' ')} ${(m.steps || []).join(' ')}`.toLowerCase();
    const word = String(d).toLowerCase().split(/[^a-z]+/).map(w => w.replace(/(es|s)$/, '')).find(w => FOOD_WORDS.has(w) && have.indexOf(w) < 0);
    return word || '';
}
function sourceName(m) { return m.from_book ? `book: ${m.book}` : m.builtin || m.source_id === 'builtin' ? 'Nourish' : m.quick ? 'Nourish (quick)' : m.source_name || m.source_id || 'other'; }

module.exports = { auditPlan, checkMeal, CHECKS, statedGrams };
