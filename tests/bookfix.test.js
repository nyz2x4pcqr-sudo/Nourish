// 0.1.12: the books that imported nothing or almost nothing. A drinks book laid out without
// headings or lists (like "The Boba Book"), and an older cookbook scanned to PDF (like "Puerto
// Rican Cookery": capital titles, lettered ingredient groups, numbered steps, recipes run together).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../books.js');
const L = require('../library.js');
const DB = require('../recipedb.js');
const { zip, page, CONTAINER } = require('./sample-book.js');

const io = buf => ({ size: buf.length, readRange: async (o, l) => new Uint8Array(buf.subarray(o, o + l)) });

// A drinks book: made on Windows (backslashes in the zip), chapter files named with other capitals
// than the book's list, titles as bold paragraphs, ingredients as one paragraph split by line breaks
// or in a table, a two-ingredient syrup, a title set over two headings.
const TEA = page(`<p class="ch">Milk Teas</p>
<p class="rec_title"><b>Classic Black Milk Tea</b></p>
<p class="yield">Makes 1 drink</p>
<p class="ingr">2 tablespoons loose black tea<br/>1 cup hot water<br/>1/4 cup whole milk<br/>2 tablespoons brown sugar syrup<br/>Ice<br/>1/2 cup cooked boba pearls</p>
<p>Steep the tea in the hot water for 5 minutes, then strain and let it cool.</p>
<p>Spoon the boba and syrup into a glass, add ice, pour over the tea and milk, and stir.</p>`);
const SYRUP = page(`<p class="rec_title"><b>Brown Sugar Syrup</b></p>
<table><tr><td>1 cup</td><td>dark brown sugar</td></tr><tr><td>1/2 cup</td><td>water</td></tr></table>
<p>Simmer the sugar and water in a small pan for 5 minutes until it thickens. Cool before using.</p>`);
const PEARLS = page(`<h2>Chewy</h2><h2>with Brown Sugar Boba Pearls</h2>
<ul><li>1 cup dried tapioca pearls</li><li>6 cups water</li><li>1/2 cup brown sugar syrup</li></ul>
<ol><li>Boil the water, add the pearls and stir until they float.</li><li>Simmer for 15 minutes, then drain and toss with the syrup.</li></ol>`);
const STORY = page(`<h1>How We Started</h1><p>We opened our first shop in 2013 with two blenders and a lot of hope.</p>`);
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title id="t1">The Boba Book</dc:title><meta refines="#t1" property="title-type">main</meta>
<dc:title id="t2">Bubble Tea and Beyond</dc:title><meta refines="#t2" property="title-type">subtitle</meta>
<dc:creator id="a1">Andrew Chau</dc:creator><dc:creator id="a2">Bin Chen</dc:creator><dc:creator id="p1">Some Photographer</dc:creator><meta refines="#p1" property="role">pht</meta></metadata>
<manifest><item id="s" href="Text/Story.xhtml" media-type="application/xhtml+xml"/><item id="t" href="Text/Tea.xhtml" media-type="application/xhtml+xml"/><item id="y" href="Text/Syrup%20Page.xhtml" media-type="application/xhtml+xml"/><item id="p" href="Text/pearls.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="s"/><itemref idref="t"/><itemref idref="y"/></spine></package>`;
const bobaBook = () => zip([
    ['mimetype', 'application/epub+zip', true],
    ['META-INF\\container.xml', CONTAINER],
    ['OEBPS\\content.opf', OPF],
    ['OEBPS\\Text\\story.xhtml', STORY],
    ['OEBPS\\Text\\tea.xhtml', TEA],
    ['OEBPS\\Text\\Syrup Page.xhtml', SYRUP],
    ['OEBPS\\Text\\pearls.xhtml', PEARLS],
]);

