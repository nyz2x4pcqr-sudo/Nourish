// The personal recipe library: the files someone drops into the Nourish folders (Recipe Books,
// My Recipes) become recipes the planner can use, preferred when they fit.
//
// Reading the folder is done by the phone (NativeBridge) or the PC (backend /api/library); this file
// turns what they return into recipes and keeps an index, so a file is only read again when it
// changes. Indexing runs in small batches with pauses, in the background.
(function (root) {
    'use strict';

    const KINDS = { txt: 'text', text: 'text', md: 'text', markdown: 'text', html: 'html', htm: 'html', webarchive: 'html', mhtml: 'html', pdf: 'pdf',
        jpg: 'image', jpeg: 'image', png: 'image', heic: 'image', webp: 'image', epub: 'epub', docx: 'docx',
        mobi: 'kindle', azw: 'kindle', azw3: 'kindle', kfx: 'kindle' };
    function kindOf(path) { const m = String(path).toLowerCase().match(/\.([a-z0-9]+)$/); return (m && KINDS[m[1]]) || null; }
    // The notes Nourish puts in its own folders ("Read me.txt") aren't recipes.
    function isReadme(path) { return /^(read ?me|about these folders)\.txt$/i.test(String(path).split('/').pop()); }

    // === RECIPES IN PLAIN TEXT (a cookbook's text, notes, markdown) ===
    const ING_HEAD = /^\W{0,4}(ingredients?|you(?:'|’)ll need|what you need|shopping list)\b[^a-z]{0,20}$/i;
    const STEP_HEAD = /^\W{0,4}(method|directions?|instructions?|preparation|steps|how to make( it)?|to make)\b[^a-z]{0,20}$/i;
    const OTHER_HEAD = /^\W{0,4}(notes?|tips?|nutrition( facts| information)?|serving suggestions?|variations?|storage|equipment|per serving)\b[^a-z]{0,30}$/i;
    const BULLET = /^\s*(?:[-*•▪◦·]|\d+[.)]|\(\d+\)|step\s*\d+[:.]?)\s*/i;
    const AMOUNT = /^\s*(?:[-*•]\s*)?(?:\d|½|¼|¾|⅓|⅔|⅛|a |an |one |two |three |pinch|handful|dash)/i;

    function cleanLine(l) { return String(l).replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
    function titleLike(l) {
        const t = l.replace(/^#+\s*/, '').trim();
        return t.length >= 3 && t.length <= 80 && !/[.:;]$/.test(t) && !AMOUNT.test(t) && !ING_HEAD.test(t) && !STEP_HEAD.test(t) && !OTHER_HEAD.test(t) && /[a-z]/i.test(t) && t.split(' ').length <= 12;
    }
    function servingsIn(lines) {
        for (const l of lines) {
            const m = l.match(/\b(?:serves|servings?|yield|makes)\b\D{0,12}(\d{1,2})/i);
            if (m) return Number(m[1]);
        }
        return null;
    }
    function timeIn(lines) {
        for (const l of lines) {
            const m = l.match(/\btotal(?: time)?\b\D{0,10}(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
            if (m && (m[1] || m[2])) return Number(m[1] || 0) * 60 + Number(m[2] || 0);
        }
        return null;
    }

    // Every recipe in a block of text: a title, an ingredients section and a method section.
    function parseRecipeText(text, { fallbackTitle = '' } = {}) {
        const lines = String(text || '').split(/\r?\n/).map(cleanLine);
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            if (!ING_HEAD.test(lines[i])) continue;
            // The title: the nearest heading-like line above, before any earlier recipe's text.
            let title = '';
            const floor = out.length ? out[out.length - 1]._end : 0;
            for (let k = i - 1; k >= Math.max(floor, i - 15); k--) {
                if (lines[k] && /^#+\s/.test(lines[k]) && titleLike(lines[k])) { title = lines[k]; break; }
            }
            if (!title) for (let k = i - 1; k >= Math.max(floor, i - 15); k--) { if (lines[k] && titleLike(lines[k]) && !/\b(serves|servings|prep|cook|total|yield|makes)\b/i.test(lines[k])) { title = lines[k]; break; } }
            const ingredients = [];
            let j = i + 1;
            for (; j < lines.length && !STEP_HEAD.test(lines[j]) && !ING_HEAD.test(lines[j]); j++) {
                const l = lines[j];
                if (!l || OTHER_HEAD.test(l)) continue;
                if (/^#+\s/.test(l) && !AMOUNT.test(l.replace(/^#+\s*/, ''))) continue;   // a sub-heading ("For the sauce")
                if (/^for the\b.*:?$/i.test(l)) continue;
                ingredients.push(l.replace(BULLET, '').trim());
            }
            if (j >= lines.length || !STEP_HEAD.test(lines[j])) continue;
            const steps = [];
            let k = j + 1;
            let current = '';
            for (; k < lines.length; k++) {
                const l = lines[k];
                if (ING_HEAD.test(l) || OTHER_HEAD.test(l)) break;
                // The next recipe's title: a heading followed soon by an ingredients header.
                if (titleLike(l) && /^#/.test(l)) break;
                if (titleLike(l) && lines.slice(k + 1, k + 8).some(x => ING_HEAD.test(x))) break;
                if (!l) { if (current) { steps.push(current); current = ''; } continue; }
                // A new step: a numbered/bulleted line, or a new sentence after a finished one.
                if (current && (BULLET.test(l) || (/[.!)]$/.test(current) && /^[A-Z]/.test(l)))) { steps.push(current); current = ''; }
                current = current ? `${current} ${l}` : l.replace(BULLET, '');
            }
            if (current) steps.push(current);
            const body = lines.slice(Math.max(floor, i - 15), k);
            const recipe = {
                name: (title || fallbackTitle).replace(/^#+\s*/, '').trim(),
                ingredients: ingredients.filter(x => x.length > 1).slice(0, 40),
                steps: steps.map(x => x.trim()).filter(x => x.length > 3).slice(0, 30),
                servings: servingsIn(body),
                time_minutes: timeIn(body),
                _end: k,
            };
            if (recipe.name && recipe.ingredients.length >= 3 && recipe.steps.length) out.push(recipe);
            i = k - 1;
        }
        return out.map(r => { delete r._end; return r; });
    }

    // Recipes from one file, as the phone or PC returned it: { kind, text?, html? }.
    // readStructured(html, url): the link importer's recipe-data reader (importer.js).
    function recipesFromFile(file, readStructured, readText) {
        const name = String(file.path || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
        let found = [];
        if (file.kind === 'html' && file.html) {
            const r = readStructured ? readStructured(file.html, file.url || '') : null;
            if (r) found = [r];
            else if (readText) found = parseRecipeText(readText(file.html), { fallbackTitle: name });
        } else if (file.text) {
            found = parseRecipeText(file.text, { fallbackTitle: name });
        }
        return found.map(r => Object.assign({}, r, {
            source_name: file.folder ? `${file.folder}: ${name}` : name,
            library_path: file.path,
            source_url: r.source_url || undefined,
        }));
    }

    // Brings the index up to date: reads only new or changed files, a few at a time, pausing
    // between batches. io: { list() → [{ path, size, mtime }], read(path) → { kind, text?, html?, image?, size? },
    // range(path, offset, length) → Uint8Array (books: EPUB and Word are read a slice at a time, see
    // books.js), ocr(image) → text (optional), readStructured, readText, sleep(ms) }.
    // opts.progress(path, done, total, chapter) is told how far a book is; opts.cancelled() → true
    // stops reading (the book is read again from the start next time).
    // index: { files: { path: { sig, recipes, note } } }. Returns { index, changed, read, errors, cancelled }.
    async function refresh(index, io, { batch = 3, pause = 400, maxFiles = 60, progress, cancelled } = {}) {
        const idx = index && index.files ? index : { files: {} };
        const listed = (await io.list()).filter(f => kindOf(f.path) && !isReadme(f.path));
        const seen = new Set(listed.map(f => f.path));
        let changed = 0;
        Object.keys(idx.files).forEach(p => { if (!seen.has(p)) { delete idx.files[p]; changed++; } });
        const todo = listed.filter(f => !idx.files[f.path] || idx.files[f.path].sig !== `${f.size}:${f.mtime}`).slice(0, maxFiles);
        let read = 0;
        const errors = [];
        let stopped = false;
        // Books are read one at a time, after the other files (they take longer).
        const BOOK = { epub: 1, docx: 1 };
        const books = todo.filter(f => BOOK[kindOf(f.path)]);
        const groups = [];
        const rest = todo.filter(f => !BOOK[kindOf(f.path)]);
        for (let i = 0; i < rest.length; i += batch) groups.push(rest.slice(i, i + batch));
        books.forEach(b => groups.push([b]));
        for (let g = 0; g < groups.length && !stopped; g++) {
            if (cancelled && cancelled()) { stopped = true; break; }
            await Promise.all(groups[g].map(async f => {
                const entry = { sig: `${f.size}:${f.mtime}`, recipes: [], note: '' };
                try {
                    const kind = kindOf(f.path);
                    if (kind === 'kindle') {
                        entry.note = booksReader() ? booksReader().KINDLE_NOTE : 'Kindle books can\'t be read.';
                        idx.files[f.path] = entry;
                        changed++;
                        return;
                    }
                    let got = await io.read(f.path);
                    if (kind === 'epub' || kind === 'docx') got = await readBook(f, got, kind, io, { progress, cancelled });
                    const file = Object.assign({ path: f.path, folder: f.folder }, got);
                    if (got.kind === 'image') {
                        file.text = io.ocr ? await io.ocr(got.image) : '';
                        if (!io.ocr) entry.note = 'Pictures can be read in the iPhone app.';
                    }
                    if (got.kind === 'pdf' && !got.text) entry.note = got.note || 'No text could be read from this PDF.';
                    entry.recipes = got.recipes ? got.recipes : recipesFromFile(file, io.readStructured, io.readText);
                    const text = file.text || (file.html && io.readText ? io.readText(file.html) : '');
                    // Passages for the cooking notes: a recipe file is already covered by its recipes.
                    entry.passages = passagesFrom(text, { max: entry.recipes.length > 3 || f.folder === 'Recipe Books' ? 250 : 40 })
                        .filter(p => !entry.recipes.some(r => r.name && p.indexOf(r.name) >= 0 && p.length < 900));
                    if (!entry.passages.length) delete entry.passages;
                    if (!entry.recipes.length && !entry.passages && !entry.note) entry.note = 'No recipe found (it needs a title, an ingredients list and steps).';
                    read++;
                } catch (e) {
                    if (e.cancelled) { stopped = true; return; }   // not saved: read again next time
                    entry.note = e.drm && booksReader() ? booksReader().DRM_NOTE : `Couldn't read it: ${e.message}`;
                    errors.push(`${f.path}: ${e.message}`);
                }
                idx.files[f.path] = entry;
                changed++;
            }));
            if (g + 1 < groups.length && io.sleep && !stopped) await io.sleep(pause);
        }
        idx.at = Date.now();
        idx.listed = listed.map(f => ({ path: f.path, folder: f.folder, size: f.size }));
        return { index: idx, changed, read, errors, cancelled: stopped, pending: Math.max(0, listed.filter(f => !idx.files[f.path] || idx.files[f.path].sig !== `${f.size}:${f.mtime}`).length) };
    }

    // A book (EPUB or Word) read a slice at a time. Its recipes keep the book's title and chapter:
    // "Recipe from Easy Mornings · Breakfast".
    // books.js loads after this file, so it's looked up when first needed.
    function booksReader() {
        if (root.NourishBooks) return root.NourishBooks;
        try { return typeof require === 'function' ? require('./books.js') : null; } catch (e) { return null; }
    }
    async function readBook(f, got, kind, io, { progress, cancelled } = {}) {
        const Books = booksReader();
        if (!Books || !io.range) throw new Error('books can\'t be read here yet');
        const size = got.size || f.size;
        const opts = {
            size, readRange: (offset, length) => io.range(f.path, offset, length),
            progress: progress ? (done, total, chapter) => progress(f.path, done, total, chapter) : null,
            cancelled, pause: io.sleep,
        };
        const book = kind === 'epub' ? await Books.readEpub(opts) : await Books.readDocx(opts);
        const fileName = String(f.path).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
        const title = book.title || fileName;
        const recipes = book.recipes.map(r => Object.assign({}, r, {
            source_name: r.chapter ? `${title} · ${r.chapter}` : title,
            book: title,
            library_path: f.path,
        }));
        return { kind, text: book.text, recipes, note: recipes.length ? '' : undefined };
    }

    // === COOKING KNOWLEDGE (cookbooks as inspiration, not as a ranking) ===
    // A cookbook's text is kept as short passages (about a paragraph each) that talk about food:
    // pairings, seasoning, techniques, proportions. For each meal the few most relevant passages are
    // found (a simple word-overlap search, fast enough for a phone) and given to the AI as notes.
    const FOOD_WORDS = /\b(salt|pepper|garlic|onion|ginger|lemon|lime|butter|oil|olive|vinegar|herb|spice|cumin|paprika|chili|chilli|thyme|rosemary|basil|parsley|cilantro|coriander|mint|dill|oregano|sauce|stock|broth|roast|sear|saut[eé]|simmer|braise|bake|grill|poach|whisk|fold|marinate|season|caramel|crisp|tender|chicken|beef|pork|lamb|fish|salmon|egg|cheese|cream|yogh?urt|rice|pasta|noodle|bean|lentil|tomato|potato|mushroom|spinach|cup|tbsp|tsp|tablespoon|teaspoon|gram|ounce|minute|heat|pan|oven|skillet)\b/gi;
    const STOP = new Set(('a an and the of to in on for with or at by from as is are be it its this that these those your you into over until then than so if but not no all any each '
        + 'can will should may about up out off just very more most some such only also too well when while them they their there here what which who how use using used make made add added '
        + 'one two three cup cups tbsp tsp minutes minute about large small medium').split(' '));
    function terms(text) {
        return String(text || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/)
            .map(w => w.replace(/^['-]+|['-]+$/g, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'))
            .filter(w => w.length > 2 && !STOP.has(w));
    }
    function passagesFrom(text, { max = 250, size = 600 } = {}) {
        const foodish = p => (p.match(FOOD_WORDS) || []).length >= 2;
        const paras = String(text || '').split(/\n\s*\n|\r\n\s*\r\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length > 40 && foodish(p));
        const out = [];
        let cur = '';
        const push = () => {
            const t = cur.trim();
            cur = '';
            if (t.length < 80) return;
            const food = (t.match(FOOD_WORDS) || []).length;
            if (food >= 3 && food / Math.max(1, t.split(' ').length) > 0.04) out.push(t.slice(0, size + 200));
        };
        for (const p of paras) {
            if (cur && (cur.length >= 150 || cur.length + p.length > size)) push();   // one topic per passage; only short bits are joined
            cur = cur ? `${cur} ${p}` : p;
            if (cur.length > size * 1.4) push();
            if (out.length >= max) break;
        }
        if (cur && out.length < max) push();
        return out;
    }

    // A search index over every file's passages, built once and reused until the index changes.
    let knowledgeCache = null;
    function knowledge(index) {
        const at = (index && index.at) || 0;
        if (knowledgeCache && knowledgeCache.at === at && knowledgeCache.index === index) return knowledgeCache;
        const docs = [];
        Object.keys((index && index.files) || {}).forEach(path => {
            const e = index.files[path];
            (e.passages || []).forEach(text => docs.push({ text, file: path, terms: new Set(terms(text)) }));
            (e.recipes || []).forEach(r => docs.push({ text: `${r.name}: ${(r.ingredients || []).join(', ')}. ${(r.steps || []).join(' ')}`.slice(0, 700), file: path, recipe: r.name, terms: new Set(terms(`${r.name} ${(r.ingredients || []).join(' ')} ${(r.steps || []).join(' ')}`)) }));
        });
        const df = new Map();
        docs.forEach(d => d.terms.forEach(t => df.set(t, (df.get(t) || 0) + 1)));
        knowledgeCache = { at, index, docs, df, pairs: pairingsOf(docs) };
        return knowledgeCache;
    }
    // The k passages that share the most (rarer) words with the question. [] when nothing matches well.
    function retrieve(index, question, k = 3) {
        const kb = knowledge(index);
        if (!kb.docs.length) return [];
        const q = [...new Set(terms(question))];
        if (!q.length) return [];
        const n = kb.docs.length;
        const idf = t => Math.log(1 + n / (1 + (kb.df.get(t) || 0)));
        const scored = kb.docs.map(d => {
            let s = 0, hits = 0;
            q.forEach(t => { if (d.terms.has(t)) { s += idf(t); hits++; } });
            return { d, s: s / Math.sqrt(1 + d.terms.size / 40), hits };
        }).filter(x => x.hits >= Math.min(2, q.length)).sort((a, b) => b.s - a.s);
        const out = [];
        const files = {};
        for (const x of scored) {
            if (out.length >= k) break;
            if ((files[x.d.file] || 0) >= 2) continue;   // a mix of books when there are several
            files[x.d.file] = (files[x.d.file] || 0) + 1;
            out.push({ text: x.d.text, file: x.d.file, recipe: x.d.recipe || '' });
        }
        return out;
    }

    // Which flavour ingredients the books put together (garlic + lemon, cumin + lime, …): counted
    // over every passage and recipe. Used to give recipes from *any* source a small nudge when
    // they use pairings the person's books use.
    const PAIR_WORDS = ['garlic', 'ginger', 'onion', 'shallot', 'scallion', 'lemon', 'lime', 'orange', 'chili', 'cumin', 'coriander', 'paprika', 'turmeric', 'cinnamon', 'nutmeg',
        'thyme', 'rosemary', 'sage', 'oregano', 'basil', 'parsley', 'cilantro', 'dill', 'mint', 'tarragon', 'chive', 'bay', 'fennel', 'mustard', 'vinegar', 'soy', 'miso', 'sesame',
        'honey', 'maple', 'butter', 'olive', 'cream', 'yogurt', 'parmesan', 'feta', 'tomato', 'mushroom', 'spinach', 'potato', 'chickpea', 'lentil', 'bean', 'rice', 'pasta', 'noodle',
        'chicken', 'beef', 'pork', 'lamb', 'salmon', 'fish', 'shrimp', 'egg', 'tofu', 'avocado', 'pepper', 'carrot', 'zucchini', 'eggplant', 'cauliflower', 'broccoli', 'kale',
        'coconut', 'peanut', 'almond', 'walnut', 'apple', 'pear', 'berry', 'caper', 'olive', 'anchovy', 'pea', 'corn', 'squash', 'pumpkin', 'leek', 'celery', 'cabbage'];
    const PAIR_SET = new Set(PAIR_WORDS);
    function flavourWords(termSet) { return [...termSet].filter(t => PAIR_SET.has(t)).sort(); }
    function pairingsOf(docs) {
        const pairs = new Map();
        docs.forEach(d => {
            const w = flavourWords(d.terms).slice(0, 14);
            for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) { const k = w[i] + '+' + w[j]; pairs.set(k, (pairs.get(k) || 0) + 1); }
        });
        return pairs;
    }
    // 0 (no help) to 1: how much of a recipe's flavour pairings the books use often. Needs a few books'
    // worth of text before it says anything.
    function pairingScore(index, recipe) {
        const kb = knowledge(index);
        if (kb.docs.length < 15 || !recipe) return 0;
        const w = flavourWords(new Set(terms(`${recipe.name || ''} ${(recipe.ingredients || []).join(' ')}`))).slice(0, 12);
        let seen = 0, total = 0;
        for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) { total++; if ((kb.pairs.get(w[i] + '+' + w[j]) || 0) >= 2) seen++; }
        return total >= 3 ? seen / total : 0;
    }

    function allRecipes(index) {
        const out = [];
        Object.keys((index && index.files) || {}).forEach(p => (index.files[p].recipes || []).forEach(r => out.push(r)));
        return out;
    }

    const api = { parseRecipeText, recipesFromFile, refresh, allRecipes, kindOf, isReadme, passagesFrom, retrieve, pairingScore, terms };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis);
