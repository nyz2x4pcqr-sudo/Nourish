// Model ranking for the phone apps: each phone gets its own top-5 list that fits its memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rankModels, assessModel, compareVersions, MODEL_CATALOG, stripThinking } = require('../ondevice.js');

const GB = 1024 ** 3;
const phones = {
    'iPhone 16 Pro (normal limit)': { platform: 'ios', ram: 8 * GB, usable: 3.4 * GB, disk_free: 50 * GB, thermal: 'nominal' },
    'iPhone 16 Pro (LiveContainer, more RAM)': { platform: 'ios', ram: 8 * GB, usable: 6.2 * GB, disk_free: 50 * GB, thermal: 'nominal' },
    'Older Android, 4 GB': { platform: 'android', ram: 4 * GB, usable: 1.6 * GB, disk_free: 8 * GB, thermal: 'nominal' },
    'Flagship Android, 16 GB': { platform: 'android', ram: 16 * GB, usable: 11 * GB, disk_free: 200 * GB, thermal: 'nominal' },
};
const ranked = Object.fromEntries(Object.entries(phones).map(([k, s]) => [k, rankModels(s)]));

test('every phone gets at most 5 picks, none of them too big', () => {
    for (const [name, r] of Object.entries(ranked)) {
        assert.ok(r.top.length >= 1 && r.top.length <= 5, name);
        for (const m of r.top) assert.notEqual(m.a.fit, 'too-big', `${name}: ${m.name}`);
        assert.equal(r.top[0].tags[0][0], 'Recommended', name);
    }
});

test('a phone with more memory gets bigger models than a small phone', () => {
    const small = ranked['Older Android, 4 GB'].top;
    const big = ranked['Flagship Android, 16 GB'].top;
    assert.ok(Math.max(...big.map(m => m.size)) > Math.max(...small.map(m => m.size)));
    assert.ok(small.every(m => m.size < 1.5 * GB), 'a 4 GB phone only gets small models');
    assert.ok(big.some(m => m.id === 'qwen35-9b'), 'a 16 GB phone can run the 9B model');
});

test('LiveContainer\'s higher memory limit unlocks bigger models on the same iPhone', () => {
    const normal = ranked['iPhone 16 Pro (normal limit)'];
    const boosted = ranked['iPhone 16 Pro (LiveContainer, more RAM)'];
    assert.ok(normal.tooBig.length > boosted.tooBig.length);
    assert.notDeepEqual(normal.top.map(m => m.id), boosted.top.map(m => m.id));
});

test('a hot phone marks models as "May get warm"', () => {
    const hot = rankModels(Object.assign({}, phones['Flagship Android, 16 GB'], { thermal: 'serious' }));
    assert.ok(hot.top.every(m => m.tags.some(t => t[0] === 'May get warm')));
});

test('not enough storage is flagged', () => {
    const m = MODEL_CATALOG.find(x => x.id === 'qwen35-9b');
    assert.equal(assessModel(m, Object.assign({}, phones['Flagship Android, 16 GB'], { disk_free: 2 * GB })).noDisk, true);
});

test('version comparison orders pre-releases before releases', () => {
    assert.ok(compareVersions('0.4.0-pre-alpha', '0.3.0-pre-alpha') > 0);
    assert.ok(compareVersions('0.3.0', '0.3.0-beta') > 0);
    assert.ok(compareVersions('v0.3.0-pre-alpha', '0.3.0-pre-alpha') === 0);
    assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
});

test('thinking is removed from replies', () => {
    assert.equal(stripThinking('<think>hmm\nok</think>\nHello'), 'Hello');
    assert.equal(stripThinking('Hello'), 'Hello');
});

test('catalog entries are complete', () => {
    for (const m of MODEL_CATALOG) {
        assert.match(m.file, /\.gguf$/);
        assert.match(m.repo, /^[\w.-]+\/[\w.-]+$/);
        assert.ok(m.size > 1e8 && m.params > 0 && m.quality > 0, m.id);
    }
});
