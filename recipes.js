// Recipe checks: decides whether an AI-made recipe is good enough to show. Used for every recipe,
// whichever AI made it (phone, PC or cloud). A recipe fails when:
// - it has no servings, or nutrition whose calories don't match its macros (P×4 + C×4 + F×9);
// - an ingredient has no amount, or is vague ("1 cup roasted vegetables", "meat");
// - it has too few steps for its cooking time, a step is a description instead of an instruction
//   ("This Moroccan tagine is…"), a step is cut off ("…with Moroccan-ve"), or no step serves it;
// - an ingredient is never used in the steps;
// - a lunch or dinner has nothing to season it (no salt, spice, herb, sauce, citrus…).
// recipeProblems() lists what's wrong, in plain words, for the log and for the "may be incomplete" note.
(function (root) {
    'use strict';

    const Grocery = root.NourishGrocery || (typeof require === 'function' ? require('./grocery.js') : null);

    // Calories from the macros: 4 per gram of protein and carbs, 9 per gram of fat.
    function macroCalories(n) {
        if (!n) return NaN;
        return 4 * Number(n.protein_g) + 4 * Number(n.carbs_g) + 9 * Number(n.fat_g);
    }
    // Within 15% (or 40 kcal for small numbers): labels and the AI both round.
    function macrosMatch(n) {
        if (!n || !(Number(n.calories) > 0)) return false;
        const fromMacros = macroCalories(n);
        if (!isFinite(fromMacros)) return false;
        return Math.abs(fromMacros - n.calories) <= Math.max(40, 0.15 * n.calories);
    }

    // Instructions start with what to do ("Heat the oil…", "In a bowl, whisk…", "Meanwhile, cook…").
    const VERBS = new Set(('preheat heat warm reheat bring boil simmer cook bake roast grill broil fry pan-fry stir-fry deep-fry saute sauté sear brown char braise stew poach steam toast ' +
        'stir mix combine whisk beat fold cream whip blend puree purée process pulse knead mash smash crush press ' +
        'add pour place put arrange lay spread layer nestle tuck pile mound scatter sprinkle season salt toss coat dredge dip brush glaze rub marinate drizzle ' +
        'chop dice slice mince cut cube halve quarter core deseed seed pit peel grate zest shred julienne trim rinse wash scrub drain pat dry soak strain sieve ' +
        'roll shape form stuff fill wrap thread skewer line grease oil assemble build divide portion spoon ladle scoop top garnish finish serve plate dish enjoy ' +
        'cover uncover reduce lower increase raise remove take transfer return set leave let allow rest cool chill refrigerate freeze thaw defrost microwave ' +
        'melt squeeze juice crack separate scramble flip turn shake swirl deglaze wilt thicken taste adjust check continue repeat keep use prepare measure open tear ' +
        'carve shell devein debone skin stem wipe soften dissolve infuse steep cream sift split stack tie insert squash spoon drop break').split(/\s+/));
    const DESCRIPTION_START = /^(this|these|that|our|it|it's|its|a|an|the (dish|recipe|meal)|perfect|delicious|enjoy this|ideal|great|tender|hearty|light|healthy|classic|traditional|moroccan|italian|indian|thai|mexican|greek|japanese|korean|french)\b/i;

    function stripNumbering(step) {
        return String(step || '').trim().replace(/^(step\s*\d+\s*[:.)-]?|\d+\s*[.):-])\s*/i, '');
    }
    function isInstruction(step) {
        const text = stripNumbering(step);
        const words = text.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
        if (!words.length) return false;
        if (VERBS.has(words[0])) return true;
        if (DESCRIPTION_START.test(text)) return false;
        return words.slice(0, 8).some(w => VERBS.has(w));
    }
    // Ends mid-sentence: no full stop, or a last word that needs something after it.
    function isCutOff(step) {
        const text = stripNumbering(step).trim();
        // "Serve hot." is short but whole; "Add the" isn't.
        if (text.length < 8 || (text.length < 12 && !/^[A-Za-z]+( [a-z]+){0,2}[.!]$/.test(text))) return true;
        if (!/[.!)]$/.test(text)) return true;
        return /\b(and|or|the|with|to|a|an|of|in|into|for|until|then|on|at|by|plus)[.!]$/i.test(text) || /-[.!]$/.test(text);
    }

    // Enough steps for the time it takes: at least 3, 4 from 20 minutes, 5 from 40 minutes.
    function minSteps(minutes) {
        const t = Number(minutes) || 0;
        return t >= 40 ? 5 : t >= 20 ? 4 : 3;
    }

    const SERVE = /\b(serv(e|es|ed|ing)|plat(e|es|ed|ing)|garnish|divide|enjoy|dish up|bowls?|plates?|top (it |them |each )?with)\b/i;
    const VAGUE = /^((mixed|roasted|assorted|chopped|seasonal|fresh|cooked|steamed|grilled|lean|favou?rite|any|your|some|other|various|leftover)\s+)*(vegetables?|veggies|meat|protein|spices|seasonings?|herbs|sauce|toppings?|fruit|greens|grains?)$/i;
    const HAS_AMOUNT = /\d|[½¼¾⅓⅔⅛⅜⅝⅞]|\b(a|an|one|two|three|four|five|six|half|pinch|dash|handful|splash|drizzle|sprinkle)\b|to taste|as needed|for (garnish|serving|frying|greasing|drizzling)|optional/i;
    const SEASONING = /salt|pepper|spice|cumin|paprika|chil[il]|cayenne|curry|garam|masala|turmeric|cinnamon|oregano|thyme|basil|rosemary|sage|cilantro|coriander|parsley|dill|mint|chive|herb|soy sauce|tamari|fish sauce|miso|vinegar|lemon|lime|garlic|ginger|onion|shallot|scallion|mustard|harissa|ras el hanout|za'?atar|sumac|pesto|salsa|stock|broth|seasoning|sauce|gochujang|sriracha|tahini|cheese|parmesan|feta|bouillon|wine|zest|caper|olive/i;

    // Words in a step, singular, for matching against ingredient names.
    function stems(text) {
        return String(text || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/[\s-]+/).filter(Boolean).map(Grocery.singular);
    }
    // Groups a step may use instead of naming each item ("add the spices", "stir in the vegetables").
    const GROUPS = [
        [/\b(spices?|seasonings?|spice mix|dry rub)\b/, /salt|pepper|cumin|paprika|chil[il]|cayenne|curry|garam|masala|turmeric|cinnamon|oregano|thyme|ras el hanout|za'?atar|sumac|coriander|cardamom|nutmeg|clove|allspice|fennel seed|mustard seed|five spice|seasoning|powder|flakes/],
        [/\bseason\b/, /\bsalt\b|pepper/],
        [/\b(vegetables?|veggies)\b/, /onion|carrot|pepper|zucchini|courgette|eggplant|aubergine|squash|tomato|celery|broccoli|cauliflower|spinach|kale|cabbage|pea|bean|corn|potato|mushroom|leek|asparagus|okra|chard|lettuce|cucumber|radish|beet|turnip|parsnip/],
        [/\b(herbs?|garnish)\b/, /parsley|cilantro|coriander|basil|mint|dill|chive|thyme|rosemary|oregano|sage|tarragon|scallion|green onion|herb/],
        [/\b(dressing|sauce|marinade|glaze|mixture|liquid|wet ingredients)\b/, /oil|vinegar|juice|soy|tamari|honey|maple|syrup|mustard|mayo|yogurt|yoghurt|milk|cream|stock|broth|water|wine|sauce|paste|tahini|sriracha|zest/],
        [/\b(dry ingredients|batter|dough)\b/, /flour|sugar|baking|salt|cocoa|oat|cornmeal|cornstarch|yeast|cinnamon|powder|egg|milk|butter/],
        [/\b(toppings?|fruit|berries)\b/, /berr|banana|apple|mango|peach|nut|seed|granola|coconut|honey|chocolate|fruit|kiwi|grape|pear/],
        [/\b(aromatics)\b/, /onion|garlic|ginger|shallot|scallion|celery|chili|lemongrass/],
    ];
    const NOT_A_NAME = new Set(['and', 'or', 'with', 'into', 'plus', 'cup', 'can', 'tbsp', 'tsp', 'oz', 'lb', 'inch', 'piece', 'clove', 'slice', 'bunch', 'sprig', 'stick', 'juice', 'zest', 'extra', 'style', 'sodium', 'reduced', 'unsalted', 'salted', 'dried', 'canned', 'jarred', 'baby', 'mini', 'firm', 'soft', 'light', 'dark', 'sweet', 'unsweetened', 'mild', 'spicy', 'hot', 'free', 'range', 'fat', 'low', 'greek-style', 'cut', 'into', 'pieces', 'bite-size', 'bite-sized']);

    // The ingredient lines no step uses.
    function unusedIngredients(meal) {
        const steps = (meal && meal.steps) || [];
        const text = steps.join(' ').toLowerCase();
        const words = new Set(stems(text));
        return ((meal && meal.ingredients) || []).filter(line => {
            const parsed = Grocery.parseIngredient(line);
            if (!parsed) return false;
            if (/water|ice\b/.test(parsed.name) && /\bwater|ice\b/.test(text)) return false;
            const own = stems(parsed.name).filter(w => w.length > 2 && !NOT_A_NAME.has(w));
            if (!own.length || own.some(w => words.has(w))) return false;
            return !GROUPS.some(([group, member]) => group.test(text) && member.test(parsed.name));
        });
    }

    // Everything wrong with one recipe, as short plain sentences. Empty means it's good to show.
    // type: 'breakfast' | 'lunch' | 'dinner' (lunch and dinner must be seasoned).
    function recipeProblems(meal, { type } = {}) {
        const out = [];
        if (!meal || typeof meal !== 'object') return ['no recipe'];
        if (!meal.name || String(meal.name).trim().length < 3) out.push('no name');
        if (!(Number(meal.servings) >= 1)) out.push('no serving count');
        const n = meal.nutrition;
        if (!n || !(Number(n.calories) > 0)) out.push('no calories');
        else if (meal.nutrition_basis !== 'calculated' && !macrosMatch(n)) out.push(`calories (${Math.round(n.calories)}) don't match the macros (${Math.round(macroCalories(n))} from protein, carbs and fat)`);

        const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients.map(String) : [];
        if (ingredients.length < 3) out.push(`only ${ingredients.length} ingredient${ingredients.length === 1 ? '' : 's'}`);
        ingredients.forEach(line => {
            if (!HAS_AMOUNT.test(line)) out.push(`"${line}" has no amount`);
            const parsed = Grocery.parseIngredient(line);
            if (parsed && VAGUE.test(parsed.name)) out.push(`"${line}" is too vague (say which ones)`);
        });
        if ((type === 'lunch' || type === 'dinner') && ingredients.length && !ingredients.some(line => SEASONING.test(line))) {
            out.push('nothing to season it (no salt, spices, herbs or sauce)');
        }

        const steps = Array.isArray(meal.steps) ? meal.steps.map(String) : [];
        const need = minSteps(meal.time_minutes);
        if (steps.length < need) out.push(`only ${steps.length} step${steps.length === 1 ? '' : 's'} for a ${Number(meal.time_minutes) || 0}-minute recipe (needs ${need})`);
        steps.forEach((step, i) => {
            if (isCutOff(step)) out.push(`step ${i + 1} is cut off`);
            else if (!isInstruction(step)) out.push(`step ${i + 1} is a description, not an instruction`);
        });
        if (steps.length && !steps.some(s => SERVE.test(s))) out.push('no step says how to serve it');
        const unused = unusedIngredients(meal);
        if (unused.length) out.push(`never used in the steps: ${unused.map(l => `"${l}"`).join(', ')}`);
        return out;
    }

    // Only the calories are off: the macros are the more detailed numbers, so calories follow them.
    function onlyCaloriesWrong(problems) {
        return problems.length === 1 && /^calories \(/.test(problems[0]);
    }
    function fixCalories(meal) {
        if (meal && meal.nutrition) meal.nutrition.calories = Math.round(macroCalories(meal.nutrition));
        return meal;
    }

    const api = { recipeProblems, macroCalories, macrosMatch, isInstruction, isCutOff, unusedIngredients, minSteps, onlyCaloriesWrong, fixCalories };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NourishRecipes = api;
})(typeof window !== 'undefined' ? window : this);
