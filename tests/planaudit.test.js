// What the plan audit (tools/audit) found in 0.1.12, each kept fixed. The bug from a real phone:
// roasted bone marrow from a book planned as a lunch, 434 kcal and 46 g protein, with 2 oz chicken
// breast added for protein and a description that was its ingredient list, brine water included.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const PL = require('../planner.js');
const P = require('../prefs.js');
const L = require('../library.js');
const O = require('../ondevice.js');

const grams = l => Math.round(N.readLine(l, 4).grams);
const MARROW = {
    name: 'Roasted Bone Marrow with Parsley Salad', servings: 4, category: 'Small Plates',
    ingredients: ['4 pounds beef marrow bones, cut lengthwise', '1 gallon cold water', '1 cup kosher salt', '1 cup flat-leaf parsley leaves', '1 shallot, thinly sliced', '2 tsp capers, drained', '1 tbsp fresh lemon juice', '1 tbsp extra virgin olive oil', '8 slices crusty bread, toasted', 'Coarse sea salt'],
    steps: ['Dissolve the salt in the water in a large container, add the marrow bones and refrigerate for 12 to 24 hours, changing the salted water twice.', 'Drain the bones, discard the brine and pat them dry.',
        'Heat the oven to 450°F. Stand the bones cut side up in a roasting pan and roast for 15 to 20 minutes.', 'Toss the parsley, shallot and capers with the lemon juice and olive oil.', 'Serve the bones hot with the toast and the salad. Scoop the marrow out and spread it on the toast.'],
};

test('roasted bone marrow: almost pure fat, the marrow counted (not the bones, not as steak), the brine not counted, never a meal', () => {
    const r = N.settle(JSON.parse(JSON.stringify(MARROW)));
    assert.equal(N.matchFood('4 pounds beef marrow bones').key, 'bone marrow');
    assert.ok(r.ingredients.some(l => /gallon cold water \(for the brine\)/.test(l)), 'the brine is found from the steps and labelled');
    const n = r.nutrition;
    assert.ok(n.fat_g * 9 / n.calories > 0.75, `${n.fat_g} g fat of ${n.calories} kcal`);
    assert.ok(n.protein_g < 20, `${n.protein_g} g protein`);
    const fit = PL.mealFit(r);
    assert.deepEqual([fit.breakfast, fit.lunch, fit.dinner], [false, false, false]);
    // Never patched with added protein, at any meal.
    assert.equal(PL.boostProtein(r, 20, 'lunch', 1), r);
    const d = O.describeFromRecipe(r);
    assert.doesNotMatch(d, /\b(water|salt|brine|gallon|pounds?)\b/i);
});

test('bones, shells and frying oil: only what is eaten counts', () => {
    assert.ok(grams('2 racks baby back pork ribs (about 4 pounds)') < 1400);
    assert.ok(grams('4 pounds bone-in beef short ribs') < 1200);
    assert.equal(grams('1 pound large shell-on shrimp'), 386);
    assert.ok(grams('1 whole chicken (about 4 pounds)') > 1100);
    assert.equal(grams('2 quarts vegetable oil, for deep frying'), 56, 'about a tablespoon a serving');
    assert.equal(N.readLine('4 cups water (for the brine)', 2).grams, 0);
    assert.equal(grams('6 prawns (shrimp), peeled and deveined'), 90);
    assert.equal(grams('2 x 400g cans lentils, drained and rinsed'), 480);
    assert.equal(grams('2 cups (200g) shredded cheese'), 200);
    assert.ok(N.calculate(['1 packs ready-cooked egg noodles (approx. 280g)'], 1).nutrition.calories < 450);
    assert.equal(N.matchFood('1 cup high protein vanilla yogurt').key, 'yogurt');
    assert.equal(N.matchFood('1 tbsp nut or seed butter').key, 'peanut butter');
    assert.equal(N.readLine('1/2 - 1 tsp cayenne pepper', 1).grams < 5, true);
    const f = N.settle({ servings: 1, ingredients: ['3.5 oz chicken breast', '1/2 cup all-purpose flour', '3 large eggs (beaten)', '1 cup panko breadcrumbs'], steps: ['Dredge the chicken in the flour, dip in the eggs and coat with the panko.', 'Fry until golden.'] });
    assert.ok(f.ingredients.filter(l => /for coating/.test(l)).length === 3 && f.nutrition.calories < 600, `${f.nutrition.calories} kcal`);
});

