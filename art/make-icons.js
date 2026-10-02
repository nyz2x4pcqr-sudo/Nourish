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
    await browser.close();
})();
