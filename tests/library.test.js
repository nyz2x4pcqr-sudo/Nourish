// The personal recipe library (library.js): recipes found in text files and cookbooks, and an index
// that only reads files again when they change.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../library.js');

const COOKBOOK = `GRANDMA'S KITCHEN
Chapter 3: Weeknight dinners

Lemon Garlic Chicken
Serves 4 · Total time 35 minutes

Ingredients
- 1 1/2 lb boneless skinless chicken thighs
- 3 cloves garlic, minced
- 1 lemon, zested and juiced
- 1 tsp kosher salt
- 2 tbsp olive oil

Method
1. Pat the chicken dry and season with the salt.
2. Heat the oil in a large skillet over medium-high heat and brown
the chicken for 6 minutes per side.
3. Add the garlic, lemon zest and juice; simmer 2 minutes and serve.

Notes
Leftovers keep 3 days.

Black Bean Soup
Makes 6 servings

Ingredients:
2 cans black beans
1 onion, diced
1 tsp ground cumin
4 cups vegetable broth
1/2 tsp salt

Directions:
Soften the onion in a pot for 5 minutes.
Add everything else and simmer 20 minutes.
Blend half and serve.
`;

test('finds every recipe in a cookbook\'s text, with titles, servings and steps', () => {
    const r = L.parseRecipeText(COOKBOOK);
    assert.equal(r.length, 2);
    assert.equal(r[0].name, 'Lemon Garlic Chicken');
    assert.equal(r[0].servings, 4);
    assert.equal(r[0].time_minutes, 35);
    assert.equal(r[0].ingredients.length, 5);
    assert.equal(r[0].ingredients[0], '1 1/2 lb boneless skinless chicken thighs');
    assert.equal(r[0].steps.length, 3);
    assert.match(r[0].steps[1], /brown the chicken for 6 minutes per side/);
    assert.equal(r[1].name, 'Black Bean Soup');
    assert.equal(r[1].servings, 6);
    assert.equal(r[1].steps.length, 3);
});

test('markdown recipes use their heading as the name', () => {
    const md = '# Shakshuka\n\nSome words about it.\n\n## Ingredients\n* 4 eggs\n* 1 can crushed tomatoes\n* 1 tsp cumin\n* 1/2 tsp salt\n\n## Instructions\n1. Simmer the tomatoes with the cumin and salt.\n2. Crack in the eggs, cover and cook 6 minutes.\n';
    const r = L.parseRecipeText(md);
    assert.equal(r.length, 1);
    assert.equal(r[0].name, 'Shakshuka');
    assert.equal(r[0].ingredients.length, 4);
    assert.equal(r[0].steps.length, 2);
});

test('text without a recipe gives nothing', () => {
    assert.deepEqual(L.parseRecipeText('Shopping: milk, eggs.\nCall mum.'), []);
});

test('the index reads only new or changed files, in small batches', async () => {
    const files = [{ path: 'My Recipes/soup.txt', size: 10, mtime: 1, folder: 'My Recipes' }, { path: 'Recipe Books/book.pdf', size: 99, mtime: 1, folder: 'Recipe Books' }, { path: 'My Recipes/cat.gif', size: 1, mtime: 1 }];
    const reads = [];
    let sleeps = 0;
    const io = {
        list: async () => files,
        read: async p => { reads.push(p); return p.endsWith('.pdf') ? { kind: 'pdf', text: COOKBOOK } : { kind: 'text', text: '' }; },
        sleep: async () => { sleeps++; },
    };
    let res = await L.refresh(null, io, { batch: 1 });
    assert.deepEqual(reads.sort(), ['My Recipes/soup.txt', 'Recipe Books/book.pdf']);
    assert.equal(sleeps, 1);
    assert.equal(L.allRecipes(res.index).length, 2);
    assert.equal(L.allRecipes(res.index)[0].source_name, 'Recipe Books: book');
    assert.match(res.index.files['My Recipes/soup.txt'].note, /No recipe found/);
    reads.length = 0;
    res = await L.refresh(res.index, io);
    assert.deepEqual(reads, []);
    files[0].mtime = 2;
    files.splice(1, 1);
    res = await L.refresh(res.index, io);
    assert.deepEqual(reads, ['My Recipes/soup.txt']);
    assert.equal(L.allRecipes(res.index).length, 0);
});

