// The plan audit: makes many full 7-day plans with the real app (the current source code, run by its
// own server in a headless browser, with a fresh copy of the data, never anyone's real data) and
// checks every meal the way a careful person would. Run before every release (release.yml).
//
//   node tools/plan-audit.js [--snapshot web-recipes.json] [--books "folder"]... [--out folder] [--live] [--quick]
//
//   --snapshot  real web recipes saved by tools/web-snapshot.js (the Data tools workflow, "snapshot").
//               Without it, and without --live, plans only have books and Nourish's own recipes.
//   --books     extra recipe books to read as well as the audit's own test books (for example the PC's
//               "Nourish/Recipe Books" folder). Copied first: the originals are never touched.
//   --live      let the app reach the real recipe sites (in CI); otherwise it's kept offline.
//   --quick     6 plans instead of 24.
// Writes plan-audit.md (plain English) and plan-audit.json to --out (default: plan-audit/). The exit
// code is 1 when a problem was found, so a release stops.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const N = require('../nutrition.js');
const PL = require('../planner.js');
const { make } = require('./make-audit-books.js');
const { ALL: BOOK_RECIPES } = require('./audit-recipes.js');

const ROOT = path.resolve(__dirname, '..');
const MEALS = ['breakfast', 'lunch', 'dinner'];
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const many = name => args.map((a, i) => (a === name ? args[i + 1] : null)).filter(Boolean);
const OUT = path.resolve(opt('--out') || 'plan-audit');
const LIVE = args.includes('--live');
const QUICK = args.includes('--quick');

