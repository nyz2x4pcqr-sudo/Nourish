// 0.1.12: each book is read once. The same books were read again minutes after being saved (the PDF
// three times): what was read was only written down once every book had been read, and only in the
// app's small settings storage. Now every file read is recorded in the recipe database by its
// contents (fingerprint), straight after it's read, even when it gave no recipes.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../library.js');
const DB = require('../recipedb.js');
const { sampleBook } = require('./sample-book.js');

const files = () => ({
    'Recipe Books/easy.epub': sampleBook(),
    'Recipe Books/stories.txt': Buffer.from('We went to the market on Saturday and talked to the fishmonger for an hour about the weather.'),
});
function phone(store) {
    const reads = [];
    return {
        reads,
        list: async () => Object.keys(store).map(p => ({ path: p, folder: 'Recipe Books', size: store[p].length, mtime: 5 })),
        read: async p => { reads.push(p); return /\.txt$/.test(p) ? { kind: 'text', text: store[p].toString() } : { kind: 'epub', size: store[p].length }; },
        range: async (p, o, l) => new Uint8Array(store[p].subarray(o, o + l)),
        sleep: async () => {},
    };
}
// The app's part (app.js saveLibraryEntry/libraryKnown), in short.
function app(db) {
    return {
        known: fp => { const b = db.book(fp), f = db.file(fp); return b || f ? { id: b && b.id, count: b ? b.count : f.count, title: (b || f).title, note: f && f.note, partial: f && f.partial } : null; },
        onFile: async (path, e) => {
            if (e.recipes && e.recipes.length) await db.importBook({ id: e.fp, title: e.title, path }, e.recipes);
            await db.recordFile(e.fp, { path, title: e.title, count: e.count, note: e.note || undefined });
        },
    };
}

test('a book is saved as soon as it is read, before the next one is started', async () => {
    const db = DB.create(DB.memoryBackend());
    const store = files();
    const io = phone(store);
    const order = [];
    const a = app(db);
    const read = io.read;
    io.read = async p => { order.push(['read', p]); return read(p); };
    const res = await L.refresh({ files: {} }, io, Object.assign({}, a, { onFile: async (p, e) => { order.push(['saved', p]); await a.onFile(p, e); } }));
    // The text file first (small files before books), each saved before the next is read.
    assert.deepEqual(order, [['read', 'Recipe Books/stories.txt'], ['saved', 'Recipe Books/stories.txt'], ['read', 'Recipe Books/easy.epub'], ['saved', 'Recipe Books/easy.epub']]);
    assert.equal(res.read, 2);
    assert.equal(db.count(), 3);
    assert.equal(db.files().length, 2, 'the file with no recipes is recorded too');
});

test('opening the books screen or checking the folder again reads nothing, even if the list of files was lost', async () => {
    const backend = DB.memoryBackend();
    const db = DB.create(backend);
    const store = files();
    const io = phone(store);
    const first = await L.refresh({ files: {} }, io, app(db));
    assert.equal(io.reads.length, 2);
    // Checked again (Settings → Recipes opened, the 5-minute check): nothing changed, nothing read.
    io.reads.length = 0;
    await L.refresh(first.index, io, app(db));
    assert.deepEqual(io.reads, []);
    // The app restarted and its list of files was lost (storage full): the database still knows both.
    const again = await DB.create(backend).open();
    const res = await L.refresh({ files: {} }, io, app(again));
    assert.deepEqual(io.reads, [], 'not read again');
    assert.equal(res.index.files['Recipe Books/easy.epub'].count, 3);
    assert.match(res.index.files['Recipe Books/stories.txt'].note, /No recipe found/);
    // Only a changed file, or Read again, reads it.
    store['Recipe Books/stories.txt'] = Buffer.from('Changed: ' + store['Recipe Books/stories.txt'].toString());
    await L.refresh(res.index, io, app(again));
    assert.deepEqual(io.reads, ['Recipe Books/stories.txt']);
    io.reads.length = 0;
    await L.refresh(res.index, io, Object.assign(app(again), { force: ['Recipe Books/easy.epub'] }));
    assert.deepEqual(io.reads, ['Recipe Books/easy.epub']);
});

test('a title that looks cut off, or no title at all, is marked for review', async () => {
    const db = DB.create(DB.memoryBackend());
    const base = { ingredients: ['1 lb pasta shells', '2 cups ricotta', '1 cup marinara', '1 tsp salt'], steps: ['Cook the shells, stuff them and bake for 20 minutes.'] };
    await db.importBook({ id: 'g', title: 'Guga' }, [Object.assign({ name: 'in Stuffed Pasta Shells' }, base), Object.assign({ name: 'Untitled recipe (page 4)', untitled: true }, base, { ingredients: base.ingredients.concat('1 egg') }), Object.assign({ name: 'Smoked Meatballs in Stuffed Pasta Shells' }, base, { ingredients: base.ingredients.concat('1 lb beef') })]);
    const byName = Object.fromEntries(db.recipesOf('g').map(r => [r.name, r]));
    assert.match(byName['in Stuffed Pasta Shells'].review_why, /title looks cut off/);
    assert.match(byName['Untitled recipe (page 4)'].review_why, /no title found/);
    assert.ok(!byName['Smoked Meatballs in Stuffed Pasta Shells'].review);
});
