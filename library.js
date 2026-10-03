// The personal recipe library: the files someone drops into the Nourish folders (Recipe Books,
// My Recipes) become recipes the planner can use, preferred when they fit.
//
// Reading the folder is done by the phone (NativeBridge) or the PC (backend /api/library); this file
// turns what they return into recipes and keeps an index, so a file is only read again when it
// changes. Indexing runs in small batches with pauses, in the background.
(function (root) {
    'use strict';

    const KINDS = { txt: 'text', text: 'text', md: 'text', markdown: 'text', html: 'html', htm: 'html', webarchive: 'html', mhtml: 'html', pdf: 'pdf',
        jpg: 'image', jpeg: 'image', png: 'image', heic: 'image', webp: 'image' };
    function kindOf(path) { const m = String(path).toLowerCase().match(/\.([a-z0-9]+)$/); return (m && KINDS[m[1]]) || null; }

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
    // between batches. io: { list() → [{ path, size, mtime }], read(path) → { kind, text?, html?, image? },
    // ocr(image) → text (optional), readStructured, readText, sleep(ms) }.
    // index: { files: { path: { sig, recipes, note } } }. Returns { index, changed, read, errors }.
    async function refresh(index, io, { batch = 3, pause = 400, maxFiles = 60 } = {}) {
        const idx = index && index.files ? index : { files: {} };
        const listed = (await io.list()).filter(f => kindOf(f.path));
        const seen = new Set(listed.map(f => f.path));
        let changed = 0;
        Object.keys(idx.files).forEach(p => { if (!seen.has(p)) { delete idx.files[p]; changed++; } });
        const todo = listed.filter(f => !idx.files[f.path] || idx.files[f.path].sig !== `${f.size}:${f.mtime}`).slice(0, maxFiles);
        let read = 0;
        const errors = [];
        for (let i = 0; i < todo.length; i += batch) {
            await Promise.all(todo.slice(i, i + batch).map(async f => {
                const entry = { sig: `${f.size}:${f.mtime}`, recipes: [], note: '' };
                try {
                    const got = await io.read(f.path);
                    const file = Object.assign({ path: f.path, folder: f.folder }, got);
                    if (got.kind === 'image') {
                        file.text = io.ocr ? await io.ocr(got.image) : '';
                        if (!io.ocr) entry.note = 'Pictures can be read in the iPhone app.';
                    }
                    if (got.kind === 'pdf' && !got.text) entry.note = got.note || 'No text could be read from this PDF.';
                    entry.recipes = recipesFromFile(file, io.readStructured, io.readText);
                    if (!entry.recipes.length && !entry.note) entry.note = 'No recipe found (it needs a title, an ingredients list and steps).';
                    read++;
                } catch (e) {
                    entry.note = `Couldn't read it: ${e.message}`;
                    errors.push(`${f.path}: ${e.message}`);
                }
                idx.files[f.path] = entry;
                changed++;
            }));
            if (i + batch < todo.length && io.sleep) await io.sleep(pause);
        }
        idx.at = Date.now();
        return { index: idx, changed, read, errors, pending: Math.max(0, listed.filter(f => !idx.files[f.path] || idx.files[f.path].sig !== `${f.size}:${f.mtime}`).length) };
    }

    function allRecipes(index) {
        const out = [];
        Object.keys((index && index.files) || {}).forEach(p => (index.files[p].recipes || []).forEach(r => out.push(r)));
        return out;
    }

    const api = { parseRecipeText, recipesFromFile, refresh, allRecipes, kindOf };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis);