test("Nourish's own Read me notes in the folders aren't read as recipes", async () => {
    const reads = [];
    const io = {
        list: async () => [{ path: 'My Recipes/Read me.txt', size: 1, mtime: 1 }, { path: 'About these folders.txt', size: 1, mtime: 1 }, { path: 'My Recipes/soup.txt', size: 1, mtime: 1, folder: 'My Recipes' }],
        read: async p => { reads.push(p); return { kind: 'text', text: '' }; },
    };
    const res = await L.refresh(null, io);
    assert.deepEqual(reads, ['My Recipes/soup.txt']);
    assert.deepEqual(res.index.listed.map(f => f.path), ['My Recipes/soup.txt']);
    assert.ok(L.isReadme('Recipe Books/Read me.txt') && !L.isReadme('My Recipes/readme pancakes.txt'));
});

const BOOK = `Roasting

A leg of lamb wants rosemary and garlic pushed into small cuts all over, plenty of salt, and a hot oven to start. Rest it for twenty minutes before carving so the juices settle.

Fish

Salmon and lemon belong together. Season the fillet with salt, sear it skin side down in a hot pan with a little olive oil, and finish with lemon juice, dill and a spoon of butter.

Lemon and garlic lift almost any fish. A splash of white wine vinegar works when there is no lemon. Dill, parsley and chives are the classic herbs for salmon and trout.

Breakfast

Eggs scrambled slowly over low heat with butter stay soft. Add chives and a pinch of salt at the end, and serve on toast.

A thank-you to everyone who helped with this book, and to my family for their patience over the years.`;

test('cookbooks become short cooking passages, and the most relevant few are found per meal', () => {
    const passages = L.passagesFrom(BOOK);
    assert.ok(passages.length >= 3, passages.length);
    assert.ok(!passages.some(p => /thank-you/.test(p)), 'a passage that is not about food was kept');
    const index = { at: 1, files: { 'Recipe Books/book.pdf': { passages, recipes: [] } } };
    const fish = L.retrieve(index, 'dinner salmon lemon', 2);
    assert.ok(fish.length >= 1 && /salmon/i.test(fish[0].text), JSON.stringify(fish));
    const brk = L.retrieve(index, 'breakfast eggs toast', 2);
    assert.ok(/scrambled/i.test(brk[0].text));
    assert.deepEqual(L.retrieve(index, 'quantum physics', 3), []);
});

test("cookbook pairings nudge recipes from any source; with no books there's no effect", () => {
    const F = require('../finder.js');
    const site = { name: 'Lemon Garlic Salmon', ingredients: ['1 lb salmon', '2 cloves garlic', '1 lemon', '1 tbsp butter', '1 tsp dill'], source_id: 'budgetbytes' };
    const lib = Object.assign({}, site, { source_id: 'library' });
    // Equal terms: the same recipe costs the same whether it came from the library or a site.
    assert.equal(F.sourceCost(lib, { settings: {} }), F.sourceCost(site, { settings: {} }));
    const passages = [];
    for (let i = 0; i < 20; i++) passages.push(`Salmon with lemon, garlic, dill and butter, number ${i}: sear the salmon in a hot pan, add the garlic and butter, finish with lemon juice and dill and salt.`);
    const index = { at: 2, files: { 'Recipe Books/fish.pdf': { passages, recipes: [] } } };
    const score = L.pairingScore(index, site);
    assert.ok(score > 0.5, score);
    assert.equal(L.pairingScore(index, { name: 'Plain Toast', ingredients: ['1 slice bread'] }), 0);
    const o = { settings: {}, pairingScore: r => L.pairingScore(index, r) };
    assert.ok(F.sourceCost(site, o) < F.sourceCost(site, { settings: {} }));
    assert.equal(F.sourceCost(lib, o), F.sourceCost(site, o));
});
