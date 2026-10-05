// Every recipe's nutrition is cross-checked, never taken from one source. Up to three independent
// figures per recipe: (a) Nourish's own calculation from the bundled USDA table (nutrition.js),
// (b) a second opinion from a free service (Edamam's full-recipe analysis, or FatSecret's and USDA's
// live food databases looked up ingredient by ingredient), (c) the recipe source's own published
// numbers. They're compared ingredient by ingredient, so a wrong food match (bone marrow read as
// lean beef), a bone-in weight or a discarded brine shows up as the one line that's off.
//
// Confidence: High when the figures agree within about 10%, Medium within about 20% (or when two of
// three agree and the odd one out is set aside), Low when they disagree. One figure only is an
// "estimate". Low recipes stay out of plans until a check settles them.
(function (root) {
    'use strict';
    const N = root.NourishNutrition || require('./nutrition.js');
    const U = root.NourishUnits || require('./units.js');
    const S = root.NourishServices || require('./services.js');

    const LABELS = { usda: 'Nourish (USDA food table)', source: 'the recipe’s own numbers', edamam: 'Edamam', fatsecret: 'FatSecret', usdalive: 'USDA FoodData Central (live)' };
    const HIGH = 0.10, MEDIUM = 0.20;
    const LINE_OFF = (a, b) => Math.abs(a - b) > Math.max(40, 0.35 * Math.max(a, b));

    // === WHICH RECIPE ===
    // The same recipe always gets the same fingerprint, from any source, so it's never checked twice.
    function fingerprint(r) {
        const text = [String(r.name || '').toLowerCase().trim(), Math.max(1, Number(r.servings) || 1)].concat((r.ingredients || []).map(l => String(l).toLowerCase().replace(/\s+/g, ' ').trim())).join('|');
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        let h2 = 0;
        for (let i = text.length - 1; i >= 0; i--) { h2 = (Math.imul(h2, 31) + text.charCodeAt(i)) >>> 0; }
        return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    }

    // === THE FIGURES ===
    const per = v => (v == null || !isFinite(Number(v)) ? null : Math.round(Number(v)));
    // (a) Nourish's own: every line with its calories and protein per serving.
    function usdaFigure(r) {
        const servings = Math.max(1, Number(r.servings) || 1);
        const c = N.calculate(r.ingredients || [], servings, r.steps);
        if (!(c.nutrition.calories > 0)) return null;
        return { id: 'usda', label: LABELS.usda, calories: c.nutrition.calories, protein_g: c.nutrition.protein_g, carbs_g: c.nutrition.carbs_g, fat_g: c.nutrition.fat_g,
            lines: c.lines.map(x => ({ line: x.line, food: x.key, grams: x.grams, kcal: x.kcal, protein: x.protein, assumed: !!x.assumed })), unmatched: c.unmatched.length };
    }
    // (c) What the site or the book printed.
    function sourceFigure(r) {
        const c = r.nutrition_check;
        const earlier = c && Array.isArray(c.figures) ? c.figures.find(f => f.id === 'source') : null;
        const s = r.source_nutrition || earlier || (c && Number(c.source) > 0 ? { calories: Number(c.source) } : null);
        if (!s || !(Number(s.calories) > 0)) return null;
        return { id: 'source', label: r.source_name ? `${r.source_name}’s own numbers` : LABELS.source, calories: per(s.calories), protein_g: per(s.protein_g), carbs_g: per(s.carbs_g), fat_g: per(s.fat_g) };
    }
    // (b) Edamam Nutrition Analysis: the whole recipe, parsed by Edamam, per ingredient.
    function edamamRequest(r) {
        return { method: 'POST', url: 'https://api.edamam.com/api/nutrition-details', body: { title: String(r.name || 'Recipe').slice(0, 120), yield: String(Math.max(1, Number(r.servings) || 1)), ingr: (r.ingredients || []).map(String).filter(l => !N.isHeader || !N.isHeader(l)) } };
    }
    const nutr = (o, code) => { const v = o && o[code]; return v && isFinite(Number(v.quantity)) ? Number(v.quantity) : 0; };
    function parseEdamam(data, r) {
        if (!data) return null;
        const servings = Math.max(1, Number(r.servings) || 1);
        const total = data.totalNutrients || (data.ingredients ? null : null);
        const lines = (data.ingredients || []).map(ing => {
            const parsed = Array.isArray(ing.parsed) ? ing.parsed : [];
            const k = parsed.reduce((t, p) => t + nutr(p.nutrients, 'ENERC_KCAL'), 0);
            const p = parsed.reduce((t, x) => t + nutr(x.nutrients, 'PROCNT'), 0);
            return { line: String(ing.text || ''), food: parsed[0] ? String(parsed[0].food || parsed[0].foodMatch || '') : '', grams: Math.round(parsed.reduce((t, x) => t + (Number(x.weight) || 0), 0)),
                kcal: Math.round(k / servings), protein: Math.round(p / servings * 10) / 10, matched: parsed.length > 0 && parsed.every(x => !x.status || x.status === 'OK') };
        });
        const kcal = total ? nutr(total, 'ENERC_KCAL') : (Number(data.calories) || lines.reduce((t, x) => t + x.kcal * servings, 0));
        if (!(kcal > 0)) return null;
        return { id: 'edamam', label: LABELS.edamam, calories: Math.round(kcal / servings), protein_g: Math.round(nutr(total, 'PROCNT') / servings), carbs_g: Math.round(nutr(total, 'CHOCDF') / servings), fat_g: Math.round(nutr(total, 'FAT') / servings), lines,
            attribution: S.SERVICES.edamam.attribution };
    }
    // Ingredient lookups (FatSecret, USDA live): the food named in each line, per 100 g, times the
    // weight Nourish read for that line. They check what each food is; Edamam also checks amounts.
    function lookupName(line) {
        const item = U.splitIngredient(String(line));
        return String(item.text || line).toLowerCase().replace(/\([^)]*\)/g, ' ').split(/,| - | for | to (serve|taste)/)[0]
            .replace(/\b(chopped|diced|minced|sliced|fresh|large|medium|small|finely|roughly|thinly|peeled|cubed|grated|shredded|boneless|skinless|optional|plus more|divided|packed|about|organic)\b/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function fatsecretSearch(name) { return { method: 'GET', url: 'https://platform.fatsecret.com/rest/server.api', query: { method: 'foods.search', search_expression: name, max_results: '10', format: 'json' } }; }
    // "Per 100g - Calories: 165kcal | Fat: 3.57g | Carbs: 0.00g | Protein: 31.02g"
    function parseFatSecretSearch(data) {
        const list = data && data.foods && data.foods.food ? [].concat(data.foods.food) : [];
        const read = f => {
            const d = String(f.food_description || '');
            const m = d.match(/^Per 100\s?g\s*-\s*Calories:\s*([\d.]+)kcal\s*\|\s*Fat:\s*([\d.]+)g\s*\|\s*Carbs:\s*([\d.]+)g\s*\|\s*Protein:\s*([\d.]+)g/i);
            return m ? { food_id: String(f.food_id || ''), name: String(f.food_name || ''), generic: f.food_type === 'Generic', per100: { kcal: +m[1], fat: +m[2], carbs: +m[3], protein: +m[4] } } : null;
        };
        const ok = list.map(read).filter(Boolean);
        return ok.find(x => x.generic) || ok[0] || null;
    }
    function usdaSearch(name) { return { method: 'GET', url: 'https://api.nal.usda.gov/fdc/v1/foods/search', query: { query: name, pageSize: '5', dataType: 'Foundation,SR Legacy,Survey (FNDDS)' } }; }
    function parseUsdaSearch(data) {
        const foods = (data && data.foods) || [];
        for (const f of foods) {
            const get = num => { const n = (f.foodNutrients || []).find(x => String(x.nutrientNumber) === num || x.nutrientId === { 208: 1008, 203: 1003, 204: 1004, 205: 1005 }[num]); return n ? Number(n.value) || 0 : null; };
            const kcal = get('208');
            if (kcal == null) continue;
            return { food_id: String(f.fdcId || ''), name: String(f.description || ''), per100: { kcal, protein: get('203') || 0, fat: get('204') || 0, carbs: get('205') || 0 } };
        }
        return null;
    }
    // A figure from per-ingredient lookups. Lines it couldn't look up keep Nourish's value, and the
    // figure only counts when it covers most of the calories itself (else it would just echo ours).
    function lookupFigure(id, base, found) {
        const servings = base.servings;
        let covered = 0, all = 0;
        const lines = base.lines.map(x => {
            all += x.kcal;
            const hit = found[x.line];
            if (!hit) return Object.assign({}, x, { own: true });
            covered += x.kcal;
            return { line: x.line, food: hit.name, grams: x.grams, kcal: Math.round(hit.per100.kcal * x.grams / 100 / servings), protein: Math.round(hit.per100.protein * x.grams / 100 / servings * 10) / 10 };
        });
        if (!all || covered / all < 0.6) return null;
        const sum = k => Math.round(lines.reduce((t, x) => t + (x[k] || 0), 0));
        return { id, label: LABELS[id], calories: sum('kcal'), protein_g: sum('protein'), lines, coverage: Math.round(covered / all * 100), attribution: id === 'fatsecret' ? S.SERVICES.fatsecret.attribution : S.SERVICES.usda.attribution };
    }

    // === COMPARING ===
    const spread = list => { const v = list.map(f => f.calories); return (Math.max(...v) - Math.min(...v)) / Math.max(...v); };
    // Ingredient by ingredient: for each of Nourish's lines, what the per-ingredient figures say.
    // A line is "off" when another figure differs a lot; with three or more, the majority decides.
    function lineCheck(figs) {
        const withLines = figs.filter(f => Array.isArray(f.lines) && f.lines.length);
        const base = withLines.find(f => f.id === 'usda');
        if (!base || withLines.length < 2) return { flags: [], corrected: null };
        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const flags = [];
        let corrected = 0, changed = false;
        base.lines.forEach((x, i) => {
            const values = { usda: x.kcal };
            const proteins = { usda: x.protein || 0 };
            withLines.filter(f => f !== base).forEach(f => {
                const y = f.lines.find(l => norm(l.line) === norm(x.line)) || (f.lines.length === base.lines.length ? f.lines[i] : null);
                if (y && !y.own) { values[f.id] = y.kcal; proteins[f.id] = y.protein || 0; }
            });
            const ids = Object.keys(values);
            let chosen = x.kcal, why = '';
            if (ids.length >= 3) {
                // The value two or more agree on (within 25%), when Nourish's isn't one of them.
                const agree = ids.filter(a => ids.some(b => b !== a && !LINE_OFF(values[a], values[b]) && Math.abs(values[a] - values[b]) <= Math.max(25, 0.25 * Math.max(values[a], values[b]))));
                if (agree.length >= 2 && !agree.includes('usda')) {
                    chosen = Math.round(agree.reduce((t, a) => t + values[a], 0) / agree.length);
                    why = `${agree.map(a => LABELS[a]).join(' and ')} agree on about ${chosen} kcal; Nourish's ${x.kcal} kcal (as ${x.food}) was off`;
                    changed = true;
                }
            }
            if (ids.length >= 2 && ids.some(a => a !== 'usda' && LINE_OFF(values.usda, values[a]))) {
                flags.push({ line: x.line, food: x.food, values, chosen, why: why || 'the figures differ: no majority' });
            }
            corrected += chosen;
        });
        return { flags: flags.slice(0, 8), corrected: changed ? corrected : null };
    }
    // The verdict on a recipe from its figures. Returns the stored result (compact: no service data
    // that its terms don't allow keeping, only the four main numbers and Nourish's own conclusions).
    function compare(figures, { checkedAt = Date.now(), fp = '' } = {}) {
        const figs = (figures || []).filter(f => f && f.calories > 0);
        const out = { fp, level: 'estimate', sources: figs.length, checked_at: checkedAt, figures: figs.map(f => ({ id: f.id, label: f.label, calories: f.calories, protein_g: f.protein_g })) };
        if (!figs.length) return Object.assign(out, { level: 'none', note: 'No nutrition could be worked out.' });
        const line = lineCheck(figs);
        out.flags = line.flags.length ? line.flags : undefined;
        if (figs.length === 1) {
            out.used = { calories: figs[0].calories, protein_g: figs[0].protein_g, from: figs[0].id };
            out.note = 'Estimate: only one source.';
            return out;
        }
        const s = spread(figs);
        if (s <= HIGH) { out.level = 'high'; out.note = `Calories checked against ${figs.length} sources: they agree.`; return out; }
        if (s <= MEDIUM) { out.level = 'medium'; out.note = `Calories checked against ${figs.length} sources: they agree within about 20%.`; return out; }
        // Disagreement. With three or more figures, the ones that agree (within 10%) win when they're
        // the majority; the odd one out is set aside and named.
        if (figs.length >= 3) {
            let best = [];
            figs.forEach(a => { const group = figs.filter(b => Math.abs(a.calories - b.calories) / Math.max(a.calories, b.calories) <= HIGH); if (group.length > best.length) best = group; });
            if (best.length * 2 > figs.length) {
                const odd = figs.filter(f => !best.includes(f));
                const mean = k => Math.round(best.reduce((t, f) => t + (Number(f[k]) || 0), 0) / best.length);
                out.level = 'medium';
                out.used = { calories: mean('calories'), protein_g: mean('protein_g'), from: best.map(f => f.id).join('+') };
                out.note = `${best.length} of ${figs.length} sources agree; ${odd.map(f => f.label).join(' and ')} ${odd.length > 1 ? 'were' : 'was'} off and isn’t used.`;
                return out;
            }
        }
        // Per ingredient: when the majority on each line corrects Nourish's total and it then agrees
        // with another figure, that corrected total is used.
        if (line.corrected) {
            const others = figs.filter(f => f.id !== 'usda');
            if (others.some(f => Math.abs(f.calories - line.corrected) / Math.max(f.calories, line.corrected) <= MEDIUM)) {
                out.level = 'medium';
                out.used = { calories: line.corrected, from: 'per-ingredient majority' };
                out.note = `Corrected ingredient by ingredient: ${line.flags.filter(f => f.why && !/no majority/.test(f.why)).map(f => f.line).slice(0, 2).join('; ')}. The corrected total agrees with another source.`;
                return out;
            }
        }
        out.level = 'low';
        out.note = `The sources disagree (${figs.map(f => `${f.label} ${f.calories} kcal`).join(', ')}). Kept out of plans until a check settles it.`;
        return out;
    }

    // The quick check every recipe gets, with no service and no key: Nourish's calculation against
    // the source's own numbers.
    function localCheck(r, now = Date.now()) {
        return compare([usdaFigure(r), sourceFigure(r)], { checkedAt: now, fp: fingerprint(r) });
    }
    // Puts a verdict on a recipe: its numbers follow the agreed figure when that isn't already them.
    function apply(r, result) {
        if (!r || !result) return r;
        r.nutrition_check = result;
        if (result.used && result.used.calories > 0 && r.nutrition && Math.abs(result.used.calories - r.nutrition.calories) / result.used.calories > 0.05) {
            const k = result.used.calories / r.nutrition.calories;
            r.nutrition = Object.assign({}, r.nutrition, { calories: result.used.calories, protein_g: result.used.protein_g != null ? result.used.protein_g : Math.round(r.nutrition.protein_g * k),
                carbs_g: Math.round((r.nutrition.carbs_g || 0) * k), fat_g: Math.round((r.nutrition.fat_g || 0) * k) });
            r.nutrition_basis = 'cross-checked';
        }
        return r;
    }
    // Plans never use a recipe whose sources disagree.
    const plannable = r => !(r && r.nutrition_check && r.nutrition_check.level === 'low');
    // The plain words for a recipe ("Calories checked against 3 sources: they agree").
    function summary(r, { anyKey = false } = {}) {
        const c = r && r.nutrition_check;
        if (!c || !c.level) return '';
        if (c.level === 'estimate') return anyKey ? 'Estimate: only one source so far (a second opinion is on its way).' : 'Estimate: only one source. Add a free key in Settings → Recipe and nutrition services for a second opinion.';
        return c.note || '';
    }

    // === RUNNING A FULL CHECK (with the free services that have keys) ===
    // send(service, request) → { status, body } (app.js: through the PC, or the phone itself).
    // caches: { get(key), set(key, value) } for lookups; services: which are usable now.
    async function fullCheck(r, { send, services = {}, cache, log = () => {}, now = Date.now() } = {}) {
        const fp = fingerprint(r);
        const usda = usdaFigure(r);
        const figs = [usda, sourceFigure(r)];
        const session = {};
        if (usda) usda.servings = Math.max(1, Number(r.servings) || 1);
        if (services.edamam) {
            try {
                const res = await send('edamam', edamamRequest(r));
                if (res.status === 200) { const f = parseEdamam(JSON.parse(res.body || 'null'), r); if (f) { figs.push(f); session.edamam = f; } }
                else if (res.status === 555) log(`Edamam couldn't read the ingredients of "${r.name}" (it parses only clearly written amounts)`);
                else log(`Edamam answered ${res.status} for "${r.name}"`, 'warn');
            } catch (e) { log(`Edamam check of "${r.name}" failed: ${e.message}`, 'warn'); }
        }
        // Ingredient lookups for the lines that matter (at least 30 kcal a serving), at most 8.
        const lookups = async (service, request, parse, ttl) => {
            const found = {};
            if (!usda) return null;
            for (const x of usda.lines.filter(l => l.kcal >= 30 && !l.assumed).sort((a, b) => b.kcal - a.kcal).slice(0, 8)) {
                const name = lookupName(x.line);
                if (!name) continue;
                const key = `${service}:${name}`;
                let hit = cache && cache.get(key);
                if (hit && ttl && now - (hit.at || 0) > ttl) hit = null;   // FatSecret: food data kept 24 hours at most
                if (!hit) {
                    try {
                        const res = await send(service, request(name));
                        if (res.status !== 200) { log(`${S.SERVICES[service === 'usdalive' ? 'usda' : service].name} answered ${res.status} for "${name}"`, 'warn'); if (res.status === 429) break; continue; }
                        const got = parse(JSON.parse(res.body || 'null'));
                        hit = got ? Object.assign(got, { at: now }) : { none: true, at: now };
                        if (cache) cache.set(key, hit);
                    } catch (e) { log(`${service} lookup of "${name}" failed: ${e.message}`, 'warn'); break; }
                }
                if (hit && !hit.none) found[x.line] = hit;
            }
            return lookupFigure(service, usda, found);
        };
        if (services.fatsecret) { const f = await lookups('fatsecret', fatsecretSearch, parseFatSecretSearch, 24 * 3600e3); if (f) figs.push(f); }
        if (services.usdalive && figs.filter(Boolean).length < 3) { const f = await lookups('usdalive', usdaSearch, parseUsdaSearch, 0); if (f) figs.push(f); }
        const result = compare(figs, { checkedAt: now, fp });
        result.services = Object.keys(services).filter(k => services[k]);
        return { result, session };
    }

    const api = { fingerprint, usdaFigure, sourceFigure, edamamRequest, parseEdamam, fatsecretSearch, parseFatSecretSearch, usdaSearch, parseUsdaSearch, lookupFigure, lookupName,
        lineCheck, compare, localCheck, apply, plannable, summary, fullCheck, LABELS, HIGH, MEDIUM };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishCrossCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