test('portions stay cookable and bracketed weights scale with their line', () => {
    const r = N.settle({ name: 'Chicken Rice Bowl', servings: 4, ingredients: ['1 lb chicken breast', '2 cups cooked rice', '2 cups broccoli', '1 tbsp soy sauce', '1 tsp salt'], steps: ['Cook the chicken.', 'Serve over the rice.'] });
    const first = PL.scaleRecipe(r, 1.75, 1);
    const day = PL.fitDay({ breakfast: null, lunch: first, dinner: null }, { calorie_target: 1600, meal_slots: 'lunch' }, 1);
    const p = day.lunch.scaled ? day.lunch.scaled.portion : 1;
    assert.equal(p * 4, Math.round(p * 4), `${p} servings`);
    assert.equal(PL.scaleLine('2 bone-in pork chops (1 1/2 pounds total)', 0.5), '1 bone-in pork chops (¾ pound total)');
    assert.equal(PL.scaleLine('1/2 cup (50g) parmesan', 0.15), '1¼ tbsp (10g) parmesan');
    assert.equal(PL.scaleLine('1 kg / 2 lb beef mince', 0.125), '125 g / ¼ lb beef mince');
});

test('not meals: starters, dips, side salads, lava cakes; butter lettuce is not butter', () => {
    const fit = r => { N.settle(r); const f = PL.mealFit(r); return f.breakfast || f.lunch || f.dinner; };
    assert.equal(fit({ name: 'Chocolate Lava Cakes', ingredients: ['4 oz chocolate', '1/2 cup butter', '2 eggs', '1/4 cup sugar'], steps: ['Bake.'] }), false);
    assert.equal(fit({ name: 'Classic Hummus', ingredients: ['1 (15 oz) can chickpeas, drained', '1/4 cup tahini', '2 tbsp olive oil'], steps: ['Blend.'] }), false);
    assert.equal(fit({ name: 'Garlic Roasted Green Beans', ingredients: ['1 pound green beans', '1 tbsp olive oil', '1/2 tsp salt'], steps: ['Roast for 15 minutes and serve as a side dish.'] }), false);
    const wraps = { name: 'Turkey Lettuce Wraps', servings: 4, ingredients: ['1 pound ground turkey', '1 head butter lettuce, leaves separated', '1/2 cup shredded cheddar', '1 tsp salt'], steps: ['Cook the turkey and fill the lettuce leaves.'] };
    N.settle(wraps);
    assert.equal(PL.fatSwap(wraps), wraps, 'no olive oil for butter lettuce');
});

test('allergies and diets: plain protein powder is dairy; nut butters are nuts; olive oil is fine without olives', () => {
    const has = (o, line) => P.excluder(o)({ name: 'x', ingredients: [line] });
    assert.ok(has({ diet: 'Vegan' }, '1 scoop protein powder'));
    assert.ok(has({ allergies: 'dairy' }, '20 g protein powder'));
    assert.equal(has({ diet: 'Vegan' }, '1 scoop pea protein powder'), null);
    assert.ok(has({ allergies: 'tree nuts' }, '1 tbsp nut or seed butter'));
    assert.equal(has({ avoid: 'olives' }, '2 tbsp olive oil'), null);
    assert.ok(has({ avoid: 'olives' }, '1/4 cup kalamata olives'));
});

test('a PDF cookbook keeps its headings, servings and two-line titles', () => {
    const page = (i, lines) => ['WEEKNIGHT KITCHEN', ...lines, '', String(i)].join('\n');
    const pages = [1, 2, 3, 4, 5].map(i => page(i, i === 3 ? ['Sheet-Pan Sausage and Peppers with', 'Crispy Potatoes', 'Serves 4', 'Ingredients', '1 pound sausages', '2 bell peppers', '1 pound potatoes', 'Method', '1. Roast everything for 30 minutes and serve.']
        : [['Lentil Soup', 'Tomato Soup', '', 'Pea Soup', 'Leek Soup'][i - 1], 'Serves 2', 'Ingredients', '1 cup lentils', '2 cups broth', '1 onion', 'Method', '1. Simmer everything for 20 minutes and serve.']));
    const found = L.findRecipesInText(pages.join('\n\f\n'));
    assert.equal(found.length, 5);
    assert.ok(found.every(r => r.servings && !r.untitled), JSON.stringify(found.map(r => [r.name, r.servings])));
    assert.equal(found[2].name, 'Sheet-Pan Sausage and Peppers with Crispy Potatoes');
    assert.equal(found[2].servings, 4);
    // The same last step on every page ("1. Simmer…") is a step, not a running foot.
    assert.ok(found.every(r => r.steps.length === 1));
});
