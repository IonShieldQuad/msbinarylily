/* Rasterises assets/emblem.svg into the favicon fallbacks every browser wants.

   An SVG favicon alone leaves Safari, older Chrome and every "add to home screen"
   with nothing, so the same mark ships as PNGs. Sizes follow what the platforms
   actually read: 16/32 in the tab, 48 for Windows taskbar previews, 180 for iOS.

   Run: NODE_PATH=<hermes-agent>/node_modules node scripts/make-icons.cjs          */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'emblem.svg');
const CHROME = process.env.PW_CHROMIUM ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const PLATE = '#0b0c10';   // --carbon: iOS does not keep transparency, so that icon gets the plate

const TARGETS = [
  { file: 'favicon-16.png', size: 16, bg: 'transparent' },
  { file: 'favicon-32.png', size: 32, bg: 'transparent' },
  { file: 'favicon-48.png', size: 48, bg: 'transparent' },
  { file: 'apple-touch-icon.png', size: 180, bg: PLATE },
];

(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();

  for (const t of TARGETS) {
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}</style>`
      + `<div id="box" style="width:${t.size}px;height:${t.size}px;background:${t.bg === 'transparent' ? 'transparent' : t.bg}">`
      + `<img id="m" src="${url}" width="${t.size}" height="${t.size}" style="display:block">`,
      { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const i = document.getElementById('m');
      return i && i.complete && i.naturalWidth > 0;
    });
    const el = await page.$('#box');
    await el.screenshot({
      path: path.join(ROOT, 'assets', t.file),
      omitBackground: t.bg === 'transparent',
    });
    const bytes = fs.statSync(path.join(ROOT, 'assets', t.file)).size;
    console.log(`${t.file.padEnd(22)} ${t.size}x${t.size}  ${bytes} bytes  ${t.bg === 'transparent' ? 'transparent' : 'on ' + t.bg}`);
  }
  await browser.close();
})().catch((e) => { console.error('ICON FAILURE:', e); process.exit(1); });
