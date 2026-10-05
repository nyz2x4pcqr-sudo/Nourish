// Kitchen units: reads amounts like "1/2 cup", converts between US (imperial) and metric with kitchen
// rounding (1 cup → 240 ml, 350°F → 180°C, like oven dials), converts amounts inside recipe text, and caps amounts
// that can't be right ("1 cup curry paste"). Plans keep the AI's own amount and unit; everything is
// converted only when shown, so switching Imperial ↔ Metric changes nothing that's stored.
(function (root) {
    'use strict';

    const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
    const UNITS = {
        cup: 'cup', cups: 'cup', c: 'cup', tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
        oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg',
        ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
        floz: 'fl oz', pint: 'pint', pints: 'pint', quart: 'quart', quarts: 'quart', gallon: 'gallon', gallons: 'gallon',
        clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice', can: 'can', cans: 'can', pinch: 'pinch', pinches: 'pinch', handful: 'handful', handfuls: 'handful',
        piece: 'piece', pieces: 'piece', stick: 'stick', sticks: 'stick', bunch: 'bunch', bunches: 'bunch', head: 'head', heads: 'head', sprig: 'sprig', sprigs: 'sprig',
        package: 'package', packages: 'package', pkg: 'package', scoop: 'scoop', scoops: 'scoop', fillet: 'fillet', fillets: 'fillet', dash: 'dash', dashes: 'dash',
    };
    const PLURAL = { cup: 'cups', clove: 'cloves', slice: 'slices', can: 'cans', handful: 'handfuls', piece: 'pieces', stick: 'sticks', bunch: 'bunches',
        head: 'heads', sprig: 'sprigs', package: 'packages', scoop: 'scoops', fillet: 'fillets', pinch: 'pinches', dash: 'dashes', pint: 'pints', quart: 'quarts' };
    // How much of each unit, in millilitres (volume) or grams (weight).
    const ML = { tsp: 5, tbsp: 15, cup: 240, 'fl oz': 30, pint: 480, quart: 960, ml: 1, l: 1000 };
    const G = { oz: 28.35, lb: 453.6, g: 1, kg: 1000 };
    const IMPERIAL = ['tsp', 'tbsp', 'cup', 'fl oz', 'pint', 'quart', 'oz', 'lb'];
    const METRIC = ['ml', 'l', 'g', 'kg'];

    // "1 1/2", "1/2", "1.5", "1½", "½", "2-3" (→ 2, high 3) at the start of text.
    function parseNumber(text) {
        const frac = text.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)/);
        if (frac && Number(frac[3])) return { value: (frac[1] ? Number(frac[1]) : 0) + Number(frac[2]) / Number(frac[3]), length: frac[0].length };
        // A range may end in a fraction: "1 to 1½ tbsp", "2-2½ cups".
        const m = text.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])?(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])?(?![\d/]))?/);
        if (!m || !(m[1] || m[2])) return null;
        const value = (m[1] ? Number(m[1]) : 0) + (m[2] ? FRACTIONS[m[2]] : 0);
        const high = (m[3] ? Number(m[3]) : 0) + (m[4] ? FRACTIONS[m[4]] : 0);
        const out = { value, length: m[0].length };
        if (!(m[3] || m[4])) out.length = (m[0].match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])?/) || [''])[0].length;
        if (high > value) out.high = high;
        else if (m[3] || m[4]) out.length = (m[0].match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])?/) || [''])[0].length;
        return out;
    }

    // "1/2 cup green curry paste" → { qty: 0.5, unit: 'cup', text: 'green curry paste' }.
    // "chicken breast: 3 oz cooked" → { qty: 3, unit: 'oz', text: 'chicken breast', note: 'cooked' }.
    function splitIngredient(line) {
        const raw = String(line == null ? '' : line).trim().replace(/\s+/g, ' ');
        let name = raw;
        let amount = raw;
        const colon = raw.indexOf(':');
        if (colon > 0) { name = raw.slice(0, colon).trim(); amount = raw.slice(colon + 1).trim(); }
        const num = parseNumber(amount);
        if (!num) return { qty: null, unit: '', text: raw };
        let rest = amount.slice(num.length).trim();
        let unit = '';
        const word = (rest.match(/^(fl\.?\s*oz|[a-z]+)\.?(?![a-z])/i) || [])[0];
        if (word) {
            const key = word.toLowerCase().replace(/[.\s]/g, '');
            if (UNITS[key]) { unit = UNITS[key]; rest = rest.slice(word.length).replace(/^\.?\s*(of\s+)?/i, ''); }
        }
        const high = num.high ? { qtyHigh: num.high } : {};
        if (colon > 0) return Object.assign({ qty: num.value, unit, text: name, note: rest }, high);
        return Object.assign({ qty: num.value, unit, text: rest }, high);
    }

    function formatQty(n) {
        const whole = Math.floor(n + 1e-9);
        const frac = n - whole;
        const marks = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
        for (const [v, mark] of marks) if (Math.abs(frac - v) < 0.03) return (whole ? whole : '') + mark;
        if (frac < 0.03) return String(whole);
        if (frac > 0.97) return String(whole + 1);
        return String(Math.round(n * 10) / 10);
    }
    function unitLabel(unit, qty) { return qty > 1 && PLURAL[unit] ? PLURAL[unit] : unit; }
    function roundTo(n, step) { return Math.max(step, Math.round(n / step) * step); }

    // Millilitres → the unit a cook would use, in that system.
    function volumeIn(ml, system) {
        if (system === 'metric') {
            if (ml < 45) return ml < 15 ? { qty: roundTo(ml / 5, 0.25), unit: 'tsp' } : { qty: roundTo(ml / 15, 0.5), unit: 'tbsp' };
            if (ml >= 1000) return { qty: Math.round(ml / 100) / 10, unit: 'l' };
            return { qty: roundTo(ml, 5), unit: 'ml' };
        }
        if (ml < 15) return { qty: roundTo(ml / 5, 0.25), unit: 'tsp' };
        if (ml < 60) return { qty: roundTo(ml / 15, 0.5), unit: 'tbsp' };
        return { qty: roundTo(ml / 240, 0.25), unit: 'cup' };
    }
    // Grams → g/kg or oz/lb.
    function weightIn(g, system) {
        if (system === 'metric') {
            if (g >= 1000) return { qty: Math.round(g / 100) / 10, unit: 'kg' };
            return { qty: g < 100 ? roundTo(g, 5) : roundTo(g, 10), unit: 'g' };
        }
        if (g < 450) { const oz = g / 28.35; return { qty: oz < 4 ? roundTo(oz, 0.5) : Math.round(oz), unit: 'oz' }; }
        return { qty: roundTo(g / 453.6, 0.25), unit: 'lb' };
    }

    // One amount in the chosen system. Spoons stay spoons (metric kitchens use 5 ml / 15 ml spoons too);
    // amounts already in that system are left exactly as written.
    function convert(qty, unit, system) {
        if (qty == null || !unit) return { qty, unit };
        const foreign = system === 'metric' ? IMPERIAL : METRIC;
        if (foreign.indexOf(unit) === -1 || unit === 'tsp' || unit === 'tbsp') return { qty, unit };
        if (ML[unit]) return volumeIn(qty * ML[unit], system);
        if (G[unit]) return weightIn(qty * G[unit], system);
        return { qty, unit };
    }

    function formatAmount(qty, unit) {
        if (qty == null) return '';
        const n = unit === 'l' || unit === 'kg' ? String(qty) : formatQty(qty);
        return unit ? `${n} ${unitLabel(unit, qty)}` : n;
    }

    // An ingredient line as shown: converted, with the AI's own wording kept for the rest.
    function formatIngredient(line, system) {
        const item = typeof line === 'object' && line ? line : splitIngredient(line);
        if (item.qty == null) return item.text;
        const c = convert(item.qty, item.unit, system);
        let amount = formatAmount(c.qty, c.unit);
        // A range keeps both ends: "2–3 garlic cloves", "200–250 g" → "7–9 oz".
        if (item.qtyHigh) {
            const hi = convert(item.qtyHigh, item.unit, system);
            amount = hi.unit === c.unit ? `${formatAmount(c.qty, '')}–${formatAmount(hi.qty, hi.unit)}` : `${amount}–${formatAmount(hi.qty, hi.unit)}`;
        }
        // An amount inside the words ("1 x 400g tin tomatoes") is shown in the chosen units too.
        const text = /\d\s*(?:g|kg|ml|l|oz|lb)\b/i.test(item.text) ? convertText(item.text, system) : item.text;
        return item.note !== undefined ? `${text}: ${amount}${item.note ? ' ' + item.note : ''}` : `${amount} ${text}`.trim();
    }

    const NUM = '(\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+|\\d*[½¼¾⅓⅔⅛])';
    function numberValue(text) { const n = parseNumber(text.trim()); return n ? n.value : NaN; }

    // A temperature: "400°F", "200 °C", "350 degrees F", "425F", "180 C". The degree mark is optional
    // only for 3-digit numbers, so "2 c" (cups) is never read as a temperature.
    const TEMP = '(?:(\\d{2,3})\\s*(?:°\\s*|º\\s*|degrees?\\s+)|(\\d{3})\\s?)(F|C|Fahrenheit|Celsius)\\b';
    function tempIn(deg, isF, system) {
        if (system === 'metric') return isF ? `${(deg - 32) * 5 / 9 >= 100 ? roundTo((deg - 32) * 5 / 9, 10) : roundTo((deg - 32) * 5 / 9, 5)}°C` : `${deg}°C`;
        if (isF) return `${deg}°F`;
        const f = deg * 9 / 5 + 32;
        return `${f >= 250 ? roundTo(f, 25) : roundTo(f, 5)}°F`;
    }

    // Amounts inside recipe text: "Roast at 400°F for 20 minutes", "add 1/2 cup stock", "2-inch pieces".
    function convertText(text, system) {
        let out = String(text == null ? '' : text);
        // Two temperatures for the same thing ("400°F (200°C)", "200°C / 400°F", "180 C or 350 F"):
        // keep one, the one already in the chosen system if there is one, so it reads "400°F" — never
        // "400°F (400°F)".
        out = out.replace(new RegExp(`${TEMP}(\\s*(?:\\(\\s*|\\/\\s*|or\\s+|,\\s*)?)${TEMP}(\\s*\\))?`, 'gi'), (all, d1, e1, s1, gap, d2, e2, s2, close) => {
            if (/\(/.test(gap) !== Boolean(close)) return all;
            const a = { deg: Number(d1 || e1), isF: /^f/i.test(s1) };
            const b = { deg: Number(d2 || e2), isF: /^f/i.test(s2) };
            const wantF = system !== 'metric';
            const keep = b.isF === wantF && a.isF !== wantF ? b : a;
            return tempIn(keep.deg, keep.isF, system);
        });
        out = out.replace(new RegExp(TEMP, 'gi'), (all, d1, d2, scale) => tempIn(Number(d1 || d2), /^f/i.test(scale), system));
        // Lengths.
        out = out.replace(new RegExp(`${NUM}(\\s*-\\s*|\\s+)(inch(?:es)?|in\\.|cm|centimet(?:er|re)s?)(?![a-z])`, 'gi'), (all, n, gap, unit) => {
            const v = numberValue(n);
            if (!isFinite(v)) return all;
            const isInch = /^in/i.test(unit);
            if (system === 'metric' && isInch) { const cm = v * 2.54; return `${cm < 5 ? roundTo(cm, 0.5) : Math.round(cm)}${gap.indexOf('-') !== -1 ? '-' : ' '}cm`; }
            if (system !== 'metric' && !isInch) return `${formatQty(roundTo(v / 2.54, 0.25))}${gap.indexOf('-') !== -1 ? '-' : ' '}inch`;
            return all;
        });
        // Volumes and weights.
        out = out.replace(new RegExp(`${NUM}\\s*(cups?|fl\\.?\\s*oz|ounces?|oz|pounds?|lbs?|grams?|g|kg|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l|pints?|quarts?)(?![a-z])`, 'gi'), (all, n, word) => {
            const v = numberValue(n);
            const unit = UNITS[word.toLowerCase().replace(/[.\s]/g, '')];
            if (!isFinite(v) || !unit) return all;
            const c = convert(v, unit, system);
            return c.unit === unit && c.qty === v ? all : formatAmount(c.qty, c.unit);
        });
        return out;
    }

    // Upper limits per recipe, in millilitres, for things the AI tends to overdo. Each is matched
    // against the line's main ingredient only (see mainIngredient): its last words, which name what
    // it is. "½ cup almond milk (vanilla)" is almond milk, "1 cup vanilla yogurt" is yogurt, "2 cups
    // ginger ale" is ale: none is an extract or a spice (0.1.10 capped the almond milk at 2 tbsp).
    const TAIL = '(?:\\s+(?:powder|leaves|seeds?|sprigs?|flakes|pods?))?s?$';
    const LIMITS = [
        [new RegExp(`\\b(salt|baking soda|baking powder|bicarbonate(?: of soda)?)${TAIL}`, 'i'), 15, 'salt and raising agents: at most 1 tbsp'],
        [new RegExp(`\\b(paste|extract|essence|spice|spice mix|seasoning|cumin|paprika|cinnamon|turmeric|chili powder|chilli powder|curry powder|garam masala|nutmeg|cloves? ground|ground cloves|cayenne|chili flakes|chilli flakes|red pepper flakes|black pepper|oregano|thyme|garlic powder|onion powder|ginger powder|ground ginger|five spice|allspice|cardamom|coriander powder|ground coriander|za'atar|sumac|smoked paprika|vanilla|vanilla bean)${TAIL}`, 'i'), 30, 'pastes, extracts and spices: at most 2 tbsp'],
        [new RegExp(`\\b(oil|vinegar)${TAIL}`, 'i'), 60, 'oils and vinegars: at most ¼ cup'],
        [new RegExp(`\\b(basil|cilantro|coriander leaves|parsley|mint|dill|chives|tarragon|fresh herbs|herbs)${TAIL}`, 'i'), 240, 'fresh herbs: at most 1 cup'],
    ];
    // Pastes that are a main ingredient in real amounts.
    const NOT_CAPPED = /\b(tomato|almond|sesame|chickpea|bean|date|red bean|lotus seed) paste$/i;
    // The main ingredient of a line: without what's in brackets, what follows a comma ("divided",
    // "cooked", "plus more"), "or …" alternatives and words that only describe it.
    function mainIngredient(text) {
        return String(text || '')
            .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
            .split(/,|;|\s+or\s+|\s+for\s+|\s+to taste\b/i)[0]
            .replace(/\b(divided|plus more|optional|unsweetened|sweetened|heaping|scant|level|about|approximately|fresh|freshly|good quality|organic)\b/gi, ' ')
            .replace(/\s+/g, ' ').trim();
    }

    // An ingredient line with an impossible amount capped: "1 cup green curry paste" → "2 tbsp green curry paste".
    // Returns { line, clamped: '' | why }.
    function clampIngredient(line) {
        const item = splitIngredient(line);
        if (item.qty == null || !ML[item.unit]) return { line: String(line), clamped: '' };
        const name = item.text;
        const main = mainIngredient(name);
        const ml = item.qty * ML[item.unit];
        if (!main || NOT_CAPPED.test(main)) return { line: String(line), clamped: '' };
        for (const [re, max, why] of LIMITS) {
            if (!re.test(main) || ml <= max * 1.01) continue;
            const capped = volumeIn(max, 'imperial');
            const text = item.note !== undefined ? `${name}: ${formatAmount(capped.qty, capped.unit)}${item.note ? ' ' + item.note : ''}` : `${formatAmount(capped.qty, capped.unit)} ${name}`;
            return { line: text, clamped: why };
        }
        return { line: String(line), clamped: '' };
    }

    // For the grocery list: an amount in a unit both systems can add up (ml, g), or as written.
    function toBase(qty, unit) {
        if (qty == null) return null;
        if (ML[unit]) return { kind: 'volume', value: qty * ML[unit] };
        if (G[unit]) return { kind: 'weight', value: qty * G[unit] };
        return { kind: unit || 'count', value: qty };
    }
    function formatBase(kind, value, system) {
        if (kind === 'volume') { const v = volumeIn(value, system); return formatAmount(v.qty, v.unit); }
        if (kind === 'weight') { const w = weightIn(value, system); return formatAmount(w.qty, w.unit); }
        if (kind === 'count') return `×${formatQty(value)}`;
        return formatAmount(value, kind);
    }

    // US (and Liberia, Myanmar) cook in cups and °F; everyone else in metric.
    function defaultSystem(locale) {
        const region = (String(locale || '').split(/[-_]/)[1] || '').toUpperCase();
        return ['US', 'LR', 'MM'].indexOf(region) !== -1 ? 'imperial' : 'metric';
    }

    const api = { splitIngredient, parseNumber, convert, formatQty, formatAmount, formatIngredient, convertText, clampIngredient, toBase, formatBase, defaultSystem, UNITS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NourishUnits = api;
})(typeof window !== 'undefined' ? window : this);
