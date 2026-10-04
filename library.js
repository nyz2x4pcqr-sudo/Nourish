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
    function parseRecipeText(text, opts) { return parseMarked(text, opts).map(r => { delete r._start; delete r._end; return r; }); }
    function parseMarked(text, { fallbackTitle = '' } = {}) {
        const { lines } = prepareLines(text);
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            if (!ING_HEAD.test(lines[i])) continue;
            // The title: the nearest heading-like line above, before any earlier recipe's text.
            let title = '', titleAt = i;
            const floor = out.length ? out[out.length - 1]._end : 0;
            for (let k = i - 1; k >= Math.max(floor, i - 15); k--) {
                if (lines[k] && /^#+\s/.test(lines[k]) && titleLike(lines[k])) { title = lines[k]; titleAt = k; break; }
            }
            if (!title) for (let k = i - 1; k >= Math.max(floor, i - 15); k--) { if (lines[k] && titleLike(lines[k]) && !/\b(serves|servings|prep|cook|total|yield|makes)\b/i.test(lines[k])) { title = lines[k]; titleAt = k; break; } }
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
                _start: titleAt, _end: k,
            };
            if (recipe.name && recipe.ingredients.length >= 3 && recipe.steps.length) out.push(recipe);
            i = k - 1;
        }
        return out;
    }

    // === RECIPES IN OLDER AND TRADITIONAL COOKBOOKS ===
    // Many cookbooks (and most scanned ones) have no "Ingredients" or "Method" headings: a title in
    // capitals, maybe an English name in brackets and the servings, the ingredients (sometimes in
    // lettered groups, "A", "B", that the steps refer to), then numbered steps or paragraphs, and the
    // next recipe straight after on the same page. Recipes are found by that shape instead: a run of
    // lines that look like ingredients (an amount, a unit or a food), followed by lines that read
    // like cooking steps, with the nearest title-like line above.
    const UNITS = /\b(cups?|c\.|tbsps?|tbs\.?|tbsp\.|tsps?\.?|tablespoons?(?:ful)?|teaspoons?(?:ful)?|ounces?|oz\.?|pounds?|lbs?\.?|grams?|g|kg|kilos?|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l|pints?|pts?\.?|quarts?|qts?\.?|gallons?|cans?|tins?|jars?|packages?|pkgs?\.?|packets?|sticks?|cloves?|heads?|bunch(?:es)?|sprigs?|stalks?|slices?|pieces?|pinch(?:es)?|dash(?:es)?|handfuls?|sheets?|leaves|inch(?:es)?|cm|drops?|scoops?|shots?|bags?|envelopes?|squares?|bottles?|dozen)\b/i;
    const FOOD = /\b(salt|pepper|sugar|flour|butter|oil|lard|water|milk|cream|eggs?|yolks?|whites?|garlic|onions?|tomato(?:es)?|rice|chicken|pork|beef|ham|bacon|lamb|fish|cod|codfish|bacalao|shrimps?|prawns?|crab|lobster|beans?|garbanzos?|chickpeas?|lentils?|potato(?:es)?|plantains?|yucca|yautia|pumpkin|squash|corn|cornmeal|peppers?|ajes?|cilantro|culantro|recao|oregano|cumin|paprika|cinnamon|vanilla|nutmeg|cloves|olives?|capers?|alcaparrado|sofrito|achiote|annatto|vinegar|wine|rum|stock|broth|cheese|bread|crumbs|coconut|lime|lemon|orange|juice|honey|syrup|tea|coffee|ice|yogh?urt|tofu|noodles|pasta|spaghetti|cabbage|carrots?|celery|spinach|lettuce|avocados?|bananas?|apples?|mangoes|pineapple|guava|raisins?|almonds?|nuts?|walnuts?|peanuts?|sesame|ginger|soy|mushrooms?|herbs?|parsley|basil|thyme|bay|mint|chili|chiles?|chocolate|cocoa|baking|yeast|soda|gelatin|steak|ribs|sausages?|chorizo|tapioca|boba|pearls|matcha)\b/i;
    const QTY = /^(?:[-*•]\s*)?(?:\d|[½¼¾⅓⅔⅛⅜⅝⅞]|(?:a|an|one|two|three|four|five|six|eight|ten|twelve|half|several|dash|pinch|handful|few|juice of|zest of|grated|freshly)\b)/i;
    const LABEL = /^\(?[A-H]\)?\s*[.:—–-]?$/;
    const LABEL_PREFIX = /^\(?[A-H]\)?\s*[—–:.)-]\s+(?=\S)/;
    const VERBS = /\b(add|bake|beat|blend|boil|braise|bring|brown|chill|chop|combine|cook|cool|cover|cut|dice|drain|fold|fry|grill|heat|knead|marinate|mash|melt|mix|place|pour|preheat|put|reduce|remove|rinse|roast|saut[eé]|season|serve|shake|simmer|slice|soak|sprinkle|steam|stir|strain|stuff|toss|turn|wash|whisk|wrap|brew|steep|crush|grind|spread|arrange|transfer|let|set|allow|keep|garnish|top|squeeze|peel|scald|parboil|baste|dissolve|sift|cream|grease|line|roll|shape|refrigerate|freeze|warm|discard|return|repeat)\b/i;
    const SERVINGS_LINE = /^\(?\s*(?:serves|servings?|makes|yields?|for)\b.{0,30}\)?$|^\(?\s*\d{1,2}(?:\s*(?:to|-|–)\s*\d{1,2})?\s*(?:servings?|portions?|people|persons?)\b.{0,20}\)?$/i;
    const SMALL = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'with', 'in', 'on', 'de', 'del', 'con', 'en', 'y', 'a la', 'al', 'la', 'el', 'los', 'las', 'for', 'to', 'à', 'au', 'aux', 'du', 'des', 'le']);
    const CONNECT_END = /\b(and|with|in|on|&|de|del|con|en|y|a la|al|for|of|or)$/i;
    const CONNECT_START = /^(and|with|in|on|&|de|del|con|en|y|al|for|of|or)\b/i;
    function stripLabel(l) { return l.replace(LABEL_PREFIX, ''); }
    // strict: the line has an amount (a list starts with one); otherwise a short food line ("Ice",
    // "Salt", "Lard or vegetable oil for frying") counts too, inside a list.
    function isIngLine(raw, strict) {
        const l = stripLabel(raw);
        if (l.length < 2 || l.length > 100) return false;
        if (/[.!?]\s+[A-Z][a-z]/.test(l) || /:$/.test(l)) return false;
        const words = l.split(/\s+/).length;
        if (words > 14) return false;
        if (/\bto taste\b/i.test(l) && words <= 8) return true;
        if (QTY.test(l)) return UNITS.test(l) || FOOD.test(l) || words <= 5;
        if (strict) return false;
        if (/\b(for frying|for greasing|for serving|for garnish|to serve|as needed|optional)\b/i.test(l) && words <= 8 && FOOD.test(l)) return true;
        return words <= 4 && FOOD.test(l) && !(words >= 3 && words === l.split(/\s+/).filter(w => /^[A-Z]/.test(w)).length) && !VERBS.test(l) && /^[a-z]/i.test(l) && !/[.!]$/.test(l);
    }
    const NUM_STEP = /^(?:step\s*)?(\d{1,2})\s*[.)]\s+(?=[A-Za-z])/i;
    function isStepLine(l) {
        if (NUM_STEP.test(l)) { const t = l.replace(NUM_STEP, ''); return t.length >= 12 && (VERBS.test(t) || t.length >= 30) && !(UNITS.test(t.split(/\s+/).slice(0, 2).join(' ')) && t.length < 40); }
        return l.length >= 25 && /^[A-Z¿¡"'(]/.test(l) && VERBS.test(l) && !isIngLine(l);
    }
    function titleish(l) {
        if (!l || l.length < 3 || l.length > 70 || /[.,;:]$/.test(l) || !/[a-z]/i.test(l)) return false;
        if (isIngLine(l) || SERVINGS_LINE.test(l) || LABEL.test(l) || ING_HEAD.test(l) || STEP_HEAD.test(l) || OTHER_HEAD.test(l)) return false;
        if (/^\(.*\)$/.test(l) || /^\d/.test(l)) return false;
        const words = l.split(/\s+/);
        if (words.length > 10) return false;
        if (l === l.toUpperCase()) return true;
        const caps = words.filter(w => /^[A-ZÁÉÍÓÚÑ"'(]/.test(w)).length;
        return /^[A-ZÁÉÍÓÚÑ¿¡"']/.test(l) && (caps >= Math.ceil(words.filter(w => !SMALL.has(w.toLowerCase())).length * 0.6) || words.length <= 5)
            && !(VERBS.test(words[0]) && words.slice(1).some(w => /^[a-z]/.test(w) && !SMALL.has(w)));
    }
    // "ARROZ CON POLLO" → "Arroz con Pollo".
    function niceTitle(t) {
        let s = String(t).replace(/\s+/g, ' ').trim();
        if (s === s.toUpperCase() && /[A-Z]{3}/.test(s)) {
            s = s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
        }
        return s;
    }
    // Lines as a cookbook's pages give them: page numbers, running heads ("PUERTO RICAN COOKERY" on
    // every page) and words split at the end of a line are cleaned up; each line keeps its page.
    function prepareLines(text) {
        const raw = String(text || '').split(/\r?\n/);
        const lines = [], pages = [];
        let page = 1;
        raw.forEach(l => { if (l.indexOf('\f') >= 0) page += (l.match(/\f/g) || []).length; lines.push(cleanLine(l)); pages.push(page); });
        // Running heads and feet: the same short line on many pages.
        const totalPages = pages.length ? pages[pages.length - 1] : 1;
        if (totalPages >= 4) {
            const seen = new Map();
            lines.forEach((l, i) => {
                if (!l || l.length > 60 || isIngLine(l)) return;
                const k = l.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
                if (!seen.has(k)) seen.set(k, new Set());
                seen.get(k).add(pages[i]);
            });
            const heads = new Set([...seen.entries()].filter(([, p]) => p.size >= Math.max(4, totalPages * 0.2)).map(([k]) => k));
            lines.forEach((l, i) => { if (heads.has(l.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' '))) lines[i] = ''; });
        }
        for (let i = 0; i < lines.length; i++) {
            if (/^(?:\d{1,4}|page \d{1,4}|[ivxlc]{1,6})$/i.test(lines[i])) lines[i] = '';
            // "toma-" + "toes, chopped" → "tomatoes, chopped".
            if (/[a-z]-$/.test(lines[i]) && i + 1 < lines.length && /^[a-z]/.test(lines[i + 1])) {
                const next = lines[i + 1].split(' ');
                lines[i] = lines[i].slice(0, -1) + next.shift();
                lines[i + 1] = next.join(' ');
            }
        }
        return { lines, pages };
    }
    function parseLooseRecipes(text, { skip = [] } = {}) {
        const { lines, pages } = prepareLines(text);
        const n = lines.length;
        const used = i => skip.some(([a, b]) => i >= a && i < b);
        const ingAt = i => i < n && !!lines[i] && isIngLine(lines[i], true);
        // Two or more ingredient lines soon after line i (the start of a recipe's list).
        const ingRunSoon = (i, span = 8) => { let c = 0; for (let k = i; k < Math.min(n, i + span); k++) { if (ingAt(k)) { c++; if (c >= 2) return true; } else if (lines[k] && isStepLine(lines[k])) return false; } return false; };
        const out = [];
        let floor = 0;
        for (let i = 0; i < n; i++) {
            if (!ingAt(i) || used(i) || !ingRunSoon(i, 4)) continue;
            // The ingredients: a run of ingredient lines; group labels ("A"), "For the sauce:" and
            // blank lines in between are fine; a line that wraps is joined to the one before.
            const ingredients = [];
            let j = i;
            for (; j < n; j++) {
                const l = lines[j];
                if (!l || LABEL.test(l) || ING_HEAD.test(l) || /^(for (the|a)\b.{0,40}|[A-Za-z ]{3,30}):$/i.test(l)) continue;
                if (isIngLine(l) && !(titleish(l) && !isIngLine(l, true) && ingRunSoon(j + 1, 6) && !ingredients.length)) { ingredients.push(stripLabel(l)); continue; }
                if (ingredients.length && /^[a-z(]/.test(l) && l.length < 50 && !isStepLine(l)) { ingredients[ingredients.length - 1] += ' ' + l; continue; }
                break;
            }
            if (ingredients.length < 2) continue;
            // The steps: numbered steps or paragraphs, up to the next recipe.
            const steps = [];
            let cur = '';
            let k = j;
            const push = () => { if (cur) { steps.push(cur.trim()); cur = ''; } };
            for (; k < n; k++) {
                const l = lines[k];
                if (!l) { if (cur && /[.!)]$/.test(cur)) push(); continue; }
                if (used(k)) break;
                if (STEP_HEAD.test(l)) continue;
                if (OTHER_HEAD.test(l) || /^(variations?|note|tips?|cook'?s note)\b/i.test(l)) { push(); break; }
                if (titleish(l) && ingRunSoon(k + 1, 10) && !(cur && /^[a-z]/.test(l))) break;
                if (ingAt(k) && ingRunSoon(k, 3) && (steps.length || cur)) break;
                if (NUM_STEP.test(l) || (isStepLine(l) && (!cur || /[.!)]$/.test(cur)))) { push(); cur = l.replace(NUM_STEP, ''); continue; }
                if (titleish(l) && (!cur || /[.!)]$/.test(cur))) { if (steps.length || cur) break; continue; }
                if (cur) { cur += ' ' + l; continue; }
            }
            push();
            const good = steps.filter(s => s.length >= 15 && (VERBS.test(s) || s.length >= 40));
            if (!good.length) continue;
            // The title: the nearest title-like line above (past the servings, an English name in
            // brackets and a short introduction), joined with the line above when it's split in two.
            let title = '', note = '', titleAt = -1;
            let servingsLine = '';
            for (let t = i - 1, prose = 0; t >= Math.max(floor, i - 14); t--) {
                const l = lines[t];
                if (!l || LABEL.test(l)) continue;
                if (SERVINGS_LINE.test(l)) { servingsLine = servingsLine || l; continue; }
                if (/^\(.*\)$/.test(l)) { if (!SERVINGS_LINE.test(l.slice(1, -1))) note = note || l; else servingsLine = servingsLine || l; continue; }
                if (titleish(l)) { title = l; titleAt = t; break; }
                if (++prose > 8) break;
            }
            if (titleAt > floor && lines[titleAt - 1] && titleish(lines[titleAt - 1]) && (CONNECT_START.test(title) || CONNECT_END.test(lines[titleAt - 1])) && (lines[titleAt - 1] + title).length <= 80) {
                title = `${lines[titleAt - 1]} ${title}`;
                titleAt--;
            }
            const body = lines.slice(Math.max(floor, titleAt >= 0 ? titleAt : i), k);
            const sm = (servingsLine || body.join(' ')).match(/\b(?:serves|servings?|makes|yields?)\b\D{0,12}(\d{1,2})|(\d{1,2})(?:\s*(?:to|-|–)\s*\d{1,2})?\s*(?:servings?|portions?|people|persons?)\b/i);
            out.push({
                name: title ? niceTitle(title) + (note && note.length < 50 ? ` ${note}` : '') : '',
                ingredients: ingredients.map(x => x.replace(BULLET, '').trim()).filter(x => x.length > 1).slice(0, 40),
                steps: good.slice(0, 30),
                servings: sm ? Number(sm[1] || sm[2]) : null,
                time_minutes: timeIn(body),
                page: pages[titleAt >= 0 ? titleAt : i] > 1 || pages[n - 1] > 1 ? pages[titleAt >= 0 ? titleAt : i] : undefined,
                _start: titleAt >= 0 ? titleAt : i, _end: k,
            });
            floor = k;
            i = k - 1;
        }
        return out;
    }
    // Every recipe in a text: the ones with "Ingredients" / "Method" headings, then the ones found by
    // their shape (older and scanned cookbooks), without counting any twice.
    function findRecipesInText(text, opts = {}) {
        const marked = parseMarked(text, opts);
        const loose = parseLooseRecipes(text, { skip: marked.map(r => [r._start, r._end]) });
        const keys = new Set(marked.map(r => r.name.toLowerCase()));
        const all = marked.concat(loose.filter(r => !r.name || !keys.has(r.name.toLowerCase()))).sort((a, b) => a._start - b._start);
        return all.map(r => {
            delete r._start; delete r._end;
            if (!r.name) { r.name = opts.fallbackTitle && all.length === 1 ? opts.fallbackTitle : `Untitled recipe${r.page ? ` (page ${r.page})` : ''}`; r.untitled = true; }
            if (r.page === undefined) delete r.page;
            return r;
        });
    }

    // Recipes from one file, as the phone or PC returned it: { kind, text?, html? }.
    // readStructured(html, url): the link importer's recipe-data reader (importer.js).
    function recipesFromFile(file, readStructured, readText) {
        const name = String(file.path || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
        let found = [];
        if (file.kind === 'html' && file.html) {
            const r = readStructured ? readStructured(file.html, file.url || '') : null;
            if (r) found = [r];
            else if (readText) found = findRecipesInText(readText(file.html), { fallbackTitle: name });
        } else if (file.text) {
            found = findRecipesInText(file.text, { fallbackTitle: name });
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
    // books.js), pdf(path, from, count) → { pages, title, author, texts: [{ text, ocr }] } (a PDF a
    // few pages at a time; scanned pages are read with the phone's text recognition), ocr(image) →
    // text (optional), readStructured, readText, sleep(ms) }.
    // opts.progress(path, done, total, chapter) is told how far a book is; opts.cancelled() → true
    // stops reading (the book isn't marked as read); opts.paused() → true stops a book where it is
    // and keeps how far it got (opts.onPause(path, fp, state); it carries on from there when it's
    // asked for again with force); opts.onCancel(path, fp) is told which book was stopped.
    // opts.known(fingerprint) → { id, count, title, note, partial } when a file with these contents
    // was already read (renamed or moved, or the index was lost): it isn't read again.
    // opts.force: paths to read again even though they haven't changed ("Read again", "Try again",
    // "Carry on"). opts.onFile(path, entry) is called (and awaited) as soon as each file is done, so
    // a finished book is saved even if the app is closed before the others are read.
    // index: { files: { path: { sig, fp, recipes, count, note, failed, title, author } } }.
    // Returns { index, changed, read, errors, cancelled, paused, removed: [{ path, fp }] }.
    async function refresh(index, io, { batch = 3, pause = 400, maxFiles = 60, progress, cancelled, paused, onPause, onCancel, onCheckpoint, known, force, onFile } = {}) {
        const idx = index && index.files ? index : { files: {} };
        const listed = (await io.list()).filter(f => kindOf(f.path) && !isReadme(f.path));
        const seen = new Set(listed.map(f => f.path));
        let changed = 0;
        const removed = [];
        Object.keys(idx.files).forEach(p => { if (!seen.has(p)) { removed.push({ path: p, fp: idx.files[p].fp, bookId: idx.files[p].bookId }); delete idx.files[p]; changed++; } });
        const again = new Set(force || []);
        const todo = listed.filter(f => again.has(f.path) || !idx.files[f.path] || idx.files[f.path].sig !== `${f.size}:${f.mtime}`).slice(0, maxFiles);
        let read = 0;
        const errors = [];
        let stopped = false, held = false;
        // Books are read one at a time, after the other files (they take longer).
        const BOOK = { epub: 1, docx: 1, pdf: 1 };
        const books = todo.filter(f => BOOK[kindOf(f.path)]);
        const groups = [];
        const rest = todo.filter(f => !BOOK[kindOf(f.path)]);
        for (let i = 0; i < rest.length; i += batch) groups.push(rest.slice(i, i + batch));
        books.forEach(b => groups.push([b]));
        const halt = () => (cancelled && cancelled()) || (paused && paused());
        for (let g = 0; g < groups.length && !stopped && !held; g++) {
            if (halt()) { if (cancelled && cancelled()) stopped = true; else held = true; break; }
            await Promise.all(groups[g].map(async f => {
                const entry = { sig: `${f.size}:${f.mtime}`, recipes: [], note: '' };
                let done = false;
                try {
                    const kind = kindOf(f.path);
                    // The file's fingerprint (its size and first and last 64 KB): a book already read
                    // (under this name or another) isn't read again.
                    if (io.range && f.size > 0 && kind !== 'kindle') {
                        try {
                            const n = Math.min(65536, f.size);
                            entry.fp = fingerprintOf(f.size, await io.range(f.path, 0, n), await io.range(f.path, Math.max(0, f.size - n), n));
                        } catch (e) { /* older app without slices: fingerprinted from its text below */ }
                    }
                    const hit = entry.fp && known ? known(entry.fp) : null;
                    // Reading that was interrupted (the app closed part-way) carries on by itself.
                    const interrupted = hit && hit.partial && hit.partial.checkpoint;
                    if (hit && !again.has(f.path) && !interrupted) {
                        Object.assign(entry, { bookId: hit.id, count: hit.count || 0, title: hit.title, linked: !!hit.id, note: hit.note || '', failed: hit.failed || undefined, paused: hit.partial ? true : undefined });
                        if (hit.author) entry.author = hit.author;
                        if (hit.passages) entry.passages = hit.passages;
                        if (!entry.failed) delete entry.failed;
                        if (!entry.paused) delete entry.paused;
                        idx.files[f.path] = entry;
                        changed++;
                        done = true;
                        return;
                    }
                    const resume = hit && hit.partial ? hit.partial : null;
                    if (kind === 'kindle') {
                        entry.note = booksReader() ? booksReader().KINDLE_NOTE : 'Kindle books can\'t be read.';
                        idx.files[f.path] = entry;
                        changed++;
                        done = true;
                        return;
                    }
                    const how = { progress, cancelled, paused, resume, checkpoint: onCheckpoint && entry.fp ? state => onCheckpoint(f.path, entry.fp, state) : null };
                    let got;
                    if (kind === 'epub' || kind === 'docx') got = await readBook(f, await io.read(f.path), kind, io, how);
                    else if (kind === 'pdf' && io.pdf) got = await readPdf(f, io, how);
                    else got = await io.read(f.path);
                    const file = Object.assign({ path: f.path, folder: f.folder }, got);
                    if (got.kind === 'image') {
                        file.text = io.ocr ? await io.ocr(got.image) : '';
                        if (!io.ocr) entry.note = 'Pictures can be read in the iPhone app.';
                    }
                    if (got.kind === 'pdf' && !String(got.text || '').trim()) entry.note = got.why || got.note || 'No text could be read from this PDF.';
                    entry.recipes = got.recipes ? got.recipes : recipesFromFile(file, io.readStructured, io.readText);
                    const text = file.text || (file.html && io.readText ? io.readText(file.html) : '');
                    if (!entry.fp) entry.fp = textFingerprint(text || got.image || f.path);
                    entry.title = cleanTitle(got.title) || titleFromFileName(f.path);
                    if (got.author) entry.author = cleanAuthor(got.author);
                    if (got.pages) entry.pages = got.pages;
                    if (got.scanned) entry.scanned = got.scanned;
                    entry.count = entry.recipes.length;
                    // Mostly recipes, or mostly technique (the person can say otherwise: hit.bookType).
                    if (/^(epub|pdf|docx)$/.test(kind)) {
                        const notes = got.notes || [];
                        entry.bookKind = (hit && hit.bookType && hit.bookType !== 'auto') ? hit.bookType : bookKind(entry.recipes.length, notes.length, got.chapters || got.pages);
                        if (entry.bookKind === 'technique') { entry.notes = notes; entry.noteCount = notes.length; entry.recipes = []; entry.count = 0; }
                        if (got.noText) entry.noText = got.noText;
                    }
                    // Passages for the cooking notes: a recipe file is already covered by its recipes.
                    entry.passages = passagesFrom(text, { max: entry.recipes.length > 3 || f.folder === 'Recipe Books' ? 250 : 40 })
                        .filter(p => !entry.recipes.some(r => r.name && p.indexOf(r.name) >= 0 && p.length < 900));
                    if (!entry.passages.length) delete entry.passages;
                    // Never a silent nothing: why no recipe came out of it, in plain words.
                    if (entry.bookKind === 'technique') entry.note = `Technique book: ${entry.noteCount} technique notes${entry.noText ? `; ${entry.noText} pages without readable text skipped` : ''}`;
                    if (!entry.recipes.length && !entry.note) entry.note = got.why || 'No recipe found (it needs a title, an ingredients list and steps).';
                    if (!entry.recipes.length && entry.bookKind !== 'technique') entry.empty = true;
                    read++;
                    done = true;
                } catch (e) {
                    if (e.cancelled) { stopped = true; if (onCancel) await onCancel(f.path, entry.fp); return; }   // not marked as read
                    if (e.paused) {
                        held = true;
                        if (onPause) await onPause(f.path, entry.fp, e.state);
                        entry.paused = true;
                        entry.note = e.state && e.state.total ? `Paused at ${e.state.unit || 'part'} ${e.state.at} of ${e.state.total}` : 'Paused';
                        idx.files[f.path] = entry;
                        changed++;
                        return;
                    }
                    entry.note = e.drm && booksReader() ? booksReader().DRM_NOTE : `Couldn't read it: ${e.message}`;
                    entry.failed = true;
                    errors.push(`${f.path}: ${e.message}`);
                    done = true;
                }
                idx.files[f.path] = entry;
                changed++;
                if (done && onFile) await onFile(f.path, entry, idx);
            }));
            if (g + 1 < groups.length && io.sleep && !stopped && !held) await io.sleep(pause);
        }
        idx.at = Date.now();
        idx.listed = listed.map(f => ({ path: f.path, folder: f.folder, size: f.size }));
        return { index: idx, changed, read, errors, removed, cancelled: stopped, paused: held, pending: Math.max(0, listed.filter(f => !idx.files[f.path] || idx.files[f.path].sig !== `${f.size}:${f.mtime}`).length) };
    }

    // A book's own title and author, without shop and download-site tags ("(Z-Library)", "[ebook]").
    const TAGS = /\s*[([{](?:z-?lib(?:rary)?(?:\.org)?|1lib|libgen(?:\.\w+)?|annas?-archive|anna['’]s archive|pdfdrive|ebook|e-book|epub|pdf|mobi|retail|calibre|ocr|scan(?:ned)?|v\d+|\d{4}|[a-z0-9]{1,3}\.?\s?ed(?:ition)?\.?|(?:1st|2nd|3rd|\d+th) ed(?:ition)?\.?)[)\]}]/gi;
    function cleanTitle(t) {
        return String(t || '').replace(TAGS, '').replace(/\s*[-–—_]\s*(z-?library|libgen|ebook)$/i, '').replace(/\s+/g, ' ').replace(/^[\s:;,-]+|[\s:;,-]+$/g, '').trim();
    }
    function cleanAuthor(a) {
        const s = cleanTitle(a).replace(/^(by)\s+/i, '');
        // "Valldejuli, Carmen Aboy" → "Carmen Aboy Valldejuli" (only a single "Last, First").
        const m = s.match(/^([^,&;]+),\s*([^,&;]+)$/);
        return m && !/\b(jr|sr|ii|iii|phd|md)\.?$/i.test(m[2]) ? `${m[2].trim()} ${m[1].trim()}` : s;
    }
    function titleFromFileName(path) {
        return cleanTitle(String(path).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(TAGS, '').replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' - ').replace(/(\S)-(\S)/g, '$1-$2'));
    }

    // A PDF a few pages at a time (io.pdf), with progress, pauses so the phone stays cool, and a
    // way to stop or pause: a scanned book is read with the phone's text recognition, which takes
    // about a second a page. Its recipes keep their page number.
    async function readPdf(f, io, { progress, cancelled, paused, resume, checkpoint } = {}) {
        const info = await io.pdf(f.path, 0, 0);
        const total = Math.min(Number(info.pages) || 0, 1500);
        const texts = resume && Array.isArray(resume.texts) ? resume.texts.slice() : [];
        let scanned = resume ? resume.scanned || 0 : 0;
        const notes = resume && Array.isArray(resume.notes) ? resume.notes.slice() : [];
        let noText = resume ? resume.noText || 0 : 0;
        let saved = page0(resume);
        function page0(r) { return r ? r.at || 0 : 0; }
        let page = resume ? Math.min(resume.at || 0, total) : 0;
        let size = 3;   // a small first step: scanned pages take a second each
        while (page < total) {
            if (cancelled && cancelled()) { const e = new Error('stopped'); e.cancelled = true; throw e; }
            if (paused && paused()) { const e = new Error('paused'); e.paused = true; e.state = { kind: 'pdf', at: page, total, unit: 'page', texts, scanned, notes, noText }; throw e; }
            // Every 30 pages, how far it got is saved: if the app is closed, reading carries on from here.
            if (checkpoint && page - saved >= 30) { saved = page; await checkpoint({ kind: 'pdf', at: page, total, unit: 'page', texts, scanned, notes, noText, checkpoint: true }); }
            const r = await io.pdf(f.path, page, size);
            const got = (r && r.texts) || [];
            if (!got.length) break;
            got.forEach(t => {
                const text = String((t && t.text) || '');
                texts.push(text);
                if (t && t.ocr) scanned++;
                // A page with no readable text (a photo, or a scan the phone couldn't read) is skipped.
                if ((text.match(/[a-z]/gi) || []).length < 20) noText++;
                else if (notes.length < 2000) techniqueNotes(text, { book: f.path, max: 2000 - notes.length }).forEach(n => notes.push(Object.assign(n, { page: texts.length })));
            });
            page += got.length;
            if (progress) progress(f.path, page, total, `page ${page} of ${total}${scanned ? ' (reading scanned pages)' : ''}`, notes.length);
            // Scanned pages are slow to read: smaller steps with a longer breath in between.
            const ocr = got.some(t => t && t.ocr);
            size = ocr ? 3 : 12;
            if (io.sleep) await io.sleep(ocr ? 400 : 60);
        }
        const text = texts.join('\n\f\n');
        const fileName = titleFromFileName(f.path);
        const title = cleanTitle(info.title) && !/^(untitled|microsoft word|document\d*|\d+)$/i.test(cleanTitle(info.title)) ? cleanTitle(info.title) : fileName;
        const found = findRecipesInText(text, { fallbackTitle: '' });
        const recipes = found.map(r => Object.assign({}, r, { source_name: r.page ? `${title} · page ${r.page}` : title, book: title, library_path: f.path }));
        let why = '';
        if (!recipes.length) {
            const letters = (text.match(/[a-z]/gi) || []).length;
            why = !total ? 'This PDF has no pages Nourish could open.'
                : letters < total * 40 ? `No text could be read from its ${total} pages${scanned ? ' (they are pictures, and the text recognition found almost nothing on them)' : ''}.`
                    : `Read all ${total} pages${scanned ? ` (${scanned} scanned)` : ''}, but no recipe was recognised: no ingredient lists followed by steps were found.`;
        }
        notes.forEach(n => { n.book = title; });
        return { kind: 'pdf', text, recipes, title, author: info.author || undefined, pages: total, scanned, why, notes, noText };
    }

    // A book (EPUB or Word) read a slice at a time. Its recipes keep the book's title and chapter:
    // "Recipe from Easy Mornings · Breakfast".
    // books.js loads after this file, so it's looked up when first needed.
    function booksReader() {
        if (root.NourishBooks) return root.NourishBooks;
        try { return typeof require === 'function' ? require('./books.js') : null; } catch (e) { return null; }
    }
    async function readBook(f, got, kind, io, { progress, cancelled, paused, resume, checkpoint } = {}) {
        const Books = booksReader();
        if (!Books || !io.range) throw new Error('books can\'t be read here yet');
        const size = got.size || f.size;
        const opts = {
            size, readRange: (offset, length) => io.range(f.path, offset, length),
            progress: progress ? (done, total, chapter, notes) => progress(f.path, done, total, chapter, notes) : null,
            cancelled, paused, resume, checkpoint, pause: io.sleep,
        };
        const book = kind === 'epub' ? await Books.readEpub(opts) : await Books.readDocx(opts);
        const fileName = titleFromFileName(f.path);
        // The book's own title, unless the file name is a longer form of it ("Guga" → "Guga: …").
        let title = cleanTitle(book.title) || fileName;
        if (fileName.toLowerCase().startsWith(title.toLowerCase()) && fileName.length > title.length + 3 && !book.subtitle) title = fileName;
        const recipes = book.recipes.map(r => Object.assign({}, r, {
            source_name: r.chapter ? `${title} · ${r.chapter}` : title,
            book: title,
            library_path: f.path,
        }));
        const notes = (book.notes || (book.text ? techniqueNotes(book.text) : [])).map(n => Object.assign(n, { book: title }));
        return { kind, text: book.text, recipes, title, author: book.author || undefined, note: recipes.length ? '' : undefined, why: book.why, notes, noText: book.imageOnly || 0, chapters: book.chapters };
    }

    // File fingerprints (recipedb.js), with a small copy here so this file works on its own.
    function fingerprintOf(size, head, tail) {
        const DB = root.NourishRecipeDB || (typeof require === 'function' ? (() => { try { return require('./recipedb.js'); } catch (e) { return null; } })() : null);
        if (DB) return DB.fingerprint(size, head, tail);
        let h = 0x811c9dc5;
        [head, tail].forEach(b => { for (let i = 0; i < (b || []).length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0; });
        return `fp-${size}-${h.toString(36)}`;
    }
    function textFingerprint(text) {
        const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(String(text || '')) : Buffer.from(String(text || ''));
        return fingerprintOf(bytes.length, bytes.subarray(0, 65536), bytes.subarray(Math.max(0, bytes.length - 65536)));
    }

    // === TECHNIQUE BOOKS: SHORT TECHNIQUE NOTES ===
    // A book about how to cook (searing, braising, seasoning, bread…) rather than a book of recipes
    // becomes short notes: what to do and why, 1–3 sentences, each tagged with the ingredients,
    // cooking methods and kinds of dish it's about. Found in code, offline: a sentence that tells
    // the cook to do something with a technique, kept with the sentence that says why.
    const T_METHODS = { sear: /\bsear/, roast: /\broast/, braise: /\bbrais/, 'stir-fry': /\bstir[- ]?fr/, fry: /\b(fry|fried|frying|deep[- ]fr|shallow[- ]fr)/, saute: /\bsaut[eé]/, grill: /\b(grill|barbecue|bbq|char)/,
        bake: /\bbak(e|ed|ing)\b/, boil: /\bboil/, simmer: /\bsimmer/, poach: /\bpoach/, steam: /\bsteam/, blanch: /\bblanch/, brine: /\bbrin(e|ing)/, marinate: /\bmarinat/,
        rest: /\b(rest|resting)\b/, season: /\b(season|salt(ing|ed)?)\b/, emulsify: /\bemulsi/, deglaze: /\bdeglaz/, reduce: /\breduc(e|ing|tion)\b/, caramelize: /\bcarameli[sz]/,
        heat: /\b(preheat|heat the (pan|oven|oil|grill))\b/, dry: /\b(pat (it |them |the \w+ )?dry|dry (the|it|them) (well|thoroughly)?)/, brown: /\bbrown(s|ed|ing)?\b/, knead: /\bknead/, proof: /\b(proof|prove|rise)\b/, whisk: /\bwhisk/, fold: /\bfold/, temper: /\btemper/, toast: /\btoast/, smoke: /\bsmok(e|ing)\b/, cure: /\bcur(e|ing)\b/, ferment: /\bferment/, sweat: /\bsweat/, slice: /\b(slice|dice|chop|julienne|knife)\b/ };
    const T_DISHES = { soup: /\bsoups?\b/, stew: /\b(stews?|casserole)\b/, sauce: /\b(sauces?|gravy|vinaigrette|dressing|mayonnaise|emulsion)\b/, salad: /\bsalads?\b/, steak: /\bsteaks?\b/, roast: /\broasts?\b/,
        pasta: /\b(pasta|noodles?|spaghetti)\b/, rice: /\b(rice|risotto|pilaf)\b/, bread: /\b(bread|dough|loaf|loaves)\b/, cake: /\b(cakes?|batter|pastry|pie crust)\b/, eggs: /\b(eggs?|omelet+e?)\b/,
        vegetables: /\bvegetables?\b/, fish: /\b(fish|fillets?)\b/, curry: /\bcurr(y|ies)\b/, stock: /\b(stock|broth)\b/, beans: /\b(beans|lentils|pulses|legumes)\b/ };
    const T_FOODS = ['chicken', 'beef', 'pork', 'lamb', 'fish', 'salmon', 'shrimp', 'egg', 'eggs', 'onion', 'onions', 'garlic', 'tomato', 'tomatoes', 'potato', 'potatoes', 'rice', 'pasta', 'flour',
        'butter', 'oil', 'cream', 'milk', 'cheese', 'mushroom', 'mushrooms', 'carrot', 'carrots', 'spinach', 'cabbage', 'beans', 'lentils', 'tofu', 'lemon', 'vinegar', 'salt', 'sugar', 'herbs',
        'pepper', 'peppers', 'steak', 'duck', 'turkey', 'bread', 'dough', 'yeast', 'chocolate', 'nuts', 'squash', 'broccoli', 'cauliflower', 'zucchini', 'eggplant', 'corn', 'peas', 'stock', 'wine', 'ginger', 'chili', 'soy'];
    const T_REASON = /\b(because|so (that|the|it|you|they|their|your|its)|instead of|which (helps|keeps|stops|means|lets)|this (helps|keeps|stops|means|lets|prevents|ensures)|prevents?|otherwise|to (keep|stop|avoid|prevent|help|get|make sure|ensure)|ensures?|allows?|helps?|that way|the reason)\b/i;
    const T_IMPERATIVE = /^(always|never|don'?t|do not|make sure|be sure|try to|remember to|avoid|use|let|keep|add|pat|dry|salt|season|sear|rest|cook|heat|preheat|start|finish|toast|whisk|fold|stir|taste|bring|reduce|simmer|cut|slice|chop|soak|rinse|chill|cool|brown|place|turn|leave|wait|press|baste|cover|uncover|remove|strain|warm|knead|proof|deglaze|blanch|marinate|grill|roast|bake|steam|poach)\b/i;
    function techniqueNotes(text, { book = '', max = 2000 } = {}) {
        const out = [];
        const seen = new Set();
        const paras = String(text || '').split(/\n\s*\n|\f/).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length > 40);
        for (const para of paras) {
            const sentences = para.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
            for (let i = 0; i < sentences.length && out.length < max; i++) {
                const a = sentences[i].trim();
                if (a.length < 30 || a.length > 280) continue;
                const low = a.toLowerCase();
                const methods = Object.keys(T_METHODS).filter(k => T_METHODS[k].test(low));
                if (!methods.length) continue;
                const why = T_REASON.test(a);
                const doIt = T_IMPERATIVE.test(a) || /\b(you should|you want|you need|it'?s best|the key|the trick|the secret)\b/i.test(a);
                if (!(doIt && why) && !(doIt && T_REASON.test(sentences[i + 1] || '')) && !(why && /\b(should|must|best|always|never)\b/i.test(a))) continue;
                let note = a;
                if (!why && sentences[i + 1] && T_REASON.test(sentences[i + 1]) && (a + sentences[i + 1]).length <= 400) { note += ' ' + sentences[i + 1].trim(); i++; }
                const all = note.toLowerCase();
                const key = all.replace(/[^a-z]+/g, ' ').trim().slice(0, 120);
                if (seen.has(key)) continue;
                seen.add(key);
                const words = new Set(all.split(/[^a-z]+/));
                out.push({
                    text: note,
                    ingredients: T_FOODS.filter(f => words.has(f)).map(f => f.replace(/(es|s)$/, '').replace(/^tomato$/, 'tomato')).filter((x, k, arr) => arr.indexOf(x) === k).slice(0, 8),
                    methods: Object.keys(T_METHODS).filter(k => T_METHODS[k].test(all)).slice(0, 6),
                    dishes: Object.keys(T_DISHES).filter(k => T_DISHES[k].test(all)).slice(0, 4),
                    book: book || undefined,
                });
            }
        }
        return out;
    }
    // Mostly recipes, or mostly technique? A book with plenty of recipes is a recipe book; one with
    // few recipes and many technique notes is a technique book. The person can say otherwise.
    function bookKind(recipeCount, noteCount, chapters) {
        if (recipeCount >= 15 && recipeCount * 4 >= noteCount) return 'recipes';
        if (noteCount >= 25 && recipeCount * 6 < noteCount) return 'technique';
        if (recipeCount === 0 && noteCount >= 5) return 'technique';
        return recipeCount >= Math.max(3, (chapters || 0) * 0.3) ? 'recipes' : noteCount >= 10 ? 'technique' : 'recipes';
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

    const api = { techniqueNotes, bookKind, cleanTitle, cleanAuthor, titleFromFileName, parseRecipeText, parseLooseRecipes, findRecipesInText, prepareLines, recipesFromFile, refresh, allRecipes, kindOf, isReadme, passagesFrom, retrieve, pairingScore, terms };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis);
