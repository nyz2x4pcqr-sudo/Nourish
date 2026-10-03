// Renders art/icon.svg to every PNG size the app uses. Run from the repo root:
//   node art/make-icons.js   (needs Playwright with Chromium)
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const sizes = [
    ['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180],
    ['mobile/ios/Nourish/Assets.xcassets/AppIcon.appiconset/icon-1024.png', 1024],
];
(async () => {
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await browser.newPage();
    for (const [file, size] of sizes) {
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(`<html><body style="margin:0;background:#0C0B0A">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
        await page.screenshot({ path: path.join(root, file), omitBackground: false });
        console.log(file, size);
    }
    // iOS launch screen: the mark alone (no background) at 96 pt, on the app's dark launch colour.
    const g = svg.match(/<g transform[^>]*>([\s\S]*?)<\/g>/)[1];
    const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)[0];
    const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 9 48 48">${defs}${g}</svg>`;
    for (const scale of [1, 2, 3]) {
        const size = 96 * scale;
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(`<html><body style="margin:0;background:transparent">${mark.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
        const file = `mobile/ios/Nourish/Assets.xcassets/LaunchLogo.imageset/launch-logo@${scale}x.png`;
        await page.screenshot({ path: path.join(root, file), omitBackground: true });
        console.log(file, size);
    }
    // Alternate home screen icons (Settings → Appearance → App icon), one per theme: the same drawing
    // in each theme's colours. Web previews (app-icon-<id>.png), iOS alternate app icons and Android
    // launcher icons (mobile/android/.../drawable/ic_launcher_*_<id>.xml).
    for (const [id, v] of Object.entries(VARIANTS)) {
        const art = recolor(svg, v);
        await page.setViewportSize({ width: 112, height: 112 });
        await page.setContent(`<html><body style="margin:0">${art.replace('<svg ', '<svg width="112" height="112" ')}</body></html>`);
        await page.screenshot({ path: path.join(root, `app-icon-${id}.png`) });
        if (id === 'default') continue;
        const set = path.join(root, `mobile/ios/Nourish/Assets.xcassets/AppIcon-${cap(id)}.appiconset`);
        fs.mkdirSync(set, { recursive: true });
        await page.setViewportSize({ width: 1024, height: 1024 });
        await page.setContent(`<html><body style="margin:0">${art.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`);
        await page.screenshot({ path: path.join(set, 'icon-1024.png') });
        fs.writeFileSync(path.join(set, 'Contents.json'), JSON.stringify({ images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
        const res = path.join(root, 'mobile/android/app/src/main/res');
        const bgXml = fs.readFileSync(path.join(res, 'drawable/ic_launcher_background.xml'), 'utf8');
        const fgXml = fs.readFileSync(path.join(res, 'drawable/ic_launcher_foreground.xml'), 'utf8');
        fs.writeFileSync(path.join(res, `drawable/ic_launcher_background_${id}.xml`), recolor(bgXml, v));
        fs.writeFileSync(path.join(res, `drawable/ic_launcher_foreground_${id}.xml`), recolor(fgXml, v));
        fs.writeFileSync(path.join(res, `mipmap-anydpi-v26/ic_launcher_${id}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background_${id}" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_${id}" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground_${id}" />
</adaptive-icon>
`);
        console.log('variant', id);
    }
    await browser.close();
})();

// Theme colours for the alternate icons: [background top, middle, bottom], glow, bowl [top, bottom],
// rim, leaf [dark, light], stem.
const VARIANTS = {
    default: {},
    midnight: { bg: ['#1C2C47', '#0F1626', '#0A0D14'], glow: '#6FB7E6', bowl: ['#A9D8F7', '#2F7DB5'], rim: '#D8EEFF' },
    forest: { bg: ['#1E3527', '#0F1A13', '#0A110D'], glow: '#8CC084', bowl: ['#FFC46A', '#E0782A'], leaf: ['#9CD38F', '#DDF4C9'], stem: '#BFE6AE' },
    plum: { bg: ['#30203D', '#170F1D', '#120C16'], glow: '#B69CF6', bowl: ['#D7C8FF', '#7A58C9'], rim: '#EFE8FF' },
    paper: { bg: ['#FFFFFF', '#F8F2E9', '#EADFCD'], glow: '#F4A13D', bowl: ['#FFB955', '#D96A1C'], rim: '#F3C27E', leaf: ['#4E8A4B', '#8CC084'], stem: '#5E9A55' },
    oled: { bg: ['#000000', '#000000', '#000000'], glow: '#F4A13D', bowl: ['#FFC46A', '#E0782A'] },
};
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function recolor(text, v) {
    let t = text;
    const swap = (from, to) => { if (to) t = t.split(from).join(to); };
    if (v.bg) { swap('#33241A', v.bg[0]); swap('#17120F', v.bg[1]); swap('#0C0B0A', v.bg[2]); }
    swap('#F4A13D', v.glow);
    if (v.bowl) { swap('#FFC46A', v.bowl[0]); swap('#E0782A', v.bowl[1]); }
    swap('#FFE2B0', v.rim);
    if (v.leaf) { swap('#7DB876', v.leaf[0]); swap('#C4E8A9', v.leaf[1]); }
    swap('#9FD08C', v.stem);
    return t;
}
