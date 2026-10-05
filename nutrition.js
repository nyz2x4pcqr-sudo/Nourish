// Nutrition worked out in code, never taken from an AI: each ingredient line is read ("1 (15 oz) can
// chickpeas", "2 cloves garlic", "1/2 cup rolled oats"), turned into grams with USDA's own portion
// weights, looked up in the offline table (nutrition-data.js, from USDA FoodData Central), added up
// and divided by the servings. Lines that can't be matched are listed, and the result is then
// "approximate". A site's own numbers are kept only when they agree with ours (within 15%).
(function (root) {
    'use strict';

    const Units = root.NourishUnits || (typeof require === 'function' ? require('./units.js') : null);
    const FOODS = root.NourishFoods || (typeof require === 'function' ? (() => { try { return require('./nutrition-data.js'); } catch (e) { return {}; } })() : {});

    const ML = { tsp: 5, tbsp: 15, cup: 240, 'fl oz': 30, pint: 480, quart: 960, gallon: 3840, ml: 1, l: 1000 };
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
        // Cuts the table names differently (their bones are taken off below: EDIBLE).
        'lamb shanks': 'lamb', 'lamb shank': 'lamb', 'rack of lamb': 'lamb chop', 'racks of lamb': 'lamb chop', 'lamb rack': 'lamb chop', 'lamb racks': 'lamb chop',
        't-bone steaks': 'beef steak', 't-bone steak': 'beef steak', 't-bone': 'beef steak', 'porterhouse': 'beef steak', 'tomahawk': 'beef steak',
        'ham hocks': 'pork shoulder', 'ham hock': 'pork shoulder', 'pork hocks': 'pork shoulder',
        'branzino': 'cod', 'sea bass': 'cod', 'snapper': 'cod', 'red snapper': 'cod', 'whole fish': 'cod', 'sea bream': 'cod', 'white fish': 'cod',
        'chicken pieces': 'chicken', 'chicken legs': 'chicken', 'chicken leg quarters': 'chicken', 'leg quarters': 'chicken',
        'fresh fruit': 'berries', 'frozen fruit': 'berries', 'mixed fruit': 'berries', fruit: 'berries',
        'mange tout': 'snow peas', 'mange-tout': 'snow peas',
        'french beans': 'green beans', 'fine beans': 'green beans', 'haricots verts': 'green beans', 'string beans': 'green beans',
        // Nut and seed butters aren't butter (0.1.12 read "nut or seed butter" as dairy butter).
        'nut butter': 'peanut butter', 'nut or seed butter': 'peanut butter', 'seed butter': 'peanut butter', 'sunflower seed butter': 'peanut butter', 'cashew butter': 'peanut butter',
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
        // Bone marrow is almost pure fat (USDA SR Legacy, bone marrow, raw). 0.1.12 read "beef marrow
        // bones" as beef steak, whole bones and all: a fatty starter became a 46 g protein meal.
        'bone marrow': { n: [786, 6.7, 0, 84.4, 0, 0, 2, 13, 1], a: ['marrow bones', 'marrow bone', 'beef marrow bones', 'beef marrow bone', 'beef marrow', 'veal marrow bones', 'marrow'], u: [[28, 'oz']] },
        // Ribs (USDA SR Legacy: pork spareribs, raw; beef short ribs, raw), per 100 g of meat and fat.
        'pork ribs': { n: [277, 15.5, 0, 23.4, 0, 0.6, 15, 242, 15], a: ['baby back ribs', 'baby back pork ribs', 'back ribs', 'pork back ribs', 'spare ribs', 'spareribs', 'pork spare ribs', 'pork spareribs', 'st louis ribs', 'st. louis ribs', 'country style ribs', 'pork ribs', 'ribs'], u: [] },
        'beef short ribs': { n: [388, 14.4, 0, 36.2, 0, 0.1, 9, 232, 14], a: ['short ribs', 'short rib', 'beef short rib', 'beef ribs', 'flanken'], u: [] },
        oxtail: { n: [262, 19, 0, 20, 0, 0, 10, 220, 15], a: ['oxtails', 'beef oxtail'], u: [] },
        lobster: { n: [77, 16.5, 0, 0.8, 0, 0, 84, 275, 43], a: ['lobster meat', 'lobster tails', 'lobster tail', 'lobsters'], u: [[145, 'cup']] },
        clams: { n: [86, 14.7, 3.6, 1, 0, 0, 46, 314, 9], a: ['clam', 'littleneck clams', 'cockles'], u: [] },
        // USDA SR Legacy: tomatillos, raw; broad (fava) beans, raw; mixed cooked grains as cooked brown rice and quinoa.
        // Frozen unsweetened acai pulp (a packet's label: per 100 g).
        acai: { n: [60, 1, 6, 5, 3, 0, 20, 100, 15], a: ['acai pulp', 'acai puree', 'frozen acai', 'acai berry'], u: [[100, 'pack']] },
        // Cooked pasta and noodles (USDA SR Legacy, cooked, per 100 g): mostly water, about 40% of dry.
        'cooked pasta': { n: [158, 5.8, 30.9, 0.9, 1.8, 0, 7, 44, 18], a: [], u: [[140, 'cup']] },
        'cooked egg noodles': { n: [138, 4.5, 25.2, 2.1, 1.2, 0.1, 12, 38, 21], a: [], u: [[160, 'cup']] },
        'cooked rice noodles': { n: [108, 1.8, 24, 0.2, 1, 0, 4, 4, 3], a: [], u: [[176, 'cup']] },
        'cooked couscous': { n: [112, 3.8, 23.2, 0.2, 1.4, 0, 8, 58, 8], a: [], u: [[157, 'cup']] },
        'cooked udon': { n: [105, 2.6, 21.6, 0.4, 0.8, 0, 6, 9, 6], a: [], u: [[200, 'cup']] },
        tomatillo: { n: [32, 1, 5.8, 1, 1.9, 0, 7, 268, 20], a: ['tomatillos'], u: [[34, 'medium'], [132, 'cup']] },
        'fava beans': { n: [88, 7.9, 17.6, 0.7, 7.5, 0, 37, 332, 33], a: ['broad beans', 'fava bean', 'broad bean'], u: [[109, 'cup']] },
        'cooked grains': { n: [120, 3.5, 23, 1.2, 2.2, 0, 10, 60, 50], a: ['mixed grains', 'cooked mixed grains', 'grain mix', 'pouch cooked grains'], u: [[195, 'cup']] },
    };
    Object.keys(SUPPLEMENT).forEach(k => { if (!FOODS[k]) FOODS[k] = SUPPLEMENT[k]; });

    // Grams in one of a thing the table weighs another way (a rice cake, a lasagna sheet, a bun).
    const EACH = { 'rice cake': 9, ginger: 8, eggplant: 450, pasta: 20, 'whole wheat pasta': 20, 'egg noodles': 20, 'cherry tomatoes': 17, 'grape tomatoes': 8,
        'pork ribs': 1000, 'beef short ribs': 300, oxtail: 150, 'lamb chop': 700, 'bone marrow': 250, lobster: 600, 'beef steak': 300, clams: 20, 'pork shoulder': 600,
        // One prawn is about 15 g, not 100; a boneless chicken breast about 200 g.
        shrimp: 15, 'chicken breast': 200, anchovies: 4 };
    // A fish fillet as recipes mean it: one portion, about 150 g (USDA's "fillet" is half a side of salmon, 396 g).
    const FISH = /^(salmon|cod|tilapia|tuna steak|trout|haddock|halibut|sea bass|white fish|pollock|hake|mackerel)$/;
    // "2 racks of ribs", "1 slab": one rack weighs a set amount (EACH), not "one rib".
    const EACH_RACK = /\b(racks?|slabs?)\b/;
    const EACH_PHRASE = [[/\b(buns?|rolls?)\b/, 60], [/\bbaguette\b/, 250]];
    // A cup of something light and airy (chips, flakes) weighs far less than a cup of water.
    const CUP = { 'tortilla chips': 28, 'potato chips': 20, popcorn: 8, 'buttered popcorn': 11, coconut: 80, pretzels: 45, cereal: 30, crackers: 60,
        // A cup of chopped or shredded meat, or of grated cheese, is far lighter than a cup of water
        // (0.1.12 read "2 cups cooked chicken" as 480 g).
        'chicken breast': 140, chicken: 140, 'chicken thigh': 140, 'turkey breast': 140, ham: 140, 'ground beef': 225, 'lean ground beef': 225, 'ground turkey': 225, 'ground chicken': 225, 'ground pork': 225,
        shrimp: 145, tuna: 150, salmon: 140, cod: 140, crab: 135, lobster: 145, tofu: 250, cheddar: 113, mozzarella: 112, parmesan: 100, feta: 150, 'goat cheese': 120, cheese: 113, 'monterey jack': 113 };

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
        // The food the line is about is its last word, the noun: "high protein vanilla yogurt" is
        // yogurt (0.1.12 read it as vanilla extract, 600 kcal). A match ending on that word wins; the
        // longest match otherwise. Parts and units ("garlic cloves", "parsley leaves") don't count.
        const head = singular((variants[2].split(' ').pop() || ''));
        const useHead = head.length > 2 && !/^(clove|leave|leaf|sprig|stalk|rib|head|bunch|piece|slice|stick|wedge|floret|chunk|strip|cube|spear|ear|half|halve|part|white|yolk)$/.test(head);
        let out = null;
        for (const [re, phrase, key, first] of PATTERNS) {
            if (all.indexOf(first) < 0) continue;   // quick check before the pattern
            if (!variants.some(v => re.test(v))) continue;
            const hit = { key, food: FOODS[key], phrase };
            if (!out) out = hit;
            if (!useHead || singular(phrase.split(' ').pop()) === head) { out = useHead ? hit : out; break; }
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
        if (FISH.test(key)) return 150;
        const byPhrase = EACH_PHRASE.find(([re]) => re.test(phrase || ''));
        if (byPhrase) return byPhrase[1];
        if (EACH[key]) return EACH[key];
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
    // === WHAT'S EATEN ===
    // Bones and shells aren't eaten: a bone-in or shell-on food counts only its edible part (USDA's
    // "refuse" for the cut). [pattern on the line, edible share, what's left, not when this matches].
    const BONELESS = /\b(boneless|shelled|peeled|meat\b|fillets?|filets?|ground|minced|picked|bone[- ]free|deboned)\b/i;
    const EDIBLE = [
        [/\bmarrow bones?\b|\bbones?\b.*\bmarrow\b|\bmarrow\b.*\bbones?\b/i, 0.2, 'the marrow (the bones aren\'t eaten)'],
        [/\bshort ribs?\b/i, 0.6, 'without the bones'],
        [/\bribs\b/i, 0.7, 'without the bones', /\bcelery\b/i],
        [/\boxtails?\b/i, 0.5, 'without the bones'],
        [/\bwings?\b/i, 0.55, 'without the bones'],
        [/\bdrumsticks?\b/i, 0.7, 'without the bones'],
        [/\bwhole (chicken|duck|turkey)s?\b/i, 0.68, 'without the bones'],
        [/\bwhole (fish|branzino|trout|snapper|sea bass|sea bream|mackerel|salmon)\b/i, 0.5, 'without the head and bones'],
        [/\b(leg quarters?|chicken legs?|chicken pieces|turkey legs?)\b/i, 0.72, 'without the bones'],
        [/\bshanks?\b/i, 0.6, 'without the bones'],
        [/\bhocks?\b/i, 0.5, 'without the bones and skin'],
        [/\b(t-bone|porterhouse|tomahawk)\b/i, 0.8, 'without the bone'],
        [/\bracks? of lamb\b|\blamb racks?\b/i, 0.75, 'without the bones'],
        [/\bhead[- ]on\b/i, 0.55, 'without heads and shells'],
        [/\bshell[- ]on\b|\bin (the |their )?shells?\b|\bunpeeled\b/i, 0.85, 'without the shells'],
        [/\bmussels\b/i, 0.4, 'without the shells', /\b(frozen cooked)\b/i],
        [/\b(clams|cockles|oysters)\b/i, 0.2, 'without the shells', /\b(chopped|canned|minced)\b/i],
        [/\bcrab legs?\b|\bwhole crabs?\b/i, 0.5, 'without the shells'],
        [/\bwhole lobsters?\b|\blobsters?\b(?! (meat|tails?))/i, 0.35, 'without the shell'],
        [/\bbone[- ]in\b|\bon the bone\b/i, 0.78, 'without the bones'],
    ];
    function edibleShare(raw) {
        const t = String(raw).toLowerCase().replace(/\([^)]*\)/g, ' ');
        if (BONELESS.test(t.replace(/\bbone[- ]in\b|\bshell[- ]on\b|\bhead[- ]on\b/g, ''))) return null;
        const hit = EDIBLE.find(([re, , , not]) => re.test(t) && !(not && not.test(t)));
        return hit ? { share: hit[1], note: hit[2] } : null;
    }
    // What's thrown away isn't eaten: a brine, soaking water. Frying oil is mostly left in the pot:
    // what a fried food takes up counts (about a tablespoon a serving), not the potful.
    const DISCARDED = /\(\s*for (the )?(brine|brining|soaking)\s*\)|\bfor (the )?(brine|brining|soaking)\b|^brine:/i;
    const FRYING = /\b(for (deep[- ]?|shallow[- ]?|pan[- ]?)?frying|to (deep[- ]?)?fry|for the (deep[- ]?)?fryer|for deep[- ]fat frying|frying oil)\b/i;
    const FAT = /\b(oil|lard|shortening|ghee|dripping|fat)\b/i;
    function isDiscarded(raw) { return DISCARDED.test(String(raw)); }
    const COATING = /\(\s*for (the )?(coating|breading|dredging)\s*\)|\bfor (dredging|coating|breading|dusting)\b/i;

    // Things counted by their size: "4 4-ounce salmon fillets", "2 x 180g snapper fillets",
    // "1 whole chicken (about 4 pounds)", "2 racks of lamb (about 1 1/2 pounds each)".
    const SIZE = /^(?:x\s*)?(\d+(?:\.\d+)?)\s*-?\s*(ounces?|oz|grams?|g|pounds?|lbs?|kg)\b\.?/i;
    const BRACKET = /\((?:about|approx\.?|around|roughly|at least)?\s*((?:\d+\s+)?\d+(?:\/\d+|\.\d+)?|[½¼¾])\s*-?\s*(pounds?|lbs?|ounces?|oz|grams?|g|kilograms?|kg)\b([^)]*)\)/i;
    const ABOUT = /,\s*(?:about|approx\.?|around|roughly)\s*((?:\d+\s+)?\d+(?:\/\d+|\.\d+)?)\s*-?\s*(pounds?|lbs?|ounces?|oz|grams?|g|kilograms?|kg)\b(\s*(?:each|total|in all))?/i;
    const toGrams = (n, unit) => n * (/^(pound|lb)/i.test(unit) ? 453.6 : /^(ounce|oz)/i.test(unit) ? 28.35 : /^k/i.test(unit) ? 1000 : 1);
    function fraction(t) { const m = String(t).trim().match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/); return m ? Number(m[1] || 0) + Number(m[2]) / Number(m[3]) : ({ '½': 0.5, '¼': 0.25, '¾': 0.75 }[t] || Number(t)); }

    const COOKED = /\b(cooked|ready[- ]cooked|ready to (wok|eat|use|heat)|pre-?cooked|leftover|boiled|steamed)\b/i;
    const COOKED_AS = { pasta: 'cooked pasta', 'whole wheat pasta': 'cooked pasta', spaghetti: 'cooked pasta', macaroni: 'cooked pasta', 'egg noodles': 'cooked egg noodles', 'rice noodles': 'cooked rice noodles', couscous: 'cooked couscous', udon: 'cooked udon', rice: 'cooked rice', 'brown rice': 'cooked brown rice', quinoa: 'cooked quinoa', lentils: 'cooked lentils' };
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
        if (isDiscarded(raw)) return { grams: 0, key: null, free: true, discarded: 'thrown away (brine or soaking water)' };
        let item = Units ? Units.splitIngredient(raw) : { qty: null, unit: '', text: raw };
        if (item.qty == null) {
            const w = WORD_AMOUNT.find(([re]) => re.test(raw));
            if (w) item = { qty: w[1], unit: w[2], text: raw.replace(w[0], '') };
        }
        // A range ("2-3 cloves", "200-250 g") counts as its middle.
        if (item.qtyHigh) item = Object.assign({}, item, { qty: (item.qty + item.qtyHigh) / 2 });
        let words = (item.text || raw) + (item.note ? ' ' + item.note : '');
        if (/,[^,]*\bor\b[^,]*\b(seeds|nuts|beans|lentils|berries|greens|peppers|mushrooms|cheese|herbs|butters?)\b/i.test(words)) words = words.replace(/,/g, ' ');
        // "fat-free, reduced-sodium chicken broth": the words after a comma can be the food itself.
        let m = matchFood(words) || matchFood(raw) || matchFood(words.replace(/,/g, ' '));
        // Cooked or ready-cooked rice, pasta, noodles, grains or lentils weigh mostly water: their
        // cooked values (0.1.12 counted "1 pack ready-cooked egg noodles" as dry: 1,075 kcal).
        if (m && COOKED.test(raw) && !/\b(uncooked|dry|dried|raw)\b/i.test(raw)) {
            const key = COOKED_AS[m.key] || `cooked ${m.key}`;
            if (FOODS[key] && key !== m.key) m = { key, food: FOODS[key], phrase: m.phrase };
        }
        const low = !m || FOODS[m.key].n[0] < 400 || /spray/.test(m.key);
        const free = FREE.test(clean(words)) && low;
        if (!m) return free ? { grams: 0, key: null, free: true } : { unmatched: true, line: raw };
        const food = m.food;
        let qty = item.qty;
        let grams = null;
        const pack = raw.match(PACK);
        const size = !item.unit && qty != null ? String(item.text || '').match(SIZE) : null;
        const bracket = raw.match(BRACKET) || raw.match(ABOUT);
        const packWord = /\b(cans?|tins?|packages?|packets?|jars?|bags?|containers?|cartons?|blocks?|boxes?)\b/i.test(raw);
        if (size && !packWord) grams = qty * toGrams(Number(size[1]), size[2]);   // "4 4-ounce fillets": 4 × 4 oz
        else if (bracket && !packWord && (qty == null || !item.unit || ['piece', 'fillet', 'slice', 'head', 'bunch', 'cup', 'tbsp', 'tsp'].indexOf(item.unit) >= 0)) {
            // A weight in brackets: the whole amount ("about 4 pounds"), or each one's ("1 1/2 pounds each").
            const w = toGrams(fraction(bracket[1]), bracket[2]);
            const after = raw.slice(raw.indexOf(bracket[0]) + bracket[0].length, raw.indexOf(bracket[0]) + bracket[0].length + 8);
            grams = /\beach\b/i.test(bracket[3] || '') || /^\s*each\b/i.test(after) ? w * (qty || 1) : w;
        } else if (pack && packWord) {
            const size = Number(pack[1]);
            const unit = pack[2].toLowerCase();
            const each = /^(oz|ounce)/.test(unit) ? size * 28.35 : /^(lb|pound)/.test(unit) ? size * 453.6 : size;
            const count = qty != null && raw.indexOf(pack[0]) > raw.search(/[\d½¼¾⅓⅔⅛⅜⅝⅞]/) ? qty : 1;
            grams = each * (count || 1);
            // Canned beans and lentils, drained: what's left without the can's liquid (about 60%).
            if (/\b(drained|rinsed)\b/i.test(raw) && /\b(beans?|chickpeas|lentils|garbanzos?|black-eyed peas|pigeon peas|cannellini|butter beans|kidney beans|corn|sweetcorn|peas|mushrooms|artichokes?|olives|beets?)\b/i.test(raw)) grams *= 0.6;
        } else if (qty != null) {
            const unit = item.unit;
            if (G[unit]) grams = qty * G[unit];
            else if (ML[unit]) grams = CUP[m.key] ? qty * ML[unit] / 240 * CUP[m.key] : qty * ML[unit] * gramsPerMl(food);
            else if (unit === 'clove') grams = qty * (portionGrams(food, ['clove']) || 3);
            // A can: USDA's own can weight when it has one; otherwise 400 g, drained beans about 60% of that.
            else if (unit === 'can') grams = qty * (portionGrams(food, ['can']) || 400 * (/\b(drained|rinsed)\b/i.test(raw) && /\b(beans?|chickpeas|lentils|garbanzos?)\b/i.test(raw) ? 0.6 : 1));
            else if (unit === 'slice') grams = qty * (portionGrams(food, ['slice']) || 30);
            else if (unit === 'pinch' || unit === 'dash') grams = qty * 0.4;
            else if (unit === 'handful') grams = qty * (FOODS[m.key].n[0] < 60 ? 20 : 30);
            else if (unit === 'bunch') grams = qty * 100;
            else if (unit === 'sprig') grams = qty * 1;
            else if (unit === 'head') grams = qty * (portionGrams(food, ['head']) || 500);
            else if (unit === 'stick') grams = qty * (m.key === 'butter' ? 113 : m.key === 'celery' ? 40 : 3);
            else if (unit === 'package') grams = qty * 300;
            else if (unit === 'scoop') grams = qty * 30;
            else if (unit === 'fillet') grams = qty * (portionGrams(food, ['fillet']) || 150);
            else if (unit === 'piece') grams = qty * eachGrams(food, m.key, m.phrase);
            else if (!unit && EACH_RACK.test(clean(raw)) && EACH[m.key]) grams = qty * EACH[m.key];
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
        const per = Math.max(1, Number(servings) || 1);
        // Frying oil: only what the food takes up (about a tablespoon a serving), never the potful.
        if (FRYING.test(raw) && FAT.test(`${m.key} ${clean(words)}`) && grams > 14 * per) return { grams: 14 * per, key: m.key, free: false, assumed: 'about 1 tbsp a serving (what frying takes up; the rest stays in the pot)' };
        // A coating: about a third of what's set out sticks to the food (the rest is left over).
        if (COATING.test(raw) && grams > 0) return { grams: grams * 0.35, key: m.key, free, assumed: 'about a third (what sticks; the rest of the coating is left over)' };
        // Bones and shells: only the edible part counts.
        const edible = edibleShare(raw);
        if (edible && grams > 0) return { grams: grams * edible.share, key: m.key, free, edible: edible.note, whole: Math.round(grams) };
        return { grams: Math.max(0, grams), key: m.key, free };
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
    function calculate(ingredients, servings) {
        const per = Math.max(1, Number(servings) || 1);
        const total = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
        // Vitamin D (µg), calcium, potassium and magnesium (mg), for the week's check (planner.js).
        const micros = { vitd: 0, ca: 0, k: 0, mg: 0 };
        let grams = 0;
        const unmatched = [];
        const lines = [];
        const assumed = [];
        (ingredients || []).forEach(line => {
            const r = readLine(line, per);
            if (!r) return;
            if (r.unmatched) { unmatched.push(r.line); return; }
            if (r.discarded) { lines.push({ line, key: null, grams: 0, kcal: 0, discarded: r.discarded }); return; }
            const n = r.key ? FOODS[r.key].n : [0, 0, 0, 0];
            const f = r.grams / 100;
            total.calories += n[0] * f; total.protein_g += n[1] * f; total.carbs_g += n[2] * f; total.fat_g += n[3] * f;
            total.fiber_g += (n[4] || 0) * f;
            micros.vitd += (n[5] || 0) * f; micros.ca += (n[6] || 0) * f; micros.k += (n[7] || 0) * f; micros.mg += (n[8] || 0) * f;
            grams += r.grams;
            // Per line, per serving: the breakdown people can check.
            lines.push({ line, key: r.key, grams: Math.round(r.grams), kcal: Math.round(n[0] * f / per), assumed: r.assumed || undefined, edible: r.edible ? `${r.edible} (${r.whole} g as bought)` : undefined });
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
    // A brine or a pot of frying oil that the recipe doesn't label: its steps say so ("dissolve the
    // salt in the water… discard the brine", "heat the oil to 350°F and deep-fry"). Those lines get
    // labelled ("1 gallon water (for the brine)"), so every later count, and the person, knows.
    const ML_OF = { tsp: 5, tbsp: 15, cup: 240, pint: 480, quart: 960, gallon: 3840, ml: 1, l: 1000, 'fl oz': 30 };
    function mlOf(line) { const it = Units ? Units.splitIngredient(line) : { qty: null }; return it.qty != null && ML_OF[it.unit] ? it.qty * ML_OF[it.unit] : 0; }
    function labelThrownAway(recipe) {
        const steps = (recipe.steps || []).map(String).join(' ');
        const lines = recipe.ingredients;
        if (/\bbrin(e|ing|ed)\b/i.test(steps)) {
            const sentences = steps.split(/(?<=[.!?])\s+/).filter(x => /\b(brin(e|ing)|dissolve[ds]?)\b/i.test(x));
            const said = word => sentences.some(x => new RegExp(`\\b${word}\\b`, 'i').test(x));
            lines.forEach((l, i) => {
                const t = clean(l);
                if (isDiscarded(l) || /\b(in|packed in|canned in) brine\b/i.test(l)) return;
                const ml = mlOf(l);
                const water = /^(cold |warm |hot |boiling )?water$/.test(t.replace(/^[\d\s/.]+\w*\s+/, '').trim()) || /\bwater\b/.test(t) && !/\b(coconut|rose|sparkling|tonic|soda)\b/.test(t);
                const brineWater = water && ml >= 480 && said('water');
                const salt = /\bsalt\b/.test(t) && ml >= 30 && said('salt');
                const sweet = /\b(sugar|brown sugar|honey|maple syrup|molasses)\b/.exec(t);
                const sugar = sweet && said(sweet[1].split(' ').pop()) && !/\b(rub|glaze|sauce|dredge|batter)\b/i.test(sentences.filter(x => new RegExp(`\\b${sweet[1].split(' ').pop()}\\b`, 'i').test(x)).join(' ')) && lines.some(x => /\bwater\b/i.test(x) && mlOf(x) >= 480);
                if (brineWater || salt || sugar) lines[i] = `${l} (for the brine)`;
            });
        }
        // A breading station (flour, beaten egg, crumbs to coat): most of it is left in the bowls.
        const coatSteps = steps.split(/(?<=[.!?])\s+/).filter(x => /\b(dredge|dredging|coat|coating|dip|dipping|bread|breading|roll)\b/i.test(x));
        if (coatSteps.length) {
            lines.forEach((l, i) => {
                if (COATING.test(l) || isDiscarded(l)) return;
                const t = clean(l);
                const what = /\b(flour|panko|breadcrumbs?|bread crumbs|crumbs|cornmeal|cornstarch|corn starch)\b/.exec(t) || (/\beggs?\b/.test(t) && /\bbeaten\b|\bwhisked\b/i.test(l) ? ['egg'] : null);
                if (!what) return;
                const word = what[0].replace(/s$/, '');
                if (coatSteps.some(x => new RegExp(`\\b${word}`, 'i').test(x)) && !new RegExp(`\\b(stir|mix|whisk|fold)[^.]*\\b${word}[^.]*\\b(into|with) the (sauce|batter|dough|filling)`, 'i').test(steps)) lines[i] = `${l} (for coating)`;
            });
        }
        if (/\bdeep[- ]?fr(y|ied|ying)\b|\bheat the oil to \d{3}\b|\boil (reaches|registers|is) \d{3}\b/i.test(steps)) {
            lines.forEach((l, i) => { if (!FRYING.test(l) && FAT.test(clean(l)) && mlOf(l) >= 480) lines[i] = `${l} (for frying)`; });
        }
        return recipe;
    }

    function settle(recipe) {
        if (!recipe || !Array.isArray(recipe.ingredients)) return recipe;
        labelThrownAway(recipe);
        const servings = Math.max(1, Number(recipe.servings) || 1);
        const c = calculate(recipe.ingredients, servings);
        const own = recipe.nutrition && Number(recipe.nutrition.calories) > 0 ? recipe.nutrition : null;
        const calc = c.nutrition;
        let keepOwn = false;
        // A site's own numbers only when they add up (protein, carbs and fat give its calories, within
        // 20%: a site's "328 kcal" with 402 kcal of macros isn't kept) and agree with ours.
        const fromMacros = own ? (Number(own.protein_g) || 0) * 4 + (Number(own.carbs_g) || 0) * 4 + (Number(own.fat_g) || 0) * 9 : 0;
        const consistent = !own || own.protein_g == null || own.carbs_g == null || own.fat_g == null || Math.abs(fromMacros - own.calories) / own.calories <= 0.2;
        if (own && calc.calories > 0) keepOwn = consistent && Math.abs(own.calories - calc.calories) / calc.calories <= 0.15;
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

    const api = { calculate, settle, labelThrownAway, edibleShare, readLine, matchFood, isMinor, lookupOnline, FOODS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishNutrition = api;
})(typeof window !== 'undefined' ? window : globalThis);
