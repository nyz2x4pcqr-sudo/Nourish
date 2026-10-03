// The app's scripts share one page: a name declared twice at the top level of two files stops the
// second file loading in the browser (this happened with DAY_WORDS). Every script in index.html is
// checked together, in order, as the browser loads them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('all the page scripts can load together (no name declared twice)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const files = [...html.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1]);
    assert.ok(files.length >= 15, files.join(', '));
    // Top-level const/let/class/function names per file; any name in two files is a clash.
    const seen = {};
    files.forEach(f => {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f);
        for (const m of src.matchAll(/^(?:const|let|class|async function|function)\s+([A-Za-z_$][\w$]*)/gm)) {
            assert.ok(!seen[m[1]] || seen[m[1]] === f, `"${m[1]}" is declared in both ${seen[m[1]]} and ${f}`);
            seen[m[1]] = f;
        }
    });
});
