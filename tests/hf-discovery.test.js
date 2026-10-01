// Live model discovery: the phone asks Hugging Face, then ranks what fits. Uses canned API answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverModels, rankModels, pickQuant, paramsFromName, prettyModelName, baseKey } = require('../ondevice.js');

const GB = 1024 ** 3;
const recent = new Date(Date.now() - 60 * 864e5).toISOString();
const old = '2023-01-01T00:00:00.000Z';
const repos = [
    { id: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', downloads: 1200000, tags: ['base_model:quantized:Qwen/Qwen3-4B-Instruct-2507'], createdAt: recent },
    { id: 'bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF', downloads: 40000, tags: ['base_model:quantized:Qwen/Qwen3-4B-Instruct-2507'], createdAt: recent },
    { id: 'bartowski/Llama-3.2-1B-Instruct-GGUF', downloads: 105000, tags: ['base_model:quantized:meta-llama/Llama-3.2-1B-Instruct'], createdAt: old },
    { id: 'unsloth/Qwen3.5-2B-GGUF', downloads: 320000, tags: ['base_model:quantized:Qwen/Qwen3.5-2B'], createdAt: recent },
    { id: 'unsloth/Qwen3.5-0.8B-GGUF', downloads: 200000, tags: [], createdAt: recent },
    { id: 'unsloth/Qwen3.5-9B-GGUF', downloads: 1300000, tags: [], createdAt: recent },
    { id: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', downloads: 9000000, tags: [], createdAt: recent },
    { id: 'someone/Llama-3.2-3B-Instruct-uncensored-GGUF', downloads: 90000, tags: [], createdAt: recent },
    { id: 'nomic-ai/nomic-embed-text-v1.5-GGUF', downloads: 500000, tags: [], createdAt: recent },
    { id: 'unsloth/gemma-4-E4B-it-GGUF', downloads: 600000, tags: [], createdAt: recent },
    { id: 'unsloth/Qwen3.8-27B-GGUF', downloads: 6000000, tags: [], createdAt: recent },
];
const sizes = { // file sizes by repo, Q4_K_M and a smaller Q3_K_M
    'unsloth/Qwen3-4B-Instruct-2507-GGUF': [2.33, 1.9], 'bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF': [2.33, 1.9],
    'bartowski/Llama-3.2-1B-Instruct-GGUF': [0.75, 0.6], 'unsloth/Qwen3.5-2B-GGUF': [1.19, 0.95], 'unsloth/Qwen3.5-0.8B-GGUF': [0.5, 0.4],
    'unsloth/Qwen3.5-9B-GGUF': [5.29, 4.35], 'unsloth/gemma-4-E4B-it-GGUF': [4.64, 3.9], 'unsloth/Qwen3.8-27B-GGUF': [16, 13],
};
const calls = [];
function fakeHF(url) {
    calls.push(url);
    const tree = url.match(/\/api\/models\/(.+)\/tree\/main$/);
    if (tree) {
        const [q4, q3] = sizes[tree[1]];
        const base = tree[1].split('/')[1].replace(/-GGUF$/, '');
        return Promise.resolve([
            { type: 'file', path: `${base}-Q4_K_M.gguf`, size: 1000, lfs: { size: Math.round(q4 * GB) } },
            { type: 'file', path: `${base}-Q3_K_M.gguf`, size: 1000, lfs: { size: Math.round(q3 * GB) } },
            { type: 'file', path: 'mmproj-F16.gguf', size: 900000000 },
            { type: 'file', path: 'README.md', size: 10 },
        ]);
    }
    return Promise.resolve(repos);
}
const phones = {
    oldAndroid: { platform: 'android', ram: 4 * GB, usable: 1.6 * GB, disk_free: 20 * GB, thermal: 'nominal' },
    iphoneLiveContainer: { platform: 'ios', ram: 8 * GB, usable: 6.2 * GB, disk_free: 50 * GB, thermal: 'nominal' },
    bigAndroid: { platform: 'android', ram: 16 * GB, usable: 11 * GB, disk_free: 200 * GB, thermal: 'nominal' },
};

test('asks Hugging Face for chat models in the GGUF format, then reads real file sizes', async () => {
    calls.length = 0;
    await discoverModels(phones.iphoneLiveContainer, { fetchJSON: fakeHF, force: true });
    assert.ok(calls.some(u => /filter=gguf/.test(u) && /filter=conversational/.test(u) && /sort=downloads/.test(u)));
    assert.ok(calls.some(u => /sort=trendingScore/.test(u)));
    assert.ok(calls.some(u => /\/tree\/main$/.test(u)));
});

test('drops code, embedding, uncensored and far-too-big models, and duplicates of the same model', async () => {
    const r = await discoverModels(phones.bigAndroid, { fetchJSON: fakeHF, force: true });
    const ids = r.models.map(m => m.repo);
    assert.ok(!ids.some(id => /Coder|embed|uncensored|27B/i.test(id)), ids.join());
    assert.equal(ids.filter(id => /Qwen3-4B-Instruct-2507/.test(id)).length, 1, 'one copy of each model');
    assert.ok(ids.includes('unsloth/Qwen3-4B-Instruct-2507-GGUF'), 'keeps the most-downloaded copy');
    assert.ok(r.models.every(m => !/mmproj/.test(m.file)));
});

test('each phone gets its own top 5, and everything in it fits', async () => {
    const tops = {};
    for (const [name, specs] of Object.entries(phones)) {
        const live = await discoverModels(specs, { fetchJSON: fakeHF, force: true });
        const ranked = rankModels(specs, live.models);
        assert.ok(ranked.top.length >= 1 && ranked.top.length <= 5, name);
        ranked.top.forEach(m => assert.notEqual(m.a.fit, 'too-big', `${name}: ${m.name}`));
        assert.equal(ranked.top[0].tags[0][0], 'Recommended');
        tops[name] = ranked.top.map(m => m.name);
    }
    assert.ok(tops.oldAndroid.every(n => !/4B|9B|E4B/.test(n)), 'small phone gets small models: ' + tops.oldAndroid);
    assert.ok(tops.bigAndroid.some(n => /9B/.test(n)), 'big phone gets the 9B: ' + tops.bigAndroid);
    assert.notDeepEqual(tops.oldAndroid, tops.iphoneLiveContainer);
});

test('prefers Q4_K_M, and falls back to a smaller version when that is all that fits', () => {
    const files = [
        { type: 'file', path: 'M-Q3_K_M.gguf', lfs: { size: 1.6 * GB } },
        { type: 'file', path: 'M-Q4_K_M.gguf', lfs: { size: 2.3 * GB } },
    ];
    assert.equal(pickQuant(files, 4, phones.iphoneLiveContainer).quant, 'Q4_K_M');
    const tight = { platform: 'ios', ram: 6 * GB, usable: 2.75 * GB, disk_free: 50 * GB, thermal: 'nominal' };
    assert.equal(pickQuant(files, 4, tight).quant, 'Q3_K_M');
    assert.equal(pickQuant(files, 4, phones.oldAndroid), null);
});

test('names and sizes are read from model names', () => {
    assert.equal(paramsFromName('Qwen3-4B-Instruct'), 4);
    assert.equal(paramsFromName('Qwen3.5-0.8B-GGUF'), 0.8);
    assert.equal(paramsFromName('gemma-4-E2B-it'), 2);
    assert.equal(paramsFromName('Mistral-Instruct'), null);
    assert.equal(prettyModelName('bartowski/google_gemma-3-4b-it-GGUF'), 'gemma-3-4b-it');
    assert.equal(prettyModelName('unsloth/Qwen3.5-2B-GGUF'), 'Qwen3.5-2B');
    assert.equal(paramsFromName('LFM2.5-230M-GGUF'), 0.23);
    // Copies of one model from different publishers count as one.
    assert.equal(baseKey({ id: 'x/A-GGUF', tags: ['base_model:quantized:Org/A'] }), 'a');
    assert.equal(baseKey({ id: 'unsloth/Ornith-1.0-9B-GGUF', tags: ['base_model:quantized:ornith-ai/Ornith-1.0-9B'] }),
        baseKey({ id: 'ornith-ai/Ornith-1.0-9B-GGUF', tags: [] }));
});

test('if Hugging Face fails, the error comes back so the app can show its built-in list', async () => {
    await assert.rejects(discoverModels(phones.iphoneLiveContainer, { fetchJSON: () => Promise.reject(new Error('offline')), force: true }), /offline/);
});

// What the first live run against Hugging Face showed: the most-downloaded models are big, and a
// ranking that only looks at those leaves small phones with almost nothing and big phones with
// models that barely fit.
const bigPopular = Array.from({ length: 30 }, (_, i) => ({ id: `pub${i}/Popular-${9 + (i % 3)}B-Instruct-GGUF`, downloads: 5e6 - i, tags: [], createdAt: recent }));
const agents = [{ id: 'bartowski/tencent_UI-Mate-9B-GGUF', downloads: 9e6, tags: [], createdAt: recent }, { id: 'bartowski/Fara1.5-4B-GGUF', downloads: 9e6, tags: [], createdAt: recent }];
const smallOnes = ['unsloth/gemma-3-1b-it-GGUF', 'bartowski/SmolLM2-360M-Instruct-GGUF', 'LiquidAI/LFM2.5-350M-GGUF', 'Qwen/Qwen2.5-0.5B-Instruct-GGUF']
    .map((id, i) => ({ id, downloads: 50000 - i, tags: [], createdAt: recent }));
function fakeHF2(url) {
    const tree = url.match(/\/api\/models\/(.+)\/tree\/main$/);
    if (!tree) return Promise.resolve(bigPopular.concat(agents, repos, smallOnes));
    const base = tree[1].split('/')[1].replace(/-GGUF$/, '');
    const p = paramsFromName(base) || 3;
    return Promise.resolve(['Q4_K_M', 'Q3_K_M'].map((q, i) => ({ type: 'file', path: `${base}-${q}.gguf`, lfs: { size: Math.round(p * (i ? 0.48 : 0.6) * GB) } })));
}

test('small phones still get several models when the popular ones are all big', async () => {
    const live = await discoverModels(phones.oldAndroid, { fetchJSON: fakeHF2, force: true });
    const top = rankModels(phones.oldAndroid, live.models).top;
    assert.ok(top.length >= 3, top.map(m => m.name).join());
});

test('the top pick fits comfortably rather than barely', async () => {
    const live = await discoverModels(phones.iphoneLiveContainer, { fetchJSON: fakeHF2, force: true });
    const top = rankModels(phones.iphoneLiveContainer, live.models).top;
    assert.equal(top[0].a.fit, 'good', top.map(m => `${m.name} ${m.a.fit}`).join());
    assert.ok(top.filter(m => m.a.fit === 'tight').length <= 2, 'most of the list fits comfortably');
});

test('agent / computer-use models are not offered for meal planning', async () => {
    const live = await discoverModels(phones.bigAndroid, { fetchJSON: fakeHF2, force: true });
    assert.ok(!live.models.some(m => /UI-Mate|Fara/.test(m.repo)));
});
