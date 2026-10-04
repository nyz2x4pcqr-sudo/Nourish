// The offline recipe database (recipedb.js): book recipes saved for good as full recipes.
const test = require('node:test');
const assert = require('node:assert/strict');
const DB = require('../recipedb.js');

const OMELETTE = { name: 'Spinach & Feta Omelette', chapter: 'Breakfast', servings: 2, time_minutes: 15,
    ingredients: ['4 large eggs', '60 g baby spinach', '50 g feta, crumbled', '1 tsp olive oil', '1/4 tsp salt'],
    steps: ['Whisk the eggs with the salt.', 'Wilt the spinach in the oil.', 'Add the eggs and feta and cook until set.'] };
const TRAYBAKE = { name: 'Lemon Chicken Traybake', chapter: 'Weeknight Dinners', servings: 4,
    ingredients: ['8 chicken thighs', '500 g new potatoes', '1 lemon', '3 garlic cloves', '2 tbsp olive oil', '1 tsp salt'],
    steps: ['Heat the oven to 200C.', 'Toss everything in a tin and roast for 40 minutes.'] };
const BROKEN = { name: 'Grandma\'s Stew', chapter: 'Mains', ingredients: ['beef', 'carrots'], steps: [] };
const COCKTAIL = { name: 'Classic Mojito', chapter: 'Drinks', servings: 1,
    ingredients: ['2 oz white rum', '1 lime, cut in wedges', '2 tsp sugar', '8 mint leaves', '4 oz soda water'], steps: ['Muddle the lime, sugar and mint.', 'Add the rum and ice, top with soda.'] };

test('a book\'s recipes become full recipes: meal type, cuisine, difficulty, nutrition, where they came from', async () => {
    const db = DB.create(DB.memoryBackend());
    const book = await db.importBook({ id: 'fp-1', title: 'Easy Mornings', author: 'A. Cook', path: 'Recipe Books/easy.epub' }, [OMELETTE, TRAYBAKE]);
    assert.equal(book.count, 2);
    const [om, tb] = db.recipesOf('fp-1');
    assert.ok(om.meal_types.includes('breakfast'), JSON.stringify(om.meal_types));
    assert.ok(tb.meal_types.includes('dinner'));
    assert.ok(om.nutrition && om.nutrition.calories > 100, JSON.stringify(om.nutrition));
    assert.ok(om.difficulty >= 1 && om.cuisine);
    assert.equal(om.book, 'Easy Mornings');
    assert.equal(om.author, 'A. Cook');
    assert.equal(om.chapter, 'Breakfast');
    assert.equal(om.source_name, 'From your book: Easy Mornings');
    assert.ok(!om.review);
    assert.equal(db.forPlanning().length, 2);
});

test('an incomplete recipe is saved but marked "needs review" and kept out of plans until confirmed', async () => {
    const db = DB.create(DB.memoryBackend());
    await db.importBook({ id: 'fp-2', title: 'Family Book' }, [OMELETTE, BROKEN]);
    const stew = db.recipesOf('fp-2').find(r => r.name === 'Grandma\'s Stew');
    assert.ok(stew.review);
    assert.match(stew.review_why, /no steps/);
    assert.ok(!db.forPlanning().some(r => r.id === stew.id));
    assert.equal(db.book('fp-2').review, 1);
    await db.confirm(stew.id, { steps: ['Simmer the beef and carrots for 2 hours.'], ingredients: ['1 lb beef', '3 carrots', '1 onion'] });
    assert.ok(!db.get(stew.id).review);
    assert.equal(db.book('fp-2').review, 0);
});

test('drinks, desserts and sauces are saved too, for snacks, extras, browsing and chat (not plans)', async () => {
    const db = DB.create(DB.memoryBackend());
    await db.importBook({ id: 'fp-3', title: 'Bar Book' }, [COCKTAIL]);
    const m = db.recipesOf('fp-3')[0];
    assert.equal(m.kind, 'drink');
    assert.equal(db.forPlanning().length, 0);
    assert.equal(db.extras().length, 1);
    assert.equal(db.search('mojito')[0].name, 'Classic Mojito');
});