test('a drinks book without headings or lists: every chapter is read and every recipe found', async () => {
    const book = await B.readEpub(io(bobaBook()));
    assert.equal(book.title, 'The Boba Book: Bubble Tea and Beyond');
    assert.equal(book.author, 'Andrew Chau & Bin Chen');
    assert.equal(book.missing, 0);
    assert.equal(book.chapters, 4, 'a page left out of the reading order is still read');
    const names = book.recipes.map(r => r.name);
    assert.deepEqual(names, ['Classic Black Milk Tea', 'Brown Sugar Syrup', 'Chewy with Brown Sugar Boba Pearls']);
    const tea = book.recipes[0];
    assert.equal(tea.ingredients.length, 6, JSON.stringify(tea.ingredients));
    assert.ok(tea.ingredients.includes('Ice'));
    assert.equal(tea.steps.length, 2);
    assert.deepEqual(book.recipes[1].ingredients, ['1 cup dark brown sugar', '1/2 cup water']);
});

test('drinks, syrups and toppings are saved with their own type, not as meals, and can be browsed', async () => {
    const book = await B.readEpub(io(bobaBook()));
    const db = DB.create(DB.memoryBackend());
    await db.importBook({ id: 'boba', title: book.title }, book.recipes);
    const kinds = Object.fromEntries(db.recipesOf('boba').map(r => [r.name, r.kind]));
    assert.equal(kinds['Classic Black Milk Tea'], 'drink');
    assert.equal(kinds['Brown Sugar Syrup'], 'sauce');
    assert.notEqual(kinds['Chewy with Brown Sugar Boba Pearls'], 'meal');
    assert.equal(db.forPlanning().length, 0);
    assert.equal(db.extras().length, 3);
    assert.equal(db.search('boba')[0].book_id, 'boba');
});

