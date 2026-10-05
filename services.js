// The free recipe and nutrition services (Settings → Recipe and nutrition services). Every one is
// optional and free: Nourish works with none of them. Only recipe and ingredient text is sent.
//
// Requests are built here; the key is added where it's kept: on the PC by the Nourish server
// (backend/services.py, keys encrypted there), on a phone here, from the phone's Keychain or
// Keystore (never the app's own storage). Each service's free limit is counted on this device and
// Nourish stops cleanly before it.
(function (root) {
    'use strict';

    // Free limits as the services publish them for their free plans (checked October 2026).
    const SERVICES = {
        edamam: {
            name: 'Edamam Nutrition Analysis',
            what: 'A second opinion on each recipe’s calories, ingredient by ingredient.',
            free: 'Free developer plan: about 400 recipes a month, 10 a minute.',
            signup: 'https://developer.edamam.com/edamam-nutrition-api',
            keys: [['edamam_app_id', 'Application ID'], ['edamam_app_key', 'Application Key']],
            limits: { month: 380, minute: 10 },
            attribution: { text: 'Nutrition analysis by Edamam', url: 'https://developer.edamam.com' },
            steps: [
                'Open developer.edamam.com and choose "Sign Up". Pick the free "Developer" plan of the Nutrition Analysis API (no card needed).',
                'Confirm your email, then log in and open "Dashboard" → "Applications".',
                'Choose "Create a new application", pick "Nutrition Analysis API", give it any name (for example "Nourish") and save.',
                'Open the application. Copy the "Application ID" into the first box here and the "Application Keys" value into the second.',
                'Tap Test. It should say the key works.',
            ],
        },
        fatsecret: {
            name: 'FatSecret Platform',
            what: 'Checks each ingredient against a big food database, and adds FatSecret’s own recipes.',
            free: 'Free Basic plan: about 5,000 lookups a day (US foods).',
            signup: 'https://platform.fatsecret.com/register',
            keys: [['fatsecret_key', 'Consumer Key'], ['fatsecret_secret', 'Consumer Secret']],
            limits: { day: 4800 },
            attribution: { text: 'Powered by fatsecret', url: 'https://www.fatsecret.com' },
            steps: [
                'Open platform.fatsecret.com/register and create a free account (the Basic edition; no card needed).',
                'Confirm your email and log in to platform.fatsecret.com.',
                'Open "Generate / View API Keys". Under "REST API OAuth 1.0 Credentials" you see a Consumer Key and a Consumer Secret.',
                'Copy the Consumer Key into the first box here and the Consumer Secret into the second.',
                'Tap Test. Nourish uses OAuth 1.0, so you don’t need to add your internet address on FatSecret’s site.',
            ],
        },
        usda: {
            name: 'USDA FoodData Central',
            what: 'The US government’s food database, looked up live as another check on each ingredient.',
            free: 'Free. Without a key Nourish uses the public demo key (about 30 lookups an hour); a free key gives 1,000 an hour.',
            signup: 'https://api.data.gov/signup/',
            keys: [['usda_api_key', 'API key (optional)']],
            limits: { hour: 900, hourNoKey: 25 },
            attribution: { text: 'USDA FoodData Central (public domain)', url: 'https://fdc.nal.usda.gov' },
            steps: [
                'Open api.data.gov/signup.',
                'Type your first name, last name and email, and choose "Sign up". It’s free and instant.',
                'Your key arrives on the page and by email. Copy it into the box here.',
                'Tap Test.',
            ],
        },
        spoonacular: {
            name: 'Spoonacular',
            what: 'Finds recipes by protein and calories, then Nourish reads them from the recipe’s own site.',
            free: 'Free plan: 50 points a day (a search costs about 1–2 points).',
            signup: 'https://spoonacular.com/food-api/console#Dashboard',
            keys: [['spoonacular_api_key', 'API key']],
            limits: { day: 45 },
            attribution: { text: 'Recipe search by spoonacular', url: 'https://spoonacular.com/food-api' },
            steps: [
                'Open spoonacular.com/food-api and choose "Start Now". Create a free account (the free plan; no card needed).',
                'Confirm your email and log in. Open "My Console" → "Profile & API Key".',
                'Choose "Show / Hide API Key" and copy the key into the box here.',
                'Tap Test.',
            ],
        },
    };
    const PRIVACY = 'Only recipe and ingredient text is sent to these services: never your name, plans, targets or anything about you. Keys are kept on this device (or encrypted on your PC) and never written to the activity log.';

    // === USAGE (counted on this device, by day, hour, minute and month) ===
    const USAGE_KEY = 'nourish_service_usage';
    function storage() { try { return root.localStorage || null; } catch (e) { return null; } }
    function loadUsage() { try { const s = storage(); return JSON.parse((s && s.getItem(USAGE_KEY)) || '{}') || {}; } catch (e) { return {}; } }
    function saveUsage(u) { try { const s = storage(); if (s) s.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) { /* full */ } }
    const stamp = (now, part) => { const d = new Date(now); const iso = d.toISOString(); return part === 'month' ? iso.slice(0, 7) : part === 'day' ? iso.slice(0, 10) : part === 'hour' ? iso.slice(0, 13) : iso.slice(0, 16); };
    function usage(service, now = Date.now()) {
        const u = loadUsage()[service] || {};
        const out = {};
        ['month', 'day', 'hour', 'minute'].forEach(p => { out[p] = u[p] && u[p][0] === stamp(now, p) ? u[p][1] : 0; });
        if (u.points && u.points[0] === stamp(now, 'day')) out.points = u.points[1];
        return out;
    }
    function count(service, n = 1, now = Date.now(), points = null) {
        const all = loadUsage();
        const u = all[service] || {};
        ['month', 'day', 'hour', 'minute'].forEach(p => { const s = stamp(now, p); u[p] = [s, (u[p] && u[p][0] === s ? u[p][1] : 0) + n]; });
        if (points != null) u.points = [stamp(now, 'day'), points];
        all[service] = u;
        saveUsage(all);
    }
    // Room left under the free limits ('' when there is room, otherwise why not).
    function limitReached(service, { hasKey = true, now = Date.now() } = {}) {
        const L = (SERVICES[service] || {}).limits || {};
        const u = usage(service, now);
        if (L.month && u.month >= L.month) return `${SERVICES[service].name}'s free allowance for this month is used up`;
        if (L.day && service === 'spoonacular' && (u.points || 0) >= L.day) return 'Spoonacular’s free points for today are used up';
        if (L.day && service !== 'spoonacular' && u.day >= L.day) return `${SERVICES[service].name}'s free allowance for today is used up`;
        const hourly = service === 'usda' && !hasKey ? L.hourNoKey : L.hour;
        if (hourly && u.hour >= hourly) return `${SERVICES[service].name}'s free allowance for this hour is used up`;
        if (L.minute && u.minute >= L.minute) return 'wait a minute';
        return '';
    }
    // "12 of 380 this month" for Settings.
    function usageText(service, { hasKey = true, now = Date.now() } = {}) {
        const L = SERVICES[service].limits;
        const u = usage(service, now);
        if (service === 'spoonacular') return `${Math.round((u.points || 0) * 10) / 10} of 50 points today`;
        if (L.month) return `${u.month} of ${L.month} this month`;
        if (service === 'usda') return `${u.hour} of ${hasKey ? L.hour : L.hourNoKey} this hour`;
        return `${u.day} of ${L.day} today`;
    }

    // === SIGNING (on a phone; the PC signs in backend/services.py) ===
    const pct = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    async function hmacSha1Base64(key, text) {
        const subtle = root.crypto && root.crypto.subtle;
        if (subtle) {
            const enc = new TextEncoder();
            const k = await subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
            const sig = new Uint8Array(await subtle.sign('HMAC', k, enc.encode(text)));
            let bin = '';
            sig.forEach(b => { bin += String.fromCharCode(b); });
            return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
        }
        return require('crypto').createHmac('sha1', key).update(text).digest('base64');
    }
    // OAuth 1.0 (RFC 5849, HMAC-SHA1), the same as backend/services.py oauth1_sign.
    async function oauth1(method, url, params, key, secret, { nonce, timestamp } = {}) {
        const out = Object.assign({}, params, {
            oauth_consumer_key: key, oauth_signature_method: 'HMAC-SHA1',
            oauth_timestamp: timestamp || String(Math.floor(Date.now() / 1000)),
            oauth_nonce: nonce || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), oauth_version: '1.0',
        });
        const norm = Object.keys(out).map(k => [pct(k), pct(out[k])]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
        const base = [method.toUpperCase(), pct(url), pct(norm)].join('&');
        out.oauth_signature = await hmacSha1Base64(`${pct(secret)}&`, base);
        return out;
    }
    const HOSTS = { edamam: 'api.edamam.com', fatsecret: 'platform.fatsecret.com', usda: 'api.nal.usda.gov', spoonacular: 'api.spoonacular.com' };
    // { url, query, headers } with the key added, for a phone that calls the service itself.
    async function authorize(service, { method = 'GET', url, query = {}, headers = {} }, keys) {
        const u = new URL(url);
        if (u.protocol !== 'https:' || u.hostname !== HOSTS[service]) throw new Error(`${service} requests can only go to ${HOSTS[service]}`);
        const base = `https://${u.hostname}${u.pathname}`;
        let q = Object.assign({}, query);
        const h = Object.assign({}, headers);
        if (service === 'edamam') {
            if (!keys.edamam_app_id || !keys.edamam_app_key) throw new Error('Add your free Edamam Application ID and Key in Settings.');
            Object.assign(q, { app_id: keys.edamam_app_id, app_key: keys.edamam_app_key });
        } else if (service === 'fatsecret') {
            if (!keys.fatsecret_key || !keys.fatsecret_secret) throw new Error('Add your free FatSecret Consumer Key and Consumer Secret in Settings.');
            q = await oauth1(method, base, q, keys.fatsecret_key, keys.fatsecret_secret);
        } else if (service === 'usda') q.api_key = keys.usda_api_key || 'DEMO_KEY';
        else if (service === 'spoonacular') {
            if (!keys.spoonacular_api_key) throw new Error('Add your free Spoonacular key in Settings.');
            h['x-api-key'] = keys.spoonacular_api_key;
        }
        const qs = Object.keys(q).map(k => `${pct(k)}=${pct(q[k])}`).join('&');
        return { url: qs ? `${base}?${qs}` : base, headers: h };
    }

    // The keys that unlock a service (all of its key fields, except USDA, which works without one).
    function needsKey(service) { return service !== 'usda'; }

    const api = { SERVICES, PRIVACY, usage, count, limitReached, usageText, oauth1, authorize, needsKey, pct, HOSTS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishServices = api;
})(typeof window !== 'undefined' ? window : globalThis);
