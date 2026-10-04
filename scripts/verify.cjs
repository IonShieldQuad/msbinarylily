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
  ['services', 'services.html', 'ru'],
  ['about', 'about.html', 'ru'],
  ['laboratory', 'laboratory.html', 'ru'],
  ['contact', 'contact.html', 'ru'],
  ['case-tg', 'case.html?project=tg-aggregator', 'ru'],
  ['case-missing', 'case.html?project=does-not-exist', 'ru'],
  ['index-static', 'index.html?static', 'ru'],
];

const NAV = ['index.html', 'projects.html', 'services.html', 'laboratory.html', 'about.html', 'contact.html'];

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
    await page.waitForTimeout(3200);

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
      groups: (() => {
        const g = (id) => document.querySelectorAll(`#${id} .card`).length;
        const client = document.getElementById('case-grid-client');
        if (!client) return null;
        return { client: g('case-grid-client'), depth: g('case-grid-depth'),
                 clientVisible: !document.getElementById('group-client')?.hidden };
      })(),
      formHidden: (() => {
        const b = document.getElementById('lead-form-block');
        return b ? b.hidden : null;
      })(),
      heroCoverage: (() => {
        const hero = document.querySelector('.hero');
        if (!hero) return null;
        return Math.round((hero.getBoundingClientRect().height / window.innerHeight) * 100);
      })(),
      btnLabels: [...document.querySelectorAll('a.btn')].filter((a) => {
        const sp = a.querySelector(':scope > span');
        if (!sp || !sp.textContent.trim()) return false;
        const r = sp.getBoundingClientRect();
        return r.height > 0 && r.width > 0 && getComputedStyle(sp).position === 'relative';
      }).length,
      btnTotal: document.querySelectorAll('a.btn').length,
      ringLayers: [...document.querySelectorAll('.ring')].every((el) => {
        const cs = getComputedStyle(el, '::before');
        return cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      }),
      primaryFill: (() => {
        // the primary CTA must keep its gradient plate on every surface
        const p = document.querySelector('.btn-primary');
        if (!p) return 'none';
        return getComputedStyle(p, '::after').backgroundImage.slice(0, 24);
      })(),
      ghostSurface: (() => {
        const b = document.querySelector('.btn:not(.btn-primary)');
        return b ? getComputedStyle(b, '::after').backgroundColor : null;
      })(),
      ambience: null,
      cyrillic: (() => {
        const txt = document.querySelector('#case-root')?.textContent || '';
        const letters = [...txt].filter((ch) => /\p{L}/u.test(ch));
        const cyr = letters.filter((ch) => /[а-яёА-ЯЁ]/i.test(ch)).length;
        return letters.length ? Math.round((cyr / letters.length) * 100) : 0;
      })(),
    }));

    // prove the ambience reacts to the pointer instead of merely existing
    facts.ambience = await page.evaluate(async () => {
      const cv = document.getElementById('ambient');
      if (!cv) return null;
      const hash = () => {
        const g = cv.getContext('2d');
        if (!g) return 0;
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) % 1e9;
        return h;
      };
      const before = hash();
      const r = cv.getBoundingClientRect();
      (cv.closest('.hero') || cv.parentElement).dispatchEvent(new PointerEvent('pointermove', {
        clientX: r.left + r.width * 0.25, clientY: r.top + r.height * 0.35, bubbles: true,
      }));
      await new Promise((res) => setTimeout(res, 600));
      const after = hash();
      return { reactsToPointer: after !== before, lit: before > 0 };
    });

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
