/* Verification harness for the site: loads every page in a real browser,
   collects console/page errors and failed requests, asserts the manifest-driven
   rendering, flips the RU/EN toggle, and writes desktop + mobile screenshots.

   Run:  NODE_PATH=<hermes-agent>/node_modules node scripts/verify.cjs [baseUrl]
   Default baseUrl is the file:// path of this repo (that is the "double-click
   index.html" case, which must work without a web server). */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SHOT_DIR || path.join(ROOT, 'shots');
const CHROME = process.env.PW_CHROMIUM ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');

const base = (process.argv[2] || 'file:///' + ROOT.replace(/\\/g, '/')).replace(/\/$/, '');
const url = (p) => (base.startsWith('file:') ? `${base}/${p}` : `${base}/${p}`);

const pages = [
  ['index', 'index.html', 'ru'],
  ['projects', 'projects.html', 'ru'],
  ['about', 'about.html', 'ru'],
  ['laboratory', 'laboratory.html', 'ru'],
  ['contact', 'contact.html', 'ru'],
  ['case-tg', 'case.html?project=tg-aggregator', 'ru'],
  ['case-missing', 'case.html?project=does-not-exist', 'ru'],
  ['index-static', 'index.html?static', 'ru'],
];

const NAV = ['index.html', 'projects.html', 'laboratory.html', 'about.html', 'contact.html'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const report = [];

  for (const [name, rel, lang] of pages) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText || ''}`));

    await page.goto(url(rel), { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const facts = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      navLinks: [...document.querySelectorAll('#site-nav a')].map((a) => a.getAttribute('href')),
      cards: document.querySelectorAll('.card').length,
      caseTitle: document.querySelector('#case-root h1')?.textContent?.trim() || null,
      sections: document.querySelectorAll('.case-section').length,
      ticker: document.querySelectorAll('#ticker-track span').length,
      ambient: !!document.querySelector('#ambient'),
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      emptyState: document.querySelector('.empty-state')?.textContent?.trim() || null,
      notice: [...document.querySelectorAll('.notice')].filter((el) => !el.hidden).map((el) => el.textContent.trim().slice(0, 50)).join(' | ') || null,
      caseText: (document.querySelector('.case-section .prose, .case-section p')?.textContent || '').slice(0, 80),
      cyrillic: (() => {
        const txt = document.querySelector('#case-root')?.textContent || '';
        const letters = [...txt].filter((ch) => /\p{L}/u.test(ch));
        const cyr = letters.filter((ch) => /[а-яёА-ЯЁ]/i.test(ch)).length;
        return letters.length ? Math.round((cyr / letters.length) * 100) : 0;
      })(),
    }));

    // language toggle: RU -> EN on a page that has a hero lede
    let langFlip = null;
    const toggle = await page.$('[data-lang-btn="en"]');
    if (toggle) {
      const before = await page.evaluate(() => document.querySelector('[data-ru]')?.textContent?.trim());
      await toggle.click();
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        first: document.querySelector('[data-ru]')?.textContent?.trim(),
        pressed: document.querySelector('[data-lang-btn="en"]')?.getAttribute('aria-pressed'),
      }));
      langFlip = { before, after: after.first, lang: after.lang, pressed: after.pressed, changed: before !== after.first };
      await page.click('[data-lang-btn="ru"]');
      await page.waitForTimeout(250);
    }

    const shot = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: shot, fullPage: false });

    if (['index', 'case-tg', 'projects'].includes(name)) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${name}-mobile.png`), fullPage: false });
    }

    report.push({ name, rel, errors, facts, langFlip, shot });
    await context.close();
  }

  // nav consistency across pages
  const navSets = report.filter((r) => r.facts.navLinks.length)
    .map((r) => JSON.stringify(r.facts.navLinks));
  const navConsistent = navSets.every((s) => s === navSets[0]) && JSON.parse(navSets[0] || '[]').join() === NAV.join();

  await browser.close();
  console.log(JSON.stringify({ base, navConsistent, report }, null, 2));
})().catch((err) => { console.error('HARNESS FAILURE:', err); process.exit(1); });
