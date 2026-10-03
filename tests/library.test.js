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
