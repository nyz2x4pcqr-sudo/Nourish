// The app runs inside phone browsers that may be a few years old: the Android app's WebView
// (minimum Android 8) and the iPhone app (minimum iOS 15). A single unsupported feature stops
// the whole script, so the page stays blank. This guards against features newer than
// Chrome 80 / Safari 15.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['app.js', 'ondevice.js', 'json-repair.js', 'grocery.js', 'mobile/shared/connect.html'];
const TOO_NEW = [
    [/\|\|=|&&=|\?\?=/, 'logical assignment (||=, &&=, ??=): Chrome 85'],
    [/\(\?<[=!]/, 'regex lookbehind: Safari 16.4'],
    [/\.replaceChildren\(/, 'Element.replaceChildren(): Chrome 86 (use setChildren)'],
    [/\.replaceAll\(/, 'String.replaceAll(): Chrome 85'],
    [/\.at\(-?\d/, 'Array/String .at(): Chrome 92, Safari 15.4'],
    [/structuredClone\(|Object\.hasOwn\(|\.findLast(Index)?\(|\.toSorted\(/, 'post-2021 built-ins'],
    [/^\s*static\s*\{/m, 'class static blocks'],
];

for (const file of FILES) {
    test(`${file} avoids features too new for older phones`, () => {
        const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
            .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
        for (const [pattern, what] of TOO_NEW) {
            const m = code.match(pattern);
            assert.equal(m, null, `${file} uses ${what}: "${m && code.slice(Math.max(0, m.index - 30), m.index + 30)}"`);
        }
    });
}
