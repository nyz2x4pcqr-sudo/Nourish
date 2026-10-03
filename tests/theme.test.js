// Themes (theme.js): every preset, background, accent and custom colour keeps text readable.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../theme.js');

function checkReadable(v, label) {
    const C = T.contrast;
    assert.ok(C(v['--text'], v['--bg']) >= 7, `${label}: text on background ${C(v['--text'], v['--bg']).toFixed(2)}`);
    assert.ok(C(v['--text'], v['--surface']) >= 7, `${label}: text on cards`);
    assert.ok(C(v['--text-2'], v['--surface']) >= 4.5, `${label}: secondary text ${C(v['--text-2'], v['--surface']).toFixed(2)}`);
    assert.ok(C(v['--text-3'], v['--surface-2']) >= 3, `${label}: faint text ${C(v['--text-3'], v['--surface-2']).toFixed(2)}`);
    assert.ok(C(v['--accent-text'], v['--surface']) >= 4.5, `${label}: accent text ${C(v['--accent-text'], v['--surface']).toFixed(2)}`);
}

test('every preset, background and accent is readable', () => {
    for (const [id, t] of Object.entries(T.THEMES)) {
        for (const bg of t.bgs) {
            for (const accent of Object.keys(T.ACCENTS)) {
                const r = T.resolve({ theme: id, bg, accent }, false);
                assert.equal(r.mode, t.mode, `${id} ${bg}`);
                checkReadable(r.vars, `${id} ${bg} ${accent}`);
            }
        }
    }
});

test('the original dark and light themes keep their exact colours', () => {
    const dark = T.resolve({ theme: 'dark' }).vars;
    assert.equal(dark['--bg'], '#0C0B0A');
    assert.equal(dark['--surface'], '#161412');
    assert.equal(dark['--text'], '#F6EFE6');
    const light = T.resolve({ theme: 'light' }).vars;
    assert.equal(light['--bg'], '#F5EFE6');
    assert.equal(light['--text'], '#1F1913');
    assert.equal(T.resolve({ theme: 'system' }, true).theme, 'paper');
    assert.equal(T.resolve({ theme: 'system' }, false).theme, 'ember');
    assert.equal(T.resolve({ theme: 'oled' }).vars['--bg'], '#000000');
});

test('a custom background that would be hard to read is fixed, and says so', () => {
    for (const bg of ['#777777', '#808080', '#3366CC', '#FF0000', '#FFFF00', '#123456', '#FFFFFF', '#000000', '#8A9A5B']) {
        const r = T.resolve({ theme: 'ember', custom_bg: bg }, false);
        checkReadable(r.vars, `custom ${bg}`);
        if (bg === '#777777' || bg === '#808080') assert.ok(r.notes.length > 0, `no note for ${bg}`);
    }
});

test('a custom accent gets matching shades and readable text on buttons', () => {
    for (const a of ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#222222', '#EEEEEE']) {
        for (const theme of ['ember', 'paper']) {
            const r = T.resolve({ theme, accent: 'custom', custom_accent: a });
            assert.equal(r.vars['--accent'], a);
            checkReadable(r.vars, `${theme} accent ${a}`);
            assert.ok(T.contrast(r.vars['--on-accent'], a) >= 3 || r.notes.length, `button text on ${a}`);
        }
    }
});
