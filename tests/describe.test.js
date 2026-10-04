// One-line recipe descriptions: the AI's output format (grammar) must reach the model intact (0.1.10
// sent one with a NUL byte in it, so every description failed in 0.0 s), and when there's no AI or it
// fails, a description is made from the recipe itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../ondevice.js');

const controlChars = g => [...String(g)].filter(c => c.charCodeAt(0) < 32 && c !== '\n').map(c => c.charCodeAt(0));

test('no output format sent to the AI holds hidden control characters', () => {
    const grammars = { describe: O.DESCRIBE_GRAMMAR, meal: O.mealGrammar(2), import: O.importGrammar(), nutrition: O.nutritionGrammar ? O.nutritionGrammar() : '', edit: O.editGrammar ? O.editGrammar() : '' };
    for (const [name, g] of Object.entries(grammars)) assert.deepEqual(controlChars(g), [], `${name} grammar`);
});

// The description format turned into a JavaScript pattern (the same rules as llama.cpp's GBNF for
// this one-line grammar): a capital letter, 20 to 140 characters without quotes, backslashes or
// control characters, then a full stop or "!".
function describePattern(g) {
    const m = String(g).match(/^root ::= \[A-Z\] \[\^"\\\\\\x00-\\x1F\]\{(\d+),(\d+)\} \[\.!\]$/);
    assert.ok(m, `the description grammar has an unexpected shape: ${g}`);
    return new RegExp(`^[A-Z][^"\\\\\\x00-\\x1F]{${m[1]},${m[2]}}[.!]$`);
}

test('the description format loads and accepts a real sentence (and nothing else)', () => {
    const re = describePattern(O.DESCRIBE_GRAMMAR);
    assert.ok(re.test('Tender chicken thighs roasted with lemon, garlic and crisp new potatoes.'));
    assert.ok(re.test('A bright, zesty bowl of noodles with sesame and crunchy greens!'));
    assert.ok(!re.test('too short.'));
    assert.ok(!re.test('lowercase start, which the format does not allow at all.'));
    assert.ok(!re.test('Says "quoted" things, which would break the format here.'));
});

test('a description made in code from the recipe when there is no AI or it fails', () => {
    const d = O.describeFromRecipe({ name: 'Lemon Chicken Traybake', time_minutes: 45,
        ingredients: ['8 chicken thighs', '500 g new potatoes, halved', '1 lemon, sliced', '3 garlic cloves', '2 tbsp olive oil', '1 tsp salt'],
        steps: ['Heat the oven to 200C.', 'Toss everything in a roasting tin and roast for 40 minutes.'] });
    assert.equal(d, 'Chicken thighs, new potatoes and lemon, roasted. About 45 minutes.');
    const salad = O.describeFromRecipe({ name: 'Chickpea Salad', ingredients: ['1 can chickpeas', '1 cup cherry tomatoes', '1/2 cucumber', '2 tbsp olive oil', 'salt'], steps: ['Mix everything in a bowl and serve.'] });
    assert.match(salad, /^Chickpeas, cherry tomatoes and (1\/2 )?cucumber, no cooking needed\./);
    assert.equal(O.describeFromRecipe({ name: 'Water', ingredients: ['1 cup water'], steps: [] }), '');
});

// 0.1.12: descriptions were cut off mid-sentence ("…topped with coarse.") and sometimes invented
// (pan con tomate described as a "savory pancake").
test('a description that is cut off, too long or invents foods or cooking is never shown', () => {
    const { descriptionProblem } = require('../ondevice.js');
    const pan = { name: 'Pan con tomate', ingredients: ['4 slices sourdough bread', '2 ripe tomatoes', '1 garlic clove', '2 tbsp olive oil', 'flaky sea salt'], steps: ['Toast the bread.', 'Rub with garlic, grate the tomatoes over it, drizzle with oil and season.'] };
    assert.equal(descriptionProblem('Toasted sourdough rubbed with garlic and topped with grated ripe tomato and olive oil.', pan), '');
    assert.match(descriptionProblem('A savory pancake with tomatoes and garlic.', pan), /pancake/);
    assert.match(descriptionProblem('Crispy bread topped with coarse.', pan), /cut off/);
    assert.match(descriptionProblem('Grilled bread with tomato, garlic and olive oil, a Spanish classic.', pan), /grill/);
    assert.match(descriptionProblem('Toasted bread with tomato and garlic and oil and more and more and more ' + 'x'.repeat(150) + '.', pan), /cut off/);
    assert.match(descriptionProblem('Toasted bread with tomato and', pan), /cut off/);
});

test('the source\'s own description is used when the recipe has one, as whole sentences', () => {
    const I = require('../importer.js');
    // Just enough of a browser's DOMParser for the importer's text cleaning (as tools/sites-diagnose.js does).
    if (typeof global.DOMParser === 'undefined') global.DOMParser = class { parseFromString(h) { const t = String(h).replace(/<[^>]+>/g, ' '); return { body: { textContent: t }, documentElement: { textContent: t }, querySelectorAll: () => [], querySelector: () => null }; } };
    assert.equal(I.wholeSentences('Our quick shakshuka is spicy and filling. Serve it with crusty bread for mopping up the sauce, or with rice if you prefer a heartier meal for the whole family to share.', 120),
        'Our quick shakshuka is spicy and filling.');
    assert.equal(I.wholeSentences('A very long first sentence that goes on and on without any end in sight because it keeps adding more and more words to it', 60), '');
    const page = '<html><head><script type="application/ld+json">' + JSON.stringify({ '@type': 'Recipe', name: 'Lentil Soup', description: 'A warming red lentil soup with cumin and lemon. Ready in 30 minutes.',
        recipeIngredient: ['1 cup red lentils', '1 onion', '1 tsp cumin', '1 lemon'], recipeInstructions: ['Simmer everything for 25 minutes.', 'Blend and finish with lemon.'] }) + '</script></head><body></body></html>';
    const doc = { querySelectorAll: sel => (/ld\+json/.test(sel) ? [{ textContent: page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1] }] : []), querySelector: () => null };
    const r = I.structuredRecipe(doc, 'https://example.com/lentil-soup');
    assert.equal(r.description, 'A warming red lentil soup with cumin and lemon. Ready in 30 minutes.');
    const F = require('../finder.js');
    assert.equal(F.tidy(Object.assign({}, r, { source_url: 'https://example.com/lentil-soup' })).description, r.description);
});
