// Runs the phone apps' model discovery against the real Hugging Face API (needs internet, so it
// runs in CI, not in the unit tests) and prints each phone profile's top 5.
const { discoverModels, rankModels } = require('../../ondevice.js');

const GB = 1024 ** 3;
const phones = {
    'iPhone 16 Pro + LiveContainer (more RAM)': { platform: 'ios', ram: 8 * GB, usable: 6.2 * GB, disk_free: 60 * GB, thermal: 'nominal' },
    'iPhone 16 Pro (normal limit)': { platform: 'ios', ram: 8 * GB, usable: 3.4 * GB, disk_free: 60 * GB, thermal: 'nominal' },
    'Older Android, 4 GB': { platform: 'android', ram: 4 * GB, usable: 1.6 * GB, disk_free: 10 * GB, thermal: 'nominal' },
    'Flagship Android, 16 GB': { platform: 'android', ram: 16 * GB, usable: 11 * GB, disk_free: 200 * GB, thermal: 'nominal' },
};

async function fetchJSON(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Nourish CI check' } });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
}

(async () => {
    let failed = false;
    for (const [name, specs] of Object.entries(phones)) {
        const live = await discoverModels(specs, { fetchJSON, force: true });
        const ranked = rankModels(specs, live.models);
        console.log(`\n${name}: ${live.models.length} suitable models found`);
        ranked.top.forEach((m, i) => console.log(`  ${i + 1}. ${m.name.padEnd(36)} ${(m.size / GB).toFixed(1)} GB  ${m.repo}/${m.file}  [${m.tags.map(t => t[0]).join(', ')}]`));
        if (ranked.top.length < 3) { console.log('  FAIL: fewer than 3 models'); failed = true; }
        if (ranked.top.some(m => m.a.fit === 'too-big')) { console.log('  FAIL: a model that does not fit'); failed = true; }
    }
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
