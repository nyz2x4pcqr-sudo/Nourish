// The recipe importer's link handling (importer.js). Page reading needs a browser's DOMParser and is
// tested in the browser and against real sites in CI (mobile/ci/import-live.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../importer.js');

test('social links are recognised, including short and mobile links', () => {
    const cases = {
        'https://www.youtube.com/watch?v=abc': 'youtube', 'https://youtu.be/abc': 'youtube', 'https://m.youtube.com/shorts/abc': 'youtube',
        'https://www.tiktok.com/@a/video/1': 'tiktok', 'https://vm.tiktok.com/xyz/': 'tiktok',
        'https://www.instagram.com/p/xyz/': 'instagram', 'https://www.facebook.com/watch/?v=1': 'facebook', 'https://fb.watch/x': 'facebook',
        'https://www.pinterest.com/pin/1/': 'pinterest', 'https://pin.it/abc': 'pinterest', 'https://www.pinterest.co.uk/pin/1/': 'pinterest',
        'https://www.reddit.com/r/recipes/comments/1/x/': 'reddit', 'https://redd.it/abc': 'reddit',
        'https://www.allrecipes.com/recipe/1/': null, 'https://notyoutube.com/watch': null,
    };
    for (const [url, want] of Object.entries(cases)) assert.equal(I.platformOf(url), want, url);
});

test('a link is found inside shared text and tidied', () => {
    assert.equal(I.normalizeUrl('Look at this! https://youtu.be/abc?si=1).'), 'https://youtu.be/abc?si=1');
    assert.equal(I.normalizeUrl('www.example.com/recipe'), 'https://www.example.com/recipe');
    assert.throws(() => I.normalizeUrl('just some words'));
});

test("YouTube's player data is read even with braces inside strings", () => {
    const html = 'x var ytInitialPlayerResponse = {"videoDetails":{"title":"Chili {easy}","shortDescription":"a \\"quote\\" }"}};var y = 1;';
    const data = I.jsonAfter(html, 'ytInitialPlayerResponse');
    assert.equal(data.videoDetails.title, 'Chili {easy}');
    assert.equal(data.videoDetails.shortDescription, 'a "quote" }');
    assert.equal(I.jsonAfter('nothing here', 'ytInitialPlayerResponse'), null);
});

test('login walls and blocks are recognised; a normal page is not', () => {
    assert.ok(I.looksBlocked(403, ''));
    assert.ok(I.looksBlocked(429, 'lots of text'));
    assert.ok(I.looksBlocked(402, ''));   // how some big recipe sites turn away cloud machines
    assert.ok(I.looksBlocked(503, 'Just a moment...'));
    assert.ok(!I.looksBlocked(404, ''));   // missing, not blocked
    assert.ok(I.looksBlocked(200, 'Log in to see photos and videos from friends.'));
    assert.ok(I.looksBlocked(200, 'Checking your browser before accessing the site'));
    assert.ok(!I.looksBlocked(200, 'Ingredients: 1 cup lentils. Log in to save this recipe to your box. '.repeat(40)));
    assert.ok(!I.looksBlocked(200, 'The Best Dal\nIngredients\n- 1 cup red lentils'));
});

test('times and numbers from recipe data', () => {
    assert.equal(I.isoMinutes('PT1H10M'), 70);
    assert.equal(I.isoMinutes('P0DT45M'), 45);
    assert.equal(I.firstNumber(['4', '4 servings']), 4);
    assert.equal(I.firstNumber('1,200 kcal'), 1200);
    assert.equal(I.firstNumber(null), null);
});
