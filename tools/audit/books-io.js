// Reads cookbook folders into the recipe database the way the app does on a PC: library.js reads
// each file (EPUB slices through books.js, PDFs page by page through the backend's own PDF reader,
// backend/library.py), and recipedb.js turns each book's recipes into full recipes (nutrition, meal
// type, "needs a look" for the ones that aren't complete).
//
// A PC has no text recognition, so a scanned PDF gives no recipes there. With `ocr: 'simulate'`
// the iPhone's reading is stood in for: a scanned book whose text is in tests/fixtures/ocr/<title>.txt
// is read from that text (as if recognised perfectly), marked as recognised.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../../library.js');
const DB = require('../../recipedb.js');

const ROOT = path.join(__dirname, '..', '..');
const OCR_DIR = path.join(ROOT, 'tests', 'fixtures', 'ocr');
const KINDS = /\.(epub|docx|pdf|txt|md|html?)$/i;

// Every readable file under the folders: [{ path (relative, like the app's), folder, size, mtime, abs }].
function listFiles(folders) {
    const out = [];
    folders.forEach(({ dir, folder }) => {
        if (!dir || !fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(name => {
            const abs = path.join(dir, name);
            const st = fs.statSync(abs);
            if (!st.isFile() || !KINDS.test(name) || /^read ?me\.txt$/i.test(name)) return;
            out.push({ path: `${folder}/${name}`, folder, size: st.size, mtime: Math.round(st.mtimeMs), abs });
        });
    });
    return out;
}

// The backend's own PDF reader (backend/library.py read_pdf_pages), every page at once.
function pdfPages(abs, python) {
    const code = [
        'import json, os, sys',
        `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'backend'))})`,
        'os.environ["NOURISH_LIBRARY_DIR"] = os.path.dirname(os.path.dirname(sys.argv[1]))',
        'import library',
        'rel = os.path.relpath(sys.argv[1], os.environ["NOURISH_LIBRARY_DIR"]).replace(os.sep, "/")',
        'print(json.dumps(library.read_pdf_pages(rel, 0, 100000)))',
    ].join('\n');
    const out = execFileSync(python, ['-c', code, abs], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 });
    return JSON.parse(out);
}

function makeIo(files, { python, ocr } = {}) {
    const byPath = new Map(files.map(f => [f.path, f]));
    const pdfCache = new Map();
    const notes = [];
    const pdfOf = p => {
        if (pdfCache.has(p)) return pdfCache.get(p);
        const f = byPath.get(p);
        const got = pdfPages(f.abs, python);
        const letters = got.texts.map(t => (String(t.text || '').match(/[a-z]/gi) || []).length);
        const scanned = got.pages > 0 && letters.every(n => n < 20);
        if (scanned && ocr === 'simulate') {
            const title = (got.title || path.basename(f.abs, '.pdf')).replace(/\s*\(scanned\)\s*$/i, '');
            const sidecar = path.join(OCR_DIR, `${title}.txt`);
            if (fs.existsSync(sidecar)) {
                const pages = fs.readFileSync(sidecar, 'utf8').split('\n\f\n');
                got.texts = got.texts.map((t, i) => ({ text: pages[i] || '', ocr: true }));
                notes.push(`${p}: scanned; its pages were "recognised" from ${path.relative(ROOT, sidecar)} (standing in for the iPhone)`);
            } else notes.push(`${p}: scanned; no stand-in text for the iPhone's reading, so no recipes (as on a PC)`);
        } else if (scanned) notes.push(`${p}: scanned (pictures only); a PC can't read it, as in the app`);
        pdfCache.set(p, got);
        return got;
    };
    return {
        notes,
        list: async () => files.map(({ path: p, folder, size, mtime }) => ({ path: p, folder, size, mtime })),
        read: async p => {
            const f = byPath.get(p);
            const ext = path.extname(p).toLowerCase();
            if (ext === '.epub' || ext === '.docx') return { kind: ext.slice(1), size: f.size };
            if (ext === '.pdf') { const g = pdfOf(p); return { kind: 'pdf', text: g.texts.map(t => t.text).join('\n') }; }
            if (/^\.html?$/.test(ext)) return { kind: 'html', html: fs.readFileSync(f.abs, 'utf8') };
            return { kind: 'text', text: fs.readFileSync(f.abs, 'utf8') };
        },
        range: async (p, offset, length) => {
            const fd = fs.openSync(byPath.get(p).abs, 'r');
            try { const buf = Buffer.alloc(length); const n = fs.readSync(fd, buf, 0, length, offset); return new Uint8Array(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
        },
        pdf: async (p, from, count) => {
            const g = pdfOf(p);
            return { pages: g.pages, title: g.title, author: g.author, from, texts: count ? g.texts.slice(from, from + count) : [] };
        },
        readText: html => String(html).replace(/<[^>]+>/g, '\n'),
        sleep: async () => {},
    };
}

// Reads the folders and returns { db, books: [{ path, title, count, meals, review, note }], notes }.
async function loadBooks(folders, { python = 'python', ocr = 'simulate', known = [] } = {}) {
    const files = listFiles(folders);
    const db = DB.create(DB.memoryBackend());
    await db.open();
    const io = makeIo(files, { python, ocr });
    const res = await L.refresh({ files: {} }, io, { pause: 0, maxFiles: 500 });
    const books = [];
    for (const [p, e] of Object.entries(res.index.files)) {
        const row = { path: p, title: e.title, note: e.note || '', count: 0 };
        if (e.recipes && e.recipes.length) {
            const book = await db.importBook({ id: e.fp, title: e.title, author: e.author, path: p, kind: L.kindOf(p), label: /^My Recipes\//.test(p) ? `From your recipes: ${e.title}` : undefined }, e.recipes, { known });
            Object.assign(row, { count: book.count, meals: book.meals, review: book.review, others: book.others });
        }
        books.push(row);
    }
    return { db, books, notes: io.notes.concat(res.errors) };
}

module.exports = { loadBooks, listFiles, pdfPages };
