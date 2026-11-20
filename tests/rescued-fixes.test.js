// Fixes from an older copy of Nourish (its own plan-audit round, early October) that never reached
// main, brought over by hand: honest weights, safer allergy checks, scaled bracket weights, and
// two-line titles in PDF cookbooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const PL = require('../planner.js');
const P = require('../prefs.js');
const L = require('../library.js');

const grams = l => Math.round(N.readLine(l, 4).grams);
const kcal = lines => N.calculate(lines, 1).nutrition.calories;

test('allergies and diets: plain protein powder is dairy, nut and seed butters are tree nuts, olive oil is fine without olives', () => {
    const has = (o, line) => P.excluder(o)({ name: 'x', ingredients: [line] });
    assert.ok(has({ diet: 'Vegan' }, '1 scoop protein powder'), 'plain protein powder is whey (milk)');
    assert.ok(has({ allergies: 'dairy' }, '20 g protein powder'));
    assert.equal(has({ diet: 'Vegan' }, '1 scoop pea protein powder'), null);
    assert.equal(has({ allergies: 'dairy' }, '1 scoop plant-based protein powder'), null);
    assert.ok(has({ allergies: 'tree nuts' }, '1 tbsp nut or seed butter'));
    assert.ok(has({ allergies: 'tree nuts' }, '2 tbsp basil pesto'));
    assert.equal(has({ allergies: 'tree nuts' }, '2 tbsp peanut butter'), null, 'peanuts are not tree nuts');
    assert.equal(has({ allergies: 'tree nuts' }, '1/4 tsp ground nutmeg'), null);
    assert.equal(has({ avoid: 'olives' }, '2 tbsp olive oil'), null);
    assert.ok(has({ avoid: 'olives' }, '1/4 cup kalamata olives'));
    assert.equal(has({ allergies: 'dairy' }, '1 head butter lettuce'), null, 'butter lettuce is a lettuce');
});

test('a food is what the line is about: protein yogurt is yogurt, nut or seed butter is a nut butter', () => {
    assert.equal(N.matchFood('1 cup high protein vanilla yogurt').key, 'yogurt');
    assert.ok(kcal(['1 cup high protein vanilla yogurt']) < 250);
    assert.equal(N.matchFood('1 tbsp nut or seed butter').key, 'peanut butter');
    assert.equal(N.matchFood('1 tbsp sunflower seed butter').key, 'peanut butter');
    // The usual matches don't move.
    assert.equal(N.matchFood('2 garlic cloves').key, 'garlic');
    assert.equal(N.matchFood('1 cup chicken broth').key, N.matchFood('chicken broth').key);
});

test('honest weights: prawns by the piece, a weight in brackets after cups, canned lentils, cups of meat and cheese', () => {
    assert.equal(grams('6 prawns (shrimp), peeled and deveined'), 90);
    assert.ok(kcal(['6 prawns (shrimp), peeled and deveined']) < 120);
    assert.equal(grams('2 cups (200g) shredded cheese'), 200);
    // Canned lentils are cooked lentils. (A can still counts at its label weight, as main decided.)
    assert.equal(N.readLine('2 x 400g cans lentils, drained and rinsed', 4).key, 'cooked lentils');
    assert.ok(kcal(['2 x 400g cans lentils, drained and rinsed']) < 1000);
    assert.ok(grams('2 cups cooked chicken, shredded') < 320, `${grams('2 cups cooked chicken, shredded')} g`);
    assert.ok(grams('1 cup shredded cheddar') < 130);
    // Already right, and kept that way.
    assert.equal(grams('1 pound large shell-on shrimp'), 386);
    assert.equal(grams('2 quarts vegetable oil, for deep frying'), 56);
});

test('a breading station: most of the flour, egg and crumbs stay in the bowls', () => {
    const f = N.settle({ servings: 1, ingredients: ['3.5 oz chicken breast', '1/2 cup all-purpose flour', '3 large eggs (beaten)', '1 cup panko breadcrumbs'],
        steps: ['Dredge the chicken in the flour, dip in the eggs and coat with the panko.', 'Fry until golden.'] });
    assert.ok(f.nutrition.calories < 600, `${f.nutrition.calories} kcal`);
    assert.ok(f.nutrition.calories > 250, `${f.nutrition.calories} kcal: the chicken and some coating still count`);
    // Flour stirred into a sauce isn't a coating.
    const sauce = N.settle({ servings: 1, ingredients: ['1 tbsp butter', '2 tbsp flour', '1 cup milk'], steps: ['Melt the butter, whisk in the flour and add the milk to make a sauce.', 'Coat the pasta with the sauce.'] });
    assert.ok(sauce.nutrition.calories > 280, `${sauce.nutrition.calories} kcal`);
});

test('bracketed weights scale with their line, also when the unit changes', () => {
    assert.equal(PL.scaleLine('2 bone-in pork chops (1 1/2 pounds total)', 0.5), '1 bone-in pork chop (¾ pound total)');
    assert.equal(PL.scaleLine('1/2 cup (50g) parmesan', 0.15), '1¼ tbsp (10g) parmesan');
    assert.equal(PL.scaleLine('1 kg / 2 lb beef mince', 0.125), '125 g / ¼ lb beef mince');
    // Unchanged: a can's own size isn't scaled.
    assert.match(PL.scaleLine('2 (15 oz) cans black beans', 0.5), /15 oz/);
});

test('a PDF cookbook keeps a recipe title that runs onto a second line', () => {
    const page = (i, lines) => ['WEEKNIGHT KITCHEN', ...lines, '', String(i)].join('\n');
    const pages = [1, 2, 3, 4, 5].map(i => page(i, i === 3 ? ['Sheet-Pan Sausage and Peppers with', 'Crispy Potatoes', 'Serves 4', 'Ingredients', '1 pound sausages', '2 bell peppers', '1 pound potatoes', 'Method', '1. Roast everything for 30 minutes and serve.']
        : [['Lentil Soup', 'Tomato Soup', '', 'Pea Soup', 'Leek Soup'][i - 1], 'Serves 2', 'Ingredients', '1 cup lentils', '2 cups broth', '1 onion', 'Method', '1. Simmer everything for 20 minutes and serve.']));
    const found = L.findRecipesInText(pages.join('\n\f\n'));
    assert.equal(found.length, 5);
    assert.equal(found[2].name, 'Sheet-Pan Sausage and Peppers with Crispy Potatoes');
    assert.equal(found[2].servings, 4);
    assert.equal(found[0].name, 'Lentil Soup');
});

test('a book\'s brine and frying groups keep that in their lines, and a step at the foot of every page is a step', () => {
    assert.equal(L.groupLabel('4 cups water', 'For the brine:'), '4 cups water (for the brine)');
    assert.equal(L.groupLabel('2 quarts vegetable oil', 'For frying'), '2 quarts vegetable oil (for frying)');
    assert.equal(L.groupLabel('1 cup rocket', 'For the salad:'), '1 cup rocket');
    const page = (i, name) => ['WEEKNIGHT KITCHEN', name, 'Serves 2', 'Ingredients', '1 cup lentils', '2 cups broth', '1 onion', 'Method', '1. Serve immediately.', '', String(i)].join('\n');
    const found = L.findRecipesInText(['Lentil Soup', 'Tomato Soup', 'Bean Soup', 'Pea Soup', 'Leek Soup'].map((n, i) => page(i + 1, n)).join('\n\f\n'));
    assert.equal(found.length, 5);
    assert.ok(found.every(r => r.steps.length === 1), JSON.stringify(found.map(r => r.steps)));
});
