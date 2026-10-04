// The offline recipe database: every recipe read from the person's books and recipe files, saved
// for good as a full recipe (same shape as web and Nourish recipes: ingredients with amounts, steps,
// servings, times, meal type, cuisine, difficulty, nutrition worked out by the app's calculator) with
// where it came from (book, author, chapter or page).
//
// Kept in the phone's (or browser's) own database, IndexedDB, which holds thousands of recipes
// without slowing the app; the plain localStorage the app uses for settings is only a few MB. All
// recipes are also kept in memory once loaded, so the planner reads them instantly; changes are
// written to the database in the background. When IndexedDB isn't available, localStorage is used
// (smaller, but nothing is lost).
//
// Books are known by a fingerprint of the file's contents, not its name: a renamed or moved book
// isn't read again or saved twice. Recipes that came out of a book incomplete are saved anyway,
// marked "needs review", and kept out of plans until they're fixed or confirmed. The same dish in
// two books (or already in the web library) is kept once.
(function (root) {
    'use strict';
    const PL = root.NourishPlanner || (typeof require === 'function' ? require('./planner.js') : null);
    const N = root.NourishNutrition || (typeof require === 'function' ? require('./nutrition.js') : null);
    const F = root.NourishFinder || (typeof require === 'function' ? (() => { try { return require('./finder.js'); } catch (e) { return null; } })() : null);

    // === STORAGE ===
    // backend: { load() → { recipes: [], books: [] }, put(store, items), del(store, ids) }, all async.
    function idbBackend(idb, name = 'nourish') {
        let dbp = null;
        const open = () => dbp || (dbp = new Promise((ok, bad) => {
            // Version 2 adds 'files': every file read, by fingerprint (also the ones with no recipes),
            // so a book is never read twice; and how far a paused book got.
            // Version 3 adds 'notes': technique notes from technique books.
            const req = idb.open(name, 3);
            req.onupgradeneeded = () => {
                const db = req.result;
                ['recipes', 'books', 'files', 'notes'].forEach(store => { if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' }); });
            };
            req.onsuccess = () => ok(req.result);
            req.onerror = () => bad(req.error || new Error('the recipe database could not be opened'));
            req.onblocked = () => bad(new Error('the recipe database is busy'));
        }));
        const tx = async (stores, mode, fn) => {
            const db = await open();
            return new Promise((ok, bad) => {
                const t = db.transaction(stores, mode);
                const out = fn(t);
                t.oncomplete = () => ok(out && out.result !== undefined ? out.result : out);
                t.onerror = () => bad(t.error);
                t.onabort = () => bad(t.error || new Error('aborted'));
            });
        };
        const getAll = (t, store) => { const r = t.objectStore(store).getAll(); return r; };
        return {
            kind: 'IndexedDB',
            async load() {
                let recipes = [], books = [], files = [], notes = [];
                await tx(['recipes', 'books', 'files', 'notes'], 'readonly', t => {
                    const a = getAll(t, 'recipes'), b = getAll(t, 'books'), c = getAll(t, 'files'), n = getAll(t, 'notes');
                    a.onsuccess = () => { recipes = a.result || []; };
                    b.onsuccess = () => { books = b.result || []; };
                    c.onsuccess = () => { files = c.result || []; };
                    n.onsuccess = () => { notes = n.result || []; };
                });
                return { recipes, books, files, notes };
            },
            put: (store, items) => tx([store], 'readwrite', t => { const s = t.objectStore(store); items.forEach(x => s.put(x)); }),
            del: (store, ids) => tx([store], 'readwrite', t => { const s = t.objectStore(store); ids.forEach(id => s.delete(id)); }),
        };
    }
    function localBackend(storage, key = 'nourish_recipe_db') {
        let data = null;
        const read = () => {
            if (!data) { try { data = JSON.parse(storage.getItem(key) || 'null') || {}; } catch (e) { data = {}; } }
            ['recipes', 'books', 'files', 'notes'].forEach(k => { if (!data[k]) data[k] = {}; });
            return data;
        };
        const write = () => { storage.setItem(key, JSON.stringify(data)); };
        return {
            kind: 'localStorage',
            async load() { const d = read(); return { recipes: Object.values(d.recipes), books: Object.values(d.books), files: Object.values(d.files), notes: Object.values(d.notes) }; },
            async put(store, items) { const d = read(); items.forEach(x => { d[store][x.id] = x; }); write(); },
            async del(store, ids) { const d = read(); ids.forEach(id => { delete d[store][id]; }); write(); },
        };
    }
    function memoryBackend() {
        const d = { recipes: {}, books: {}, files: {}, notes: {} };
        const copy = store => Object.values(d[store]).map(x => JSON.parse(JSON.stringify(x)));
        return {
            kind: 'memory',
            async load() { return { recipes: copy('recipes'), books: copy('books'), files: copy('files'), notes: copy('notes') }; },
            async put(store, items) { items.forEach(x => { d[store][x.id] = JSON.parse(JSON.stringify(x)); }); },
            async del(store, ids) { ids.forEach(id => { delete d[store][id]; }); },
        };
    }

    // === A FINGERPRINT FOR A FILE ===
    // From its size and its first and last 64 KB: the same book renamed or moved has the same one.
    function fingerprint(size, head, tail) {
        let h1 = 0x811c9dc5, h2 = 0x01000193;
        const feed = bytes => { for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 16777619) >>> 0; h2 = Math.imul(h2 + bytes[i], 2246822519) >>> 0; } };
        feed(head || []);
        feed(tail || []);
        return `fp-${Number(size) || 0}-${h1.toString(36)}-${h2.toString(36)}`;
    }
    function textFingerprint(text) {
        const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(String(text || '')) : Buffer.from(String(text || ''));
        return fingerprint(bytes.length, bytes.subarray(0, 65536), bytes.subarray(Math.max(0, bytes.length - 65536)));
    }

    // === A BOOK'S RECIPE MADE INTO A FULL RECIPE ===
    const AMOUNT = /^\s*(?:[-*•]\s*)?(?:\d|½|¼|¾|⅓|⅔|⅛|a |an |one |two |three |four |half |pinch|handful|dash|juice of|zest of)/i;
    const NOT_MEAL_KIND = { 'a drink': 'drink', 'a dessert': 'dessert', 'a sauce or condiment': 'sauce', 'a side or snack': 'side' };
    function enrich(raw, book) {
        const list = v => (Array.isArray(v) ? v : []).map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        const r = {
            name: String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled recipe',
            ingredients: list(raw.ingredients).slice(0, 50),
            steps: list(raw.steps).slice(0, 40),
            servings: Number(raw.servings) >= 1 && Number(raw.servings) <= 24 ? Math.round(Number(raw.servings)) : null,
            time_minutes: Number(raw.time_minutes) > 0 ? Math.round(Number(raw.time_minutes)) : null,
            category: Array.isArray(raw.category) ? raw.category.join(', ') : String(raw.category || raw.chapter || ''),
        };
        const why = [];
        // A title that looks cut off ("in Stuffed Pasta Shells", "and Rice") or missing.
        if (raw.untitled || /^Untitled recipe/.test(r.name)) why.push('no title found');
        else if (/^[a-z]/.test(r.name) || /^(in|with|and|or|on|of|for|to|from|over|under|at|by|&|y|con|de|en)\b/i.test(r.name) || /\b(and|with|in|of|or|&)$/i.test(r.name)) why.push('the title looks cut off');
        if (r.ingredients.length < 2 || (r.ingredients.length < 3 && !(r.ingredients.every(l => AMOUNT.test(l))))) why.push('fewer than 3 ingredients');
        if (!r.steps.length) why.push('no steps');
        const amounts = r.ingredients.filter(l => AMOUNT.test(l)).length;
        if (r.ingredients.length >= 3 && amounts < r.ingredients.length / 2) why.push('most ingredients have no amounts');
        if (!r.servings) { r.servings = 4; r.servings_guessed = true; }
        // Nutrition from the app's own calculator, per serving.
        let unmatched = 0;
        if (N && r.ingredients.length) {
            try {
                N.settle(r);
                unmatched = (r.nutrition_unmatched || []).length;
            } catch (e) { r.nutrition = null; }
        }
        if (!r.nutrition || !(Number(r.nutrition.calories) > 0)) why.push('nutrition could not be worked out');
        else {
            const major = (r.nutrition_unmatched || []).filter(l => !(N.isMinor && N.isMinor(l)));
            if (major.length >= 3 || major.length > r.ingredients.length * 0.25) why.push(`the calculator can't read: ${major.slice(0, 3).join('; ')}`);
            else if (unmatched) r.nutrition_approximate = true;
        }
        // What kind of dish it is, and which meals it suits.
        const kindWhy = F && F.notAMeal ? F.notAMeal(r) : '';
        const fit = PL ? PL.mealFit(r) : { breakfast: false, lunch: false, dinner: false };
        const meals = ['breakfast', 'lunch', 'dinner'].filter(m => fit[m]);
        const kind = NOT_MEAL_KIND[kindWhy] || (meals.length ? 'meal' : /dessert/.test(fit.why || '') ? 'dessert' : /drink/.test(fit.why || '') ? 'drink' : /article/.test(fit.why || '') ? 'article'
            : /starter|spread|side/.test(fit.why || '') ? 'side' : /sauce/.test(fit.why || '') ? 'sauce' : 'other');
        const prof = PL ? PL.recipeProfile(r) : null;
        const out = Object.assign(r, {
            meal_types: meals,
            kind,   // meal, drink, dessert, sauce, side or other: only meals go into plans; the rest are for snacks, extras, browsing and chat
            cuisine: PL ? PL.cuisineOf(r) : undefined,
            difficulty: prof ? prof.difficulty : undefined,
            active_minutes: prof && prof.minutes ? prof.minutes : undefined,
            book: book.title || undefined,
            author: book.author || undefined,
            chapter: raw.chapter || undefined,
            page: raw.page || undefined,
            book_id: book.id,
            library_path: book.path || undefined,
            source_name: book.label || `From your book: ${book.title || 'Untitled'}`,
            from_book: true,
            review: why.length > 0 || undefined,
            review_why: why.length ? why.join('; ') : undefined,
        });
        if (!out.time_minutes && prof && prof.minutes) { out.time_minutes = prof.minutes; out.time_estimated = true; }
        return out;
    }

    const keyOf = name => (PL && PL.dishKey ? PL.dishKey(name) : String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'recipe';

    // === THE DATABASE ===
    function create(backend) {
        const recipes = new Map();
        const books = new Map();
        const files = new Map();
        const notes = new Map();
        let ready = null;
        const listeners = [];
        const changed = what => listeners.forEach(fn => { try { fn(what); } catch (e) { /* keep going */ } });
        // A book's counts: recipes, meals for plans, other kinds, waiting for review.
        async function recount(bookId) {
            const b = books.get(bookId);
            if (!b) return;
            const mine = [...recipes.values()].filter(x => x.book_id === bookId && !x.duplicate_of);
            b.count = mine.length;
            b.review = mine.filter(x => x.review).length;
            b.meals = mine.filter(x => x.kind === 'meal' && !x.review).length;
            b.others = mine.filter(x => x.kind !== 'meal').length;
            await backend.put('books', [b]);
        }
        const api = {
            backend,
            open() {
                if (!ready) {
                    ready = backend.load().then(d => {
                        (d.books || []).forEach(b => books.set(b.id, b));
                        (d.recipes || []).forEach(r => recipes.set(r.id, r));
                        (d.files || []).forEach(f => files.set(f.id, f));
                        (d.notes || []).forEach(n => notes.set(n.id, n));
                        return api;
                    });
                }
                return ready;
            },
            onChange(fn) { listeners.push(fn); },
            count() { return recipes.size; },
            all() { return [...recipes.values()]; },
            get(id) { return recipes.get(id) || null; },
            books() { return [...books.values()].sort((a, b) => String(a.title).localeCompare(String(b.title))); },
            book(id) { return books.get(id) || null; },
            bookByPath(path) { return [...books.values()].find(b => b.path === path || (b.paths || []).includes(path)) || null; },
            recipesOf(bookId) { return [...recipes.values()].filter(r => r.book_id === bookId); },
            // Recipes the planner may use: complete meals, not duplicates, not waiting for review.
            forPlanning() { return [...recipes.values()].filter(r => r.kind === 'meal' && !r.review && !r.duplicate_of && r.meal_types && r.meal_types.length); },
            // Everything else that's still food: drinks, desserts, sauces, sides (for snacks, extras, browsing and chat).
            extras() { return [...recipes.values()].filter(r => r.kind !== 'meal' && r.kind !== 'article' && !r.duplicate_of); },
            // Simple word search over names, ingredients, book and chapter.
            search(q, limit = 30) {
                const words = String(q || '').toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2);
                if (!words.length) return [];
                return [...recipes.values()].filter(r => !r.duplicate_of).map(r => {
                    const name = r.name.toLowerCase(), rest = `${(r.ingredients || []).join(' ')} ${r.book || ''} ${r.chapter || ''} ${r.cuisine || ''}`.toLowerCase();
                    const score = words.reduce((s, w) => s + (name.includes(w) ? 3 : rest.includes(w) ? 1 : 0), 0);
                    return { r, score };
                }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.r);
            },
            // Saves a book's recipes (replacing what was saved for it before). `known` is a list of
            // dish names already elsewhere (the web library): those are kept once.
            async importBook(meta, rawRecipes, { known = [] } = {}) {
                await api.open();
                const id = meta.id;
                const old = books.get(id) || {};
                const book = Object.assign({}, old, {
                    id, title: meta.title || old.title || 'Untitled book', author: meta.author || old.author || undefined,
                    path: meta.path || old.path, paths: [...new Set([].concat(old.paths || [], meta.path ? [meta.path] : []))],
                    kind: meta.kind || old.kind, label: meta.label || old.label, at: Date.now(), missing: false, type: 'recipes', notes: 0,
                });
                // A book that was read as a technique book before: its notes go.
                const oldNotes = api.notesOf ? api.notesOf(id).map(n => n.id) : [];
                oldNotes.forEach(k => notes.delete(k));
                if (oldNotes.length) await backend.del('notes', oldNotes);
                const removed = api.recipesOf(id).map(r => r.id);
                removed.forEach(rid => recipes.delete(rid));
                const knownKeys = new Set(known.map(keyOf));
                const otherKeys = new Map();
                recipes.forEach(r => { if (!r.duplicate_of) otherKeys.set(keyOf(r.name), r.id); });
                const seen = new Set();
                const fresh = [];
                rawRecipes.forEach((raw, i) => {
                    const r = enrich(raw, book);
                    const k = keyOf(r.name);
                    r.id = `${id}:${i}:${slug(r.name)}`;
                    // The same dish twice: kept once (the first copy); marked so it can be shown if wanted.
                    if (seen.has(k)) return;
                    seen.add(k);
                    if (otherKeys.has(k)) r.duplicate_of = otherKeys.get(k);
                    else if (knownKeys.has(k)) r.duplicate_of = 'web';
                    fresh.push(r);
                    recipes.set(r.id, r);
                });
                book.count = fresh.filter(r => !r.duplicate_of).length;
                book.review = fresh.filter(r => r.review && !r.duplicate_of).length;
                book.meals = fresh.filter(r => r.kind === 'meal' && !r.review && !r.duplicate_of).length;
                book.duplicates = fresh.filter(r => r.duplicate_of).length;
                book.others = fresh.filter(r => r.kind !== 'meal' && !r.duplicate_of).length;
                books.set(id, book);
                const gone = removed.filter(rid => !recipes.has(rid));
                if (gone.length) await backend.del('recipes', gone);
                await backend.put('recipes', fresh);
                await backend.put('books', [book]);
                changed('import');
                return book;
            },
            // Every file that was read, by its fingerprint: { id, path, title, author, count, note,
            // failed, empty, passages, partial (where a paused read got to), stopped }. Kept even for
            // files with no recipes, so nothing is read twice.
            file(fp) { return files.get(fp) || null; },
            files() { return [...files.values()]; },
            async recordFile(fp, data) {
                if (!fp) return null;
                const rec = Object.assign({}, files.get(fp) || {}, data, { id: fp, at: Date.now() });
                Object.keys(rec).forEach(k => { if (rec[k] === undefined) delete rec[k]; });
                files.set(fp, rec);
                await backend.put('files', [rec]);
                return rec;
            },
            async forgetFile(fp) { if (files.delete(fp)) await backend.del('files', [fp]); },
            // === TECHNIQUE NOTES (technique books) ===
            // Saves a technique book's notes (replacing what was saved for it before) and the book.
            async saveTechniqueBook(meta, list) {
                await api.open();
                const id = meta.id;
                const old = [...notes.values()].filter(n => n.book_id === id).map(n => n.id);
                old.forEach(k => notes.delete(k));
                if (old.length) await backend.del('notes', old);
                const fresh = (list || []).slice(0, 2000).map((n, i) => ({ id: `${id}:n${i}`, book_id: id, book: meta.title, text: String(n.text).slice(0, 420),
                    ingredients: n.ingredients || [], methods: n.methods || [], dishes: n.dishes || [], chapter: n.chapter, page: n.page }));
                fresh.forEach(n => notes.set(n.id, n));
                if (fresh.length) await backend.put('notes', fresh);
                const prev = books.get(id) || {};
                const book = Object.assign({}, prev, { id, title: meta.title || prev.title || 'Untitled book', author: meta.author || prev.author, path: meta.path || prev.path,
                    paths: [...new Set([].concat(prev.paths || [], meta.path ? [meta.path] : []))], kind: meta.kind || prev.kind, type: 'technique', notes: fresh.length, count: 0, meals: 0, review: 0, others: 0, at: Date.now(), missing: false });
                books.set(id, book);
                // A book that was a recipe book before: its recipes go.
                const recipeIds = api.recipesOf(id).map(r => r.id);
                recipeIds.forEach(k => recipes.delete(k));
                if (recipeIds.length) await backend.del('recipes', recipeIds);
                await backend.put('books', [book]);
                changed('notes');
                return book;
            },
            notesOf(bookId) { return [...notes.values()].filter(n => n.book_id === bookId); },
            noteCount() { return notes.size; },
            // The notes most related to a dish: shared ingredients, cooking methods and kinds of dish,
            // then shared words. q: { words, ingredients, methods, dishes }. At most one note in three
            // from the same chapter, so the AI gets a mix.
            notesFor(q, k = 5) {
                if (!notes.size) return [];
                const ing = new Set((q.ingredients || []).map(x => String(x).toLowerCase())), met = new Set(q.methods || []), dis = new Set(q.dishes || []);
                const words = new Set(String(q.words || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3));
                const scored = [];
                notes.forEach(n => {
                    let sc = 0;
                    (n.ingredients || []).forEach(x => { if (ing.has(x)) sc += 2; });
                    (n.methods || []).forEach(x => { if (met.has(x)) sc += 2.5; });
                    (n.dishes || []).forEach(x => { if (dis.has(x)) sc += 2; });
                    if (sc === 0) return;
                    String(n.text).toLowerCase().split(/[^a-z]+/).forEach(w => { if (words.has(w)) sc += 0.3; });
                    scored.push({ n, sc: sc / Math.sqrt(1 + n.text.length / 200) });
                });
                scored.sort((a, b) => b.sc - a.sc);
                const out = [], per = {};
                for (const x of scored) {
                    const key = `${x.n.book_id}|${x.n.chapter || x.n.page || ''}`;
                    if ((per[key] || 0) >= 2) continue;
                    per[key] = (per[key] || 0) + 1;
                    out.push(x.n);
                    if (out.length >= k) break;
                }
                return out;
            },
            // A book's file is in a new place (renamed or moved): just remembered.
            async linkPath(id, path) {
                const b = books.get(id);
                if (!b) return null;
                b.path = path;
                b.paths = [...new Set([].concat(b.paths || [], [path]))];
                b.missing = false;
                await backend.put('books', [b]);
                return b;
            },
            async markMissing(id, missing = true) {
                const b = books.get(id);
                if (!b || !!b.missing === missing) return;
                b.missing = missing;
                await backend.put('books', [b]);
                changed('missing');
            },
            async removeBook(id) {
                const ids = api.recipesOf(id).map(r => r.id);
                ids.forEach(rid => recipes.delete(rid));
                const nids = api.notesOf(id).map(n => n.id);
                nids.forEach(k => notes.delete(k));
                if (nids.length) await backend.del('notes', nids);
                books.delete(id);
                await backend.del('recipes', ids);
                await backend.del('books', [id]);
                changed('remove');
            },
            // "Looks right": a recipe waiting for review is confirmed and can go into plans.
            async confirm(id, patch) {
                const r = recipes.get(id);
                if (!r) return null;
                Object.assign(r, patch || {});
                delete r.review; delete r.review_why;
                await recount(r.book_id);
                await backend.put('recipes', [r]);
                changed('confirm');
                return r;
            },
            // Edited by the person (name, ingredients, steps, servings, time): worked out again
            // (nutrition, meal type) and confirmed.
            async update(id, patch) {
                const old = recipes.get(id);
                if (!old) return null;
                const b = books.get(old.book_id) || { id: old.book_id, title: old.book, author: old.author, path: old.library_path };
                const r = enrich(Object.assign({ chapter: old.chapter, page: old.page, category: old.category }, patch), b);
                Object.assign(r, { id, edited: true });
                if (old.duplicate_of) r.duplicate_of = old.duplicate_of;
                delete r.review; delete r.review_why;
                Object.keys(r).forEach(k => { if (r[k] === undefined) delete r[k]; });
                recipes.set(id, r);
                await recount(r.book_id);
                await backend.put('recipes', [r]);
                changed('confirm');
                return r;
            },
            // For PC sync and backups: everything, as plain data.
            exportData() { return { version: 1, books: api.books(), recipes: api.all() }; },
            // Merges a backup or the PC's copy: newer books win, recipes follow their book.
            async importData(data) {
                if (!data || !Array.isArray(data.books) || !Array.isArray(data.recipes)) return 0;
                await api.open();
                let n = 0;
                const putBooks = [], putRecipes = [];
                for (const b of data.books) {
                    if (!b || !b.id) continue;
                    const mine = books.get(b.id);
                    if (mine && (mine.at || 0) >= (b.at || 0)) continue;
                    books.set(b.id, b);
                    putBooks.push(b);
                    const theirs = data.recipes.filter(r => r && r.id && r.book_id === b.id);
                    const drop = api.recipesOf(b.id).map(r => r.id).filter(rid => !theirs.some(r => r.id === rid));
                    drop.forEach(rid => recipes.delete(rid));
                    if (drop.length) await backend.del('recipes', drop);
                    theirs.forEach(r => { recipes.set(r.id, r); putRecipes.push(r); });
                    n += theirs.length;
                }
                if (putRecipes.length) await backend.put('recipes', putRecipes);
                if (putBooks.length) { await backend.put('books', putBooks); changed('sync'); }
                return n;
            },
        };
        return api;
    }

    // The app's database: IndexedDB when the device has it, else localStorage, else memory only.
    function forDevice() {
        try {
            if (root.indexedDB) return create(idbBackend(root.indexedDB));
        } catch (e) { /* fall through */ }
        try { if (root.localStorage) return create(localBackend(root.localStorage)); } catch (e) { /* fall through */ }
        return create(memoryBackend());
    }

    const api = { create, forDevice, idbBackend, localBackend, memoryBackend, enrich, fingerprint, textFingerprint, keyOf };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishRecipeDB = api;
})(typeof window !== 'undefined' ? window : globalThis);
