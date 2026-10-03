// Cookbooks as EPUB (and Word .docx) files: a small sample book is built here, zipped the same
// way real EPUBs are, and read a slice at a time like the app does.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../books.js');

// The app's way of reading: only the slices asked for. Counts how many bytes were read.
function io(buf) {
    const seen = { bytes: 0 };
    return { seen, size: buf.length, readRange: async (o, l) => { seen.bytes += l; return new Uint8Array(buf.subarray(o, o + l)); } };
}

const { zip, sampleBook, CONTAINER, OPF, INTRO, BREAKFAST, PHOTOS, DINNER, INDEX } = require('./sample-book.js');

test('an EPUB cookbook: recipes in reading order, with book and chapter, intro/photos/index skipped', async () => {
    const buf = sampleBook();
    const f = io(buf);
    const steps = [];
    const book = await B.readEpub({ ...f, progress: (done, total, chapter) => steps.push([done, total, chapter]) });
    assert.strictEqual(book.title, 'Easy Mornings & Evenings');
    assert.deepStrictEqual(book.recipes.map(r => r.name), ['Spinach & Feta Omelette', 'Overnight Oats with Berries', 'Lemon Chicken Traybake']);
    const [omelette, oats, chicken] = book.recipes;
    assert.deepStrictEqual(omelette.ingredients, ['4 large eggs', '60 g baby spinach', '50 g feta, crumbled', '1 tsp olive oil', 'Salt and pepper']);
    assert.strictEqual(omelette.steps.length, 3);
    assert.ok(!omelette.steps.some(s => /chilli/.test(s)), 'the tip is not a step');
    assert.strictEqual(omelette.servings, 2);
    assert.strictEqual(omelette.time_minutes, 15);
    assert.strictEqual(omelette.chapter, 'Breakfast');
    assert.strictEqual(omelette.book, 'Easy Mornings & Evenings');
    assert.ok(oats.ingredients.includes('½ cup berries'));
    assert.strictEqual(oats.steps.length, 2);
    assert.strictEqual(oats.servings, 1);
    assert.strictEqual(chicken.chapter, 'Weeknight Dinners');
    assert.strictEqual(chicken.servings, 4);
    assert.strictEqual(chicken.time_minutes, 45);
    assert.strictEqual(chicken.ingredients.length, 5);
    // Nothing from the introduction or the index became a recipe.
    assert.ok(!book.recipes.some(r => /introduction|index|gallery/i.test(r.name)));
    // Progress was reported for every chapter, in order, ending at the total.
    assert.deepStrictEqual(steps.map(s => s[0]), [1, 2, 3, 4, 5]);
    assert.ok(steps.every(s => s[1] === 5));
    // The picture was never read: far fewer bytes read than the file's size.
    assert.ok(f.seen.bytes < buf.length / 2, `read ${f.seen.bytes} of ${buf.length} bytes`);
});

test('reading a book can be cancelled', async () => {
    let n = 0;
    await assert.rejects(B.readEpub({ ...io(sampleBook()), progress: () => n++, cancelled: () => n >= 2 }), e => e.cancelled === true);
    assert.strictEqual(n, 2);
});

test('a copy-protected (DRM) EPUB is reported plainly, not read', async () => {
    const enc = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`;
    await assert.rejects(B.readEpub(io(sampleBook([['META-INF/encryption.xml', enc]]))), e => e.drm === true);
    assert.match(B.DRM_NOTE, /copy-protected/);
    // Only fonts scrambled ("font obfuscation") is not DRM: the book still reads.
    const fonts = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`;
    const ok = await B.readEpub(io(sampleBook([['META-INF/encryption.xml', fonts]])));
    assert.strictEqual(ok.recipes.length, 3);
});

test('an EPUB 2 book uses its toc.ncx for chapter names', async () => {
    const opf = OPF.replace('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
    const ncx = `<ncx><navMap><navPoint id="a"><navLabel><text>Introduction</text></navLabel><content src="text/intro.xhtml"/></navPoint><navPoint id="b"><navLabel><text>Breakfast &amp; Brunch</text></navLabel><content src="text/breakfast.xhtml"/></navPoint><navPoint id="c"><navLabel><text>Suppers</text></navLabel><content src="text/dinner.xhtml"/></navPoint></navMap></ncx>`;
    const buf = zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', CONTAINER], ['OEBPS/content.opf', opf], ['OEBPS/toc.ncx', ncx],
        ['OEBPS/text/intro.xhtml', INTRO], ['OEBPS/text/breakfast.xhtml', BREAKFAST], ['OEBPS/text/photos.xhtml', PHOTOS], ['OEBPS/text/dinner.xhtml', DINNER], ['OEBPS/text/index.xhtml', INDEX]]);
    const book = await B.readEpub(io(buf));
    assert.deepStrictEqual(book.recipes.map(r => r.chapter), ['Breakfast & Brunch', 'Breakfast & Brunch', 'Suppers']);
});

