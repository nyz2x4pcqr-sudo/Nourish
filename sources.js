// The recipe source registry: every place Nourish looks for real, tested recipes, in one list.
// To add a site, add one line here. Each entry says how to find recipes on it:
//   search: 'wp'      WordPress search (the site's own /wp-json search; small, fast, no key)
//           'page'    the site's own search page, read for links to recipe pages ({q} = the words)
//           'sitemap' the site's recipe sitemap (a list of every recipe address; cached for a week)
//           'web'     a web search limited to this site (DuckDuckGo, or Brave with a key)
//           'api'     a recipe API (handled in planner.js)
// Recipe pages are read with the link importer's structured-data reader (importer.js), the same
// recipe data these sites publish for search engines.
// healthy: the site focuses on lighter cooking (preferred when the goal is Lose).
// nutrition: the site publishes nutrition per serving (cross-checked against our own numbers).
// status: 'ok' = checked (robots.txt, terms, recipe data) and used by default; 'dropped' = kept here
// with the reason, so it isn't added again by mistake. See SOURCES.md for the checks.
(function (root) {
    'use strict';

    const SOURCES = [
        // --- APIs ---
        { id: 'themealdb', name: 'TheMealDB', kind: 'api', group: 'api', status: 'ok', note: 'Free recipe database, no key needed.' },
        { id: 'spoonacular', name: 'Spoonacular', kind: 'api', group: 'api', status: 'ok', needsKey: 'spoonacular_api_key', nutrition: true, note: 'Large recipe database with nutrition. Needs a free key.' },

        // --- your own files ---
        { id: 'library', name: 'Your recipe library', kind: 'library', group: 'library', status: 'ok', note: 'Recipes from the files in your Nourish folders.' },
    ];

    // Sites, filled in from the checks (see SOURCES.md). Kept as a separate list so the checks can
    // read it too (mobile/ci/sources-check.js).
    const SITES = [];

    function all() { return SOURCES.concat(SITES); }
    function byId(id) { return all().find(s => s.id === id) || null; }
    function hostMatches(site, host) {
        host = String(host || '').toLowerCase().replace(/^www\./, '');
        return (site.domains || [site.domain]).some(d => d && (host === d || host.endsWith('.' + d)));
    }
    function siteForUrl(url) {
        let host = '';
        try { host = new URL(url).hostname; } catch (e) { return null; }
        return SITES.find(s => hostMatches(s, host)) || null;
    }

    const api = { SOURCES, SITES, all, byId, siteForUrl, hostMatches };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishSources = api;
})(typeof window !== 'undefined' ? window : globalThis);