test('the same dish is kept once: within a book, across books and against the web library', async () => {
    const db = DB.create(DB.memoryBackend());
    await db.importBook({ id: 'a', title: 'Book A' }, [OMELETTE, OMELETTE, TRAYBAKE]);
    assert.equal(db.recipesOf('a').length, 2);
    await db.importBook({ id: 'b', title: 'Book B' }, [Object.assign({}, OMELETTE, { name: 'Spinach and Feta Omelette' })]);
    assert.ok(db.recipesOf('b')[0].duplicate_of, 'the second book\'s copy points at the first');
    assert.equal(db.forPlanning().length, 2);
    await db.importBook({ id: 'c', title: 'Book C' }, [Object.assign({}, TRAYBAKE, { name: 'Sheet Pan Gnocchi' })], { known: ['Sheet Pan Gnocchi'] });
    assert.equal(db.recipesOf('c')[0].duplicate_of, 'web');
});

test('reading a book again replaces its recipes (no duplicates), and everything survives a restart', async () => {
    const backend = DB.memoryBackend();
    const db = DB.create(backend);
    await db.importBook({ id: 'fp-9', title: 'Book', path: 'Recipe Books/b.epub' }, [OMELETTE, TRAYBAKE]);
    await db.importBook({ id: 'fp-9', title: 'Book', path: 'Recipe Books/b.epub' }, [OMELETTE, TRAYBAKE]);
    assert.equal(db.count(), 2);
    // A new app start: everything is loaded back from storage.
    const again = await DB.create(backend).open();
    assert.equal(again.count(), 2);
    assert.equal(again.books()[0].title, 'Book');
    // The file renamed: the same book, only its path is remembered.
    await again.linkPath('fp-9', 'Recipe Books/b (renamed).epub');
    assert.equal(again.bookByPath('Recipe Books/b (renamed).epub').id, 'fp-9');
    // The file deleted: the recipes stay until the person says to remove them.
    await again.markMissing('fp-9');
    assert.equal(again.count(), 2);
    await again.removeBook('fp-9');
    assert.equal((await DB.create(backend).open()).count(), 0);
});

test('fingerprints: same contents, same fingerprint, whatever the file is called', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    assert.equal(DB.fingerprint(5, a, a), DB.fingerprint(5, a.slice(), a.slice()));
    assert.notEqual(DB.fingerprint(5, a, a), DB.fingerprint(5, new Uint8Array([1, 2, 3, 4, 6]), a));
    assert.equal(DB.textFingerprint('# Soup'), DB.textFingerprint('# Soup'));
});

test('backup and PC sync: exported data merges back in, newer books win', async () => {
    const db = DB.create(DB.memoryBackend());
    await db.importBook({ id: 'x', title: 'X' }, [OMELETTE]);
    const data = JSON.parse(JSON.stringify(db.exportData()));
    const other = DB.create(DB.memoryBackend());
    assert.equal(await other.importData(data), 1);
    assert.equal(other.books()[0].title, 'X');
    assert.equal(await other.importData(data), 0, 'nothing newer: nothing changes');
});

test('thousands of recipes stay quick', async () => {
    const db = DB.create(DB.memoryBackend());
    // 3,000 different dishes (names that differ by more than a number: "No 12" and "No 13" are the same dish).
    const A = ['Lemon', 'Garlic', 'Smoky', 'Herby', 'Spicy', 'Honey', 'Ginger', 'Miso', 'Pesto', 'Harissa', 'Sesame', 'Paprika', 'Tahini', 'Chipotle', 'Za\'atar'];
    const B = ['Chicken', 'Salmon', 'Tofu', 'Beef', 'Pork', 'Lentil', 'Chickpea', 'Turkey', 'Prawn', 'Halloumi', 'Lamb', 'Cod', 'Bean', 'Egg', 'Tempeh', 'Duck', 'Trout', 'Mushroom', 'Paneer', 'Squid'];
    const C = ['Traybake', 'Stew', 'Curry', 'Salad', 'Bowl', 'Skewers', 'Pie', 'Risotto', 'Soup', 'Wraps'];
    const many = Array.from({ length: 3000 }, (_, i) => Object.assign({}, TRAYBAKE, { name: `${A[i % 15]} ${B[Math.floor(i / 15) % 20]} ${C[Math.floor(i / 300) % 10]}` }));
    const t0 = Date.now();
    await db.importBook({ id: 'big', title: 'Big Book' }, many);
    const tImport = Date.now() - t0;
    const t1 = Date.now();
    for (let i = 0; i < 20; i++) db.forPlanning();
    const tPlan = (Date.now() - t1) / 20;
    assert.ok(db.count() >= 2900, String(db.count()));
    assert.ok(tPlan < 50, `planning pool took ${tPlan} ms`);
    assert.ok(tImport < 60000, `import took ${tImport} ms`);
});
