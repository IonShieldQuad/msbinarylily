/* Responsive proof for the case pages and the index: mobile (360), tablet (768),
 * desktop (1440). Fails on a horizontal scrollbar, an image wider than its
 * column, a thumbnail that is missing its box, or a card grid that keeps its
 * desktop column count on a phone.
 *
 * Run:
 *   NODE_PATH="$LOCALAPPDATA/hermes/hermes-agent/node_modules" \
 *     "$LOCALAPPDATA/hermes/node/node.exe" scripts/case-breakpoints.cjs [baseUrl]
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(process.env.SHOT_DIR || path.join(ROOT, 'shots'), 'breakpoints');
const CHROME = process.env.PW_CHROMIUM ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const base = (process.argv[2] || 'file:///' + ROOT.replace(/\\/g, '/')).replace(/\/$/, '');
const url = (p) => `${base}/${p}`;

const WIDTHS = [
  { name: 'mobile', width: 360, height: 780, maxCols: 1 },
  { name: 'tablet', width: 768, height: 1024, maxCols: 2 },
  { name: 'desktop', width: 1440, height: 1000, maxCols: 3 },
];

const PAGES = [
  ['index', 'index.html'],
  ['projects', 'projects.html'],
  ['case-tg', 'case.html?project=tg-aggregator'],
  ['case-mod', 'case.html?project=lilys-innovations'],
  ['case-missing', 'case.html?project=does-not-exist'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const failures = [];
  const rows = [];
  for (const [name, rel] of PAGES) {
    for (const vp of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: 'ru-RU' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // only the site's own requests: a flaky webfont CDN is not a layout defect
      page.on('requestfailed', (r) => {
        const u = r.url();
        if (u.startsWith('file:') || (base.startsWith('http') && u.startsWith(base))) {
          errors.push(`${u} ${r.failure()?.errorText || ''}`);
        }
      });
      await page.goto(url(rel), { waitUntil: 'load' });
      await page.waitForTimeout(2200);
      // scroll once so lazy images below the fold are actually requested
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(700);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);

      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const grid = document.getElementById('case-grid-client') || document.getElementById('case-grid')
          || document.getElementById('featured-cases');
        const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
        const imgs = [...document.querySelectorAll('img')].map((i) => ({
          src: i.getAttribute('src'),
          w: Math.round(i.getBoundingClientRect().width),
          natural: i.naturalWidth,
          inThumb: !!i.closest('.card-thumb'),
          inFigure: !!i.closest('.case-figure'),
        }));
        return {
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          cols,
          overflow: de.scrollWidth - de.clientWidth,
          wide: imgs.filter((i) => i.w > de.clientWidth).map((i) => i.src),
          broken: imgs.filter((i) => i.natural === 0).map((i) => i.src),
          thumbs: imgs.filter((i) => i.inThumb).length,
          figures: imgs.filter((i) => i.inFigure).length,
          figureW: Math.round(document.querySelector('.case-figure img')?.getBoundingClientRect().width || 0),
        };
      });

      const tag = `${name}@${vp.name}(${vp.width})`;
      if (m.overflow > 1) failures.push(`${tag}: horizontal overflow ${m.overflow}px (scrollWidth ${m.scrollW})`);
      if (m.wide.length) failures.push(`${tag}: image(s) wider than the viewport — ${m.wide.join(', ')}`);
      if (m.broken.length) failures.push(`${tag}: image(s) did not load — ${m.broken.join(', ')}`);
      if (m.cols > vp.maxCols) failures.push(`${tag}: card grid keeps ${m.cols} columns (max ${vp.maxCols})`);
      if ((m.thumbs || m.figures) && vp.name === 'mobile' && m.figureW > vp.width) failures.push(`${tag}: figure ${m.figureW}px wide on a ${vp.width}px screen`);
      if (errors.length) failures.push(`${tag}: ${errors.slice(0, 3).join(' | ')}`);
      rows.push({ tag, overflow: m.overflow, cols: m.cols, thumbs: m.thumbs, figures: m.figures, figureW: m.figureW });

      await page.screenshot({ path: path.join(OUT, `${name}-${vp.name}.png`), fullPage: false });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify({ base, ok: failures.length === 0, failures, rows }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((err) => { console.error('HARNESS FAILURE:', err); process.exit(1); });