test('a book with no recipes says why, in plain words', async () => {
    const OPF2 = OPF.replace(/<spine>[\s\S]*<\/spine>/, '<spine><itemref idref="s"/></spine>').replace(/<item id="[typ]"[^>]*>/g, '');
    const book = await B.readEpub(io(zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', CONTAINER], ['OEBPS/content.opf', OPF2], ['OEBPS/Text/Story.xhtml', STORY]])));
    assert.equal(book.recipes.length, 0);
    assert.match(book.why, /Read 1 chapters, but none of them has an ingredient list/);
    // Chapters the book lists but doesn't contain are counted and said.
    const broken = await B.readEpub(io(zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', CONTAINER], ['OEBPS/content.opf', OPF], ['OEBPS/Text/Story.xhtml', STORY]])));
    assert.equal(broken.missing, 3);
    assert.match(broken.why, /couldn't be found inside the file/);
});

// The text of an older cookbook as a scan's text recognition gives it: page by page (\f), with the
// book's name and page numbers on every page, words split at line ends, two recipes on a page.
const pageText = n => `PUERTO RICAN COOKERY\n${n}\n`;
const OLD_BOOK = [
    pageText(41) + `INTRODUCTION TO RICE\nRice is served at almost every meal on the island, and a good cook is judged by it. The grains should be separate and tender.`,
    pageText(42) + `ARROZ CON POLLO\n(Chicken with Rice)\n(6 to 8 servings)\n\n1 chicken, about 3 pounds\nA\n2 cloves garlic, peeled\n1 teaspoon whole dried ori-\ngano\n6 whole peppercorns\n2 1/2 teaspoons salt\n1 tablespoon olive oil\nB\n1 tablespoon lard\n2 ounces lean cured ham, diced\n1 onion, peeled\n1 green pepper, seeded\nC\n3 cups rice\n1 1/2 cups water\n\n1. Wash chicken and cut into serving pieces.\n2. In a mortar, crush and mix ingredients included in A. Rub chicken pieces\nwith this seasoning.\n3. In a caldero, heat lard and brown rapidly ham and chicken. Reduce heat to\nmoderate, add ingredients in B, and saute for 10 minutes.\n4. Add rice and water, mix, and cook covered over low heat for 30 minutes.`,
    pageText(43) + `ARROZ CON GANDULES\n(Rice with Pigeon Peas)\n(8 servings)\n1/4 pound salt pork, diced\n1 tablespoon annatto oil\n1 onion, chopped\n2 cups pigeon peas\n3 cups rice\n4 cups water\n1. In a caldero, brown the salt pork and add the annatto oil.\n2. Add onion and saute until soft, then add peas, rice and water.\n3. Bring to a boil, cover and cook over low heat for 30 minutes.\n\nTOSTONES\n(Twice-Fried Plantains)\n2 green plantains\n4 cups water\n1 tablespoon salt\nLard or vegetable oil for frying\nPeel plantains and cut diagonally into 1-inch slices. Soak for 15 minutes in the salted water and drain.\nFry over moderate heat for 7 minutes, flatten each slice and fry again until golden.`,
    pageText(44) + `FLAN DE LECHE\n(Milk Custard)\n1 cup sugar\n6 eggs\n1 can evaporated milk\n1 teaspoon vanilla\nIn a caldero, melt the sugar over moderate heat until it turns to a golden syrup and coat the mold.\nBeat the eggs, add milk and vanilla, strain into the mold and bake in a water bath at 350F for 1 hour.`,
    pageText(45) + `INDEX\nArroz con pollo, 42\nTostones, 43`,
].join('\n\f\n');

test('an older cookbook (no "Ingredients" headings, lettered groups, recipes run together) gives every recipe', () => {
    const r = L.findRecipesInText(OLD_BOOK);
    assert.deepEqual(r.map(x => x.name), ['Arroz con Pollo (Chicken with Rice)', 'Arroz con Gandules (Rice with Pigeon Peas)', 'Tostones (Twice-Fried Plantains)', 'Flan de Leche (Milk Custard)']);
    assert.equal(r[0].servings, 6);
    assert.equal(r[0].page, 2);
    assert.equal(r[2].page, 3);
    assert.equal(r[0].ingredients.length, 12, JSON.stringify(r[0].ingredients));
    assert.ok(r[0].ingredients.includes('1 teaspoon whole dried origano'), 'a word split at the end of a line is joined');
    assert.equal(r[0].steps.length, 4);
    assert.match(r[0].steps[1], /Rub chicken pieces with this seasoning\.$/);
    assert.ok(!r.some(x => x.steps.some(s => /PUERTO RICAN COOKERY/.test(s))), 'the running head is not part of a step');
    assert.equal(r[2].steps.length, 2);
    assert.ok(r[2].ingredients.includes('Lard or vegetable oil for frying'));
});

test('a modern recipe text is found exactly as before (headings first), with no extra copies', () => {
    const md = '# Shakshuka\n\n## Ingredients\n* 4 eggs\n* 1 can crushed tomatoes\n* 1 tsp cumin\n\n## Instructions\n1. Simmer the tomatoes with the cumin.\n2. Crack in the eggs, cover and cook 6 minutes.\n';
    assert.deepEqual(L.findRecipesInText(md).map(r => r.name), ['Shakshuka']);
    assert.deepEqual(L.findRecipesInText('We went to the market. Two cups of coffee later we cooked dinner for friends and it was lovely.'), []);
});

// A scanned PDF read through the phone (io.pdf): a few pages at a time, pictures read with the
// phone's text recognition, with progress, pause and carry on.
function scannedPdf() {
    const pages = OLD_BOOK.split('\n\f\n');
    const calls = [];
    return {
        calls,
        io: {
            list: async () => [{ path: 'Recipe Books/Puerto Rican Cookery (Z-Library).pdf', folder: 'Recipe Books', size: 4900000, mtime: 1 }],
            read: async () => { throw new Error('the whole PDF should not be read at once'); },
            range: async (p, o, l) => new Uint8Array(Math.min(l, 64)).fill(7),
            pdf: async (p, from, count) => {
                calls.push([from, count]);
                return { pages: pages.length, title: 'Puerto Rican Cookery', author: 'Valldejuli, Carmen Aboy', texts: pages.slice(from, from + count).map(text => ({ text, ocr: true })) };
            },
            sleep: async () => {},
        },
    };
}

test('a scanned PDF is read a few pages at a time with text recognition, and its recipes keep their page', async () => {
    const { io: pio, calls } = scannedPdf();
    const seen = [];
    const res = await L.refresh({ files: {} }, pio, { progress: (p, done, total, what) => seen.push([done, total, what]) });
    const e = res.index.files['Recipe Books/Puerto Rican Cookery (Z-Library).pdf'];
    assert.equal(e.count, 4);
    assert.equal(e.title, 'Puerto Rican Cookery');
    assert.equal(e.author, 'Carmen Aboy Valldejuli');
    assert.equal(e.scanned, 5);
    assert.equal(e.recipes[0].source_name, 'Puerto Rican Cookery · page 2');
    assert.ok(calls.every(([, n]) => n <= 12));
    assert.ok(calls.slice(1).every(([, n]) => n <= 3), 'scanned pages are read in smaller steps');
    assert.match(seen[seen.length - 1][2], /reading scanned pages/);
});

test('reading a big PDF can be paused, and carries on from the same page', async () => {
    const { io: pio, calls } = scannedPdf();
    let pages = 0, held = null;
    const paused = await L.refresh({ files: {} }, pio, {
        progress: (p, done) => { pages = done; },
        paused: () => pages >= 3,
        onPause: async (path, fp, state) => { held = { fp, state }; },
    });
    assert.equal(paused.paused, true);
    const e = paused.index.files['Recipe Books/Puerto Rican Cookery (Z-Library).pdf'];
    assert.ok(e.paused && /Paused at page \d of 5/.test(e.note), e.note);
    assert.ok(held.state.at >= 3 && held.state.texts.length === held.state.at);
    // Not started again by itself…
    calls.length = 0;
    const again = await L.refresh(paused.index, pio, { known: fp => (fp === held.fp ? { partial: held.state } : null) });
    assert.equal(calls.length, 0);
    assert.ok(again.index.files['Recipe Books/Puerto Rican Cookery (Z-Library).pdf'].paused);
    // …and carries on from the page it got to when asked.
    const resumed = await L.refresh(again.index, pio, { force: ['Recipe Books/Puerto Rican Cookery (Z-Library).pdf'], known: fp => (fp === held.fp ? { partial: held.state } : null) });
    assert.ok(calls.filter(([, n]) => n > 0).every(([from]) => from >= held.state.at));
    assert.equal(resumed.index.files['Recipe Books/Puerto Rican Cookery (Z-Library).pdf'].count, 4);
});

test('a PDF with no readable text says so instead of finishing silently', async () => {
    const { io: pio } = scannedPdf();
    pio.pdf = async (p, from, count) => ({ pages: 30, title: '', texts: Array.from({ length: Math.min(count, 30 - from) }, () => ({ text: '', ocr: true })) });
    const res = await L.refresh({ files: {} }, pio, {});
    const e = res.index.files['Recipe Books/Puerto Rican Cookery (Z-Library).pdf'];
    assert.equal(e.count, 0);
    assert.match(e.note, /No text could be read from its 30 pages \(they are pictures/);
    assert.equal(e.title, 'Puerto Rican Cookery', 'the file name without "(Z-Library)"');
});

test('book titles and authors are cleaned of download-site tags', () => {
    assert.equal(L.cleanTitle('Guga (Z-Library)'), 'Guga');
    assert.equal(L.titleFromFileName('Recipe Books/The Boba Book [ebook] (z-lib.org).epub'), 'The Boba Book');
    assert.equal(L.cleanAuthor('Chau, Andrew'), 'Andrew Chau');
    assert.equal(L.cleanAuthor('Andrew Chau & Bin Chen'), 'Andrew Chau & Bin Chen');
});

test('a PDF cookbook whose every page says "Ingredients", "Method", "Serves 4": those lines are never taken for running heads (titles and servings were lost)', () => {
    const L = require('../library.js');
    const { TEXT_PDF } = require('../tools/audit-recipes.js');
    const { pageLines } = require('../tools/make-audit-books.js');
    const pages = TEXT_PDF.recipes.map(r => [r.title].concat(pageLines(r)).join('\n'));
    const found = L.findRecipesInText(pages.join('\n\f\n'), { fallbackTitle: '' });
    assert.deepEqual(found.map(r => r.name), TEXT_PDF.recipes.map(r => r.title));
    found.forEach((r, i) => assert.equal(r.servings, Number(TEXT_PDF.recipes[i].serves.match(/\d+/)[0]), r.name));
    assert.equal(found.find(r => /Pancakes/.test(r.name)).time_minutes, 15);
});
