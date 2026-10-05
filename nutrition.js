// Nutrition worked out in code, never taken from an AI: each ingredient line is read ("1 (15 oz) can
// chickpeas", "2 cloves garlic", "1/2 cup rolled oats"), turned into grams with USDA's own portion
// weights, looked up in the offline table (nutrition-data.js, from USDA FoodData Central), added up
// and divided by the servings. Lines that can't be matched are listed, and the result is then
// "approximate". A site's own numbers are kept only when they agree with ours (within 15%).
(function (root) {
    'use strict';

    const Units = root.NourishUnits || (typeof require === 'function' ? require('./units.js') : null);
    const FOODS = root.NourishFoods || (typeof require === 'function' ? (() => { try { return require('./nutrition-data.js'); } catch (e) { return {}; } })() : {});

    const ML = { tsp: 5, tbsp: 15, cup: 240, 'fl oz': 30, pint: 480, quart: 960, gallon: 3785, ml: 1, l: 1000 };
    const G = { oz: 28.35, lb: 453.6, g: 1, kg: 1000 };
    // Words that describe how an ingredient is cut or prepared, not what it is.
    const PREP = /\b(chopped|finely|roughly|coarsely|thinly|thickly|diced|minced|sliced|grated|shredded|crushed|peeled|seeded|deseeded|cored|trimmed|halved|quartered|cubed|julienned|torn|packed|loosely|lightly|heaping|level|rounded|softened|melted|room temperature|cold|warm|hot|cooked|uncooked|raw|fresh|freshly|frozen|thawed|drained|rinsed|and rinsed|divided|optional|to taste|for serving|for garnish|garnish|plus more|or more|as needed|about|approximately|large|medium|small|extra|boneless|skinless|skin-on|bone-in|organic|good quality|low[- ]sodium|reduced[- ]sodium|unsalted|salted|whole|ground|dried|toasted|roasted|fat[- ]free|lean|of|the|a|an)\b/g;
    // Herbs, spices and seasonings: almost no calories, so a missing amount doesn't matter.
    const FREE = /\b(salt|pepper|cumin|paprika|chili powder|chilli|cayenne|flakes|turmeric|coriander|cinnamon|oregano|basil|thyme|rosemary|parsley|cilantro|dill|mint|chives|bay lea(?:f|ves)|garlic powder|onion powder|nutmeg|cloves|cardamom|allspice|star anise|anise|cinnamon sticks?|seasoning|spice|herbs?|zest|vanilla|water|ice|cooking spray|nonstick spray|baking soda|bicarbonate of soda|baking powder|yeast|stevia|splenda|truvia|sweetener|sucralose|erythritol|monk fruit|mrs dash|msg|food colou?ring|liquid smoke|bitters)\b/;

    // Everyday names the USDA table doesn't have, read as the closest food it does.
    const EXTRA = {
        'hamburger buns': 'bread', 'hamburger bun': 'bread', 'burger buns': 'bread', 'burger bun': 'bread', 'buns': 'bread', 'bun': 'bread',
        'sub rolls': 'bread', 'sub roll': 'bread', 'hoagie rolls': 'bread', 'dinner rolls': 'bread', 'crusty bread': 'bread', 'baguette': 'bread',
        'bean sprouts': 'cabbage', 'red chilies': 'jalapeno', 'red chili': 'jalapeno', 'thai chilies': 'jalapeno', 'green chilies': 'jalapeno', 'chilies': 'jalapeno',
        'chili bean paste': 'miso', 'doubanjiang': 'miso', 'arugula': 'lettuce', 'rocket': 'lettuce',
        // Cured and salted meats, and legumes the table names differently.
        'salt pork': 'bacon', 'fatback': 'bacon', 'pork belly': 'bacon', 'pancetta': 'bacon', 'guanciale': 'bacon',
        'pigeon peas': 'chickpeas', 'gandules': 'chickpeas', 'black-eyed peas': 'chickpeas', 'black eyed peas': 'chickpeas', 'split peas': 'cooked lentils', 'yellow split peas': 'cooked lentils',
        // British names.
        'natural yogurt': 'yogurt', 'stock cube': 'chicken broth', 'stock pot': 'chicken broth', 'gem lettuce': 'lettuce', 'little gem': 'lettuce',
        'plain flour': 'flour', 'self raising flour': 'flour', 'self-raising flour': 'flour', 'wholemeal flour': 'flour', 'caster sugar': 'sugar', 'demerara sugar': 'brown sugar',
        'icing sugar': 'powdered sugar', 'beetroot': 'beet', 'beetroots': 'beet', 'back bacon': 'bacon', 'streaky bacon': 'bacon', 'gammon': 'ham', 'prawns': 'shrimp', 'king prawns': 'shrimp',
        'single cream': 'half and half', 'soured cream': 'sour cream', 'mince': 'ground beef', 'beef mince': 'ground beef', 'pork mince': 'ground pork', 'turkey mince': 'ground turkey', 'lamb mince': 'ground lamb',
        'mixed salad leaves': 'lettuce', 'salad leaves': 'lettuce', 'mixed greens': 'lettuce', 'mixed salad greens': 'lettuce', 'spring mix': 'lettuce', 'salad greens': 'lettuce',
        'tenderstem': 'broccoli', 'sweetcorn': 'corn', 'mangetout': 'snow peas', 'sugar snap peas': 'snow peas', 'chestnut mushrooms': 'mushrooms', 'baby plum tomatoes': 'cherry tomatoes',
    };
    // Common foods the USDA extract doesn't carry (per 100 g: kcal, protein, carbs, fat; USDA SR
    // Legacy values or a product's label), added when missing. British names map onto them below.
    const SUPPLEMENT = {
        rutabaga: { n: [37, 1.1, 8.6, 0.2, 2.3, 0, 43, 305, 20], a: ['swede', 'swedes'], u: [[386, 'medium'], [140, 'cup']] },
        turnip: { n: [28, 0.9, 6.4, 0.1, 1.8, 0, 30, 191, 11], a: ['turnips'], u: [[122, 'medium'], [130, 'cup']] },
        'vegetable spread': { n: [535, 0.2, 0.7, 59, 0, 0, 7, 30, 1], a: ['margarine', 'buttery spread', 'light spread', 'spread', 'smart balance', 'flora'], u: [[14, 'tbsp'], [5, 'tsp']] },
        buttermilk: { n: [40, 3.3, 4.8, 0.9, 0, 0, 116, 151, 11], a: [], u: [[245, 'cup']] },
        'swiss chard': { n: [19, 1.8, 3.7, 0.2, 1.6, 0, 51, 379, 81], a: ['chard', 'rainbow chard'], u: [[36, 'cup'], [48, 'leaf']] },
        molasses: { n: [290, 0, 74.7, 0.1, 0, 0, 205, 1464, 242], a: ['black treacle', 'treacle'], u: [[20, 'tbsp']] },
        'golden syrup': { n: [325, 0, 81, 0, 0, 0, 10, 20, 2], a: ['cane syrup'], u: [[21, 'tbsp']] },
        quark: { n: [72, 12, 4, 0.2, 0, 0, 90, 140, 10], a: [], u: [[225, 'cup']] },
        'yeast extract': { n: [260, 39, 24, 0.5, 3.5, 0, 70, 2600, 180], a: ['marmite', 'vegemite'], u: [[5, 'tsp']] },
        'creme fraiche': { n: [292, 2.4, 2.8, 30, 0, 0.3, 75, 100, 8], a: ['crème fraîche'], u: [[15, 'tbsp']] },
        'double cream': { n: [340, 2.8, 2.7, 36, 0, 1.6, 66, 95, 7], a: ['heavy cream', 'whipping cream'], u: [[15, 'tbsp'], [238, 'cup']] },
        // Bony cuts, per 100 g of the part that's eaten (USDA SR Legacy). Bought by weight, most of
        // that weight is bone: EDIBLE below counts only the meat (or the marrow).
        'bone marrow': { n: [786, 6.7, 0, 84.4, 0, 0, 2, 32, 2], a: ['marrow bones', 'marrow bone', 'beef marrow bones', 'beef marrow bone', 'beef marrow', 'marrow'], u: [[25, 'bone']] },
        'pork ribs': { n: [277, 15.5, 0, 23.4, 0, 0.6, 15, 242, 15], a: ['pork spare ribs', 'pork spareribs', 'spare ribs', 'spareribs', 'baby back ribs', 'baby back pork ribs', 'back ribs', 'st louis ribs', 'pork back ribs', 'ribs'], u: [[700, 'rack']] },
        'beef short ribs': { n: [388, 14.4, 0, 36.2, 0, 0.1, 9, 232, 14], a: ['short ribs', 'beef ribs', 'flanken'], u: [[250, 'rib']] },
        oxtail: { n: [196, 23, 0, 11, 0, 0, 10, 250, 18], a: ['oxtails', 'oxtail pieces'], u: [[150, 'piece']] },
        barley: { n: [352, 9.9, 77.7, 1.2, 15.6, 0, 29, 280, 79], a: ['pearl barley', 'pot barley', 'hulled barley', 'barley'], u: [[200, 'cup']] },
        plantain: { n: [122, 1.3, 31.9, 0.4, 2.3, 0, 3, 499, 37], a: ['plantains', 'green plantains', 'green plantain', 'ripe plantains', 'platanos'], u: [[179, 'medium']] },
        // Frozen filled dumplings, counted by the piece (about 25 g each), never as the meat in them.
        dumplings: { n: [210, 8.5, 27, 7.5, 1.5, 2.2, 25, 150, 15], a: ['dumpling', 'potstickers', 'potsticker', 'pot stickers', 'gyoza', 'wontons', 'wonton', 'dim sum', 'mandu', 'momos', 'chicken potstickers', 'pork potstickers', 'chicken dumplings', 'pork dumplings', 'shrimp dumplings', 'vegetable dumplings', 'veggie dumplings', 'chicken gyoza', 'pork gyoza', 'vegetable gyoza', 'chicken wontons', 'pork wontons', 'shrimp wontons', 'frozen potstickers', 'frozen dumplings', 'frozen gyoza', 'frozen wontons', 'chicken and vegetable potstickers', 'pork and chive dumplings'], u: [[25, 'piece'], [25, 'none']] },
        // Whole dried berries and seeds put in a pot and fished out (a few tenths of a gram each).
        'whole spice berries': { n: [263, 6, 72, 8.7, 21.6, 2.5, 661, 1044, 135], a: ['allspice berries', 'allspice berry', 'whole allspice', 'juniper berries', 'juniper berry', 'peppercorns', 'black peppercorns', 'whole peppercorns', 'whole black peppercorns', 'pink peppercorns', 'szechuan peppercorns', 'sichuan peppercorns'], u: [[0.2, 'berry'], [0.2, 'none'], [2, 'tsp'], [6, 'tbsp']] },
        // A whole nutmeg weighs about 7 g.
        'whole nutmeg': { n: [525, 5.8, 49.3, 36.3, 20.8, 25.9, 184, 350, 183], a: ['nutmeg seed', 'whole nutmegs'], u: [[7, 'none'], [7, 'whole']] },
        'chili crisp': { n: [600, 4, 12, 58, 4, 8, 30, 200, 30], a: ['chili crunch', 'chilli crisp', 'chili oil crisp', 'spicy chili crisp', 'chili onion crunch'], u: [[13, 'tbsp'], [4, 'tsp']] },
        'sweet chili sauce': { n: [207, 0.4, 51, 0.6, 1, 0, 8, 90, 4], a: ['thai sweet chili sauce', 'sweet chilli sauce', 'thai sweet chilli sauce'], u: [[19, 'tbsp']] },
    };
    Object.keys(SUPPLEMENT).forEach(k => { if (!FOODS[k]) FOODS[k] = SUPPLEMENT[k]; });
    // Corrections to the USDA extract for what people actually buy. USDA's "tofu" is a dense firm tofu
    // set with calcium sulfate (683 mg calcium per 100 g); a typical supermarket block is about a third
    // of that, with fewer calories (0.1.13 credited one tofu dish with 1,830 mg more calcium). A block
    // is 14 oz (396 g), not 100 g. Silken tofu is lighter still.
    FOODS.tofu = { n: [110, 12, 2.5, 6.5, 1, 1, 200, 180, 40], a: ['firm tofu', 'extra firm tofu', 'extra-firm tofu', 'medium firm tofu', 'super firm tofu', 'tofu block'], u: [[396, 'block'], [396, 'package'], [252, 'cup']] };
    FOODS['silken tofu'] = { n: [55, 4.8, 2.9, 2.7, 0.1, 0.4, 31, 120, 29], a: ['soft tofu', 'silken'], u: [[340, 'block'], [340, 'package'], [248, 'cup']] };
    // Barley is its own grain, not another name for farro (the USDA extract listed it so).
    if (FOODS.farro && Array.isArray(FOODS.farro.a)) FOODS.farro.a = FOODS.farro.a.filter(x => !/barley/.test(x));

    const FISH = /\b(salmon|cod|tilapia|trout|haddock|halibut|pollock|mackerel|sea bass|snapper|tuna steak|swordfish|fish)\b/;
    // Grams in one of a thing the table weighs another way (a rice cake, a lasagna sheet, a bun).
    const EACH = { 'rice cake': 9, ginger: 8, eggplant: 450, pasta: 20, 'whole wheat pasta': 20, 'egg noodles': 20, dumplings: 25, 'whole spice berries': 0.2, 'whole nutmeg': 7, nutmeg: 2, tofu: 396, 'silken tofu': 340 };
    const EACH_PHRASE = [[/\b(buns?|rolls?)\b/, 60], [/\bbaguette\b/, 250]];
    // A cup of something light and airy (chips, flakes) weighs far less than a cup of water.
    const CUP = { 'tortilla chips': 28, 'potato chips': 20, popcorn: 8, 'buttered popcorn': 11, coconut: 80, pretzels: 45, cereal: 30, crackers: 60 };

    // The part of a bony or shelled food that's eaten, when it's bought by weight ("2 lb bone-in
    // chicken thighs", "4 lb baby back ribs", "2 lb shell-on shrimp"): USDA's refuse (bone, shell)
    // taken off. Foods that are always bony count this way; others only when the line says bone-in,
    // on the bone, shell-on or whole.
    const EDIBLE = [
        [/\bmarrow\b/, 0.2, true], [/\boxtails?\b/, 0.45, true], [/\b(short ribs?|beef ribs?|flanken)\b/, 0.55, true], [/\bribs?\b/, 0.7, true],
        [/\bmussels?\b/, 0.4, true], [/\bclams?\b/, 0.3, true], [/\b(whole crabs?|crab legs?|whole lobsters?|lobster tails?)\b/, 0.4, true],
        [/\b(drumsticks?|chicken legs?|leg quarters?)\b/, 0.7, true], [/\bwings?\b/, 0.6, true],
        [/\bhead[- ]on\b/, 0.55, false], [/\b(shrimp|prawns?)\b/, 0.85, false], [/\bwhole (chicken|turkey|duck)\b|\bchicken pieces\b|\bpieces of chicken\b/, 0.7, false],
        [/\bthighs?\b/, 0.8, false], [/\bbreasts?\b/, 0.85, false], [/\bchops?\b/, 0.85, false], [/\b(shoulder|butt|leg of lamb|lamb leg|shanks?|hocks?)\b/, 0.75, false],
        [/\bwhole (fish|trout|snapper|sea bass|bream|mackerel)\b/, 0.5, false],
    ];
    const BONY = /\b(bone[- ]in|on the bone|skin[- ]on|shell[- ]on|in (their |the )?shells?|head[- ]on|whole (chicken|turkey|duck|fish|trout|snapper|sea bass|bream|mackerel)|chicken pieces|pieces of chicken)\b/;
    function edibleShare(raw, key) {
        const t = clean(raw) + ' ' + (key || '');
        if (/\b(boneless|meat only|picked|shelled|peeled|deveined|cooked meat|canned|tinned|lump)\b/.test(t) && !/\bmarrow\b/.test(t)) return 1;
        const hit = EDIBLE.find(([re, , always]) => re.test(t) && (always || BONY.test(clean(raw))));
        return hit ? hit[1] : 1;
    }
    // Rice, pasta and grains said to be cooked ("2 cups cooked rice", "1 cup brown rice, cooked"):
    // counted as cooked, not dry (a cup of cooked rice is about 205 kcal, dry about 675). A weight
    // "cooked according to the packet" is the dry weight.
    const COOKED_TWIN = { rice: 'cooked rice', 'brown rice': 'cooked brown rice', quinoa: 'cooked quinoa', pasta: 'cooked pasta', 'whole wheat pasta': 'cooked pasta', lentils: 'cooked lentils' };
    const COOKED_SHARE = { barley: 0.3, udon: 0.38, 'egg noodles': 0.38, 'rice noodles': 0.3, couscous: 0.35, farro: 0.4, oats: 0.15, 'black beans': 0.38, 'kidney beans': 0.38, 'white beans': 0.38, 'pinto beans': 0.38 };
    function saysCooked(raw, unit) {
        const t = String(raw).toLowerCase();
        if (/\b(uncooked|dry|dried|raw)\b/.test(t)) return false;
        if (!/\b(cooked|pre-?cooked|precooked|leftover|steamed|boiled|prepared)\b/.test(t)) return false;
        // "115 g ramen noodles, cooked according to the packet": the weight before cooking.
        if (/\b(cooked|prepared) (according to|as per|following|per) (the )?(packet|package|pack|box|instructions)|to package instructions|packet directions|package directions/.test(t) && G[unit]) return false;
        return true;
    }
    // Oil for deep or shallow frying is mostly left in the pan: only what the food soaks up counts
    // (about a tablespoon a serving), whatever the amount in the pot.
    const FRYING = /\b(for (deep[- ]?|shallow[- ]?)?frying|to (deep[- ]?)?fry|for the fryer|for deep[- ]?fat frying|deep[- ]fry(ing)?|for frying)\b/i;

    let INDEX = null;   // [phrase, key], longest phrases first
    function index() {
        if (INDEX) return INDEX;
        INDEX = Object.keys(EXTRA).filter(k => FOODS[EXTRA[k]]).map(k => [k, EXTRA[k]]);
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
        return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // crème fraîche → creme fraiche
            .replace(/\byoghurts?\b/g, 'yogurt').replace(/\b(courgettes?)\b/g, 'zucchini').replace(/\baubergines?\b/g, 'eggplant')
            .replace(/\([^)]*\)/g, ' ').replace(/,.*$/, ' ')        // "(about 2 cups)", ", chopped"
            .replace(/[^a-z0-9%' -]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // The table entry for an ingredient's words, or null. The patterns are made once, and each
    // ingredient's answer is remembered (plans read the same lines many times).
    let PATTERNS = null;
    const matched = new Map();
    function matchFood(text) {
        const base = clean(text);
        if (matched.has(base)) return matched.get(base);
        if (!PATTERNS) PATTERNS = index().map(([phrase, key]) => [new RegExp('(^|[^a-z])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])'), phrase, key, phrase.split(' ')[0]]);
        const variants = [base, base.split(' ').map(singular).join(' '), base.replace(PREP, ' ').replace(/\s+/g, ' ').trim()];
        variants.push(variants[2].split(' ').map(singular).join(' '));
        const all = variants.join(' | ');
        let out = null;
        for (const [re, phrase, key, first] of PATTERNS) {
            if (all.indexOf(first) < 0) continue;   // quick check before the pattern
            if (variants.some(v => re.test(v))) { out = { key, food: FOODS[key], phrase }; break; }
        }
        if (matched.size > 20000) matched.clear();
        matched.set(base, out);
        return out;
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
    function eachGrams(food, key, phrase) {
        const byPhrase = EACH_PHRASE.find(([re]) => re.test(phrase || ''));
        if (byPhrase) return byPhrase[1];
        if (EACH[key]) return EACH[key];
        // A fish fillet in a recipe is a portion (about 150–170 g), not USDA's whole side of a fish.
        if (/\bfillets?\b/.test(phrase || '') || FISH.test(key)) { const g = portionGrams(food, ['fillet']); if (g) return Math.min(g, 170); }
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

    // Amounts without a number: "small bunch coriander", "a handful of rocket", "a knob of butter".
    const WORD_AMOUNT = [
        [/^(?:a\s+)?(?:small\s+|large\s+)?bunch(?:\s+of)?\s+/i, 1, 'bunch'], [/^(?:a\s+(?:small\s+|large\s+)?|small\s+|large\s+)?handful(?:\s+of)?\s+/i, 1, 'handful'],
        [/^(?:a\s+)?(?:small\s+|large\s+)?knob(?:\s+of)?\s+/i, 10, 'g'], [/^(?:a\s+)?splash(?:\s+of)?\s+/i, 15, 'ml'], [/^(?:a\s+)?drizzle(?:\s+of)?\s+/i, 5, 'ml'],
        [/^(?:a\s+)?(?:few\s+)?sprigs?(?:\s+of)?\s+/i, 2, 'sprig'], [/^(?:a\s+)?pinch(?:\s+of)?\s+/i, 1, 'pinch'], [/^(?:a\s+)?dash(?:\s+of)?\s+/i, 1, 'dash'],
    ];
    // "Juice of 1 lemon", "juice of ½ lime": the juice, about 45 g a lemon, 30 g a lime, 80 g an orange.
    const JUICE = /^(?:the\s+)?juice\s+(?:of|from)\s+(\d+(?:\.\d+)?|½|half|a|an|one|two|1\/2)\s+(?:\w+\s+)?(lemons?|limes?|oranges?)\b/i;
    function readLine(line, servings = 1) {
        let raw = String(line || '').trim();
        if (!raw) return null;
        const juice = raw.match(JUICE);
        if (juice) {
            const n = { '½': 0.5, half: 0.5, '1/2': 0.5, a: 1, an: 1, one: 1, two: 2 }[juice[1].toLowerCase()] || Number(juice[1]) || 1;
            const fruit = juice[2].toLowerCase().replace(/s$/, '');
            const key = `${fruit} juice`;
            if (FOODS[key]) return { grams: n * ({ lemon: 45, lime: 30, orange: 80 }[fruit]), key, free: false };
        }
        if (/^(?:the\s+)?(?:finely\s+)?(?:grated\s+)?zest\s+(?:of|from)\b/i.test(raw)) return { grams: 0, key: null, free: true };
        let item = Units ? Units.splitIngredient(raw) : { qty: null, unit: '', text: raw };
        if (item.qty == null) {
            const w = WORD_AMOUNT.find(([re]) => re.test(raw));
            if (w) item = { qty: w[1], unit: w[2], text: raw.replace(w[0], '') };
        }
        // A range ("2-3 cloves", "200-250 g") counts as its middle.
        if (item.qtyHigh) item = Object.assign({}, item, { qty: (item.qty + item.qtyHigh) / 2 });
        const words = (item.text || raw) + (item.note ? ' ' + item.note : '');
        // "fat-free, reduced-sodium chicken broth": the words after a comma can be the food itself.
        const m = matchFood(words) || matchFood(raw) || matchFood(words.replace(/,/g, ' '));
        const low = !m || FOODS[m.key].n[0] < 400 || /spray/.test(m.key);
        const free = FREE.test(clean(words)) && low;
        if (!m) return free ? { grams: 0, key: null, free: true } : { unmatched: true, line: raw };
        // Cooked rice, pasta and grains: the cooked food, or the dry food's share of a cooked weight.
        if (saysCooked(raw, item.unit) && COOKED_TWIN[m.key] && FOODS[COOKED_TWIN[m.key]]) Object.assign(m, { key: COOKED_TWIN[m.key], food: FOODS[COOKED_TWIN[m.key]] });
        const cookedShare = saysCooked(raw, item.unit) && COOKED_SHARE[m.key] ? COOKED_SHARE[m.key] : 1;
        const food = m.food;
        let qty = item.qty;
        let grams = null;
        // "8 marrow bones (about 3 pounds)", "2 racks ribs (about 4 lb)": the weight in brackets.
        const about = raw.match(/\((?:about|approx\.?|approximately|roughly|around|total(?:ling)?)?\s*(\d+(?:\.\d+)?|\d+\s+\d\/\d|\d\/\d)\s*(pounds?|lbs?|kg|kilos?|grams?|g|ounces?|oz)\b[^)]*\)/i)
            || raw.match(/,\s*(?:about|approx\.?|approximately|roughly|around|total(?:ling)?)\s+(\d+(?:\.\d+)?|\d+\s+\d\/\d|\d\/\d)\s*(pounds?|lbs?|kg|kilos?|grams?|g|ounces?|oz)\b/i);
        if (about && qty != null && !G[item.unit] && !ML[item.unit] && !/\b(cans?|tins?|packages?|packets?|jars?|bags?|containers?|cartons?|blocks?|boxes?)\b/i.test(raw)) {
            const q = about[1].includes('/') ? about[1].split(/\s+/).reduce((a, x) => a + (x.includes('/') ? Number(x.split('/')[0]) / Number(x.split('/')[1]) : Number(x)), 0) : Number(about[1]);
            const u = about[2].toLowerCase();
            grams = q * (/^(lb|pound)/.test(u) ? 453.6 : /^(kg|kilo)/.test(u) ? 1000 : /^(oz|ounce)/.test(u) ? 28.35 : 1);
        }
        const pack = raw.match(PACK);
        if (grams != null) { /* the weight in brackets */ }
        else if (pack && /\b(cans?|tins?|packages?|packets?|jars?|bags?|containers?|cartons?|blocks?|boxes?)\b/i.test(raw)) {
            const size = Number(pack[1]);
            const unit = pack[2].toLowerCase();
            const each = /^(oz|ounce)/.test(unit) ? size * 28.35 : /^(lb|pound)/.test(unit) ? size * 453.6 : size;
            // How many packs: the amount in front ("2 (15 oz) cans", "½ (15 oz.) can"), unless that
            // amount is the pack's own size ("15 oz can tomatoes").
            const count = qty != null && !(G[item.unit] || ML[item.unit]) ? qty : 1;
            grams = each * (count || 1);
        } else if (qty != null) {
            const unit = item.unit;
            if (G[unit]) grams = qty * G[unit];
            else if (ML[unit]) grams = CUP[m.key] ? qty * ML[unit] / 240 * CUP[m.key] : qty * ML[unit] * gramsPerMl(food);
            else if (unit === 'clove') grams = qty * (portionGrams(food, ['clove']) || 3);
            else if (unit === 'can') grams = qty * (portionGrams(food, ['can']) || 400);
            else if (unit === 'slice') grams = qty * (portionGrams(food, ['slice']) || 30);
            else if (unit === 'pinch' || unit === 'dash') grams = qty * 0.4;
            else if (unit === 'handful') grams = qty * (FOODS[m.key].n[0] < 60 ? 20 : 30);
            else if (unit === 'bunch') grams = qty * 100;
            else if (unit === 'sprig') grams = qty * 1;
            else if (unit === 'head') grams = qty * (portionGrams(food, ['head']) || (m.key === 'garlic' ? 50 : 500));
            else if (unit === 'stick') grams = qty * (m.key === 'butter' ? 113 : m.key === 'celery' ? 40 : 3);
            else if (unit === 'package') grams = qty * 300;
            else if (unit === 'scoop') grams = qty * 30;
            else if (unit === 'fillet') grams = qty * Math.min(170, portionGrams(food, ['fillet']) || 150);
            else if (unit === 'piece') grams = qty * eachGrams(food, m.key, m.phrase);
            else if (!unit && /^\s*[\d.\/½¼¾]+\s+leaves?\b/i.test(raw)) grams = qty * (/lettuce|cabbage|chard|kale|spinach|collard/.test(m.key) ? 10 : 0.5);   // 8 lettuce leaves, 6 basil leaves
            else if (!unit && FREE.test(clean(words)) && /\b(sticks?|star anise|anise|pods?|cloves|bay lea(?:f|ves)|leaves|sprigs?|whole)\b/.test(clean(raw))) grams = qty * 1.5;   // 2 cinnamon sticks, 3 star anise
            else grams = qty * eachGrams(food, m.key, m.phrase);
        } else {
            // No amount ("salt to taste", "cooking spray"): seasonings count as nothing; anything else
            // is a guess, so the recipe is marked approximate.
            if (free) return { grams: 0, key: m.key, free: true };
            const typical = assumedAmount(raw, m.key);
            if (typical) return { grams: typical.grams * Math.max(1, Number(servings) || 1), key: m.key, assumed: typical.label };
            return { unmatched: true, line: raw, key: m.key };
        }
        // Frying oil: what the food soaks up, never the whole pot.
        if (FRYING.test(raw) && /\b(oil|lard|shortening|ghee|fat|dripping)\b/.test(clean(raw) + ' ' + m.key)) {
            const absorbed = 14 * Math.max(1, Number(servings) || 1);
            if (grams > absorbed) return { grams: absorbed, key: m.key, free, assumed: '1 tbsp per serving (absorbed when frying; the rest stays in the pan)' };
        }
        // Bones and shells aren't eaten: by weight, only the edible part counts. Counted pieces
        // ("6 chicken thighs") already use the weight of the meat.
        const weighed = G[item.unit] || (grams != null && about) || (pack && /\b(packages?|packets?|bags?|containers?|cartons?|boxes?)\b/i.test(raw));
        const share = weighed ? edibleShare(raw, m.key) : (m.key === 'bone marrow' || m.key === 'pork ribs' || m.key === 'oxtail' || m.key === 'beef short ribs') && !portionGrams(food, [item.unit || 'none']) ? edibleShare(raw, m.key) : 1;
        const out = { grams: Math.max(0, grams) * share * cookedShare, key: m.key, free };
        if (share < 1) out.edible = share;
        if (cookedShare < 1) out.cooked = true;
        return out;
    }

    // A line that hardly changes a recipe's calories when it can't be read: no amount, a small one
    // (a teaspoon, a pinch, a few grams), or a garnish, seasoning or sweetener. A recipe whose only
    // unreadable lines are like this is kept, with its nutrition marked approximate.
    function isMinor(line) {
        const raw = String(line || '');
        const t = clean(raw);
        if (FREE.test(t) || /\b(to taste|for (serving|garnish|garnishing|decoration|dusting|greasing)|optional|to serve|as needed|garnish)\b/i.test(raw)) return true;
        const item = Units ? Units.splitIngredient(raw) : { qty: null };
        if (item.qty == null) return !/\b(cups?|lbs?|pounds?|kg|chicken|beef|pork|lamb|fish|salmon|rice|pasta|noodles|potato(es)?|beans|cheese|cream|butter|oil)\b/i.test(t);
        if (['tsp', 'pinch', 'dash', 'sprig'].indexOf(item.unit) >= 0) return item.qty <= 3;
        if (item.unit === 'g' || item.unit === 'ml') return item.qty <= 10;
        if (item.unit === 'tbsp') return item.qty <= 1 && !/\b(oil|butter|sugar|honey|syrup|cream|mayo|peanut|nut butter|tahini)\b/.test(t);
        return false;
    }

    // { calories, protein_g, carbs_g, fat_g } per serving, the lines that couldn't be matched, and
    // whether the result is approximate.
    // Ingredients that are thrown away, not eaten: a brine, the water something soaks in, a marinade
    // or buttermilk the food is lifted out of. By ingredient group ("For the brine", "Brine:") or by
    // what the steps say ("soak the bones in the brine", "lift the chicken out of the buttermilk",
    // "discard the marinade"). Returns { index: share eaten } (0 for a brine, about a fifth of a
    // marinade or buttermilk that clings to the food).
    const HEADER = /^(?:for (?:the )?)?([a-z][a-z &'-]{1,40}?)\s*:?\s*$/i;
    function isHeader(line) {
        const t = String(line || '').trim();
        if (!t || /\d|½|¼|¾/.test(t)) return false;
        return /:$/.test(t) || /^for (the )?[a-z]/i.test(t) && t.split(/\s+/).length <= 5;
    }
    function discarded(ingredients, steps) {
        const out = {};
        const how = String((steps || []).join(' ')).toLowerCase();
        let group = '';
        (ingredients || []).forEach((line, i) => {
            if (isHeader(line)) { group = String(line).toLowerCase(); return; }
            if (/\b(brine|brining|soaking)\b/.test(group)) out[i] = 0;
        });
        const liquids = new Set();
        const re = /\b(?:lift|remove|take|drain|shake)\b[^.]{0,40}?\b(?:out of|from|off)\s+(?:the\s+)?(brine|buttermilk|marinade|milk|soaking (?:liquid|water)|water|yogh?urt)\b|\bdiscard(?:ing)?\s+(?:the\s+)?(brine|buttermilk|marinade|soaking (?:liquid|water)|water)\b|\b(?:remove|drain)\s+(?:the\s+)?\w+\s+from\s+the\s+(brine|marinade)\b/g;
        let m;
        while ((m = re.exec(how))) liquids.add(m[1] || m[2] || m[3]);
        const brined = /\bbrine\b/.test(how);
        (ingredients || []).forEach((line, i) => {
            if (i in out || isHeader(line)) return;
            const t = clean(line);
            // The salt, sugar and water of a brine the steps make ("dissolve the salt in the water to make a brine").
            if (brined && /\b(salt|sugar|brown sugar|water|peppercorns|bay)\b/.test(t) && /\b(cups?|quarts?|gallons?|litres?|liters?|l)\b|\b[2-9]\d* ?(tbsp|tablespoons?)\b|\b\d+\s*\/\s*\d+\s*cups?\b/.test(String(line).toLowerCase())) { out[i] = 0; return; }
            liquids.forEach(liq => { if (new RegExp(`\\b${liq.split(' ')[0]}\\b`).test(t) && !/\b(oil)\b/.test(t)) out[i] = /brine|water|soaking/.test(liq) ? 0 : 0.2; });
        });
        return out;
    }

    function calculate(ingredients, servings, steps) {
        const per = Math.max(1, Number(servings) || 1);
        const thrown = steps ? discarded(ingredients, steps) : (ingredients || []).some(isHeader) ? discarded(ingredients, []) : {};
        const total = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
        // Vitamin D (µg), calcium, potassium and magnesium (mg), for the week's check (planner.js).
        const micros = { vitd: 0, ca: 0, k: 0, mg: 0 };
        let grams = 0;
        const unmatched = [];
        const lines = [];
        const assumed = [];
        (ingredients || []).forEach((line, idx) => {
            if (isHeader(line)) return;   // "For the brine", "Sauce:": a heading, not an ingredient
            const r = readLine(line, per);
            if (!r) return;
            if (idx in thrown) {
                if (r.unmatched) return;
                r.grams *= thrown[idx];
                r.discarded = thrown[idx] === 0 ? 'thrown away' : 'mostly thrown away';
            }
            if (r.unmatched) { unmatched.push(r.line); return; }
            const n = r.key ? FOODS[r.key].n : [0, 0, 0, 0];
            const f = r.grams / 100;
            total.calories += n[0] * f; total.protein_g += n[1] * f; total.carbs_g += n[2] * f; total.fat_g += n[3] * f;
            total.fiber_g += (n[4] || 0) * f;
            micros.vitd += (n[5] || 0) * f; micros.ca += (n[6] || 0) * f; micros.k += (n[7] || 0) * f; micros.mg += (n[8] || 0) * f;
            grams += r.grams;
            // Per line, per serving: the breakdown people can check.
            lines.push({ line, key: r.key, grams: Math.round(r.grams), kcal: Math.round(n[0] * f / per), protein: Math.round(n[1] * f / per * 10) / 10, assumed: r.assumed || undefined, edible: r.edible, discarded: r.discarded || undefined });
            if (r.assumed) assumed.push({ line: String(line), amount: r.assumed });
        });
        const round = v => Math.round(v / per);
        const r1 = v => Math.round(v / per * 10) / 10;
        return {
            nutrition: { calories: round(total.calories), protein_g: round(total.protein_g), carbs_g: round(total.carbs_g), fat_g: round(total.fat_g), fiber_g: r1(total.fiber_g),
                micros: { vitd: r1(micros.vitd), ca: round(micros.ca), k: round(micros.k), mg: round(micros.mg) } },
            // Calories per gram of the dish (its "calorie density"): lower fills you up for fewer calories.
            density: grams > 0 ? Math.round(total.calories / grams * 100) / 100 : null,
            unmatched, lines, assumed, approximate: unmatched.length > 0,
        };
    }

    // A recipe's nutrition, settled: our calculation, unless the source's own numbers agree with it
    // (then the source's are kept). Sets nutrition, nutrition_basis ('calculated' | 'source') and
    // nutrition_unmatched (lines we couldn't match: the numbers are approximate).
    function settle(recipe) {
        if (!recipe || !Array.isArray(recipe.ingredients)) return recipe;
        const servings = Math.max(1, Number(recipe.servings) || 1);
        const c = calculate(recipe.ingredients, servings, recipe.steps);
        // The source's own published numbers, kept as they were the first time (settle can run again).
        if (!recipe.source_nutrition && recipe.nutrition && Number(recipe.nutrition.calories) > 0 && recipe.nutrition_basis == null && !recipe.from_book && !recipe.builtin && !recipe.ai) {
            const o = recipe.nutrition;
            recipe.source_nutrition = { calories: Math.round(o.calories), protein_g: o.protein_g != null ? Math.round(o.protein_g) : null, carbs_g: o.carbs_g != null ? Math.round(o.carbs_g) : null, fat_g: o.fat_g != null ? Math.round(o.fat_g) : null };
        }
        const own = recipe.nutrition && Number(recipe.nutrition.calories) > 0 ? recipe.nutrition : null;
        const calc = c.nutrition;
        let keepOwn = false;
        if (own && calc.calories > 0) keepOwn = Math.abs(own.calories - calc.calories) / calc.calories <= 0.15;
        else if (own && !c.lines.length) keepOwn = true;   // nothing matched at all: the source's numbers are all we have
        recipe.nutrition = keepOwn ? { calories: Math.round(own.calories), protein_g: own.protein_g != null ? Math.round(own.protein_g) : calc.protein_g, carbs_g: own.carbs_g != null ? Math.round(own.carbs_g) : calc.carbs_g, fat_g: own.fat_g != null ? Math.round(own.fat_g) : calc.fat_g,
            fiber_g: calc.fiber_g, micros: calc.micros } : calc;
        recipe.kcal_per_g = c.density || undefined;
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

    const api = { calculate, settle, readLine, matchFood, isMinor, isHeader, discarded, edibleShare, lookupOnline, FOODS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishNutrition = api;
})(typeof window !== 'undefined' ? window : globalThis);
