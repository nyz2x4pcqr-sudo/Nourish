// Run with:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLLMJSON } = require('../json-repair.js');

const plan = { days: [{ day: 1, breakfast: { name: 'Oats', steps: ['Visit http://example.com // not a comment'] } }] };
const clean = JSON.stringify(plan);

test('clean JSON', () => assert.deepEqual(parseLLMJSON(clean), plan));

test('fenced JSON with prose', () => {
    assert.deepEqual(parseLLMJSON('Here you go:\n```json\n' + clean + '\n```\nEnjoy!'), plan);
});

test('trailing commas', () => {
    assert.deepEqual(parseLLMJSON('{"a":[1,2,],"b":{"c":3,},}'), { a: [1, 2], b: { c: 3 } });
});

test('comment lines, without touching // inside strings', () => {
    const text = '{\n  // the plan\n  "days": [ /* day one */ {"day": 1, "breakfast": {"name": "Oats", "steps": ["Visit http://example.com // not a comment"]}} ]\n}';
    assert.deepEqual(parseLLMJSON(text), plan);
});

test('truncated output keeps complete items', () => {
    const full = JSON.stringify({ days: [{ day: 1, x: 'a' }, { day: 2, x: 'b' }, { day: 3, x: 'c' }] });
    const cut = full.slice(0, full.indexOf('"c"') + 1); // cut mid-string inside day 3
    assert.deepEqual(parseLLMJSON(cut), { days: [{ day: 1, x: 'a' }, { day: 2, x: 'b' }] });
});

test('truncated right after a comma', () => {
    assert.deepEqual(parseLLMJSON('{"days":[{"day":1},'), { days: [{ day: 1 }] });
});

test('escaped quotes inside strings', () => {
    assert.deepEqual(parseLLMJSON('{"name":"The \\"best\\" oats"}'), { name: 'The "best" oats' });
});

test('empty and non-JSON input give readable errors', () => {
    assert.throws(() => parseLLMJSON(''), /empty/);
    assert.throws(() => parseLLMJSON(undefined), /empty/);
    assert.throws(() => parseLLMJSON('Sorry, I cannot help with that.'), /did not contain any JSON/);
    assert.throws(() => parseLLMJSON('{"days": ['), /Could not read/);
});