function playwright() {
    const tries = ['playwright', path.join(ROOT, 'node_modules/playwright'), '/opt/node22/lib/node_modules/playwright', path.join(process.env.HOME || '', 'node-tools/node_modules/playwright')];
    try { tries.push(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) { /* no npm */ }
    for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
    throw new Error('Playwright is needed: npm i --no-save playwright');
}
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const up = port => new Promise(ok => http.get(`http://127.0.0.1:${port}/api/info`, r => { r.resume(); ok(r.statusCode < 500); }).on('error', () => ok(false)));

// ---------------------------------------------------------------------------------------------
// The plans: different goals, calorie targets, avoided foods, diets, budgets and schedules,
// with and without the books.
const BASE = { calorie_target: '2200', protein_target: '140', body_weight: '', snacks_per_day: '0', diet: 'No restriction', allergies: '', budget: 'Any', calorie_mode: 'daily', big_days: '', big_days_ok: '', sources_off: '', calorie_split: 'dinner', units: 'metric' };
const CASES = [
    { id: 'lose-1500', goal: 'Cut', settings: { calorie_target: '1500', body_weight: '70' } },
    { id: 'lose-1800-nobooks', goal: 'Cut', books: false, settings: { calorie_target: '1800', body_weight: '85' } },
    { id: 'lose-1600-veg', goal: 'Cut', settings: { calorie_target: '1600', diet: 'Vegetarian' } },
    { id: 'lose-2000-shellfish', goal: 'Cut', settings: { calorie_target: '2000', allergies: 'shellfish' } },
    { id: 'lose-1700-budget', goal: 'Cut', settings: { calorie_target: '1700', budget: 'Budget-friendly' } },
    { id: 'lose-1900-snacks', goal: 'Cut', settings: { calorie_target: '1900', snacks_per_day: '1', body_weight: '90' } },
    { id: 'lose-1500-lowcarb', goal: 'Cut', settings: { calorie_target: '1500', macro_pref: 'lower-carb' } },
    { id: 'lose-1800-pork-mushroom', goal: 'Cut', avoid: 'pork, mushrooms', settings: { calorie_target: '1800' } },
    { id: 'maintain-2000', goal: 'Maintain', settings: { calorie_target: '2000' } },
    { id: 'maintain-2200-nobooks', goal: 'Maintain', books: false, settings: { calorie_target: '2200' } },
    { id: 'maintain-2400-nuts-dairy', goal: 'Maintain', settings: { calorie_target: '2400', allergies: 'tree nuts, peanuts, dairy' } },
    { id: 'maintain-2200-gluten', goal: 'Maintain', settings: { calorie_target: '2200', allergies: 'gluten' } },
    { id: 'maintain-2000-pescatarian', goal: 'Maintain', settings: { calorie_target: '2000', diet: 'Pescatarian' } },
    { id: 'maintain-2300-weekly', goal: 'Maintain', settings: { calorie_target: '2300', calorie_mode: 'weekly', big_days: JSON.stringify([{ weekday: 5, kcal: 3200 }]) } },
    { id: 'maintain-2100-frontload', goal: 'Maintain', settings: { calorie_target: '2100', calorie_split: 'frontload' } },
    { id: 'maintain-2500-beef-egg', goal: 'Maintain', avoid: 'beef, eggs', settings: { calorie_target: '2500' } },
    { id: 'maintain-2200-busy', goal: 'Maintain', settings: { calorie_target: '2200', sched_breakfast: '10', sched_lunch: '20' } },
    { id: 'maintain-1900-vegan', goal: 'Maintain', settings: { calorie_target: '1900', diet: 'Vegan' } },
    { id: 'gain-2800', goal: 'Gain', settings: { calorie_target: '2800', body_weight: '75' } },
    { id: 'gain-3200-nobooks', goal: 'Gain', books: false, settings: { calorie_target: '3200' } },
    { id: 'gain-3000-snacks', goal: 'Gain', settings: { calorie_target: '3000', snacks_per_day: '2' } },
    { id: 'gain-2600-chicken', goal: 'Gain', avoid: 'chicken', settings: { calorie_target: '2600' } },
    { id: 'gain-3500-lowfat', goal: 'Gain', settings: { calorie_target: '3500', macro_pref: 'lower-fat' } },
    { id: 'gain-2700-fish', goal: 'Gain', avoid: 'fish, salmon, tuna', settings: { calorie_target: '2700', budget: 'No limit' } },
];

// ---------------------------------------------------------------------------------------------
// The checks. Each finding: { check, severity: 'problem' | 'note', what }.
const NOT_MEAL_WORDS = [
    [/\b(dip|hummus|spread|salsa|guacamole|pesto|chimichurri|tzatziki|aioli|vinaigrette|dressing|gravy|chutney|relish|jam|compote)\b/i, 'a sauce, dip or spread'],
    [/\b(bone marrow|marrow bones?|p[âa]t[ée]|terrine|crostini|canap[ée]s?|deviled eggs|devilled eggs)\b/i, 'a starter'],
    [/\b(coleslaw|slaw|tostones|side salad|garlicky green beans|roast(ed)? potatoes|mashed potatoes|fries)\b/i, 'a side dish'],
    [/\b(lassi|lemonade|cocktail|mocktail|latte|hot chocolate|iced tea|punch|milkshake)\b/i, 'a drink'],
    [/\b(cakes?|cupcakes?|cookies?|brownies?|blondies?|flan|pudding|ice cream|mousse|cheesecake|fudge|truffles|tart|pie)\b/i, 'a dessert'],
    [/^(how to|the best|\d+ (easy|quick|best|healthy))\b|\b(ideas|tips|guide)\b/i, 'an article'],
];
const MEAL_WORDS = /\b(chicken|beef|pork|turkey|lamb|fish|salmon|tuna|shrimp|tofu|eggs?|lentils?|beans|chickpeas|quinoa|rice|pasta|noodles|potato(es)?|bowls?|salads?|soups?|stews?|curry|curries|chili|tacos?|wraps?|sandwich(es)?|burgers?|pot pie|shepherd|quiche|frittata|omelet|omelette|oats|porridge|pancakes|waffles|toast|pizza|flatbread|risotto|lasagn[ae])\b/i;
const DINNER_DISH = /\b(ribs|pot roast|roast (chicken|pork|beef|lamb)|pork shoulder|pernil|brisket|oxtail|osso buco|fried chicken|fish and chips|beer[- ]battered|prime rib|leg of lamb|whole chicken|lasagn[ae])\b/i;
const LONG_WAIT = /\b(brine|brining)\b|\b(marinate|soak|refrigerate|chill|rest|rise|proof)\b[^.]{0,40}\b(overnight|(\d+|several) (to \d+ )?hours?)\b/i;
const DISCARDED = /\b(for (the )?brine|for brining|for (deep[- ]?|shallow[- ]?)?frying|to (deep[- ]?)?fry|for soaking|soaking water|for boiling|cooking water|water to cover)\b/i;
const BONE_IN = /\b(bone[- ]in|on the bone|marrow bones?|ribs?|rack of|oxtail|drumsticks?|chicken wings?|whole chicken|chicken pieces|shanks?|shell[- ]on|in (their|the) shells?|whole (crab|lobster)|crab legs|mussels|clams)\b/i;
const WEIGHT = /\b(\d+(\.\d+)?|\d+ \d\/\d)\s*(-|\s)?(lbs?|pounds?|kg|kilos?|g|grams?|oz|ounces?)\b/i;
const LUXURY = /\b(wagyu|caviar|truffles?|foie gras|lobster|langoustines?|king crab|saffron)\b/i;
// Avoided foods and allergens, read independently of the app's own filter.
const AVOID_WORDS = {
    shellfish: /\b(shrimp|prawns?|crab|lobster|scallops?|mussels|clams|oysters?|langoustines?|crawfish)\b/i,
    'tree nuts': /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamias?|pine nuts|brazil nuts|nut butter|almond (milk|flour|butter))\b/i,
    peanuts: /\b(peanuts?|peanut butter|satay)\b/i,
    dairy: /\b(milk|cheese|butter(?!nut| beans| lettuce)|cream|yogh?urt|cheddar|mozzarella|parmesan|feta|ricotta|paneer|ghee|whey|kefir|cr[eè]me|buttermilk|halloumi|mascarpone)\b/i,
    gluten: /\b(flour|bread|pasta|spaghetti|noodles|couscous|bulgur|barley|farro|tortillas?(?! \(corn)|pita|buns?|breadcrumbs|panko|crackers|soy sauce|wheat|seitan|croutons|bagels?|naan|orzo|lasagn)\b/i,
    pork: /\b(pork|bacon|ham|sausages?|chorizo|prosciutto|pancetta|salami|pepperoni|ribs|pernil|lard)\b/i,
    mushrooms: /\bmushrooms?\b/i,
    beef: /\b(beef|steak|brisket|oxtail|ground chuck|sirloin|marrow)\b/i,
    eggs: /\beggs?\b(?! noodles)/i,
    chicken: /\bchicken\b/i,
    fish: /\b(fish|salmon|lox|gravlax|tuna|cod|tilapia|trout|halibut|sardines?|mackerel|anchov(y|ies)|haddock|sea bass|snapper|mahi)\b/i,
    salmon: /\bsalmon\b/i, tuna: /\btuna\b/i,
};
const DIET_WORDS = {
    Vegetarian: /\b(chicken|beef|pork|turkey|lamb|bacon|ham|sausages?|fish|salmon|lox|gravlax|tuna|cod|shrimp|prawns?|anchov|gelatin|chorizo|steak|ribs|oxtail|marrow|crab|lobster|scallops?|duck|veal|venison)\b/i,
    Pescatarian: /\b(chicken|beef|pork|turkey|lamb|bacon|ham|sausages?|chorizo|steak|ribs|oxtail|marrow|duck|veal|venison)\b/i,
};
DIET_WORDS.Vegan = new RegExp(DIET_WORDS.Vegetarian.source.slice(0, -4) + '|eggs?|milk|cheese|butter(?!nut| beans)|cream|yogh?urt|honey|feta|parmesan|ghee|whey)\\b', 'i');

const lc = s => String(s || '').toLowerCase();
const words = s => lc(s).split(/[^a-z]+/).filter(w => w.length >= 3).map(w => w.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'));
// Pairs where the table's food has another name than the line (checked by hand).
const SAME_FOOD = [[/potstickers?|pot stickers|gyoza|wontons?|dim sum|mandu|momos/, /dumpling/], [/\bmince\b/, /ground/], [/\bprawns?\b/, /shrimp/], [/\bswede\b/, /rutabaga/], [/\bmangetout|sugar snap/, /snow peas/], [/\bpanko|bread ?crumbs/, /breadcrumb/], [/\bkimchi/, /sauerkraut|cabbage/], [/\bhot sauce|habanero|piri piri|peri peri/, /sriracha|hot sauce/], [/\bcourgette/, /zucchini/], [/\baubergine/, /eggplant/], [/\bscallions?|spring onions?|green onions?/, /onion/],
    [/\bbuns?|rolls?|baguette|crusty/, /bread/], [/\bstock\b|bouillon/, /broth/], [/\bchilli|chili|jalape/, /pepper|jalapeno|chili/], [/\bcilantro|coriander/, /coriander|cilantro|parsley/], [/\bpasta|spaghetti|penne|macaroni|fusilli|linguine|rigatoni|orzo/, /pasta|spaghetti|macaroni/],
    [/\byoghurt/, /yogurt/], [/\bpassata|crushed tomatoes|tomato puree/, /tomato/], [/\bsalt pork|fatback|pancetta|guanciale|pork belly/, /bacon/], [/\bpigeon peas|gandules|black-eyed/, /chickpea|pea/], [/\bsplit peas/, /lentil/], [/\bcornstarch|cornflour/, /corn/],
    [/\bflank|skirt|sirloin|steak|chuck|round/, /beef|steak/], [/\bwraps?\b/, /tortilla/], [/\bmayo\b/, /mayonnaise/], [/\bromaine|little gem|iceberg|salad leaves|greens|spring mix/, /lettuce/],
    [/\bblueberr|raspberr|strawberr|blackberr/, /berr/], [/\blox\b|smoked salmon/, /smoked salmon/], [/\bnoodles?\b|ramen|udon|soba|lo mein|vermicelli/, /pasta|udon|noodle/], [/\bgarbanzo/, /chickpea/],
    [/\bcheese|cotija|manchego|monterey|jack|colby|gruyere|emmental|gouda|pecorino|asiago|fontina|provolone/, /cheese|cheddar|jack|parmesan|mozzarella/], [/\btaco seasoning|seasoning|spice mix|spice blend|curry powder/, /masala|spice|seasoning|chili powder|paprika|cumin|curry/], [/\bcod|haddock|tilapia|pollock|halibut|white fish/, /fish|cod/], [/\bold bay|seasoning|spice|chili powder|paprika|cumin/, /spice|seasoning|paprika|chili|cumin|pepper/]];
function wrongFood(line, key) {
    const l = lc(line), k = lc(key);
    if (!k || /^(water|salt|pepper)$/.test(k)) return false;
    const kw = words(k), lw = new Set(words(l));
    if (kw.some(w => lw.has(w) || l.includes(w))) return false;
    if (SAME_FOOD.some(([a, b]) => a.test(l) && b.test(k))) return false;
    return true;
}
function minutesOf(meal) { return Number(meal.active_minutes) || Number(meal.time_minutes) || 0; }

function checkMeal(meal, slot, ctx) {
    const out = [];
    const add = (check, severity, what) => out.push({ check, severity, what });
    const text = `${meal.name} ${(meal.ingredients || []).join(' ')}`;
    const name = meal.name || '';
    const n = meal.nutrition || {};
    const kcal = Number(n.calories) || 0, p = Number(n.protein_g) || 0, f = Number(n.fat_g) || 0;
    // What the book says it is (for the audit's own test books).
    const truth = meal.from_book ? BOOK_RECIPES.find(r => lc(name).startsWith(lc(r.title).slice(0, 14)) || lc(r.title).startsWith(lc(name).slice(0, 14))) : null;
    const origProtein = meal.protein_added ? p - (Number(meal.protein_added.grams) || 0) : p;

    // 1. Not really a meal.
    if (truth && !['breakfast', 'lunch', 'dinner', 'main'].includes(truth.is)) add('not a meal', 'problem', `${truth.is} (the book says so), planned as ${slot}`);
    else {
        // A smoothie is a breakfast when it's filling (at least 250 kcal and 10 g protein), else a drink; chia pudding is a breakfast.
        const filling = /smoothie|shake/i.test(name) && kcal >= 250 && p >= 10;
        const nm = filling || /chia( seed)? pudding|overnight oats|protein pudding|bread pudding|savou?ry/i.test(name) ? null : NOT_MEAL_WORDS.find(([re]) => re.test(name));
        const isMealish = MEAL_WORDS.test(name.replace(nm ? nm[0] : /$^/, ''));
        if (nm && !(isMealish && !/a starter|an article/.test(nm[1]))) add('not a meal', 'problem', `looks like ${nm[1]}`);
        else if (kcal > 0 && f * 9 / kcal > 0.7 && p * 4 / kcal < 0.12) add('not a meal', 'problem', `${Math.round(f * 9 / kcal * 100)}% of its calories are fat and only ${Math.round(p * 4 / kcal * 100)}% protein: a starter or spread, not a meal`);
    }
    // 2. Wrong meal slot.
    if (truth && truth.is === 'dinner' && slot !== 'dinner') add('wrong slot', 'problem', `a dinner dish at ${slot}`);
    else if (truth && truth.is === 'breakfast' && slot === 'dinner') add('wrong slot', 'note', 'a breakfast dish at dinner');
    else if (slot !== 'dinner' && DINNER_DISH.test(name)) add('wrong slot', 'problem', `a dinner dish ("${name.match(DINNER_DISH)[0]}") at ${slot}`);
    const steps = (meal.steps || []).join(' ');
    const lim = ctx.limits && ctx.limits[slot];
    if (lim && isFinite(lim.minutes) && minutesOf(meal) > lim.minutes * 1.3 + 5) add('too slow for the slot', 'problem', `${minutesOf(meal)} minutes of cooking; ${slot} allows about ${lim.minutes}`);
    if (slot !== 'dinner' && LONG_WAIT.test(steps) && !meal.make_ahead && !/overnight oats|chia|bircher|soaked oats|refrigerator oats|fridge oats|make[- ]ahead|pudding/i.test(name)) add('too involved for the slot', 'problem', `needs "${steps.match(LONG_WAIT)[0]}" before a ${slot}`);
    try {
        const prof = PL.recipeProfile(meal);
        if (prof && prof.difficulty > (lim ? Math.max(lim.difficulty, 6) : 6) && slot !== 'dinner') add('too involved for the slot', 'problem', `difficulty ${prof.difficulty} of 10 ("Involved") at ${slot}`);
    } catch (e) { /* no profile */ }

    // 3. Nutrition: what each line was matched to, and whether the totals make sense.
    const servings = Math.max(1, Number(meal.servings) || 1);
    let calc = null;
    try { calc = N.calculate(meal.ingredients || [], servings); } catch (e) { /* none */ }
    (calc ? calc.lines : []).forEach(l => {
        if (l.key && wrongFood(l.line, l.key) && l.kcal >= 30) add('matched to the wrong food', 'problem', `"${l.line}" was counted as ${l.key} (${l.kcal} kcal a serving)`);
        if (DISCARDED.test(l.line) && l.kcal >= (/fry|frying/i.test(l.line) ? 135 : 25)) add('discarded ingredient counted', 'problem', `"${l.line}" counted as ${l.kcal} kcal a serving, but it's thrown away`);
        if (BONE_IN.test(l.line) && WEIGHT.test(l.line) && l.key) {
            // The weight as written in the line (the app's own reading already takes the bones off).
            const w = l.line.match(/(\d+(?:\.\d+)?|\d+\s+\d\/\d|\d\/\d|[½¼¾])\s*-?\s*(lbs?|pounds?|kg|kilos?|g|grams?|oz|ounces?)\b/i);
            const num = w ? (/[½¼¾]/.test(w[1]) ? { '½': 0.5, '¼': 0.25, '¾': 0.75 }[w[1]] : w[1].includes('/') ? w[1].split(/\s+/).reduce((a, x) => a + (x.includes('/') ? Number(x.split('/')[0]) / Number(x.split('/')[1]) : Number(x)), 0) : Number(w[1])) : 0;
            const stated = w ? num * (/^(lb|pound)/i.test(w[2]) ? 453.6 : /^(kg|kilo)/i.test(w[2]) ? 1000 : /^(oz|ounce)/i.test(w[2]) ? 28.35 : 1) / servings * (/\b(pack|can|tin)s?\b/i.test(l.line) ? 1 : 1) : 0;
            const perServing = l.grams / servings;
            if (stated > 0 && perServing >= stated * 0.95) add('bone or shell counted as food', 'problem', `"${l.line}": ${l.grams} g counted, the whole weight with the bones or shells`);
        }
    });
    // Discarded lines in a brine or frying group the line itself doesn't name.
    const groups = []; let g = '';
    (meal.ingredients || []).forEach(l => { if (/^(for the |brine:?$|.*:$)/i.test(l.trim())) g = lc(l); else groups.push([l, g]); });
    groups.forEach(([l, grp]) => { if (/brine|soak/.test(grp) && calc) { const hit = calc.lines.find(x => x.line === l); if (hit && hit.kcal >= 25) add('discarded ingredient counted', 'problem', `"${l}" (in the ${grp.replace(/[:]/g, '')}) counted as ${hit.kcal} kcal a serving`); } });
    if (/\bmarrow\b/i.test(text) && p > 15) add('implausible nutrition', 'problem', `bone marrow is nearly all fat, but this has ${p} g protein`);
    if (kcal > 0 && p * 4 / kcal > 0.85 && !meal.protein_added) add('implausible nutrition', 'problem', `${Math.round(p * 4 / kcal * 100)}% of the calories from protein: leaner than plain chicken breast`);
    if (kcal > 0 && (kcal < 120 || kcal > 2000)) add('implausible nutrition', 'problem', `${kcal} kcal for a ${slot}`);

    // 3b. Protein in each meal (Nourish's own rule: breakfast never under 25 g, main meals 25–40 g).
    if (slot === 'breakfast' && p < 24.5) add('meal low in protein', 'problem', `breakfast with ${p} g protein (the rule is at least 25 g)`);
    if (slot !== 'breakfast' && p < 20) add('meal low in protein', 'problem', `${slot} with ${p} g protein`);

    // 4. Added by the app to make it pass.
    if (meal.protein_added) {
        const added = meal.protein_added;
        // More than a person would eat as an add-on (the app's own limits: 4 eggs, 6 oz chicken, 2 scoops…).
        const MOST = [[/\begg whites\b/, 1], [/\beggs?\b/, 4], [/\boz\b/, 6], [/\bscoops?\b/, 2], [/\bcups?\b/, 1.5]];
        [].concat(added).map(String).filter(a => (meal.ingredients || []).includes(a)).forEach(l => {
            const q = Number((String(l).match(/^(\d+(?:\.\d+)?)/) || [])[1]) / servings;
            const lim = MOST.find(([re]) => re.test(l.toLowerCase()));
            if (lim && q > lim[1] * 1.01) add('ingredient added by the app', 'problem', `"${l}": more than a person would add (${q} a serving)`);
        });
        const bad = (truth && !['breakfast', 'lunch', 'dinner', 'main'].includes(truth.is)) || (origProtein < 8 && slot !== 'breakfast');
        add('ingredient added by the app', bad ? 'problem' : 'note', `${added.line || added.food || 'protein'} added for protein (${Math.round(origProtein)} g of its own)`);
    }
    if (meal.fiber_added) add('ingredient added by the app', 'note', `${meal.fiber_added.line || meal.fiber_added.food || 'fiber'} added for fiber`);

    // 5. Repeats and luxury.
    if (slot !== 'dinner' && PL.pricey(meal)) add('luxury ingredient', 'problem', `${PL.pricey(meal)} at ${slot}`);
    if (LUXURY.test(text) && ctx.settings.budget !== 'No limit') add('luxury ingredient', 'problem', `${text.match(LUXURY)[0]} with the budget at "${ctx.settings.budget}"`);

    // 6. Description, title, servings.
    const d = String(meal.description || '').trim();
    if (d) {
        if (!/[.!?]["')]?$/.test(d)) add('description', 'problem', `cut off: "${d.slice(-60)}"`);
        const lines = (meal.ingredients || []).filter(l => /^\s*[\d½¼¾⅓]/.test(l));
        const stitched = lines.filter(l => d.toLowerCase().includes(lc(l).replace(/^[\d\s/.½¼¾⅓-]+/, '').split(',')[0].trim().slice(0, 25))).length;
        if (/\b\d+\s*(gallons?|cups?|tbsp|tsp|tablespoons?|teaspoons?|pounds?|lbs?|oz|g)\b/i.test(d)) add('description', 'problem', `has amounts in it, like an ingredient list: "${d.slice(0, 90)}"`);
        else if (stitched >= 4) add('description', 'problem', `the ingredient list stitched together: "${d.slice(0, 90)}"`);
        if (/\b(water|kosher salt|salt)\b.*\band\b/i.test(d.split(/[.,]/)[0])) add('description', 'problem', `starts with staples, not the dish: "${d.slice(0, 80)}"`);
    } else add('description', 'note', 'no description');
    if (/^(with|and|or|in|on|of|for|to|the)\b|^[a-z]|\b(and|with|or|of|the|in)$|^\W|\d{2,}$/.test(name.trim()) ) add('chopped title', 'problem', `"${name}"`);
    const portion = meal.scaled ? Number(meal.scaled.portion) : 1;
    if (portion && Math.abs(portion * 4 - Math.round(portion * 4)) > 0.02) add('odd serving size', 'problem', `${portion} servings`);

    // 7. Avoided foods and allergens.
    const avoid = String(ctx.avoid || '').split(',').concat(String(ctx.settings.allergies || '').split(',')).map(s => s.trim().toLowerCase()).filter(Boolean);
    avoid.forEach(a => {
        const re = AVOID_WORDS[a] || new RegExp(`\\b${a.replace(/s$/, '')}s?\\b`, 'i');
        const hit = (meal.ingredients || []).concat([name]).find(l => re.test(a === 'dairy' ? l.replace(/\b(peanut|almond|cashew|nut|seed|sunflower|apple|cocoa|shea|soy|oat|coconut|rice|plant|vegan|dairy-free|non-dairy)[- ](butter|milk|cream|yogh?urt|cheese)\b/gi, '') : l) && !/\b(free|vegan|dairy-free|plant-based|non-dairy|coconut milk|oat milk|almond milk|soy milk|nut-free)\b/i.test(l));
        if (hit) add('avoided food present', 'problem', `${a}: "${hit}"`);
    });
    const dietRe = DIET_WORDS[ctx.settings.diet];
    if (dietRe) { const hit = (meal.ingredients || []).find(l => dietRe.test(l.replace(/\b(peanut|almond|cashew|nut|seed|sunflower|apple|cocoa|shea|soy|oat|coconut|rice|plant|vegan|dairy-free|non-dairy)[- ](butter|milk|cream|yogh?urt|cheese)\b/gi, '')) && !/\b(vegetable|veggie|vegan|plant|meatless|mushroom|stock|broth|egg-free|eggless)\b/i.test(l) && !/\b(free)\b/i.test(l)); if (hit) add('avoided food present', 'problem', `${ctx.settings.diet}: "${hit}"`); }
    return out;
}

function checkPlan(res, c) {
    const findings = [];
    const push = (where, f) => findings.push(Object.assign({ case: c.id }, where, f));
    const days = res.days || [];
    const dayNames = res.dayNames || [];
    // Every meal.
    days.forEach((d, i) => MEALS.forEach(slot => {
        const m = d && d[slot];
        if (!m) { push({ day: dayNames[i] || `Day ${i + 1}`, slot, meal: '—' }, { check: 'empty slot', severity: 'problem', what: 'no meal' }); return; }
        checkMeal(m, slot, { limits: res.limits && res.limits[i], settings: Object.assign({}, BASE, c.settings), avoid: c.avoid }).forEach(f => push({ day: dayNames[i] || `Day ${i + 1}`, slot, meal: m.name, source: res.sourceOf[`${i}:${slot}`] }, f));
    }));
    // Repeats and sources.
    const seen = new Map();
    days.forEach((d, i) => MEALS.forEach(slot => { const m = d && d[slot]; if (!m || m.leftover) return; const k = PL.dishKey ? PL.dishKey(m.name) : lc(m.name); if (seen.has(k)) push({ day: dayNames[i], slot, meal: m.name }, { check: 'repeat', severity: 'problem', what: `also on ${seen.get(k)}` }); else seen.set(k, `${dayNames[i]} ${slot}`); }));
    const per = {};
    Object.values(res.sourceOf).forEach(s => { per[s] = (per[s] || 0) + 1; });
    Object.entries(per).forEach(([s, n]) => { if (n > 3 && s !== 'Nourish recipes') push({ meal: s }, { check: 'more than 3 from one source', severity: 'problem', what: `${n} meals from ${s}` }); });
    // Nourish's own recipes while fitting web recipes were there.
    const builtins = Object.entries(res.sourceOf).filter(([, s]) => s === 'Nourish recipes');
    if (builtins.length > 3) {
        const spare = res.spareWeb || {};
        // A problem when a slot had more spare web recipes that fit than Nourish recipes used in it.
        const inSlot = m => builtins.filter(([k]) => k.split(':')[1] === m).length;
        const could = builtins.filter(([k]) => (spare[k.split(':')[1]] || 0) > inSlot(k.split(':')[1]));
        const names = [...new Set(could.map(([k]) => k.split(':')[1]))].map(m => `${m}: ${((res.spareNames || {})[m] || []).slice(0, 3).join('; ')}`).join(' / ');
        push({ meal: 'Nourish recipes' }, { check: 'too many built-in recipes', severity: could.length ? 'problem' : 'note', what: `${builtins.length} of 21 meals were Nourish's own recipes${could.length ? `; ${could.length} of them had web recipes that fit the slot (${names})` : ''}` });
    }
    // Daily totals.
    days.forEach((d, i) => {
        const t = res.totals[i];
        const target = res.targets[i];
        if (!t || !target) return;
        if (Math.abs(t.kcal / target.kcal - 1) > 0.1) push({ day: dayNames[i] }, { check: 'day off target', severity: 'problem', what: `${Math.round(t.kcal)} kcal against ${target.kcal}` });
        if (t.protein < target.protein * 0.9) push({ day: dayNames[i] }, { check: 'day off target', severity: 'problem', what: `${Math.round(t.protein)} g protein against ${target.protein}` });
    });
    return findings;
}

// ---------------------------------------------------------------------------------------------
async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nourish-audit-'));
    const lib = path.join(tmp, 'library');
    const booksDir = path.join(lib, 'Recipe Books');
    fs.mkdirSync(booksDir, { recursive: true });
    const made = make(booksDir);
    // Real books from a folder (copied, never moved or changed).
    many('--books').forEach(dir => { try { fs.readdirSync(dir).filter(f => /\.(epub|pdf|docx|txt|md)$/i.test(f)).forEach(f => { fs.copyFileSync(path.join(dir, f), path.join(booksDir, f)); made.push(f); }); } catch (e) { console.error(`Couldn't read ${dir}: ${e.message}`); } });
    let snapshot = {};
    const snapFile = opt('--snapshot');
    if (snapFile) { try { snapshot = JSON.parse(fs.readFileSync(snapFile, 'utf8')); } catch (e) { console.error(`Couldn't read the snapshot ${snapFile}: ${e.message}`); } }
    console.error(`Audit folder: ${tmp}; books: ${made.map(f => path.basename(f)).join(', ')}; web recipes in the snapshot: ${Object.keys(snapshot).length}`);

    const port = 8790 + Math.floor(Math.random() * 100);
    const env = Object.assign({}, process.env, { NOURISH_NO_BROWSER: '1', NOURISH_PORT: String(port), NOURISH_DATA_FILE: path.join(tmp, 'nourish-data.json'), NOURISH_LIBRARY_DIR: lib, NOURISH_LOG_DIR: tmp });
    if (!LIVE) Object.assign(env, { HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', http_proxy: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost' });
    const server = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(ROOT, 'backend', 'nourish_app.py')], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverLog = '';
    server.stdout.on('data', b => { serverLog += b; }); server.stderr.on('data', b => { serverLog += b; });
    const stop = () => { try { server.kill(); } catch (e) { /* gone */ } };
    process.on('exit', stop);
    for (let i = 0; i < 60 && !(await up(port)); i++) await wait(500);
    if (!(await up(port))) { console.error(serverLog); throw new Error('The Nourish server didn\'t start'); }

    const { chromium } = playwright();
    const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? {} : {});
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    // Offline unless --live: only the app's own server.
    if (!LIVE) await context.route(url => !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(String(url)), r => r.abort());
    await context.addInitScript(([snap]) => {
        if (!localStorage.getItem('nourish_audit_seeded')) {
            localStorage.setItem('nourish_recipe_cache', snap);
            localStorage.setItem('nourish_library_refreshed', String(Date.now()));   // no background refresh during the audit
            localStorage.setItem('nourish_audit_seeded', '1');
        }
    }, [JSON.stringify(snapshot)]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => typeof runSmartPlan === 'function' && typeof recipeDBReady !== 'undefined' && recipeDBReady, null, { timeout: 60000 });
    const version = await page.evaluate(() => ((serverInfo && serverInfo.version) || ''));

    // The books, read the way the app reads them.
    const books = await page.evaluate(async () => {
        Object.assign(settings, { active_provider: 'lmstudio', lmstudio_model: '' });
        await indexLibrary({ quiet: false });
        for (let i = 0; i < 240 && (libraryState.busy || libraryState.progress); i++) await new Promise(r => setTimeout(r, 500));
        await new Promise(r => setTimeout(r, 1500));
        const list = recipeDB.books ? recipeDB.books() : [];
        window.__auditFiles = (recipeDB.files ? recipeDB.files() : []).map(f => ({ path: f.path || f.name, count: f.count, why: f.why || f.note || '', type: f.type }));
        window.__auditNotes = (libraryState.notes || []).slice(0, 20);
        return list.map(b => ({ title: b.title, author: b.author, count: b.count, review: b.review, meals: b.meals, others: b.others, type: b.type, why: b.why || b.note || '',
            recipes: recipeDB.recipesOf ? recipeDB.recipesOf(b.id).map(r => ({ name: r.name, kind: r.kind, meal_types: r.meal_types, ingredients: r.ingredients, review: r.review, why: r.review_why || r.why || '', nutrition: r.nutrition, fit: r._fit || NourishPlanner.mealFit(r) })) : [] }));
    });

    const files = await page.evaluate(() => ({ files: window.__auditFiles || [], notes: window.__auditNotes || [] }));
    const results = [];
    const only = opt('--only');
    const cases = only ? CASES.filter(c => c.id === only) : QUICK ? CASES.filter((c, i) => i % 4 === 0) : CASES;
    for (const c of cases) {
        const t0 = Date.now();
        const res = await page.evaluate(async ({ c, BASE, MEALS }) => {
            localStorage.removeItem('nourish_plan_history'); localStorage.removeItem('nourish_plan_progress');
            Object.keys(settings).filter(k => /^sched_/.test(k)).forEach(k => { settings[k] = SETTINGS_DEFAULTS[k]; });
            Object.assign(settings, BASE, { macro_pref: 'balanced' }, c.settings, { sources_off: c.books === false ? 'library' : '' });
            if (settings.calorie_mode === 'weekly' && settings.big_days) settings.big_days_ok = settings.big_days;
            prefs.goal = c.goal; prefs.hates = c.avoid || ''; prefs.likes = '';
            changed('settings'); changed('prefs');
            const since = Date.now();
            let error = '';
            try { await runSmartPlan('', prefs.hates); } catch (e) { error = e.message; }
            const sourceOf = {};
            daysData.forEach((d, i) => MEALS.forEach(t => { const m = d && d[t]; if (!m) return; sourceOf[`${i}:${t}`] = m.from_book ? `book: ${m.book || m.source_name}` : m.builtin || m.source_id === 'builtin' ? 'Nourish recipes' : m.source_url ? (m.source_name || 'web') : 'other'; }));
            // Web recipes that would have fitted a slot and weren't used (for the built-in check).
            const inPlan = new Set(daysData.flatMap(d => MEALS.map(t => d && d[t] && d[t].name)).filter(Boolean));
            const exclude = NourishPrefs.excluder({ avoid: prefs.hates, allergies: settings.allergies, diet: settings.diet });
            const spareWeb = {};
            const perSite = {};
            daysData.forEach(d => MEALS.forEach(t => { const m = d && d[t]; if (m && m.source_name) perSite[m.source_name] = (perSite[m.source_name] || 0) + 1; }));
            const share = { breakfast: 0.25, lunch: 0.3, dinner: 0.45 };
            const spareNames = {};
            MEALS.forEach(t => { const list = ((lastPlanPools || {})[t] || []).filter(r => r.source_url && !r.from_book && !r.builtin && !inPlan.has(r.name) && !exclude(r) && (perSite[r.source_name] || 0) < (Number(settings.source_cap) || 3)
                && r.nutrition && daysData.some((d, i) => { const f = dayKcalTarget(i) * share[t] / r.nutrition.calories; const others = MEALS.filter(x => x !== t).map(x => d && d[x]).filter(Boolean);
                    const clash = others.some(o => NourishPlanner.mainProtein(o) && NourishPlanner.mainProtein(o) === NourishPlanner.mainProtein(r));
                    return f >= 0.5 && f <= 2 && (r.nutrition.protein_g || 0) * Math.min(2, f) >= 12 && !clash && !slotCheck(r, t, i); })); spareWeb[t] = list.length; spareNames[t] = list.slice(0, 5).map(r => `${r.name} (${r.source_name}, ${r.nutrition.calories} kcal)`); });
            return {
                error, ms: Date.now() - since,
                days: JSON.parse(JSON.stringify(daysData)).map(d => { MEALS.forEach(t => { const m = d && d[t]; if (m && !m.description && typeof describeFromRecipe === 'function') { m.description = describeFromRecipe(m); m.description_made = true; } }); return d; }),
                dayNames: daysData.map((d, i) => dayName(i)),
                totals: daysData.map(d => { const t = NourishPlanner.dayTotals(d); return { kcal: t.kcal, protein: t.protein, fiber: t.fiber }; }),
                targets: daysData.map((d, i) => ({ kcal: dayKcalTarget(i), protein: proteinTarget() })),
                limits: daysData.map((d, i) => Object.fromEntries(MEALS.map(t => [t, slotLimitsFor(t, i)]))),
                sourceOf, spareWeb, spareNames,
                split: planSourceSplit(daysData),
                log: activityLog.filter(l => l.t >= since && l.area === 'plan').map(l => l.msg + (l.details ? ` ${l.details.slice(0, 400)}` : '')),
            };
        }, { c, BASE, MEALS });
        const findings = checkPlan(res, c);
        results.push({ case: c, res, findings });
        const probs = findings.filter(f => f.severity === 'problem').length;
        console.error(`${c.id.padEnd(30)} ${((Date.now() - t0) / 1000).toFixed(1)} s, ${probs} problems, split ${JSON.stringify(res.split.perSource)}${res.error ? ' ERROR ' + res.error : ''}`);
    }
    await browser.close();
    stop();
    return report({ version, books, files, results, snapshotSize: Object.keys(snapshot).length, live: LIVE, pageErrors, tmp });
}

// ---------------------------------------------------------------------------------------------
function report({ version, books, files, results, snapshotSize, live, pageErrors, tmp }) {
    fs.mkdirSync(OUT, { recursive: true });
    const all = results.flatMap(r => r.findings);
    const problems = all.filter(f => f.severity === 'problem');
    // Book judgment: each test recipe as read, against what it really is.
    const bookRows = [];
    books.forEach(b => (b.recipes || []).forEach(r => {
        const truth = BOOK_RECIPES.find(x => lc(r.name).startsWith(lc(x.title).slice(0, 14)) || lc(x.title).startsWith(lc(r.name).slice(0, 14)));
        if (!truth) return;
        const meal = ['breakfast', 'lunch', 'dinner', 'main'].includes(truth.is);
        const asMeal = r.kind === 'meal' && !r.review;
        if (meal !== asMeal) problems.push({ case: 'books', meal: r.name, check: 'book recipe judged wrongly', severity: 'problem', what: `really ${truth.is}, read as ${asMeal ? 'a meal' : r.kind || 'not a meal'} (${(r.fit && r.fit.why) || ''})` });
        bookRows.push({ book: b.title, name: r.name, is: truth.is, read: asMeal ? 'meal' : r.kind || 'not a meal', kcal: r.nutrition && r.nutrition.calories, protein: r.nutrition && r.nutrition.protein_g, fat: r.nutrition && r.nutrition.fat_g, review: r.review ? (r.why || 'yes') : '' });
    }));
    const missingBooks = BOOK_RECIPES.filter(x => x.book !== 'Grandma\'s Recipe Cards' && !bookRows.some(r => lc(r.name).startsWith(lc(x.title).slice(0, 14))));
    missingBooks.forEach(x => problems.push({ case: 'books', meal: x.title, check: 'book recipe not read', severity: 'problem', what: `in ${x.book}, not found when the book was read` }));
    pageErrors.forEach(e => problems.push({ case: 'app', check: 'app error', severity: 'problem', what: e }));
    results.forEach(r => { if (r.res.error) problems.push({ case: r.case.id, check: 'plan failed', severity: 'problem', what: r.res.error }); });

    const byCheck = {};
    problems.forEach(f => { byCheck[f.check] = (byCheck[f.check] || 0) + 1; });
    const notes = all.filter(f => f.severity === 'note');
    const noteBy = {};
    notes.forEach(f => { noteBy[f.check] = (noteBy[f.check] || 0) + 1; });
    const splitTotal = { web: 0, books: 0, builtin: 0, ai: 0 };
    results.forEach(r => Object.keys(splitTotal).forEach(k => { splitTotal[k] += r.res.split[k] || 0; }));
    const plans = results.length;
    const lines = [];
    lines.push(`# Plan audit${version ? ` — Nourish ${version}` : ''}`, '');
    lines.push(`${plans} full 7-day plans (${plans * 21} meals), made by the app from ${live ? 'the live recipe sites' : `${snapshotSize} saved web recipes (no internet)`}, the audit's test books and Nourish's own recipes.`, '');
    lines.push(problems.length ? `**${problems.length} problems found.**` : '**Clean: no problems found.**', '');
    lines.push(`Where the meals came from: ${splitTotal.web} web, ${splitTotal.books} books, ${splitTotal.builtin} Nourish recipes${splitTotal.ai ? `, ${splitTotal.ai} AI` : ''}.`, '');
    if (Object.keys(byCheck).length) {
        lines.push('| Check | Problems |', '|---|---|');
        Object.entries(byCheck).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => lines.push(`| ${k} | ${n} |`));
        lines.push('');
        lines.push('## Worst examples', '');
        const seen = new Set();
        Object.keys(byCheck).forEach(check => problems.filter(f => f.check === check).filter(f => { const k = f.check + f.meal + f.what; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4)
            .forEach(f => lines.push(`- **${f.check}** — ${f.meal ? `"${f.meal}"` : ''}${f.day ? ` (${f.case}, ${f.day} ${f.slot || ''})` : ` (${f.case})`}${f.source ? `, from ${f.source}` : ''}: ${f.what}`)));
        lines.push('');
    }
    if (Object.keys(noteBy).length) { lines.push('Notes (not problems): ' + Object.entries(noteBy).map(([k, n]) => `${k} ${n}`).join(', ') + '.', ''); }
    lines.push('## The test books as read', '', '| Book | Recipe | Really | Read as | kcal | Protein | Fat | Review |', '|---|---|---|---|---|---|---|---|');
    bookRows.forEach(r => lines.push(`| ${r.book} | ${r.name} | ${r.is} | ${r.read} | ${r.kcal ?? ''} | ${r.protein ?? ''} | ${r.fat ?? ''} | ${r.review} |`));
    books.filter(b => !b.count).forEach(b => lines.push('', `${b.title}: no recipes. ${b.why || ''}`));
    (files.files || []).filter(f => !f.count).forEach(f => lines.push('', `${path.basename(String(f.path))}: no recipes read. ${f.why || '(no reason given)'}`));
    if ((files.notes || []).length) lines.push('', 'What the app said about the files: ' + files.notes.map(n => (typeof n === 'string' ? n : JSON.stringify(n))).join(' · '));
    lines.push('', '## Plans', '');
    results.forEach(r => {
        const n = r.findings.filter(f => f.severity === 'problem').length;
        lines.push(`- ${r.case.id}: ${n ? `${n} problems` : 'clean'}; ${Math.round(r.res.ms / 100) / 10} s; ${r.res.split.web} web, ${r.res.split.books} books, ${r.res.split.builtin} Nourish`);
    });
    const md = lines.join('\n') + '\n';
    fs.writeFileSync(path.join(OUT, 'plan-audit.md'), md);
    if (opt('--only')) fs.writeFileSync(path.join(OUT, 'plan-full.json'), JSON.stringify(results.map(r => r.res.days), null, 1));
    fs.writeFileSync(path.join(OUT, 'plan-audit.json'), JSON.stringify({ version, problems, notes, books, results: results.map(r => ({ case: r.case, findings: r.findings, split: r.res.split, log: r.res.log, days: r.res.days.map(d => Object.fromEntries(MEALS.map(m => [m, d && d[m] ? { name: d[m].name, kcal: d[m].nutrition && d[m].nutrition.calories, protein: d[m].nutrition && d[m].nutrition.protein_g, portion: d[m].scaled && d[m].scaled.portion, description: d[m].description, source: d[m].source_name || d[m].book } : null]))) })) }, null, 1));
    process.stdout.write(md);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* leave it */ }
    return problems.length;
}

if (require.main === module) {
    main().then(n => process.exit(n ? 1 : 0), e => { console.error(e.stack || e.message); process.exit(2); });
}
module.exports = { checkMeal, checkPlan, CASES };
