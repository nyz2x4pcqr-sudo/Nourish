// Builds the plan audit's test cookbooks from tools/audit/test-recipes.js:
//   - The Butcher's Table.epub          (an EPUB, chapters as web pages)
//   - Weeknight Kitchen.pdf             (a text PDF: running heads, page numbers, a title that
//                                        wraps onto two lines, two recipes on one page)
//   - Sunday Suppers (scanned).pdf      (pages that are only pictures, like a scanned book; made
//                                        by tools/audit/make-scanned-pdf.py, needs Python + Pillow)
// and tests/fixtures/ocr/Sunday Suppers.txt: the scanned book's text as if the iPhone's text
// recognition read it perfectly (the audit uses it to stand in for the iPhone).
//   node tools/audit/make-test-books.js [folder]   (default: tests/fixtures/books)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { zip, page } = require('../../tests/sample-book.js');
const { BUTCHER, WEEKNIGHT, SUNDAY } = require('./test-recipes.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tests', 'fixtures', 'books'));
const OCR = path.join(ROOT, 'tests', 'fixtures', 'ocr');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// === EPUB ===
function epub(book) {
    const files = [];
    const items = [];
    book.chapters.forEach(([chapter, recipes], i) => {
        const body = [`<h1 class="chapter-title">${esc(chapter)}</h1>`, '<p>Recipes for the table.</p>'];
        recipes.forEach(r => {
            body.push(`<h2>${esc(r.title)}</h2>`, `<p class="serves">Serves ${r.serves} · ${esc(r.time)}</p>`, '<h3>Ingredients</h3>');
            r.groups.forEach(([head, lines]) => {
                if (head) body.push(`<p class="ingredient-heading">${esc(head)}</p>`);
                body.push(`<ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`);
            });
            body.push('<h3>Method</h3>', `<ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`);
        });
        const name = `text/ch${i + 1}.xhtml`;
        files.push([`OEBPS/${name}`, page(body.join('\n'))]);
        items.push({ id: `c${i + 1}`, href: name, chapter });
    });
    const intro = page('<h1>Introduction</h1><p>Good meat, cooked with care, is one of life\'s pleasures. This book starts small and ends with weekend projects.</p>');
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(book.title)}</dc:title><dc:creator>${esc(book.author)}</dc:creator></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c0" href="text/intro.xhtml" media-type="application/xhtml+xml"/>${items.map(it => `<item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine><itemref idref="c0"/>${items.map(it => `<itemref idref="${it.id}"/>`).join('')}</spine></package>`;
    const nav = page(`<nav epub:type="toc"><ol><li><a href="text/intro.xhtml">Introduction</a></li>${items.map(it => `<li><a href="${it.href}">${esc(it.chapter)}</a></li>`).join('')}</ol></nav>`);
    const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
    return zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', container], ['OEBPS/content.opf', opf], ['OEBPS/nav.xhtml', nav], ['OEBPS/text/intro.xhtml', intro], ...files]);
}

// === The text of a printed page (shared by the text PDF and the scanned one) ===
// Lines: [text, size, bold]. Titles longer than the page is wide wrap onto a second line.
function pageLines(recipes, { head, number } = {}) {
    const out = [];
    if (head) out.push([head, 8, false]);
    recipes.forEach((r, k) => {
        if (k) out.push(['', 10, false]);
        if (r.chapterNote) out.push([r.chapterNote, 10, true]);
        if (r.wrapTitle) {
            const words = r.title.split(' ');
            const cut = Math.ceil(words.length * 0.6);
            out.push([words.slice(0, cut).join(' '), 18, true], [words.slice(cut).join(' '), 18, true]);
        } else out.push([r.title, 18, true]);
        out.push([`Serves ${r.serves} · ${r.time}`, 10, false], ['Ingredients', 12, true]);
        r.groups.forEach(([h, lines]) => { if (h) out.push([h, 10, true]); lines.forEach(l => out.push([l, 10, false])); });
        out.push(['Method', 12, true]);
        r.steps.forEach((s, i) => wrap(`${i + 1}. ${s}`, 95).forEach(l => out.push([l, 10, false])));
    });
    if (number) out.push(['', 10, false], [String(number), 8, false]);
    return out;
}
function wrap(text, width) {
    const out = [];
    let line = '';
    String(text).split(' ').forEach(w => { if ((line + ' ' + w).trim().length > width) { out.push(line); line = '   ' + w; } else line = (line + ' ' + w).trim() === '' ? w : `${line} ${w}`.replace(/^ /, ''); });
    if (line) out.push(line);
    return out;
}

// === A text PDF (Helvetica; the text is in the file, as in a PDF made on a computer) ===
function textPdf(book) {
    const toLatin = t => String(t).replace(/·/g, '-').replace(/°/g, ' degrees ').replace(/[–—]/g, '-').replace(/[’]/g, "'");
    const escPdf = t => toLatin(t).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?');
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pagesId = objects.length + 1 + book.pages.length * 2;
    const kids = [];
    book.pages.forEach((recipes, i) => {
        let y = 760;
        const ops = pageLines(recipes, { head: book.runningHead, number: i + 1 }).map(([t, size, b]) => {
            y -= size + 6;
            return t ? `BT /${b ? 'F2' : 'F1'} ${size} Tf 50 ${y} Td (${escPdf(t)}) Tj ET` : '';
        }).filter(Boolean).join('\n');
        const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> >>`));
    });
    add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
    const info = add(`<< /Title (${escPdf(book.title)}) /Author (${escPdf(book.author)}) >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

// The scanned book's pages as text (one entry per page), for the picture PDF and for the stand-in
// for the iPhone's text recognition.
function scannedPages(book) {
    return book.pages.map((recipes, i) => pageLines(recipes, { head: book.title.toUpperCase(), number: i + 1 }));
}

if (require.main === module) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.mkdirSync(OCR, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${BUTCHER.title}.epub`), epub(BUTCHER));
    fs.writeFileSync(path.join(OUT, `${WEEKNIGHT.title}.pdf`), textPdf(WEEKNIGHT));
    const pages = scannedPages(SUNDAY);
    // Pages separated by a form feed, the way the app joins a PDF's pages.
    fs.writeFileSync(path.join(OCR, `${SUNDAY.title}.txt`), pages.map(p => p.map(([t]) => t).join('\n')).join('\n\f\n'));
    const spec = path.join(OCR, `${SUNDAY.title}.pages.json`);
    fs.writeFileSync(spec, JSON.stringify({ title: SUNDAY.title, author: SUNDAY.author, pages }));
    const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    try {
        execFileSync(py, [path.join(__dirname, 'make-scanned-pdf.py'), spec, path.join(OUT, `${SUNDAY.title} (scanned).pdf`)], { stdio: 'inherit' });
    } catch (e) { console.warn(`The scanned PDF wasn't made (needs Python with Pillow): ${e.message}`); }
    fs.unlinkSync(spec);
    console.log(`Wrote the test books to ${OUT}`);
}

module.exports = { epub, textPdf, pageLines, scannedPages };
