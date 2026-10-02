// Recipes from any link. Tries, in order:
// 1. the recipe data most recipe sites embed for search engines (schema.org JSON-LD, or the older
//    "microdata" markup);
// 2. for YouTube, TikTok, Instagram, Facebook, Pinterest and Reddit: the post's caption, description,
//    transcript or text (and for a Pinterest pin or a Reddit link post, the recipe page it points to);
// 3. the page's readable text;
// and hands the text from 2 and 3 to the AI to pull out the recipe (the `extract` function the app
// passes in). A page that's blocked or needs a login throws an ImportBlocked error, so the app can
// offer pasting the text or a screenshot instead.
// Runs in the browser (the PC web app and the phone apps' web view): pages are fetched by the caller
// (`fetchPage`: the phone fetches them itself, the PC web app through the Nourish server).
(function (root) {
    'use strict';

    function blocked(message, reason) {
        const e = new Error(message);
        e.blocked = true;
        e.reason = reason || 'blocked';
        return e;
    }

    const PLATFORMS = [
        ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
        ['tiktok', /(^|\.)tiktok\.com$/],
        ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/],
        ['facebook', /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
        ['pinterest', /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/],
        ['reddit', /(^|\.)(reddit\.com|redd\.it)$/],
    ];
    const PLATFORM_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', pinterest: 'Pinterest', reddit: 'Reddit' };

    function hostOf(url) {
        try { return new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, ''); } catch (e) { return ''; }
    }
    function platformOf(url) {
        const host = hostOf(url);
        const hit = PLATFORMS.find(([, re]) => re.test(host));
        return hit ? hit[0] : null;
    }
    function normalizeUrl(text) {
        let url = String(text || '').trim();
        const inText = url.match(/https?:\/\/\S+/i);   // "Check out this recipe! https://…" shared from an app
        if (inText) url = inText[0];
        url = url.replace(/[)\].,;!?'"]+$/, '');
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        const u = new URL(url);   // throws on nonsense
        if (!/\./.test(u.hostname)) throw new Error('bad host');
        return u.href;
    }

    // === TEXT HELPERS ===
    function parseHTML(html) { return new DOMParser().parseFromString(String(html || ''), 'text/html'); }
    function cleanText(text) {
        const doc = parseHTML('<body>' + String(text == null ? '' : text) + '</body>');
        return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function cleanTextKeepLines(text) { return String(text).split('\n').map(cleanText).join('\n'); }
    function isoMinutes(iso) {
        const m = String(iso || '').trim().toUpperCase().match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
        if (!m || !(m[1] || m[2] || m[3])) return null;
        return (Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) || null;
    }
    function firstNumber(v) {
        if (Array.isArray(v)) { for (const x of v) { const n = firstNumber(x); if (n != null) return n; } return null; }
        const m = String(v == null ? '' : v).replace(/,/g, '').match(/\d+(\.\d+)?/);
        return m ? Number(m[0]) : null;
    }
    function recipeSteps(instr) {
        if (typeof instr === 'string') {
            const text = instr.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n');
            return cleanTextKeepLines(text).replace(/\.\s+(?=[A-Z])/g, '.\n').split(/\n+/).map(s => s.trim()).filter(s => s.length > 3);
        }
        const out = [];
        (Array.isArray(instr) ? instr : instr && typeof instr === 'object' ? [instr] : []).forEach(item => {
            if (typeof item === 'string') out.push(cleanText(item));
            else if (item && item.itemListElement) out.push.apply(out, recipeSteps(item.itemListElement));
            else if (item) out.push(cleanText(item.text || item.name));
        });
        return out.filter(Boolean);
    }
    function meta(doc, ...names) {
        for (const name of names) {
            const el = doc.querySelector(`meta[property="${name}" i], meta[name="${name}" i]`);
            const v = el && (el.getAttribute('content') || '').trim();
            if (v) return v;
        }
        return '';
    }
    function siteName(doc, url) {
        const named = doc ? meta(doc, 'og:site_name', 'application-name') : '';
        if (named && named.length <= 40) return named;
        const platform = platformOf(url);
        return platform ? PLATFORM_NAMES[platform] : hostOf(url);
    }

    // === 1. RECIPE DATA EMBEDDED IN THE PAGE ===
    function findRecipeNode(data) {
        if (Array.isArray(data)) {
            for (const item of data) { const f = findRecipeNode(item); if (f) return f; }
        } else if (data && typeof data === 'object') {
            const t = data['@type'];
            if (t === 'Recipe' || (Array.isArray(t) && t.indexOf('Recipe') >= 0)) return data;
            for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
                if (data[key]) { const f = findRecipeNode(data[key]); if (f) return f; }
            }
        }
        return null;
    }
    function fromSchema(recipe, url) {
        if (!recipe || !recipe.name) return null;
        const list = v => (Array.isArray(v) ? v : v ? [v] : []);
        const ingredients = list(recipe.recipeIngredient || recipe.ingredients).map(cleanText).filter(Boolean);
        const steps = recipeSteps(recipe.recipeInstructions);
        if (!ingredients.length && !steps.length) return null;
        const total = isoMinutes(recipe.totalTime) || ((isoMinutes(recipe.prepTime) || 0) + (isoMinutes(recipe.cookTime) || 0)) || null;
        const n = recipe.nutrition && typeof recipe.nutrition === 'object' ? recipe.nutrition : {};
        const nutrition = { calories: firstNumber(n.calories), protein_g: firstNumber(n.proteinContent), carbs_g: firstNumber(n.carbohydrateContent), fat_g: firstNumber(n.fatContent) };
        const servings = firstNumber(recipe.recipeYield);
        return {
            name: cleanText(recipe.name).slice(0, 150), time_minutes: total,
            servings: servings >= 1 && servings <= 100 ? Math.round(servings) : null,
            nutrition: Object.keys(nutrition).some(k => nutrition[k] != null) ? nutrition : null,
            ingredients: ingredients.slice(0, 60), steps: steps.slice(0, 40),
            category: cleanText(list(recipe.recipeCategory).join(', ')).slice(0, 80),
        };
    }
    function fromJsonLd(doc, url) {
        let recipe = null;
        Array.prototype.some.call(doc.querySelectorAll('script[type="application/ld+json" i]'), s => {
            const raw = (s.textContent || '').trim();
            let data = null;
            try { data = JSON.parse(raw); } catch (e) {
                try { data = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]+/g, ' ')); } catch (e2) { return false; }
            }
            recipe = fromSchema(findRecipeNode(data), url);
            return !!recipe;
        });
        return recipe;
    }
    // Older sites mark the recipe up in the page itself: itemtype="https://schema.org/Recipe" with
    // itemprop="recipeIngredient", "recipeInstructions", …
    function fromMicrodata(doc, url) {
        const scope = doc.querySelector('[itemscope][itemtype*="schema.org/Recipe" i]');
        if (!scope) return null;
        const own = (el, prop) => Array.prototype.filter.call(el.querySelectorAll(`[itemprop~="${prop}"]`), x => {
            let p = x.parentElement;   // skip properties of nested items (a review's "name"), except nutrition
            while (p && p !== el) { if (p.hasAttribute('itemscope') && !/Nutrition/i.test(p.getAttribute('itemtype') || '')) return false; p = p.parentElement; }
            return true;
        });
        const value = x => (x.getAttribute('content') || x.getAttribute('datetime') || (x.tagName === 'META' ? '' : x.textContent) || '').trim();
        const one = prop => { const x = own(scope, prop)[0]; return x ? value(x) : ''; };
        const steps = [];
        own(scope, 'recipeInstructions').forEach(x => {
            const items = x.querySelectorAll('li, [itemprop~="text"], p');
            if (items.length) Array.prototype.forEach.call(items, i => steps.push(cleanText(i.textContent)));
            else steps.push.apply(steps, recipeSteps(x.innerHTML || value(x)));
        });
        const nutritionEl = scope.querySelector('[itemprop~="nutrition"]');
        const nut = prop => { const x = nutritionEl && nutritionEl.querySelector(`[itemprop~="${prop}"]`); return x ? value(x) : ''; };
        return fromSchema({
            name: one('name'),
            recipeIngredient: own(scope, 'recipeIngredient').concat(own(scope, 'ingredients')).map(value),
            recipeInstructions: steps.filter(Boolean),
            totalTime: one('totalTime'), prepTime: one('prepTime'), cookTime: one('cookTime'), recipeYield: one('recipeYield'),
            recipeCategory: one('recipeCategory'),
            nutrition: nutritionEl ? { calories: nut('calories'), proteinContent: nut('proteinContent'), carbohydrateContent: nut('carbohydrateContent'), fatContent: nut('fatContent') } : null,
        }, url);
    }
    function structuredRecipe(doc, url) {
        return fromJsonLd(doc, url) || fromMicrodata(doc, url);
    }

    // === 3. THE PAGE'S READABLE TEXT ===
    const BLOCKS = /^(P|DIV|LI|UL|OL|H[1-6]|TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE|BR|DD|DT|FIGCAPTION)$/;
    function readableText(doc) {
        const body = doc.body ? doc.body.cloneNode(true) : null;
        if (!body) return '';
        body.querySelectorAll('script, style, noscript, svg, iframe, form, button, nav, header, footer, aside, [aria-hidden="true"], [hidden], ' +
            '[class*="comment" i], [id*="comment" i], [class*="advert" i], [class*="newsletter" i], [class*="related" i], [class*="share" i], [class*="cookie" i]')
            .forEach(el => el.remove());
        const candidates = ['[itemtype*="Recipe" i]', '.wprm-recipe-container', '.tasty-recipes', '.mv-create-card', '[class*="recipe-card" i]', '[class*="recipe" i]', 'article', 'main', '[role="main"]'];
        let rootEl = body;
        for (const sel of candidates) {
            const el = body.querySelector(sel);
            if (el && (el.textContent || '').trim().length > 300) { rootEl = el; break; }
        }
        const lines = [];
        let line = '';
        (function walk(node) {
            if (node.nodeType === 3) { line += node.nodeValue; return; }
            if (node.nodeType !== 1) return;
            const block = BLOCKS.test(node.tagName);
            if (block && line.trim()) { lines.push(line); line = ''; }
            if (node.tagName === 'LI') line += '- ';
            Array.prototype.forEach.call(node.childNodes, walk);
            if (block && line.trim()) { lines.push(line); line = ''; }
        })(rootEl);
        if (line.trim()) lines.push(line);
        const out = [];
        lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l && l !== '-').forEach(l => { if (out[out.length - 1] !== l) out.push(l); });
        let text = out.join('\n');
        const title = (doc.querySelector('h1') && doc.querySelector('h1').textContent.trim()) || meta(doc, 'og:title') || (doc.title || '').trim();
        // Long blog posts: start a little before the ingredients, where the recipe is.
        const at = text.search(/\bingredients?\b/i);
        if (at > 2500) text = text.slice(at - 400);
        return ((title && text.indexOf(title) === -1 ? title + '\n' : '') + text).slice(0, 20000);
    }

    // A login wall, a bot check or an error page instead of the recipe.
    const WALL = /\b(log ?in|sign ?in|sign up|create an account)\b.{0,40}\b(to (see|view|continue|watch|read)|for full access)|you must (log|sign) in|login_required|accounts\/login|are you a (robot|human)|captcha|unusual traffic|access denied|enable javascript to|checking your browser|request blocked/i;
    // Any refusal counts (401, 402 and 403 from sites that turn away apps or cloud machines, 429, 451,
    // 503 from a bot check, 999 from LinkedIn-style blocks); only "not found" doesn't.
    function looksBlocked(status, text) {
        if (status >= 400 && status !== 404 && status !== 410) return true;
        return text.length < 1500 && WALL.test(text);
    }

    // === 2. SOCIAL POSTS ===
    // The JSON object that follows `marker` in a page's script ("ytInitialPlayerResponse = {…};").
    function jsonAfter(html, marker) {
        const at = html.indexOf(marker);
        if (at === -1) return null;
        const start = html.indexOf('{', at + marker.length);
        if (start === -1) return null;
        let depth = 0, inString = false, escaped = false;
        for (let i = start; i < html.length && i < start + 3000000; i++) {
            const c = html[i];
            if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
            if (c === '"') inString = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; } }
        }
        return null;
    }
    function youtubeId(url) {
        const u = new URL(url);
        if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0];
        const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{6,})/);
        return m ? m[2] : u.searchParams.get('v');
    }
    async function youtubeText(url, fetchPage, note) {
        const id = youtubeId(url);
        if (!id) throw new Error("That YouTube link doesn't point to a video.");
        const page = await fetchPage(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, { browser: true });
        const player = jsonAfter(page.body || '', 'ytInitialPlayerResponse') || {};
        const details = player.videoDetails || {};
        let title = details.title || '';
        let description = details.shortDescription || '';
        if (!title) {
            const doc = parseHTML(page.body);
            title = meta(doc, 'og:title', 'title');
            description = description || meta(doc, 'og:description', 'description');
        }
        let transcript = '';
        const tracks = (((player.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
        const track = tracks.find(t => /^en/i.test(t.languageCode || '') && t.kind !== 'asr') || tracks.find(t => /^en/i.test(t.languageCode || '')) || tracks[0];
        if (track && track.baseUrl) {
            try {
                const res = await fetchPage(track.baseUrl + '&fmt=json3', { browser: true });
                const data = JSON.parse(res.body || '{}');
                transcript = (data.events || []).map(e => (e.segs || []).map(s => s.utf8 || '').join('')).join(' ').replace(/\s+/g, ' ').trim();
            } catch (e) {
                try {
                    const res = await fetchPage(track.baseUrl, { browser: true });
                    transcript = Array.prototype.map.call(parseHTML(res.body).querySelectorAll('text'), t => cleanText(t.textContent)).join(' ');
                } catch (e2) { /* no transcript */ }
            }
        }
        note(transcript ? 'Read the video\'s description and transcript' : 'Read the video\'s description (no transcript available)');
        if (!title && !description) throw blocked("YouTube didn't share that video's details.", 'no-details');
        return { title, text: `Video title: ${title}\n\nDescription:\n${description}${transcript ? `\n\nTranscript:\n${transcript.slice(0, 12000)}` : ''}` };
    }
    async function tiktokText(url, fetchPage, note) {
        let caption = '';
        let author = '';
        try {
            const res = await fetchPage(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { browser: false });
            const data = JSON.parse(res.body || '{}');
            caption = data.title || '';
            author = data.author_name || '';
        } catch (e) { /* try the page */ }
        if (!caption) {
            const page = await fetchPage(url, { browser: true });
            const data = jsonAfter(page.body || '', '__UNIVERSAL_DATA_FOR_REHYDRATION__');
            const item = data && JSON.stringify(data).match(/"desc":"((?:[^"\\]|\\.)*)"/);
            caption = item ? JSON.parse(`"${item[1]}"`) : meta(parseHTML(page.body), 'og:description', 'description');
        }
        if (!caption) throw blocked("TikTok didn't share that video's caption.", 'no-details');
        note("Read the video's caption");
        return { title: '', text: `TikTok video by ${author || 'a creator'}. Caption:\n${caption}` };
    }
    async function redditText(url, fetchPage, note, follow) {
        let address = url;
        if (/\/s\/|redd\.it/i.test(url)) {   // share links redirect to the post
            const page = await fetchPage(url, { browser: true });
            address = page.url || url;
        }
        const u = new URL(address);
        u.hostname = 'www.reddit.com';
        u.search = '';
        const res = await fetchPage(u.href.replace(/\/$/, '') + '.json?raw_json=1&limit=40', { browser: false });
        let data = null;
        try { data = res.status < 400 ? JSON.parse(res.body || 'null') : null; } catch (e) { data = null; }
        // Reddit sometimes refuses its data format to apps; the post's own page has the text too.
        if (!data) return redditPageText(u.href, fetchPage, note);
        const post = data && data[0] && data[0].data && data[0].data.children[0] && data[0].data.children[0].data;
        if (!post) throw new Error("That Reddit link isn't a post.");
        // A link post to a recipe site: import the recipe from there.
        if (post.url && !/reddit\.com|redd\.it/i.test(post.url) && /^https?:/i.test(post.url) && !/\.(jpe?g|png|gif|webp|mp4)(\?|$)/i.test(post.url)) {
            const linked = await follow(post.url).catch(() => null);
            if (linked) return { recipe: linked };
        }
        const comments = ((data[1] && data[1].data && data[1].data.children) || []).map(c => c.data).filter(c => c && c.body);
        const byPoster = comments.filter(c => c.author === post.author).map(c => c.body);
        const recipeComment = comments.filter(c => /ingredient/i.test(c.body)).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        const parts = [post.selftext].concat(byPoster);
        if (!parts.some(p => /ingredient/i.test(p || '')) && recipeComment) parts.push(recipeComment.body);
        note(byPoster.length ? 'Read the post and the poster\'s comments' : 'Read the post');
        return { title: post.title, text: `Reddit post: ${post.title}\n\n${parts.filter(Boolean).join('\n\n').slice(0, 15000)}` };
    }
    async function redditPageText(url, fetchPage, note) {
        const page = await fetchPage(url, { browser: true });
        const doc = parseHTML(page.body);
        const title = meta(doc, 'og:title', 'twitter:title') || (doc.querySelector('h1') && doc.querySelector('h1').textContent.trim()) || '';
        const body = doc.querySelector('[slot="text-body"], [data-post-click-location="text-body"], .usertext-body, shreddit-post');
        const text = (body ? cleanTextKeepLines(body.innerHTML.replace(/<\/(p|li|div)>|<br\s*\/?>/gi, '\n')) : '') || meta(doc, 'og:description', 'description');
        if (looksBlocked(page.status, readableText(doc)) || text.trim().length < 40) throw blocked("Reddit didn't let Nourish read that post.", 'http-' + page.status);
        note('Read the post');
        return { title, text: `Reddit post: ${title}\n\n${text.slice(0, 15000)}` };
    }
    async function pinterestText(url, fetchPage, note, follow) {
        const page = await fetchPage(url, { browser: true });
        const html = page.body || '';
        const doc = parseHTML(html);
        const recipe = structuredRecipe(doc, page.url || url);
        if (recipe) return { recipe };
        // Most pins point to the recipe's own page.
        const links = (html.match(/"link":"(https?:\\?\/\\?\/[^"]+)"/g) || []).map(m => JSON.parse(m.slice(7)))
            .concat([meta(doc, 'og:see_also')]).filter(l => l && !/pinterest\.|pin\.it/i.test(l));
        for (const link of links.slice(0, 2)) {
            const linked = await follow(link).catch(() => null);
            if (linked) return { recipe: linked };
        }
        const title = meta(doc, 'og:title', 'twitter:title');
        const description = meta(doc, 'og:description', 'description');
        if (looksBlocked(page.status, readableText(doc)) || !description) throw blocked("Pinterest didn't share that pin's recipe.", 'no-details');
        note("Read the pin's description");
        return { title, text: `Pinterest pin: ${title}\n\n${description}` };
    }
    async function metaCaptionText(platform, url, fetchPage, note) {
        const page = await fetchPage(url, { browser: true });
        const doc = parseHTML(page.body);
        const title = meta(doc, 'og:title', 'twitter:title');
        const caption = meta(doc, 'og:description', 'description', 'twitter:description');
        // Instagram's preview: "123 likes, 4 comments - user on March 1, 2024: "the caption"".
        const text = caption.replace(/^[\d,.\sKkMm]+likes?,[\d,.\sKkMm]+comments?\s*-\s*[^:]+:\s*/i, '').replace(/^"|"$/g, '');
        if (looksBlocked(page.status, readableText(doc)) || text.length < 40 || /log ?in|sign up|see (instagram|facebook) photos/i.test(text.slice(0, 80))) {
            throw blocked(`${PLATFORM_NAMES[platform]} only shows that post to people who are logged in.`, 'login');
        }
        note("Read the post's caption");
        return { title, text: `${PLATFORM_NAMES[platform]} post: ${title}\n\nCaption:\n${text}` };
    }

    // === THE WHOLE IMPORT ===
    // fetchPage(url, { browser }) → { status, url, body }. extract(text, { url, site, kind }) → recipe
    // or null (no recipe in the text). Returns { recipe, how, notes }.
    async function importUrl(input, { fetchPage, extract, onStatus = () => {}, depth = 0 } = {}) {
        let url;
        try { url = normalizeUrl(input); } catch (e) { throw new Error("That doesn't look like a web address. Copy the link from the address bar or the app's Share button."); }
        const notes = [];
        const note = text => { notes.push(text); onStatus(text + '…'); };
        const follow = async link => {
            if (depth > 0) return null;
            const r = await importUrl(link, { fetchPage, extract, onStatus, depth: depth + 1 });
            notes.push(...r.notes);
            return Object.assign(r.recipe, { via_url: url, via_name: PLATFORM_NAMES[platformOf(url)] || hostOf(url) });
        };
        const finish = (recipe, how, doc) => {
            recipe.source_url = recipe.source_url || url;
            recipe.source_name = recipe.source_name || siteName(doc, url);
            return { recipe, how, notes };
        };
        const platform = platformOf(url);

        if (platform) {
            onStatus(`Reading the ${PLATFORM_NAMES[platform]} post…`);
            const got = platform === 'youtube' ? await youtubeText(url, fetchPage, note)
                : platform === 'tiktok' ? await tiktokText(url, fetchPage, note)
                    : platform === 'reddit' ? await redditText(url, fetchPage, note, follow)
                        : platform === 'pinterest' ? await pinterestText(url, fetchPage, note, follow)
                            : await metaCaptionText(platform, url, fetchPage, note);
            if (got.recipe) return { recipe: got.recipe, how: got.recipe.how || 'structured', notes };
            onStatus('Asking the AI to find the recipe…');
            const recipe = await extract(got.text, { url, site: PLATFORM_NAMES[platform], kind: 'caption' });
            if (!recipe) throw blocked(`That ${PLATFORM_NAMES[platform]} post doesn't include the recipe itself (it may be in the video, or behind a link).`, 'no-recipe');
            return finish(recipe, 'ai', null);
        }

        onStatus(`Opening ${hostOf(url)}…`);
        const page = await fetchPage(url, { browser: true });
        const finalUrl = page.url || url;
        if (page.status === 404 || page.status === 410) throw new Error(`That page doesn't exist (HTTP ${page.status}). Check the link.`);
        const doc = parseHTML(page.body || '');
        const structured = structuredRecipe(doc, finalUrl);
        if (structured) {
            notes.push('Read the recipe data the site provides');
            structured.source_url = finalUrl;
            return finish(structured, 'structured', doc);
        }
        const text = readableText(doc);
        if (looksBlocked(page.status, text)) throw blocked(`${hostOf(finalUrl)} didn't let Nourish read that page${page.status >= 400 ? ` (HTTP ${page.status})` : ''}.`, 'http-' + page.status);
        if (text.length < 120) throw blocked(`${hostOf(finalUrl)} shows that page only after it runs in a browser, so Nourish can't read it.`, 'empty');
        note('No recipe data on the page; reading its text');
        onStatus('Asking the AI to find the recipe…');
        const recipe = await extract(text, { url: finalUrl, site: siteName(doc, finalUrl), kind: 'page' });
        if (!recipe) throw new Error("No recipe was found on that page. If it's there, paste the recipe text instead.");
        recipe.source_url = finalUrl;
        return finish(recipe, 'ai', doc);
    }

    const api = { importUrl, platformOf, hostOf, normalizeUrl, structuredRecipe, readableText, looksBlocked, jsonAfter, cleanText, isoMinutes, firstNumber, recipeSteps, PLATFORM_NAMES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NourishImport = api;
})(typeof window !== 'undefined' ? window : this);
