// Writes the plan audit's three test books (tools/audit-recipes.js) into a folder:
//   node tools/make-audit-books.js [folder]   (default: audit-books)
// - The Audit Kitchen.epub        an EPUB with chapters, bold-paragraph and heading titles, a title over two lines
// - Weeknight Classics.pdf        a text PDF (one page per recipe)
// - Grandma's Recipe Cards.pdf    a scanned PDF: pictures of pages with no text in them (needs Python + Pillow)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { zip, page, CONTAINER } = require('../tests/sample-book.js');
const { pdf } = require('../tests/sample-pdf.js');
const { EPUB, TEXT_PDF, SCANNED_PDF } = require('./audit-recipes.js');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function epub(book) {
    const files = [];
    book.chapters.forEach(([name, recipes], ci) => {
        const body = [`<h1>${esc(name)}</h1>`, `<p>Recipes from the ${esc(name.toLowerCase())} chapter.</p>`];
        recipes.forEach((r, ri) => {
            // Half the titles are headings, half bold paragraphs (both are common in real EPUBs).
            if (r.splitTitle) body.push(...r.splitTitle.map(t => `<p class="recipe-title"><b>${esc(t)}</b></p>`));
            else body.push(ri % 2 ? `<p class="recipe-title"><strong>${esc(r.title)}</strong></p>` : `<h2>${esc(r.title)}</h2>`);
            if (r.intro) body.push(`<p class="intro">${esc(r.intro)}</p>`);
            body.push(`<p class="serves">${esc(r.serves)} · ${esc(r.time)}</p>`, '<h3>Ingredients</h3>');
            const groups = [];
            r.ingredients.forEach(l => { if (/^(for the |brine:|pork:)/i.test(l) || /^For /.test(l)) groups.push(`</ul><p class="group">${esc(l)}</p><ul>`); else groups.push(`<li>${esc(l)}</li>`); });
            body.push(`<ul>${groups.join('')}</ul>`, '<h3>Method</h3>', `<ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`);
        });
        files.push([`OEBPS/text/ch${ci + 1}.xhtml`, page(body.join('\n').replace(/<ul><\/ul>/g, ''))]);
    });
    const ids = files.map((f, i) => `c${i + 1}`);
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(book.title)}</dc:title><dc:creator>${esc(book.author)}</dc:creator></metadata>
<manifest>${files.map((f, i) => `<item id="${ids[i]}" href="${f[0].replace('OEBPS/', '')}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${ids.map(id => `<itemref idref="${id}"/>`).join('')}</spine></package>`;
    return zip([['mimetype', 'application/epub+zip', true], ['META-INF/container.xml', CONTAINER], ['OEBPS/content.opf', opf], ...files]);
}

// Lines of a recipe page as printed (wrapped at about 90 characters).
function pageLines(r) {
    const wrap = s => { const out = []; let line = ''; String(s).split(' ').forEach(w => { if ((line + ' ' + w).trim().length > 88) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }); if (line) out.push(line); return out; };
    return [r.serves, r.time, ...(r.intro ? wrap(r.intro) : []), 'Ingredients', ...r.ingredients, 'Method', ...r.steps.flatMap(wrap)];
}

function make(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    const e = path.join(dir, `${EPUB.title}.epub`);
    fs.writeFileSync(e, epub(EPUB)); out.push(e);
    const p = path.join(dir, `${TEXT_PDF.title}.pdf`);
    fs.writeFileSync(p, pdf(TEXT_PDF.recipes.map(r => [r.title, pageLines(r)]))); out.push(p);
    const s = path.join(dir, `${SCANNED_PDF.title}.pdf`);
    try {
        execFileSync('python3', [path.join(__dirname, 'make-scanned-pdf.py'), s], { input: JSON.stringify(SCANNED_PDF.recipes.map(r => [r.title, pageLines(r)])), stdio: ['pipe', 'inherit', 'inherit'] });
        out.push(s);
    } catch (err) { console.error(`No scanned PDF (needs Python and Pillow): ${err.message}`); }
    return out;
}

if (require.main === module) make(process.argv[2] || 'audit-books').forEach(f => console.log(`Wrote ${f}`));
module.exports = { make, epub, pageLines };
