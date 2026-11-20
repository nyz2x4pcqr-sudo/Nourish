// Importing a recipe that's already in the Cookbook: the same page is recognised however the link
// was shared (importer.js linkKey / sameLink), so it isn't saved twice by accident.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../importer.js');

test('the same page with tracking tags, www, http, a trailing slash or an #anchor is the same link', () => {
    assert.ok(I.sameLink('https://www.example.com/recipes/lemon-chicken/?utm_source=pinterest&utm_medium=social', 'http://example.com/recipes/lemon-chicken'));
    assert.ok(I.sameLink('https://example.com/recipes/lemon-chicken#recipe-card', 'https://example.com/recipes/lemon-chicken/'));
    assert.ok(I.sameLink('https://m.example.com/recipes/lemon-chicken?fbclid=abc123', 'https://example.com/recipes/lemon-chicken'));
    assert.ok(I.sameLink('https://www.instagram.com/reel/C0abc/?igsh=xyz', 'https://instagram.com/reel/C0abc'));
    assert.ok(I.sameLink('Look at this! https://example.com/recipes/lemon-chicken?utm_campaign=x', 'example.com/recipes/lemon-chicken'));
});

test('a query that picks the page still matters: different videos and posts are different recipes', () => {
    assert.ok(I.sameLink('https://m.youtube.com/watch?v=abc123&si=share', 'https://www.youtube.com/watch?v=abc123'));
    assert.ok(!I.sameLink('https://www.youtube.com/watch?v=abc123', 'https://www.youtube.com/watch?v=def456'));
    assert.ok(!I.sameLink('https://example.com/?p=12', 'https://example.com/?p=13'));
    assert.ok(!I.sameLink('https://example.com/recipes/lemon-chicken', 'https://example.com/recipes/lime-chicken'));
});

test('nothing and nonsense never match', () => {
    assert.equal(I.linkKey(''), '');
    assert.equal(I.linkKey('not a link'), '');
    assert.ok(!I.sameLink('', ''));
    assert.ok(!I.sameLink(null, undefined));
});
