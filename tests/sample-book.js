// A small sample cookbook as a real EPUB file (and the zip writer that makes it), for the tests
// (tests/books.test.js) and to try the app with: node tools/make-sample-epub.js
'use strict';
const zlib = require('node:zlib');

// A minimal zip writer: each file deflated (or stored), with the directory at the end.
function zip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const [name, text, store] of files) {
        const raw = Buffer.from(text, 'utf8');
        const data = store ? raw : zlib.deflateRawSync(raw);
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = zlib.crc32 ? zlib.crc32(raw) : 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
        local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(store ? 0 : 8, 10); central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBuf, data);
        centrals.push(central, nameBuf);
        offset += 30 + nameBuf.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}
const page = body => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>${body}</body></html>`;
const INTRO = page(`<h1>Introduction</h1><p>I grew up in my grandmother's kitchen, where 2 cups of tea a day was the rule.</p><p>This book is for everyone who loves a slow morning.</p>`);
const BREAKFAST = page(`<h1 class="chapter-title">Breakfast</h1>
<p>Mornings should be easy.</p>
<h2>Spinach &amp; Feta Omelette</h2>
<p class="serves">Serves 2 · Prep 5 min · Cook 10 min</p>
<h3>Ingredients</h3>
<ul><li>4 large eggs</li><li>60 g baby spinach</li><li>50 g feta, crumbled</li><li>1 tsp olive oil</li><li>Salt and pepper</li></ul>
<h3>Method</h3>
<ol><li>Whisk the eggs with a pinch of salt and pepper.</li><li>Heat the oil in a pan and wilt the spinach for a minute.</li><li>Pour in the eggs, scatter the feta and cook until just set. Fold and serve.</li></ol>
<p class="tip">Tip: add chilli flakes for heat.</p>
<h2>Overnight Oats with Berries</h2>
<p>Makes 1</p>
<p class="ingredient">50 g rolled oats</p><p class="ingredient">120 ml milk</p><p class="ingredient">2 tbsp Greek yogurt</p><p class="ingredient">&frac12; cup berries</p>
<p>Stir the oats, milk and yogurt together in a jar and chill overnight.</p>
<p>In the morning, top with the berries and eat cold.</p>
<figure><img src="../images/oats.jpg"/><figcaption>Oats, ready to go</figcaption></figure>`);
const PHOTOS = page(`<h1>Gallery</h1><figure><img src="../images/a.jpg"/></figure><p>A photo of the market.</p>`);
const DINNER = page(`<h1>Weeknight Dinners</h1>
<p class="recipe-title">Lemon Chicken Traybake</p>
<p>Serves 4. Ready in 45 minutes.</p>
<ul><li>8 chicken thighs</li><li>500 g new potatoes, halved</li><li>1 lemon, sliced</li><li>3 garlic cloves</li><li>2 tbsp olive oil</li></ul>
<p>Heat the oven to 200C. Toss everything in a roasting tin with the oil and season well.</p>
<p>Roast for 40 minutes until the chicken is golden and cooked through.</p>`);
const INDEX = page(`<h1>Index</h1><p>eggs, 12</p><p>oats, 14</p><p>2 cups flour, 40</p>`);

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Easy Mornings &amp; Evenings</dc:title></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c0" href="text/intro.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/breakfast.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/photos.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="text/dinner.xhtml" media-type="application/xhtml+xml"/><item id="c4" href="text/index.xhtml" media-type="application/xhtml+xml"/><item id="img" href="images/oats.jpg" media-type="image/jpeg"/></manifest>
<spine><itemref idref="c0"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="c4"/></spine></package>`;
const NAV = page(`<nav epub:type="toc"><ol><li><a href="text/intro.xhtml">Introduction</a></li><li><a href="text/breakfast.xhtml">Breakfast</a></li><li><a href="text/photos.xhtml">Gallery</a></li><li><a href="text/dinner.xhtml#top">Weeknight Dinners</a></li><li><a href="text/index.xhtml">Index</a></li></ol></nav>`);
const BIG_PICTURE = 'x'.repeat(200000);
const sampleBook = (extra = []) => zip([
    ['mimetype', 'application/epub+zip', true],
    ['META-INF/container.xml', CONTAINER],
    ['OEBPS/content.opf', OPF],
    ['OEBPS/nav.xhtml', NAV],
    ['OEBPS/text/intro.xhtml', INTRO],
    ['OEBPS/text/breakfast.xhtml', BREAKFAST],
    ['OEBPS/text/photos.xhtml', PHOTOS],
    ['OEBPS/text/dinner.xhtml', DINNER],
    ['OEBPS/text/index.xhtml', INDEX],
    ['OEBPS/images/oats.jpg', BIG_PICTURE, true],
    ...extra,
]);

module.exports = { zip, sampleBook, page, CONTAINER, OPF, INTRO, BREAKFAST, PHOTOS, DINNER, INDEX };
