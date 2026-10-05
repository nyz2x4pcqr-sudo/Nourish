// What people type in "Foods you love", "Foods you avoid" and Allergies, understood:
// - "All", "all food", "everything", "anything", "whatever" or nothing at all: no restriction.
// - Lists with commas, "and", slashes, new lines or just spaces; full sentences ("I really love
//   salmon and anything spicy"); plurals; small typos ("brocoli", "chiken").
// - Avoided foods and allergies are hard exclusions, matched against every ingredient, including
//   close variants (avoiding cucumber also avoids pickles, unless "pickles are fine" is written).
// Liked foods only make matching recipes rank higher; they are never searched for on their own.
(function (root) {
    'use strict';

    const FOODS = root.NourishFoods || (typeof require === 'function' ? (() => { try { return require('./nutrition-data.js'); } catch (e) { return {}; } })() : {});

    const NO_LIMIT = /^(all|all foods?|every ?thing|any ?thing|any|whatever|no preference|no preferences|none|nothing|n\/?a|no|nope|not really|-|anything goes|i eat everything|i like everything|i love everything)$/;
    const FILLER = new Set(('i me my we really very so love loves loved like likes liked enjoy prefer want would eat eating ate food foods dish dishes meal meals ' +
        'and or but with without no not dont don\'t do does hate hates avoid avoiding allergic allergy allergies to of the a an any some all lot lots much ' +
        'please also too especially mostly mainly kind kinds type types stuff things thing anything everything is are be am ok okay fine allowed good great').split(' '));

    // Groups and the foods they cover. A term in someone's list expands to its group.
    const GROUPS = {
        meat: ['beef', 'pork', 'lamb', 'veal', 'chicken', 'turkey', 'duck', 'bacon', 'ham', 'sausage', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'pepperoni', 'steak', 'mince', 'ground beef', 'ground pork', 'ground lamb', 'ground turkey', 'ground chicken', 'gelatin', 'meatball', 'venison', 'goat', 'veal'],
        'red meat': ['beef', 'pork', 'lamb', 'veal', 'steak', 'bacon', 'ham', 'sausage', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'pepperoni', 'ground beef', 'ground pork', 'ground lamb', 'venison', 'goat'],
        poultry: ['chicken', 'turkey', 'duck', 'ground chicken', 'ground turkey'],
        pork: ['pork', 'bacon', 'ham', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'pepperoni', 'ground pork', 'pork sausage', 'lard'],
        beef: ['beef', 'steak', 'ground beef', 'brisket', 'sirloin', 'ribeye', 'veal', 'beef broth', 'beef stock'],
        lamb: ['lamb', 'mutton', 'ground lamb'],
        chicken: ['chicken', 'ground chicken', 'chicken broth', 'chicken stock'],
        fish: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'mackerel', 'sardine', 'lox', 'smoked salmon', 'gravlax', 'kipper', 'herring', 'anchovy', 'haddock', 'pollock', 'snapper', 'bass', 'swordfish', 'catfish', 'fish sauce', 'worcestershire'],
        shellfish: ['shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster', 'crawfish', 'crayfish', 'langoustine', 'squid', 'calamari', 'octopus', 'oyster sauce'],
        seafood: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'mackerel', 'sardine', 'lox', 'smoked salmon', 'gravlax', 'kipper', 'herring', 'anchovy', 'haddock', 'shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster', 'squid', 'calamari', 'octopus', 'fish sauce', 'oyster sauce'],
        dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'ghee', 'whey', 'parmesan', 'mozzarella', 'cheddar', 'feta', 'ricotta', 'paneer', 'halloumi', 'cream cheese', 'sour cream', 'buttermilk', 'half and half', 'creme fraiche', 'mascarpone', 'goat cheese', 'cottage cheese', 'gruyere', 'brie', 'casein'],
        lactose: ['milk', 'cream', 'yogurt', 'ice cream', 'buttermilk', 'cream cheese', 'sour cream', 'half and half', 'ricotta', 'cottage cheese', 'whey'],
        egg: ['egg', 'mayonnaise', 'mayo', 'aioli', 'meringue', 'egg white', 'egg yolk', 'eggnog'],
        gluten: ['wheat', 'flour', 'bread', 'pasta', 'spaghetti', 'penne', 'noodle', 'couscous', 'bulgur', 'barley', 'rye', 'semolina', 'spelt', 'farro', 'seitan', 'breadcrumb', 'panko', 'crouton', 'tortilla', 'pita', 'naan', 'bagel', 'cracker', 'soy sauce', 'beer', 'orzo', 'udon', 'ramen'],
        wheat: ['wheat', 'flour', 'bread', 'pasta', 'spaghetti', 'penne', 'noodle', 'couscous', 'bulgur', 'semolina', 'spelt', 'farro', 'breadcrumb', 'panko', 'tortilla', 'pita', 'naan', 'bagel', 'cracker', 'orzo', 'udon'],
        peanut: ['peanut', 'peanut butter', 'satay', 'groundnut', 'peanut oil', 'trail mix', 'snickers', 'candy bar', 'pad thai'],
        nut: ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'brazil nut', 'nut butter', 'almond butter', 'almond milk', 'almond flour', 'praline', 'marzipan', 'nutella', 'trail mix', 'nut'],
        'tree nut': ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'brazil nut', 'almond butter', 'almond milk', 'almond flour', 'trail mix'],
        soy: ['soy', 'soya', 'tofu', 'tempeh', 'edamame', 'miso', 'soy sauce', 'tamari', 'soy milk'],
        sesame: ['sesame', 'tahini', 'sesame oil', 'sesame seed', 'hummus'],
        cucumber: ['cucumber', 'pickle', 'gherkin', 'cornichon', 'tzatziki', 'relish'],
        tomato: ['tomato', 'marinara', 'ketchup', 'salsa', 'passata', 'tomato paste', 'tomato sauce', 'pasta sauce'],
        onion: ['onion', 'shallot', 'scallion', 'green onion', 'spring onion', 'onion powder', 'chive'],
        garlic: ['garlic', 'garlic powder', 'aioli'],
        mushroom: ['mushroom', 'shiitake', 'portobello', 'cremini', 'porcini', 'chanterelle', 'oyster mushroom', 'enoki'],
        pepper: ['bell pepper', 'capsicum', 'jalapeno', 'chili', 'chilli', 'poblano', 'serrano', 'habanero', 'paprika', 'cayenne'],
        spicy: ['chili', 'chilli', 'jalapeno', 'cayenne', 'sriracha', 'hot sauce', 'chili flakes', 'red pepper flakes', 'habanero', 'gochujang', 'chipotle', 'sambal', 'harissa'],
        corn: ['corn', 'cornmeal', 'polenta', 'cornstarch', 'corn tortilla', 'popcorn', 'grits'],
        coconut: ['coconut', 'coconut milk', 'coconut oil', 'coconut cream'],
        cilantro: ['cilantro', 'coriander leaves', 'fresh coriander'],
        avocado: ['avocado', 'guacamole'],
        eggplant: ['eggplant', 'aubergine', 'baba ganoush'],
        olive: ['olive', 'tapenade'],
        sugar: ['sugar', 'honey', 'maple syrup', 'syrup', 'agave', 'molasses'],
        alcohol: ['wine', 'beer', 'vodka', 'rum', 'brandy', 'sherry', 'mirin', 'sake', 'bourbon', 'whiskey', 'liqueur'],
    };
    // What a word stands for: "nuts" → nut, "shellfish" → shellfish, "prawns" → shrimp group member.
    const ALIASES = {
        nuts: 'nut', 'tree nuts': 'tree nut', peanuts: 'peanut', eggs: 'egg', 'dairy products': 'dairy', 'milk products': 'dairy', 'lactose intolerant': 'lactose',
        'gluten free': 'gluten', coeliac: 'gluten', celiac: 'gluten', 'red meats': 'red meat', meats: 'meat', 'sea food': 'seafood', mushrooms: 'mushroom',
        tomatoes: 'tomato', onions: 'onion', cucumbers: 'cucumber', pickles: 'pickle', peppers: 'pepper', chilies: 'chili', chillies: 'chili', 'spicy food': 'spicy',
        'hot food': 'spicy', heat: 'spicy', aubergine: 'eggplant', coriander: 'cilantro', olives: 'olive', soya: 'soy', 'soy beans': 'soy', shrimps: 'shrimp',
        prawns: 'shrimp', prawn: 'shrimp', mince: 'ground beef', capsicum: 'bell pepper', courgette: 'zucchini', rocket: 'arugula',
    };
    // Words that aren't the food they look like: "peanut butter" isn't dairy, "eggplant" isn't egg.
    const NOT = {
        butter: ['peanut butter', 'almond butter', 'nut butter', 'cashew butter', 'apple butter', 'cocoa butter', 'butternut', 'butter bean', 'butterhead', 'sunflower butter'],
        milk: ['coconut milk', 'almond milk', 'oat milk', 'soy milk', 'rice milk', 'cashew milk', 'milk chocolate'],
        cream: ['coconut cream', 'cream of tartar'],
        egg: ['eggplant'],
        nut: ['nutmeg', 'coconut', 'butternut', 'doughnut', 'donut', 'nutritional yeast', 'water chestnut'],
        corn: ['peppercorn', 'corned'],
        pepper: ['black pepper', 'white pepper', 'pepper flakes', 'peppercorn', 'salt and pepper', 'ground pepper', 'cracked pepper', 'lemon pepper'],
        fish: ['fish sauce'],
        cheese: ['vegan cheese', 'nutritional yeast'],
    };
    const CUISINES = ['italian', 'mexican', 'thai', 'indian', 'japanese', 'chinese', 'korean', 'vietnamese', 'mediterranean', 'greek', 'middle eastern', 'lebanese', 'turkish', 'moroccan', 'french', 'spanish', 'american', 'cajun', 'caribbean', 'ethiopian', 'persian', 'filipino', 'indonesian', 'malaysian', 'peruvian', 'brazilian', 'british', 'german'];
    const DIET_EXCLUDES = {
        Vegetarian: ['meat', 'fish', 'shellfish'], Vegan: ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'], Pescatarian: ['meat'],
        'Gluten-free': ['gluten'], 'Dairy-free': ['dairy'], 'Nut-free': ['nut', 'peanut'], Halal: ['pork', 'alcohol'], Kosher: ['pork', 'shellfish'],
    };

    let VOCAB = null;   // every food word and phrase we know, for typo fixing and splitting space-separated lists
    function vocab() {
        if (VOCAB) return VOCAB;
        const set = new Set();
        Object.keys(FOODS).forEach(k => { set.add(k); (FOODS[k].a || []).forEach(a => set.add(a.toLowerCase())); });
        Object.keys(GROUPS).forEach(g => { set.add(g); GROUPS[g].forEach(x => set.add(x)); });
        Object.keys(ALIASES).forEach(a => set.add(a));
        CUISINES.forEach(c => set.add(c));
        ['vegetables', 'veggies', 'fruit', 'fruits', 'greens', 'grains', 'beans', 'legumes', 'pasta', 'rice', 'noodles', 'curry', 'soup', 'salad', 'stir fry', 'tacos', 'pizza', 'burgers', 'sandwiches', 'sushi', 'stew', 'chili', 'seafood', 'spicy', 'sweet', 'savory', 'healthy', 'lean protein', 'protein', 'carbs'].forEach(w => set.add(w));
        VOCAB = Array.from(set).sort((a, b) => b.length - a.length);
        return VOCAB;
    }

    function singular(w) {
        if (w.length < 4 || /(ss|us|is|ous)$/.test(w)) return w;
        if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
        if (/(tomato|potato|mango|hero)es$/.test(w)) return w.slice(0, -2);
        if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
        return w.endsWith('s') ? w.slice(0, -1) : w;
    }
    function distance(a, b, max) {
        if (Math.abs(a.length - b.length) > max) return max + 1;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            let best = i;
            for (let j = 1; j <= b.length; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2 >= 0 ? j - 2 : 0] + 1);
                best = Math.min(best, cur[j]);
            }
            if (best > max) return max + 1;
            prev = cur;
        }
        return prev[b.length];
    }
    // The vocabulary word a (possibly misspelled) word means, or null.
    function correct(word) {
        if (!word || word.length < 3) return null;
        const words = vocab();
        if (words.indexOf(word) >= 0) return word;
        const s = singular(word);
        if (words.indexOf(s) >= 0) return s;
        const max = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
        if (!max) return null;
        let best = null;
        let bestD = max + 1;
        for (const v of words) {
            if (v.indexOf(' ') >= 0 || Math.abs(v.length - word.length) > max || v[0] !== word[0]) continue;
            const d = distance(word, v, max);
            if (d < bestD) { best = v; bestD = d; }
        }
        return bestD <= max ? best : null;
    }

    // "I love salmon, brocoli and anything spicy" → { any: false, terms: ['salmon', 'broccoli', 'spicy'], except: [] }.
    function parse(text) {
        const raw = String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[.!?]+$/, '').trim();
        if (!raw || NO_LIMIT.test(raw.replace(/\s+/g, ' '))) return { any: true, terms: [], except: [] };
        const except = [];
        // "pickles are fine", "except pickles", "but cheese is ok"
        let body = raw.replace(/\b(?:except|but not|apart from|other than)\s+([a-z ]+?)(?=[,;.]|$)/g, (m, x) => { except.push(...x.split(/\band\b|\bor\b/).map(s => s.trim()).filter(Boolean)); return ' '; });
        body = body.replace(/([a-z ]+?)\s+(?:are|is)?\s*(?:ok|okay|fine|allowed)\b/g, (m, x) => { except.push(x.replace(/^(but|though|although)\s+/, '').trim()); return ' '; });
        const parts = body.split(/[,;\n/&+]|\band\b|\bor\b|\bplus\b/).map(s => s.trim()).filter(Boolean);
        const terms = [];
        const add = t => { if (t && terms.indexOf(t) < 0) terms.push(t); };
        parts.forEach(part => {
            const p = ' ' + part.replace(/[^a-z0-9 '-]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
            if (NO_LIMIT.test(p.trim())) return;
            let rest = p;
            // Known phrases first ("sweet potato", "peanut butter"), then single words.
            for (const v of vocab()) {
                if (v.indexOf(' ') < 0) continue;
                const re = new RegExp(' ' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's? ', 'g');
                if (re.test(rest)) { add(ALIASES[v] || v); rest = rest.replace(re, ' '); }
            }
            rest.split(' ').filter(Boolean).forEach(w => {
                if (FILLER.has(w) || /^\d+$/.test(w)) return;
                const c = correct(w);
                if (c) add(ALIASES[c] || ALIASES[w] || c);
                else if (w.length >= 4) add(singular(w));   // unknown but plausible ("ras el hanout" parts, brand names)
            });
        });
        return terms.length ? { any: false, terms, except } : { any: true, terms: [], except };
    }

    // Every word or phrase a term rules out, with its group expanded.
    function expand(term) {
        const t = ALIASES[term] || term;
        const out = new Set([t]);
        if (GROUPS[t]) GROUPS[t].forEach(x => out.add(x));
        // "cucumber" is in its own group; "pickle" alone is just pickles.
        Object.keys(GROUPS).forEach(g => { if (g === t + 's') GROUPS[g].forEach(x => out.add(x)); });
        return Array.from(out);
    }

    function termRegex(term) {
        const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+');
        return new RegExp('(^|[^a-z])' + esc + '(e?s|es)?($|[^a-z])', 'i');
    }

    // A checker for recipes: given the avoid text, the allergies text and the diet, returns
    // fn(recipe) → null when fine, or the word that rules it out.
    function excluder({ avoid, allergies, diet } = {}) {
        const a = parse(avoid);
        const b = parse(allergies);
        const terms = new Set();
        a.terms.concat(b.terms).forEach(t => expand(t).forEach(x => terms.add(x)));
        (DIET_EXCLUDES[diet] || []).forEach(g => expand(g).forEach(x => terms.add(x)));
        const except = a.except.concat(b.except).map(e => singular(e.replace(/^(the|a)\s+/, '')));
        except.forEach(e => { terms.delete(e); terms.delete(e + 's'); });   // "pickles are fine": keep pickles, still avoid cucumber
        const list = Array.from(terms).filter(t => t.length >= 2).map(t => [t, termRegex(t)]);
        return function check(recipe) {
            const lines = [recipe.name || ''].concat(recipe.ingredients || []).map(l => String(l).toLowerCase());
            for (const line of lines) {
                for (const [t, re] of list) {
                    if (!re.test(line)) continue;
                    const nots = NOT[t] || NOT[singular(t)] || [];
                    const stripped = nots.reduce((s, n) => s.replace(new RegExp(n.replace(/ /g, '[\\s-]+'), 'gi'), ' '), line);
                    if (!re.test(stripped)) continue;
                    return t;
                }
            }
            return null;
        };
    }

    // How much a recipe matches the foods someone loves (0 = none).
    function likeScore(recipe, likes) {
        const p = typeof likes === 'string' ? parse(likes) : likes;
        if (!p || p.any) return 0;
        const text = ((recipe.name || '') + ' ' + (recipe.ingredients || []).join(' ') + ' ' + (recipe.cuisine || '')).toLowerCase();
        let score = 0;
        p.terms.forEach(t => { if (expand(t).some(x => termRegex(x).test(text))) score += /^(healthy|spicy|sweet|savory)$/.test(t) ? 0.5 : 1; });
        return score;
    }
    // The liked foods worth searching for together with a meal ("salmon dinner"), never on their own.
    function searchTerms(likes) {
        const p = typeof likes === 'string' ? parse(likes) : likes;
        if (!p || p.any) return [];
        return p.terms.filter(t => vocab().indexOf(t) >= 0 && !/^(healthy|sweet|savory|protein|carbs|lean protein|vegetables|veggies|fruit|fruits|greens|grains)$/.test(t)).slice(0, 6);
    }

    const api = { parse, excluder, likeScore, searchTerms, correct, expand, singular, distance, CUISINES, GROUPS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishPrefs = api;
})(typeof window !== 'undefined' ? window : globalThis);
