// Cookbooks as files: EPUB (and Word .docx, which is built the same way: a zip of XML pages).
//
// An EPUB is a zip of web pages (chapters) plus a list saying their order and a table of contents.
// Nourish reads it a slice at a time (readRange), never the whole book in one go, so a big,
// illustrated cookbook doesn't freeze or overheat the phone: first the zip's directory at the end of
// the file, then only the text chapters (pictures are never read), one chapter at a time with short
// pauses, reporting progress and stopping when asked to.
//
// Recipes are found in each chapter by their shape: a title, a list of ingredients with amounts and
// steps (numbered, or paragraphs after the ingredients). Introductions, stories, indexes and photo
// pages have no such shape and are skipped; chapters called "Introduction", "Contents", "Index"…
// aren't read at all. Each recipe keeps its book and chapter ("Breakfast", "Mains"), which also
// tells the planner what meal it is.
//
// A copy-protected (DRM) book can't be opened: that's said in plain words. Kindle books (MOBI, AZW3)
// can't be read: the person is told how to convert one that isn't protected.
(function (root) {
    'use strict';

    // === ZIP, a slice at a time ===
    // readRange(offset, length) → Uint8Array; size: the file's size in bytes.
    // inflate(bytes) → Uint8Array (raw deflate); DecompressionStream is used when none is given.
    async function inflateRaw(bytes) {
        if (typeof DecompressionStream === 'undefined') throw new Error('this device can\'t unpack zip files');
        const ds = new DecompressionStream('deflate-raw');
        const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
        return new Uint8Array(await out.arrayBuffer());
    }
    const u16 = (b, o) => b[o] | (b[o + 1] << 8);
    const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    function utf8(bytes) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        return Buffer.from(bytes).toString('utf8');
    }
    async function openZip({ readRange, size, inflate = inflateRaw }) {
        // The directory is described in the last bytes of the file ("end of central directory").
        const tailLen = Math.min(size, 66000);
        const tail = await readRange(size - tailLen, tailLen);
        let eocd = -1;
        for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('not a zip file (the book may be damaged)');
        const count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOffset = u32(tail, eocd + 16);
        const cd = await readRange(cdOffset, cdSize);
        const entries = {};
        for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
            if (u32(cd, p) !== 0x02014b50) break;
            const flags = u16(cd, p + 8), method = u16(cd, p + 10), comp = u32(cd, p + 20), full = u32(cd, p + 24);
            const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32), local = u32(cd, p + 42);
            const name = utf8(cd.subarray(p + 46, p + 46 + nameLen));
            entries[name] = { name, flags, method, comp, size: full, local };
            p += 46 + nameLen + extraLen + commentLen;
        }
        // Names as books store them vary: "OEBPS\\Text\\ch1.xhtml" (made on Windows), "/OEBPS/…",
        // different capitals, or %20 for spaces. Looked up exactly first, then loosely.
        const norm = n => { let x = String(n || '').replace(/\\/g, '/').replace(/^\.?\//, ''); try { x = decodeURIComponent(x); } catch (err) { /* keep */ } return x.normalize ? x.normalize('NFC').toLowerCase() : x.toLowerCase(); };
        let loose = null;
        const find = name => {
            if (entries[name]) return entries[name];
            try { if (entries[decodeURIComponent(name)]) return entries[decodeURIComponent(name)]; } catch (err) { /* keep */ }
            if (!loose) { loose = new Map(); Object.keys(entries).forEach(k => loose.set(norm(k), entries[k])); }
            const k = norm(name);
            if (loose.has(k)) return loose.get(k);
            // Last resort: the only file anywhere with that name.
            const base = k.split('/').pop();
            const same = [...loose.keys()].filter(x => x.split('/').pop() === base);
            return same.length === 1 ? loose.get(same[0]) : null;
        };
        async function read(name) {
            const e = find(name);
            if (!e) return null;
            if (e.flags & 1) { const err = new Error('encrypted'); err.drm = true; throw err; }
            const head = await readRange(e.local, 30);
            const start = e.local + 30 + u16(head, 26) + u16(head, 28);
            const data = await readRange(start, e.comp);
            if (e.method === 0) return data;
            if (e.method === 8) return inflate(data);
            throw new Error('a part of the file is packed in a way Nourish can\'t unpack');
        }
        return { entries, find, read, readText: async name => { const b = await read(name); return b ? utf8(b) : null; } };
    }

    // === HTML / XML into text with its structure ===
    const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è', times: '×' };
    function decode(t) {
        return String(t).replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
            if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n ? String.fromCodePoint(n) : ''; }
            return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : m;
        });
    }
    // A chapter as a list of blocks: { kind: 'h'|'li'|'p', level, list: 'ol'|'ul', cls, text }.
    function blocksOf(html) {
        let s = String(html || '').replace(/<head[\s\S]*?<\/head>/i, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
        const out = [];
        const lists = [];
        // A table row is one line ("2 cups" | "milk" → "2 cups milk"): cells are joined, rows split.
        s = s.replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ' ');
        const re = /<(\/?)(h[1-6]|p|li|ol|ul|div|dt|dd|td|th|tr|br|section|blockquote|figcaption|table)\b([^>]*)>/gi;
        let last = 0, cur = null;
        const flush = upto => {
            if (!cur) return;
            const text = decode(s.slice(last, upto).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
            if (text) { cur.text = (cur.text ? cur.text + ' ' : '') + text; }
        };
        const close = () => { if (cur && cur.text) out.push(cur); cur = null; };
        let m;
        while ((m = re.exec(s))) {
            const [, end, tag, attrs] = m;
            const t = tag.toLowerCase();
            flush(m.index);
            last = re.lastIndex;
            if (t === 'ol' || t === 'ul') { close(); if (end) lists.pop(); else lists.push(t); continue; }
            if (end || t === 'br') { if (t === 'br' && cur) { cur.text = (cur.text || '') + '\n'; continue; } close(); continue; }
            close();
            const cls = (attrs.match(/class=["']([^"']*)["']/i) || [])[1] || '';
            if (/^h[1-6]$/.test(t)) cur = { kind: 'h', level: Number(t[1]), cls, text: '' };
            else if (t === 'li') cur = { kind: 'li', list: lists[lists.length - 1] || 'ul', cls, text: '' };
            else cur = { kind: 'p', cls, text: '' };
            // Cookbooks often mark titles and ingredient lines with classes instead of headings and lists.
            if (cur.kind === 'p' && /\b(recipe-?title|recipe-?name|rec-?title|chapter-?title|title|head(ing)?|rt|rn|h[1-4])\b/i.test(cls) && !/sub|caption/i.test(cls)) { cur.kind = 'h'; cur.level = 3; }
        }
        flush(s.length);
        close();
        const blocks = out.map(b => Object.assign(b, { text: b.text.replace(/\s*\n\s*/g, '\n').trim() })).filter(b => b.text);
        // A paragraph that is really a list (ingredients one per line, split by line breaks) becomes
        // one block per line, so each line is judged on its own.
        const split = [];
        blocks.forEach(b => {
            const lines = b.text.split('\n').map(x => x.trim()).filter(Boolean);
            if (b.kind !== 'h' && lines.length >= 2 && lines.filter(x => x.length <= 100).length >= lines.length * 0.7) lines.forEach(t => split.push(Object.assign({}, b, { text: t })));
            else split.push(b);
        });
        return split;
    }

    // === RECIPES IN A CHAPTER ===
    const AMOUNT = /^(?:[-*•]\s*)?(?:\d|½|¼|¾|⅓|⅔|⅛|⅜|a |an |one |two |three |four |half |pinch|handful|dash|small |large |medium |juice of|zest of|salt|pepper|freshly)/i;
    const UNIT = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|g|kg|ml|l|oz|ounces?|lb|lbs|pounds?|cloves?|pinch|handful|cans?|tins?|slices?|bunch|sprigs?|stalks?|grams?)\b/i;
    const ING_HEAD = /^(ingredients?|you(?:'|’)ll need|what you need|for the [a-z ]+:?)$/i;
    const STEP_HEAD = /^(method|directions?|instructions?|preparation|steps|to make|to serve)$/i;
    const SERVES = /\b(serves|servings?|makes|yield)\b\D{0,12}(\d{1,2})/i;
    const TIME = /\b(?:total|ready in|takes?|prep(?:aration)?|cook(?:ing)?)(?: time)?\b\D{0,10}(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/gi;
    const SKIP_CHAPTER = /^(contents|table of contents|introduction|intro|foreword|preface|acknowledg(e)?ments?|about the author|about this book|index|copyright|title page|dedication|cover|also by|glossary|conversion|equipment|basics of|thanks|credits|notes?)\b/i;
    const JOIN_START = /^(?:[a-z]|(?:and|with|in|on|over|&|de|del|con|en|y|al|for|of|or|plus)\b)/;
    const JOIN_END = /\b(?:and|with|in|on|over|&|de|del|con|en|y|a la|al|for|of|or|plus)$/i;
    const isIngredient = b => (b.kind === 'li' || /ingr/i.test(b.cls) || b.kind === 'p') && b.text.length < 160 && (AMOUNT.test(b.text) || UNIT.test(b.text) || /ingr/i.test(b.cls)) && !/[.!?]\s+[A-Z]/.test(b.text);
    const isStepLike = b => b.text.length >= 20 && /^[A-Z0-9]/.test(b.text) && (b.kind === 'li' || /method|step|instruct|direction|proc/i.test(b.cls) || /[.!]$/.test(b.text));
    function minutesOf(text) {
        // A stated total ("Ready in 45 minutes") wins; otherwise prep and cook times are added.
        let total = null, sum = 0;
        String(text).replace(TIME, (m, h, mi) => { const v = Number(h || 0) * 60 + Number(mi || 0); if (v > 0 && /total|ready/i.test(m)) { if (total == null) total = v; } else if (v > 0) sum += v; return m; });
        return total != null ? total : sum || null;
    }
    function recipesInChapter(html, { chapter = '', book = '' } = {}) {
        const blocks = blocksOf(html);
        const out = [];
        // Titles: headings (or title-classed lines) that are short and aren't section labels.
        const titleAt = i => {
            const b = blocks[i];
            return b && b.kind === 'h' && b.text.length >= 3 && b.text.length <= 90 && !ING_HEAD.test(b.text) && !STEP_HEAD.test(b.text) && !SERVES.test(b.text);
        };
        for (let i = 0; i < blocks.length; i++) {
            if (!titleAt(i)) continue;
            // A chapter heading ("Breakfast") is followed by the recipe's own title before any ingredient:
            // the recipe's name is the last heading before its ingredients.
            let nextIng = i + 1;
            while (nextIng < blocks.length && !isIngredient(blocks[nextIng])) nextIng++;
            let later = false;
            for (let j = i + 1; j < nextIng; j++) if (titleAt(j)) { later = true; break; }
            if (later) continue;
            // This recipe's blocks run to the next title that is followed by more ingredients.
            let end = i + 1;
            while (end < blocks.length && !(titleAt(end) && blocks.slice(end + 1, end + 25).some(isIngredient) && blocks.slice(i + 1, end).some(isIngredient))) end++;
            const part = blocks.slice(i + 1, end);
            const firstIng = part.findIndex(isIngredient);
            if (firstIng < 0) continue;
            const ingredients = [];
            let k = firstIng;
            for (; k < part.length; k++) {
                const b = part[k];
                if (ING_HEAD.test(b.text) || (b.kind === 'h' && /^for the\b/i.test(b.text))) continue;
                if (STEP_HEAD.test(b.text)) { k++; break; }
                if (isIngredient(b)) { b.text.split('\n').forEach(l => { if (l.trim()) ingredients.push(l.replace(/^[-*•]\s*/, '').trim()); }); continue; }
                if (b.kind === 'li' && b.list === 'ul' && b.text.length < 120) { ingredients.push(b.text); continue; }
                // One short line without an amount in the middle of the list ("Ice", "Salt") stays in it.
                if (b.kind !== 'h' && b.text.length <= 40 && !/[.!?]$/.test(b.text) && part[k + 1] && isIngredient(part[k + 1])) { ingredients.push(b.text); continue; }
                break;
            }
            const steps = [];
            for (; k < part.length; k++) {
                const b = part[k];
                if (b.kind === 'h' && !STEP_HEAD.test(b.text)) { if (steps.length) break; continue; }
                if (STEP_HEAD.test(b.text) || ING_HEAD.test(b.text)) continue;
                if (/^(tip|note|cook'?s tip|variation|make ahead|to store|nutrition|per serving)s?\b/i.test(b.text)) break;
                if (isStepLike(b)) steps.push(b.text.replace(/^(\d+[.)]|step\s*\d+[:.]?)\s*/i, '').replace(/\n/g, ' '));
            }
            const body = part.map(b => b.text).join('\n');
            const serves = body.match(SERVES);
            // A title set over two lines ("Smoked Brisket" / "in Stuffed Pasta Shells") is one title.
            let name = blocks[i].text.replace(/\s+/g, ' ').trim();
            for (let p = i - 1; p >= 0 && p >= i - 2 && blocks[p].kind === 'h'; p--) {
                const above = blocks[p].text.replace(/\s+/g, ' ').trim();
                if (!(JOIN_START.test(name) || JOIN_END.test(above)) || ING_HEAD.test(above) || (above + name).length > 110) break;
                name = `${above} ${name}`;
            }
            const recipe = {
                name,
                ingredients: ingredients.filter(x => x.length > 1).slice(0, 40),
                steps: steps.filter(x => x.length > 3).slice(0, 30),
                servings: serves ? Number(serves[2]) : null,
                time_minutes: minutesOf(body),
                category: chapter ? [chapter] : [],
                book: book || undefined,
                chapter: chapter || undefined,
            };
            // Two ingredients are enough when both have amounts (a syrup, a drink, a dressing).
            const enough = recipe.ingredients.length >= 3 || (recipe.ingredients.length === 2 && recipe.ingredients.every(x => AMOUNT.test(x)));
            if (enough && recipe.steps.length) { out.push(recipe); i = end - 1; }
        }
        return out;
    }

    // === EPUB ===
    const dirOf = p => (p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/') + 1) : '');
    function joinPath(base, rel) {
        const parts = (base + decodeURIComponent(String(rel).split('#')[0])).split('/');
        const out = [];
        parts.forEach(x => { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); });
        return out.join('/');
    }
    function attr(tag, name) { const m = String(tag).match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i')); return m ? decode(m[1]) : ''; }
    // The book's title, its chapters in reading order and their titles from the table of contents.
    async function epubOutline(zip) {
        if (zip.entries['META-INF/encryption.xml']) {
            const enc = await zip.readText('META-INF/encryption.xml');
            // Only fonts "obfuscated" is fine; anything else is real copy protection (DRM).
            const algs = [...String(enc).matchAll(/Algorithm=["']([^"']+)["']/g)].map(m => m[1]);
            if (algs.some(a => !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a)) || zip.entries['META-INF/rights.xml']) {
                const e = new Error('copy-protected'); e.drm = true; throw e;
            }
        }
        const container = await zip.readText('META-INF/container.xml');
        const opfPath = container && attr((container.match(/<rootfile\b[^>]*>/i) || [''])[0], 'full-path');
        if (!opfPath) throw new Error('this doesn\'t look like an EPUB book (no contents list inside)');
        const opf = await zip.readText(opfPath);
        if (!opf) throw new Error('this EPUB\'s contents list is missing');
        const base = dirOf(opfPath);
        // Title and author from the book's own details. EPUB 3 can give a main title and a subtitle
        // as two titles ("Guga" + "…"); several authors are joined; illustrators and editors aren't authors.
        const text = x => decode(String(x || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        const titles = [...opf.matchAll(/<dc:title\b([^>]*)>([\s\S]*?)<\/dc:title>/gi)].map(m => ({ id: attr(m[1], 'id'), text: text(m[2]) })).filter(t => t.text);
        const typeOf = id => id ? ((opf.match(new RegExp(`<meta[^>]*refines=["']#${id}["'][^>]*property=["']title-type["'][^>]*>([^<]*)<`, 'i')) || [])[1] || '').trim().toLowerCase() : '';
        const main = titles.find(t => typeOf(t.id) === 'main') || titles[0] || { text: '' };
        const sub = titles.find(t => t !== main && (typeOf(t.id) === 'subtitle' || !typeOf(t.id)));
        let title = main.text;
        if (sub && sub.text && title.toLowerCase().indexOf(sub.text.toLowerCase()) < 0) title = `${title}: ${sub.text}`;
        const creators = [...opf.matchAll(/<dc:creator\b([^>]*)>([\s\S]*?)<\/dc:creator>/gi)].map(m => {
            const role = attr(m[1], 'opf:role') || ((opf.match(new RegExp(`<meta[^>]*refines=["']#${attr(m[1], 'id')}["'][^>]*property=["']role["'][^>]*>([^<]*)<`, 'i')) || [])[1] || '');
            return { name: text(m[2]), role: role.trim().toLowerCase() };
        }).filter(c => c.name && (!c.role || c.role === 'aut'));
        const author = [...new Set(creators.map(c => c.name))].slice(0, 3).join(' & ');
        const manifest = {};
        for (const m of opf.matchAll(/<item\b[^>]*>/gi)) manifest[attr(m[0], 'id')] = { href: joinPath(base, attr(m[0], 'href')), type: attr(m[0], 'media-type'), props: attr(m[0], 'properties') };
        const isPage = x => x && /html|xml/i.test(x.type || 'html') && !/ncx|svg|css|image|font/i.test(x.type || '') && !/\bnav\b/.test(x.props || '');
        const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map(m => manifest[attr(m[0], 'idref')]).filter(isPage).map(x => x.href);
        // Pages listed in the book but left out of its reading order are read after it.
        Object.values(manifest).filter(isPage).forEach(x => { if (!spine.includes(x.href)) spine.push(x.href); });
        // Table of contents: EPUB 3 nav page, or EPUB 2 toc.ncx.
        const toc = {};
        const nav = Object.values(manifest).find(x => /\bnav\b/.test(x.props || ''));
        if (nav) {
            const html = await zip.readText(nav.href);
            for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
                const file = joinPath(dirOf(nav.href), m[1]);
                if (!toc[file]) toc[file] = decode(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
            }
        } else {
            const ncx = Object.values(manifest).find(x => /ncx/.test(x.type || '') || /\.ncx$/i.test(x.href));
            const xml = ncx ? await zip.readText(ncx.href) : '';
            for (const m of String(xml || '').matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src=["']([^"']+)["']/gi)) {
                const file = joinPath(dirOf(ncx.href), m[2]);
                if (!toc[file]) toc[file] = decode(m[1]).replace(/\s+/g, ' ').trim();
            }
        }
        return { title, author, spine, toc };
    }
    // Every recipe in an EPUB. opts: { readRange, size, inflate, progress(done, total, chapter),
    // cancelled() → bool, paused() → bool, resume (where a paused read got to), pause(ms) }.
    // Returns { title, author, recipes, chapters, skipped, missing, text, why }: why says in plain
    // words why no recipe was found, when none was.
    async function readEpub(opts) {
        const zip = await openZip(opts);
        const { title, author, spine, toc } = await epubOutline(zip);
        const r0 = opts.resume && opts.resume.kind === 'epub' ? opts.resume : null;
        const recipes = r0 ? r0.recipes.slice() : [];
        let section = r0 ? r0.section || '' : '';
        let skipped = r0 ? r0.skipped || 0 : 0, missing = r0 ? r0.missing || 0 : 0, recipeLike = r0 ? r0.recipeLike || 0 : 0;
        const textParts = r0 ? (r0.textParts || []).slice() : [];
        // Technique notes (library.js techniqueNotes), kept as the book is read; chapters that are
        // only pictures (no readable text) are counted and skipped.
        const notes = r0 ? (r0.notes || []).slice() : [];
        let imageOnly = r0 ? r0.imageOnly || 0 : 0;
        const stateAt = i => ({ kind: 'epub', at: i, total: spine.length, unit: 'chapter', recipes, section, skipped, missing, recipeLike, textParts: textParts.slice(0, 120), notes, imageOnly });
        for (let i = r0 ? r0.at : 0; i < spine.length; i++) {
            if (opts.cancelled && opts.cancelled()) { const e = new Error('stopped'); e.cancelled = true; throw e; }
            if (opts.paused && opts.paused()) {
                const e = new Error('paused'); e.paused = true;
                e.state = stateAt(i);
                throw e;
            }
            // Every 15 chapters, how far it got is saved: if the app is closed, reading carries on from here.
            if (opts.checkpoint && i > 0 && i % 15 === 0) await opts.checkpoint(Object.assign(stateAt(i), { checkpoint: true }));
            const file = spine[i];
            const label = toc[file] || '';
            if (label) section = label;
            if (SKIP_CHAPTER.test(label)) { skipped++; if (opts.progress) opts.progress(i + 1, spine.length, label); continue; }
            const html = await zip.readText(file);
            // A chapter the book lists but doesn't contain is counted (and said), never skipped silently.
            if (!html) { missing++; if (opts.progress) opts.progress(i + 1, spine.length, label || file); continue; }
            const blocks = blocksOf(html);
            if (blocks.reduce((n, b) => n + b.text.length, 0) < 40 && /<(img|image|svg)\b/i.test(html)) { imageOnly++; if (opts.progress) opts.progress(i + 1, spine.length, label || 'a page of pictures (skipped)'); continue; }
            // A chapter label like "Breakfast" or "Mains" stays the section for the chapters under it.
            const heading = (blocks.find(b => b.kind === 'h' && b.level <= 2) || {}).text || '';
            const chapter = sectionName(label || heading || section, section);
            let found = recipesInChapter(html, { chapter, book: title });
            // Recipes laid out without headings or lists (bold lines, plain paragraphs) are found by
            // their shape, as in a scanned cookbook (library.js).
            const L = libraryReader();
            if (L) {
                const extra = L.findRecipesInText(blocks.map(b => b.text).join('\n'), {})
                    .filter(r => !r.untitled && !found.some(f => sameRecipe(f, r)))
                    .map(r => Object.assign(r, { category: chapter ? [chapter] : [], book: title || undefined, chapter: chapter || undefined }));
                found = found.concat(extra);
            }
            if (!found.length) { skipped++; if (blocks.filter(b => /^(?:[-*•]\s*)?(?:\d|½|¼|¾|⅓|⅔)/.test(b.text) && b.text.length < 90).length >= 3) recipeLike++; }
            found.forEach(r => recipes.push(r));
            if (textParts.length < 400) textParts.push(blocks.map(b => b.text).join('\n'));
            if (L && notes.length < 2000) L.techniqueNotes(blocks.map(b => b.text).join('\n\n'), { book: title, max: 2000 - notes.length }).forEach(n => notes.push(Object.assign(n, { chapter: label || heading || undefined })));
            if (opts.progress) opts.progress(i + 1, spine.length, chapter, notes.length);
            if (opts.pause && i % 3 === 2) await opts.pause(60);   // a short breath every few chapters: the phone stays cool
        }
        let why = '';
        if (!recipes.length) {
            const read = spine.length - missing;
            why = !spine.length ? 'This book has no chapters Nourish could find.'
                : missing && missing >= spine.length / 2 ? `${missing} of the book's ${spine.length} chapters couldn't be found inside the file (it may be damaged or packed in an unusual way).`
                    : recipeLike ? `Read ${read} chapters: ${recipeLike} have ingredient amounts, but no complete recipe (a title, an ingredient list and steps) was recognised in them.`
                        : `Read ${read} chapters, but none of them has an ingredient list with amounts.`;
        }
        return { title, author, recipes, chapters: spine.length, skipped, missing, text: textParts.join('\n\n'), why, notes, imageOnly };
    }
    // The same recipe found twice (by its headings and by its shape): mostly the same ingredients.
    function sameRecipe(a, b) {
        const words = r => new Set((r.ingredients || []).map(x => String(x).toLowerCase().replace(/[^a-z ]/g, ' ').trim()).filter(Boolean));
        const A = words(a), B = words(b);
        let common = 0;
        B.forEach(x => { if (A.has(x)) common++; });
        return String(a.name).toLowerCase() === String(b.name).toLowerCase() || common >= Math.min(A.size, B.size) * 0.5;
    }
    function libraryReader() {
        if (root.NourishLibrary) return root.NourishLibrary;
        try { return typeof require === 'function' ? require('./library.js') : null; } catch (e) { return null; }
    }
    // The section a recipe belongs to: the nearest chapter name that says what kind of food it is.
    const MEAL_SECTION = /\b(breakfast|brunch|lunch|dinner|supper|mains?|main courses?|salads?|soups?|sides?|desserts?|puddings?|baking|snacks?|starters?|small plates|drinks|sauces|weeknight|light meals)\b/i;
    function sectionName(chapter, section) { return MEAL_SECTION.test(chapter) || !MEAL_SECTION.test(section || '') ? chapter : section; }

    // === WORD (.docx) ===
    // word/document.xml: paragraphs (<w:p>) with their style (Heading 1…) and list numbering.
    async function readDocx(opts) {
        const zip = await openZip(opts);
        const xml = await zip.readText('word/document.xml');
        if (!xml) throw new Error('this doesn\'t look like a Word document');
        const html = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(m => {
            const p = m[0];
            const text = decode([...p.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(t => t[1]).join(''));
            if (!text.trim()) return '';
            const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
            const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            if (/^(heading|title)\s*\d?/i.test(style)) return `<h${Math.min(4, Number((style.match(/\d/) || [2])[0]) + 1)}>${esc}</h${Math.min(4, Number((style.match(/\d/) || [2])[0]) + 1)}>`;
            if (/<w:numPr>/.test(p)) return `<li>${esc}</li>`;
            return `<p>${esc}</p>`;
        }).join('\n');
        const title = (html.match(/<h\d>([^<]+)<\/h\d>/) || [])[1] || '';
        return { title, recipes: recipesInChapter(`<body>${html}</body>`, { chapter: '', book: '' }), text: blocksOf(html).map(b => b.text).join('\n') };
    }

    // What a file type is and, for those that can't be read, why, in plain words.
    const KINDLE_NOTE = 'Kindle books (MOBI, AZW, AZW3) can\'t be read: they\'re usually copy-protected. If yours isn\'t, convert it to EPUB with the free Calibre app and add the EPUB instead.';
    const DRM_NOTE = 'This book is copy-protected (DRM), so Nourish can\'t open it. Books bought from some stores are locked to their own reading app.';

    const api = { openZip, blocksOf, recipesInChapter, epubOutline, readEpub, readDocx, inflateRaw, KINDLE_NOTE, DRM_NOTE, SKIP_CHAPTER };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishBooks = api;
})(typeof window !== 'undefined' ? window : globalThis);
