// Runs the app's recipe importer (importer.js) on real links in Chrome, through the Nourish server.
// There's no AI here, so where the app would ask the AI to read a page or post, this reports how much
// text it would have sent. Prints a Markdown table.
const { chromium } = require('playwright-core');

const LINKS = [
    ['Recipe site', 'https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/'],
    ['Recipe site', 'https://www.budgetbytes.com/one-pot-creamy-cajun-chicken-pasta/'],
    ['Recipe site', 'https://www.seriouseats.com/the-best-slow-cooked-bolognese-sauce-recipe'],
    ['Recipe site', 'https://www.bbcgoodfood.com/recipes/easy-chocolate-cake'],
    ['Recipe site (paywall)', 'https://cooking.nytimes.com/recipes/1015819-chocolate-chip-cookies'],
    ['YouTube', 'https://www.youtube.com/watch?v=PUP7U5vTMM0'],
    ['TikTok', 'https://www.tiktok.com/@scout2015/video/6718335390845095173'],
    ['Reddit', 'REDDIT_TOP'],
    ['Instagram', 'https://www.instagram.com/p/BsOGulcndj-/'],
    ['Facebook', 'https://www.facebook.com/watch/?v=10153231379946729'],
];

(async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://localhost:8000/');
    await page.waitForFunction(() => typeof NourishImport !== 'undefined' && typeof fetchForImport === 'function');
    const rows = [];
    let crashed = 0;
    for (const [kind, link] of LINKS) {
        const r = await page.evaluate(async link => {
            let url = link;
            if (link === 'REDDIT_TOP') {   // a current post from r/recipes
                try {
                    const res = await fetchForImport('https://www.reddit.com/r/recipes/top.json?t=month&limit=5', { browser: false });
                    const post = JSON.parse(res.body).data.children.find(c => c.data && c.data.is_self).data;
                    url = 'https://www.reddit.com' + post.permalink;
                } catch (e) {
                    // Reddit may refuse its data format here; find a post on the plain page instead.
                    try {
                        const res = await fetchForImport('https://old.reddit.com/r/recipes/top/?t=month', { browser: true });
                        const link = new DOMParser().parseFromString(res.body, 'text/html').querySelector('a[href*="/comments/"]');
                        if (!link) return { url: 'r/recipes', result: `couldn't find a post (HTTP ${res.status})`, ok: false };
                        url = new URL(link.getAttribute('href'), 'https://www.reddit.com').href.replace('old.reddit.com', 'www.reddit.com');
                    } catch (e2) { return { url: 'r/recipes', result: `couldn't list posts: ${e2.message}`, ok: false }; }
                }
            }
            let sent = 0;
            const extract = async text => { sent = text.length; return { name: `(the AI would read ${text.length} characters)`, ingredients: ['x'], steps: ['x'] }; };
            const started = Date.now();
            try {
                const r = await NourishImport.importUrl(url, { fetchPage: fetchForImport, extract });
                const recipe = r.recipe;
                return {
                    url, ok: true, seconds: (Date.now() - started) / 1000,
                    result: r.how === 'structured'
                        ? `Recipe data: "${recipe.name}", ${recipe.ingredients.length} ingredients, ${recipe.steps.length} steps${recipe.nutrition ? ', nutrition' : ''}${recipe.servings ? `, serves ${recipe.servings}` : ''}`
                        : `Text for the AI: ${sent} characters (${r.notes.join('; ')})`,
                };
            } catch (e) {
                return { url, ok: false, blocked: !!e.blocked, crashed: !e.blocked && !/HTTP|doesn't exist|No recipe|didn't share|look like a web address|Couldn't load|blocked|timed out|logged in/i.test(e.message), result: (e.blocked ? 'Blocked: ' : 'Error: ') + e.message, seconds: (Date.now() - started) / 1000 };
            }
        }, link);
        if (r.crashed) crashed++;
        rows.push(`| ${kind} | ${r.url.replace(/\|/g, '%7C').slice(0, 80)} | ${r.ok ? '✅' : r.blocked ? '🔒' : r.crashed ? '💥' : '⚠️'} ${r.result.replace(/\|/g, '/')} | ${r.seconds != null ? r.seconds.toFixed(1) + ' s' : ''} |`);
    }
    console.log('## Recipe import from real links\n\n| Kind | Link | Result | Time |\n|---|---|---|---|\n' + rows.join('\n'));
    console.log(`\n✅ read · 🔒 blocked or login-only (the app offers paste/screenshot) · ⚠️ site error · 💥 import code crashed\n`);
    if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
    await browser.close();
    if (crashed || errors.length) process.exit(1);
})();
