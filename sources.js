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
// meals: the meals a site has enough of (searched only for those); veg: a vegetarian site (no meat
// searches); terms: the site's own search words per meal. Checked with tools/sites-diagnose.js.
// status: 'ok' = checked (robots.txt, terms, recipe data) and used by default; 'dropped' = kept here
// with the reason, so it isn't added again by mistake. See SOURCES.md for the checks.
(function (root) {
    'use strict';

    const SOURCES = [
        // --- APIs ---
        { id: 'themealdb', name: 'TheMealDB', kind: 'api', group: 'api', status: 'ok', note: 'Free recipe database, no key needed.' },
        { id: 'spoonacular', name: 'Spoonacular', kind: 'api', group: 'api', status: 'ok', needsKey: 'spoonacular_api_key', nutrition: true, note: 'Large recipe database with nutrition. Needs a free key.' },

        // --- Nourish's own recipes (builtins.js): always there, offline too ---
        { id: 'builtin', name: 'Nourish kitchen', kind: 'builtin', group: 'builtin', status: 'ok', note: 'Nourish\'s own tested recipes, built into the app. Work offline.' },

        // --- your own files ---
        { id: 'library', name: 'Your recipe library', kind: 'library', group: 'library', status: 'ok', note: 'Recipes from the files in your Nourish folders.' },
    ];

    // Sites, filled in from the checks (see SOURCES.md). Kept as a separate list so the checks can
    // read it too (tools/sources-check.js).
    const SITES = [
        { id: 'skinnytaste', name: 'Skinnytaste', domain: 'skinnytaste.com', group: 'healthy', search: 'wp', healthy: true, nutrition: true, status: 'ok' },
        { id: 'budgetbytes', name: 'Budget Bytes', domain: 'budgetbytes.com', group: 'healthy', search: 'wp', nutrition: true, status: 'dropped', why: 'refuses the app\'s searches and recipe pages (403), on phones and servers' },
        { id: 'cookieandkate', name: 'Cookie and Kate', domain: 'cookieandkate.com', group: 'healthy', search: 'wp', healthy: true, nutrition: true, status: 'dropped', why: 'refuses the app\'s searches and recipe pages (403), on phones and servers' },
        { id: 'minimalistbaker', name: 'Minimalist Baker', domain: 'minimalistbaker.com', group: 'healthy', search: 'wp', veg: true, healthy: true, nutrition: true, status: 'ok' },
        { id: 'loveandlemons', name: 'Love and Lemons', domain: 'loveandlemons.com', group: 'healthy', search: 'wp', veg: true, healthy: true, nutrition: true, status: 'ok' },
        { id: 'wellplated', name: 'Well Plated', domain: 'wellplated.com', group: 'healthy', search: 'wp', healthy: true, nutrition: true, status: 'ok' },
        { id: 'ambitiouskitchen', name: 'Ambitious Kitchen', domain: 'ambitiouskitchen.com', group: 'healthy', search: 'wp', healthy: true, nutrition: true, status: 'dropped', why: 'refuses the app\'s recipe pages (403)' },
        { id: 'pinchofyum', name: 'Pinch of Yum', domain: 'pinchofyum.com', group: 'healthy', search: 'wp', status: 'dropped', why: 'refuses the app\'s recipe pages (405, a bot check)' },
        { id: 'recipetineats', name: 'RecipeTin Eats', domain: 'recipetineats.com', group: 'general', search: 'wp', meals: ['lunch', 'dinner'], nutrition: true, status: 'ok' },
        { id: 'hotthaikitchen', name: 'Hot Thai Kitchen', domain: 'hot-thai-kitchen.com', group: 'world', search: 'wp', status: 'dropped', why: 'refuses the app\'s searches and recipe pages (403)' },
        { id: 'mexicoinmykitchen', name: 'Mexico in My Kitchen', domain: 'mexicoinmykitchen.com', group: 'world', search: 'wp', nutrition: true, status: 'dropped', why: 'refuses the app\'s recipe pages (403)' },
        { id: 'mediterraneandish', name: 'The Mediterranean Dish', domain: 'themediterraneandish.com', group: 'world', search: 'wp', healthy: true, nutrition: true, status: 'dropped', why: 'refuses the app\'s recipe pages (403)' },
        { id: 'feelgoodfoodie', name: 'FeelGoodFoodie', domain: 'feelgoodfoodie.net', group: 'healthy', search: 'sitemap', sitemap: 'https://feelgoodfoodie.net/recipe-sitemap.xml', healthy: true, nutrition: true, status: 'dropped', why: 'refuses the app\'s recipe pages (403); its 1.7 MB sitemap was downloaded on every plan for nothing' },
        { id: 'thehealthymaven', name: 'The Healthy Maven', domain: 'thehealthymaven.com', group: 'healthy', search: 'wp', healthy: true, nutrition: true, status: 'ok' },
        { id: 'cafedelites', name: 'Cafe Delites', domain: 'cafedelites.com', group: 'general', search: 'wp', meals: ['lunch', 'dinner'], nutrition: true, status: 'ok' },
        { id: 'spendwithpennies', name: 'Spend With Pennies', domain: 'spendwithpennies.com', group: 'general', search: 'wp', meals: ['lunch', 'dinner'], nutrition: true, status: 'ok' },
        { id: 'seonkyoung', name: 'Seonkyoung Longest', domain: 'seonkyounglongest.com', group: 'world', search: 'wp', terms: { breakfast: ['egg', 'porridge', 'toast'], lunch: ['rice bowl', 'noodles', 'kimbap', 'salad', 'soup'], dinner: ['chicken', 'beef', 'pork', 'tofu', 'stir fry', 'noodles'] }, nutrition: true, status: 'ok' },
        { id: 'isabeleats', name: 'Isabel Eats', domain: 'isabeleats.com', group: 'world', search: 'wp', nutrition: true, status: 'dropped', why: 'refuses the app\'s recipe pages (403)' },
        // --- Checked for 0.2 with the new ways of finding recipes (search pages, category pages, sitemaps, feeds) ---
        { id: 'swasthi', name: 'Swasthi\'s Indian Healthy Recipes', domain: 'indianhealthyrecipes.com', group: 'world', find: ['category'], healthy: true, nutrition: true, status: 'ok',
            categories: { breakfast: ['/recipes/indian-breakfast/', '/recipes/indian-breakfast/page/{page}/'], lunch: ['/recipes/rice/', '/recipes/dal/'], dinner: ['/recipes/curry/', '/recipes/chicken/', '/recipes/paneer/'] },
            recipePath: '^/(?!recipes/|category/|tag/|page/|about|contact)[a-z0-9-]{8,}/$' },
        { id: 'bbcgoodfood', name: 'BBC Good Food', domain: 'bbcgoodfood.com', group: 'general', find: ['category', 'rss'], healthy: true, nutrition: true, status: 'ok',
            categories: { breakfast: ['/recipes/collection/healthy-breakfast-recipes', '/recipes/collection/breakfast-recipes'], lunch: ['/recipes/collection/healthy-lunch-recipes', '/recipes/collection/lunch-recipes'],
                dinner: ['/recipes/collection/healthy-dinner-recipes', '/recipes/collection/quick-healthy-dinner-recipes', '/recipes/collection/family-meal-recipes'] },
            feed: 'https://www.bbcgoodfood.com/feed', recipePath: '^/recipes/(?!collection|category)[a-z0-9-]+/?$' },
        { id: 'olivemagazine', name: 'olive magazine', domain: 'olivemagazine.com', group: 'general', find: ['category', 'rss'], status: 'ok',
            categories: { breakfast: ['/recipes/breakfast/', '/recipes/collection/best-ever-brunch-recipes/'], lunch: ['/recipes/collection/healthy-lunch-ideas/', '/recipes/collection/best-ever-salad-recipes/'], dinner: ['/recipes/collection/easy-30-minute-meals/', '/recipes/healthy/'] },
            feed: 'https://www.olivemagazine.com/feed', recipePath: '^/recipes/(?!collection/)[a-z-]+/[a-z0-9-]+/?$' },
        { id: 'jamieoliver', name: 'Jamie Oliver', domain: 'jamieoliver.com', group: 'general', find: ['category'], status: 'ok',
            categories: { breakfast: ['/recipes/course/breakfast-brunch/'], lunch: ['/recipes/course/quick-and-easy/', '/recipes/vegetables/salad/'], dinner: ['/recipes/course/mains/', '/recipes/chicken/'] },
            recipePath: '^/recipes/(?!course/|special-diets/|category/)[a-z0-9-]+/[a-z0-9-]+/?$' },
        { id: 'sbsfood', name: 'SBS Food', domain: 'sbs.com.au', group: 'world', find: ['category'], status: 'ok',
            categories: { any: ['https://www.sbs.com.au/food', 'https://www.sbs.com.au/food/recipes'] }, recipePath: '^/food/recipe/' },
        { id: 'gousto', name: 'Gousto', domain: 'gousto.co.uk', group: 'mealkit', find: ['category'], meals: ['lunch', 'dinner'], status: 'ok',
            categories: { lunch: ['/cookbook/quick-and-easy-recipes', '/cookbook/healthy-recipes'], dinner: ['/cookbook/chicken-recipes', '/cookbook/vegetarian-recipes', '/cookbook/fish-recipes', '/cookbook/beef-recipes'] },
            recipePath: '^/cookbook/(recipes|[a-z-]+-recipes)/[a-z0-9-]+/?$' },
        { id: 'bhf', name: 'British Heart Foundation', domain: 'bhf.org.uk', group: 'public-health', find: ['sitemap'], healthy: true, nutrition: true, status: 'ok',
            sitemap: 'https://www.bhf.org.uk/sitemap.xml', recipePath: '/recipe-finder/[a-z0-9-]+$' },
        { id: 'diabetesuk', name: 'Diabetes UK', domain: 'diabetes.org.uk', group: 'public-health', find: ['category'], healthy: true, nutrition: true, status: 'ok',
            categories: { any: ['/living-with-diabetes/eating/recipes', '/living-with-diabetes/eating/recipes?page={page}'] }, recipePath: '/recipes/[a-z0-9-]+$' },
        { id: 'diabetesfoodhub', name: 'Diabetes Food Hub', domain: 'diabetesfoodhub.org', group: 'public-health', find: ['category'], healthy: true, nutrition: true, status: 'ok',
            categories: { breakfast: ['/recipes/breakfast-and-brunch'], lunch: ['/recipes/salads', '/recipes/soups-stews'], dinner: ['/recipes/main-dishes', '/recipes/veggie-rich'] },
            recipePath: '^/recipes/(?!breakfast-and-brunch|kidney-friendly|vegan-vegetarian|lower-carb|veggie-rich|budget-friendly|main-dishes|salads|soups-stews|snacks|desserts|side-dishes|beverages)[a-z0-9-]+$' },
        { id: 'heartandstroke', name: 'Heart & Stroke Foundation', domain: 'heartandstroke.ca', group: 'public-health', find: ['category'], healthy: true, status: 'ok',
            categories: { breakfast: ['/healthy-living/recipes/breakfast'], lunch: ['/healthy-living/recipes/salads', '/healthy-living/recipes/soups'], dinner: ['/healthy-living/recipes/main-dishes', '/healthy-living/recipes/fish-and-seafood'] },
            recipePath: '^/healthy-living/recipes/[a-z-]+/[a-z0-9-]+$' },
        { id: 'canadafoodguide', name: 'Canada\'s Food Guide', domain: 'food-guide.canada.ca', group: 'public-health', find: ['sitemap'], healthy: true, status: 'ok',
            sitemap: 'https://food-guide.canada.ca/sitemap.xml', recipePath: '^/en/recipes/[a-z0-9-]+/?$' },
        { id: 'bbcfood', name: 'BBC Food', domain: 'bbc.co.uk', group: 'general', find: ['sitemap'], status: 'ok',
            sitemap: 'https://www.bbc.co.uk/food/sitemap.xml', recipePath: '^/food/recipes/[a-z0-9_]+$' },
        { id: 'hellofresh', name: 'HelloFresh', domain: 'hellofresh.com', group: 'mealkit', status: 'dropped', why: 'terms forbid robots and scrapers (section 16.7)' },
        { id: 'everyplate', name: 'EveryPlate', domain: 'everyplate.com', group: 'mealkit', status: 'dropped', why: 'terms forbid robots and scrapers (same terms as HelloFresh)' },
        { id: 'greenchef', name: 'Green Chef', domain: 'greenchef.com', group: 'mealkit', status: 'dropped', why: 'terms forbid robots and scrapers (same terms as HelloFresh)' },
        { id: 'homechef', name: 'Home Chef', domain: 'homechef.com', group: 'mealkit', status: 'dropped', why: 'terms forbid robots, spiders and scrapers' },
        { id: 'blueapron', name: 'Blue Apron', domain: 'blueapron.com', group: 'mealkit', status: 'dropped', why: 'refuses automated requests (403), no readable recipe data' },
        { id: 'marleyspoon', name: 'Marley Spoon', domain: 'marleyspoon.com', group: 'mealkit', status: 'dropped', why: 'recipes are behind the menu/login; search only finds blog posts' },
        { id: 'dinnerly', name: 'Dinnerly', domain: 'dinnerly.com', group: 'mealkit', status: 'dropped', why: 'recipes are behind the menu/login; search only finds blog posts' },
        { id: 'eatingwell', name: 'EatingWell', domain: 'eatingwell.com', group: 'healthy', status: 'dropped', why: 'terms (People Inc.) forbid scrapers and robots' },
        { id: 'allrecipes', name: 'Allrecipes', domain: 'allrecipes.com', group: 'general', status: 'dropped', why: 'terms (People Inc.) forbid scrapers and robots' },
        { id: 'seriouseats', name: 'Serious Eats', domain: 'seriouseats.com', group: 'general', status: 'dropped', why: 'terms (People Inc.) forbid scrapers and robots' },
        { id: 'simplyrecipes', name: 'Simply Recipes', domain: 'simplyrecipes.com', group: 'general', status: 'dropped', why: 'terms (People Inc.) forbid scrapers and robots' },
        { id: 'epicurious', name: 'Epicurious', domain: 'epicurious.com', group: 'general', status: 'dropped', why: 'terms (Condé Nast) forbid crawling and scraping' },
        { id: 'delish', name: 'Delish', domain: 'delish.com', group: 'general', status: 'dropped', why: 'terms (Hearst) forbid robots and crawlers; many recipes are members-only' },
        { id: 'tasteofhome', name: 'Taste of Home', domain: 'tasteofhome.com', group: 'general', status: 'dropped', why: 'terms (Trusted Media Brands) forbid data mining and robots' },
        { id: 'tasty', name: 'Tasty', domain: 'tasty.co', group: 'general', status: 'dropped', why: 'terms (BuzzFeed) forbid automated access' },
        { id: 'downshiftology', name: 'Downshiftology', domain: 'downshiftology.com', group: 'healthy', status: 'dropped', why: 'terms forbid AI and automated access' },
        { id: 'foodnetwork', name: 'Food Network', domain: 'foodnetwork.com', group: 'general', status: 'dropped', why: 'robots.txt refuses automated readers (403)' },
        { id: 'thekitchn', name: 'The Kitchn', domain: 'thekitchn.com', group: 'general', status: 'dropped', why: 'terms forbid robots and scraping; refuses automated requests' },
        { id: 'food52', name: 'Food52', domain: 'food52.com', group: 'general', status: 'dropped', why: 'refuses automated requests (429)' },
        { id: 'justonecookbook', name: 'Just One Cookbook', domain: 'justonecookbook.com', group: 'world', status: 'dropped', why: 'refuses automated requests' },
        { id: 'thewoksoflife', name: 'The Woks of Life', domain: 'thewoksoflife.com', group: 'world', status: 'dropped', why: 'refuses automated requests (403)' },
        { id: 'maangchi', name: 'Maangchi', domain: 'maangchi.com', group: 'world', status: 'dropped', why: 'refuses automated requests (403)' },
        { id: 'vegrecipesofindia', name: 'Dassana\'s Veg Recipes', domain: 'vegrecipesofindia.com', group: 'world', status: 'dropped', why: 'refuses automated requests (403)' },
        { id: 'eatingbirdfood', name: 'Eating Bird Food', domain: 'eatingbirdfood.com', group: 'healthy', status: 'dropped', why: 'refuses automated requests (403)' },
        { id: 'gimmesomeoven', name: 'Gimme Some Oven', domain: 'gimmesomeoven.com', group: 'general', status: 'dropped', why: 'refuses automated requests (403)' },
        { id: 'sallysbakingaddiction', name: 'Sally\'s Baking Addiction', domain: 'sallysbakingaddiction.com', group: 'general', status: 'dropped', why: 'refuses automated requests (403); mostly baking' },
        { id: 'myplate', name: 'MyPlate Kitchen (USDA)', domain: 'myplate.gov', group: 'public-health', status: 'dropped', why: 'robots.txt refuses automated readers (403)' },
        { id: 'nhlbi', name: 'NHLBI Heart-Healthy Recipes', domain: 'nhlbi.nih.gov', group: 'public-health', status: 'dropped', why: 'recipe pages have no recipe data to read' },
        { id: 'nhs', name: 'NHS Healthier Families', domain: 'nhs.uk', group: 'public-health', status: 'dropped', why: 'recipe pages carry no recipe data the app can read (checked again for 0.2)' },
        { id: 'aha', name: 'American Heart Association', domain: 'heart.org', group: 'public-health', status: 'dropped', why: 'refuses automated requests (403)' },
        { id: 'mayoclinic', name: 'Mayo Clinic', domain: 'mayoclinic.org', group: 'public-health', status: 'dropped', why: 'refuses automated requests (403)' },
    ];

    function all() { return SOURCES.concat(SITES); }
    function usable() { return SITES.filter(s => s.status === 'ok'); }
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

    const api = { SOURCES, SITES, all, usable, byId, siteForUrl, hostMatches };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishSources = api;
})(typeof window !== 'undefined' ? window : globalThis);
