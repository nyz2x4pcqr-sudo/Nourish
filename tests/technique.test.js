// Technique books (how to cook, not recipes): read once into short technique notes, tagged by
// ingredient, cooking method and dish, stored offline and given to the AI for matching dishes.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../library.js');
const DB = require('../recipedb.js');
const { zip, page, CONTAINER } = require('./sample-book.js');

const CH = [
    page(`<h1>Heat</h1><p>Always pat meat dry before searing it. A wet surface steams instead of browning, so you never get a good crust.</p>
<p>Preheat the pan until it is properly hot before the meat goes in, because a cold pan makes the meat stick and stew in its juices.</p>
<p>Let a roast rest for fifteen minutes after cooking so the juices settle back into the meat instead of running onto the board.</p>`),
    page(`<h1>Salt</h1><p>Salt your pasta water generously so the pasta is seasoned from the inside.</p>
<p>Season chicken a day ahead if you can: the salt has time to reach the middle, which keeps the meat juicy when it roasts.</p>
<p>Add acid at the end of a braise to brighten the sauce, because long cooking dulls flavour.</p>`),
    page(`<figure><img src="../images/knife.jpg"/></figure>`),
    page(`<h1>Vegetables</h1><p>Blanch green vegetables in plenty of boiling salted water and then cool them in iced water, which stops the cooking and keeps them bright green.</p>
<p>Never crowd the tray when you roast vegetables: they steam instead of browning. Spread them out in one layer.</p>
<p>Toast whole spices in a dry pan before grinding them, so their oils wake up and the flavour is deeper.</p>`),
];
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Cook's Method</dc:title><dc:creator>A. Chef</dc:creator></metadata>
<manifest>${CH.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${CH.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`;
const techniqueBook = () => zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', CONTAINER], ['OEBPS/content.opf', OPF], ...CH.map((c, i) => [`OEBPS/c${i}.xhtml`, c])]);
const io = buf => ({
    list: async () => [{ path: 'Recipe Books/method.epub', folder: 'Recipe Books', size: buf.length, mtime: 1 }],
    read: async () => ({ kind: 'epub', size: buf.length }),
    range: async (p, o, l) => new Uint8Array(buf.subarray(o, o + l)),
    sleep: async () => {},
});

test('a technique book is recognised and becomes short technique notes, tagged; picture-only pages are skipped', async () => {
    const res = await L.refresh({ files: {} }, io(techniqueBook()), {});
    const e = res.index.files['Recipe Books/method.epub'];
    assert.equal(e.bookKind, 'technique');
    assert.equal(e.count, 0);
    assert.ok(e.noteCount >= 7, `${e.noteCount} notes`);
    assert.equal(e.noText, 1, 'the chapter that is only a picture');
    const dry = e.notes.find(n => /pat meat dry/.test(n.text));
    assert.ok(dry && dry.methods.includes('sear') && /crust/.test(dry.text), 'the note keeps the reason');
    assert.ok(e.notes.every(n => n.text.split(/[.!?]\s/).length <= 3));
    const blanch = e.notes.find(n => /Blanch/.test(n.text));
    assert.ok(blanch.methods.includes('blanch') && blanch.dishes.includes('vegetables'));
    assert.match(e.note, /Technique book: \d+ technique notes; 1 pages without readable text skipped/);
});

test('the person can say a book is a recipe book or a technique book', async () => {
    const res = await L.refresh({ files: {} }, io(techniqueBook()), { known: () => ({ bookType: 'recipes' }), force: ['Recipe Books/method.epub'] });
    assert.equal(res.index.files['Recipe Books/method.epub'].bookKind, 'recipes');
});

test('notes are stored offline and the best few are found for a dish', async () => {
    const res = await L.refresh({ files: {} }, io(techniqueBook()), {});
    const db = DB.create(DB.memoryBackend());
    const book = await db.saveTechniqueBook({ id: 'fp-method', title: "The Cook's Method" }, res.index.files['Recipe Books/method.epub'].notes);
    assert.equal(book.type, 'technique');
    assert.ok(book.notes >= 7);
    const forSteak = db.notesFor({ words: 'pan seared steak with roasted vegetables', ingredients: ['steak'], methods: ['sear', 'roast'], dishes: ['steak', 'vegetables'] }, 5);
    assert.ok(forSteak.length >= 3 && forSteak.length <= 5);
    assert.ok(forSteak.some(n => /pat meat dry/.test(n.text)));
    assert.ok(!forSteak.some(n => /pasta water/.test(n.text)), 'unrelated notes stay out');
    // Kept after a restart, and gone with the book.
    const again = await DB.create(db.backend).open();
    assert.equal(again.noteCount(), book.notes);
    await again.removeBook('fp-method');
    assert.equal(again.noteCount(), 0);
});

test('reading a big book that was interrupted carries on from where it got to', async () => {
    // Twenty chapters: a checkpoint is saved after 15; the app "closes" at chapter 17.
    const many = Array.from({ length: 20 }, (_, i) => CH[i % 2]);
    const opf = OPF.replace(/<manifest>[\s\S]*<\/spine>/, `<manifest>${many.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${many.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine>`);
    const buf = zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', CONTAINER], ['OEBPS/content.opf', opf], ...many.map((c, i) => [`OEBPS/c${i}.xhtml`, c])]);
    let saved = null, seen = 0;
    const crash = await L.refresh({ files: {} }, io(buf), { onCheckpoint: async (p, fp, state) => { saved = { fp, state }; }, progress: () => { seen++; }, cancelled: () => seen >= 17 }).catch(e => e);
    assert.ok(saved && saved.state.checkpoint && saved.state.at === 15, JSON.stringify(saved && saved.state.at));
    // Next start: the file isn't marked as read, the database has the checkpoint → it carries on.
    const chapters = [];
    const res = await L.refresh(crash.index || { files: {} }, io(buf), { known: fp => (fp === saved.fp ? { partial: saved.state } : null), progress: (p, done) => chapters.push(done) });
    assert.equal(chapters[0], 16, 'starts after the checkpoint');
    assert.equal(res.index.files['Recipe Books/method.epub'].bookKind, 'technique');
});