test('not an EPUB: a plain message instead of a crash', async () => {
    await assert.rejects(B.readEpub(io(Buffer.from('this is just text, not a book'))), /not a zip file/);
    await assert.rejects(B.readEpub(io(zip([['hello.txt', 'hi']]))), /doesn't look like an EPUB/);
});

test('a Word (.docx) recipe file', async () => {
    const p = (text, style, list) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/>${list ? '<w:numPr><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>` : list ? '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>' : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const doc = `<w:document><w:body>${[
        p('Mum\'s Lentil Soup', 'Heading1'), p('Serves 4'), p('Ingredients', 'Heading2'),
        p('1 cup red lentils', '', true), p('1 onion, chopped', '', true), p('2 carrots, diced', '', true), p('1 litre vegetable stock', '', true),
        p('Method', 'Heading2'), p('Soften the onion and carrots in a little oil for 5 minutes.', '', true), p('Add the lentils and stock and simmer for 20 minutes, then blend.', '', true),
    ].join('')}</w:body></w:document>`;
    const r = await B.readDocx(io(zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', doc]])));
    assert.strictEqual(r.recipes.length, 1);
    assert.strictEqual(r.recipes[0].name, 'Mum\'s Lentil Soup');
    assert.strictEqual(r.recipes[0].ingredients.length, 4);
    assert.strictEqual(r.recipes[0].steps.length, 2);
    assert.strictEqual(r.recipes[0].servings, 4);
});

test('Kindle books are turned away with a plain explanation', () => {
    assert.match(B.KINDLE_NOTE, /Kindle/);
    assert.match(B.KINDLE_NOTE, /EPUB/);
});

test('the recipe folder reads EPUBs a slice at a time, labels recipes with book and chapter, and explains Kindle files', async () => {
    const L = require('../library.js');
    const files = { 'Recipe Books/easy.epub': sampleBook(), 'Recipe Books/old.azw3': Buffer.from('kindle'), 'My Recipes/notes.txt': Buffer.from('nothing here') };
    const seen = [];
    const io = {
        list: async () => Object.keys(files).map(p => ({ path: p, folder: p.split('/')[0], size: files[p].length, mtime: 1 })),
        read: async p => (/\.txt$/.test(p) ? { kind: 'text', text: files[p].toString() } : { kind: L.kindOf(p), size: files[p].length }),
        range: async (p, o, l) => new Uint8Array(files[p].subarray(o, o + l)),
        sleep: async () => {},
    };
    const res = await L.refresh({ files: {} }, io, { progress: (path, done, total) => seen.push([path, done, total]) });
    const book = res.index.files['Recipe Books/easy.epub'];
    assert.strictEqual(book.recipes.length, 3);
    assert.strictEqual(book.recipes[0].source_name, 'Easy Mornings & Evenings · Breakfast');
    assert.strictEqual(book.recipes[2].source_name, 'Easy Mornings & Evenings · Weeknight Dinners');
    assert.match(res.index.files['Recipe Books/old.azw3'].note, /Kindle/);
    assert.strictEqual(seen.length, 5);
    assert.strictEqual(seen[4][1], 5);
    // Cancelling part-way leaves the book unread, so it's read again next time.
    let n = 0;
    const stopped = await L.refresh({ files: {} }, io, { progress: () => n++, cancelled: () => n >= 2 });
    assert.strictEqual(stopped.cancelled, true);
    assert.ok(!stopped.index.files['Recipe Books/easy.epub']);
    assert.ok(stopped.pending >= 1);
    // A copy-protected book gets the plain DRM note.
    const enc = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>';
    files['Recipe Books/easy.epub'] = sampleBook([['META-INF/encryption.xml', enc]]);
    const drm = await L.refresh({ files: {} }, io, {});
    assert.match(drm.index.files['Recipe Books/easy.epub'].note, /copy-protected/);
});
