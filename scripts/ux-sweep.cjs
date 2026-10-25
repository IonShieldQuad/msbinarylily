/* UX / client-journey sweep for the MsBinaryLily portfolio.
   Read-only, and deliberately separate from verify.cjs: verify asserts the rules,
   this one reports what a visitor meets — tap-target sizes, type floor, horizontal
   overflow, images, conversion reachability, per-case evidence links and visuals,
   and it walks the primary journey (home → projects → a case → services → contact)
   in one browser session. Writes out/ux-facts.json + screenshots.

   Run:  NODE_PATH="$LOCALAPPDATA/hermes/hermes-agent/node_modules" \
         "$LOCALAPPDATA/hermes/node/node.exe" scripts/ux-sweep.cjs [baseUrl]
*/
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.argv[2] || 'file:///' + ROOT.replace(/\\/g, '/')).replace(/\/$/, '');
// shots/ is gitignored — the sweep's screenshots and one JSON dump are dev output
const OUT = path.join(ROOT, 'shots', 'ux');
const CHROME = process.env.PW_CHROMIUM ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');

const url = (p) => `${BASE}/${p}`;

const PAGES = [
  ['index', 'index.html'],
  ['projects', 'projects.html'],
  ['services', 'services.html'],
  ['about', 'about.html'],
  ['laboratory', 'laboratory.html'],
  ['contact', 'contact.html'],
  ['case-tg', 'case.html?project=tg-aggregator'],
  ['case-cpu', 'case.html?project=cpu-from-nand'],
  ['case-lily', 'case.html?project=lilys-innovations'],
  ['case-missing', 'case.html?project=nope'],
];

const CASES = ['tg-aggregator', 'ai-agents-automation', 'lilys-innovations', 'android-apps',
  'compiler-translator', 'neural-net-from-scratch', 'cpu-from-nand', 'compression-algorithms',
  'sorting-visualizer'];

const VIEWPORTS = [['desktop', 1440, 900], ['mobile', 390, 844]];

const probe = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const inter = [...document.querySelectorAll('a,button,input,textarea,select')]
    .filter(vis)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: label(el),
        href: el.getAttribute('href') || null,
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top + scrollY),
      };
    });
  const smallText = [];
  document.querySelectorAll('body *').forEach((el) => {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !vis(el)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) smallText.push({ text: label(el), fs, cls: el.className || el.tagName });
  });
  const imgs = [...document.images].map((im) => ({
    src: im.currentSrc || im.src, w: im.naturalWidth, h: im.naturalHeight,
    shown: Math.round(im.getBoundingClientRect().width),
  }));
  const foldBottom = innerHeight;
  const fold = [...document.querySelectorAll('h1, .hero h2, .lede, .kicker, .btn, .hero-cta a, .page-title')]
    .filter(vis)
    .filter((el) => el.getBoundingClientRect().top < foldBottom)
    .map((el) => ({ cls: el.className || el.tagName, text: label(el).slice(0, 200) }));
  const prose = [...document.querySelectorAll('.prose p, .prose li')].slice(0, 8).map((el) => {
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const w = el.getBoundingClientRect().width;
    return { fs, width: Math.round(w), estCharsPerLine: Math.round(w / (fs * 0.5)) };
  });
  return {
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim().slice(0, 160)),
    inter,
    smallText,
    imgs,
    fold,
    prose,
    overflow: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
    linkToContact: [...document.querySelectorAll('a[href*="contact.html"]')].filter(vis).length,
    linkToServices: [...document.querySelectorAll('a[href*="services.html"]')].filter(vis).length,
    external: [...document.querySelectorAll('a[href^="http"]')].map((a) => a.getAttribute('href')),
    bodyText: document.body.innerText,
    scrollHeight: Math.round(document.documentElement.scrollHeight),
  };
};

const caseProbe = () => {
  const root = document.getElementById('case-root');
  const ev = [...document.querySelectorAll('.evidence li')].map((li) => ({
    text: li.innerText.trim().replace(/\s+/g, ' '),
    link: !!li.querySelector('a'),
    href: li.querySelector('a') ? li.querySelector('a').getAttribute('href') : null,
  }));
  return {
    title: document.title,
    h1: root ? (root.querySelector('h1') || {}).innerText : null,
    sections: [...document.querySelectorAll('.case-section h2')].map((h) => h.innerText.trim()),
    evidence: ev,
    imgs: [...document.images].map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })),
    caseImgs: root ? root.querySelectorAll('img').length : 0,
    ctaToContact: root ? [...root.querySelectorAll('a')].filter((a) => /contact\.html|t\.me/.test(a.getAttribute('href') || '')).map((a) => a.innerText.trim()) : [],
    pager: [...document.querySelectorAll('.pager a')].map((a) => a.innerText.trim()),
    literalMd: /\*\*[^*]+\*\*/.test(document.body.innerText),
    vaultNote: /vault note|заметках хранилища/.test(document.body.innerText),
    proseChars: [...document.querySelectorAll('.prose p')].slice(0, 3).map((p) => {
      const fs = parseFloat(getComputedStyle(p).fontSize);
      return Math.round(p.getBoundingClientRect().width / (fs * 0.5));
    }),
    textLen: document.body.innerText.length,
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const out = { base: BASE, pages: {}, cases: {}, journey: {}, meta: {} };

  for (const [vpName, width, height] of VIEWPORTS) {
    for (const [name, rel] of PAGES) {
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
      await page.goto(url(rel), { waitUntil: 'load' });
      await page.waitForTimeout(1800);
      // scroll through to fire reveal observers, then back to top
      await page.evaluate(async () => {
        const H = document.documentElement.scrollHeight;
        for (let y = 0; y < H; y += innerHeight * 0.7) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 250));
      });
      const facts = await page.evaluate(probe);
      if (name.startsWith('case-')) {
        Object.assign(facts, { caseFacts: await page.evaluate(caseProbe) });
      }
      facts.errors = errors;
      out.pages[`${vpName}:${name}`] = facts;
      if (vpName === 'desktop' || name === 'index') {
        await page.screenshot({ path: path.join(OUT, `${vpName}-${name}.png`), fullPage: false });
      }
      await ctx.close();
    }
  }

  // per-case detail, desktop only
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
    const page = await ctx.newPage();
    for (const id of CASES) {
      const errors = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (e) => errors.push(String(e.message)));
      await page.goto(url(`case.html?project=${id}`), { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      const f = await page.evaluate(caseProbe);
      f.errors = errors;
      out.cases[id] = f;
    }
    await ctx.close();
  }

  // journey: home -> projects -> first case -> in-case next -> services -> CTA -> contact
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const steps = [];
    const note = async (name, extra = {}) => steps.push({
      name, url: page.url().replace(BASE, ''),
      title: await page.title(),
      h1: await page.evaluate(() => (document.querySelector('h1') || {}).innerText || ''),
      ...extra,
    });
    await page.goto(url('index.html'), { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await note('land-home');
    // primary CTA in the hero
    const heroCta = await page.evaluate(() => [...document.querySelectorAll('.hero-cta a')]
      .map((a) => ({ text: a.innerText.trim(), href: a.getAttribute('href') })));
    out.journey.heroCtas = heroCta;
    // nav to projects
    await page.click('#site-nav a[href="projects.html"]');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1200);
    await note('nav-projects');
    const cards = await page.evaluate(() => [...document.querySelectorAll('a.card')].map((a) => ({
      text: a.querySelector('h3').innerText.trim(), href: a.getAttribute('href'),
    })));
    out.journey.cards = cards;
    await page.click('#case-grid-client a.card');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1200);
    await note('open-case');
    // is there any conversion path inside a case?
    const inCase = await page.evaluate(() => ({
      ctas: [...document.querySelectorAll('#case-root a')].map((a) => ({
        text: a.innerText.trim().slice(0, 40), href: a.getAttribute('href'),
      })),
      hasContactLink: !!document.querySelector('#case-root a[href*="contact"]'),
    }));
    out.journey.inCase = inCase;
    // nav to services
    await page.click('#site-nav a[href="services.html"]');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1200);
    await note('nav-services');
    // the "form and email" CTA
    const svcCtas = await page.evaluate(() => [...document.querySelectorAll('main .btn')].map((a) => ({
      text: a.innerText.trim(), href: a.getAttribute('href'),
    })));
    out.journey.servicesCtas = svcCtas;
    const formBtn = await page.evaluate(() => {
      const a = [...document.querySelectorAll('main a.btn')].find((x) => /contact\.html/.test(x.getAttribute('href') || ''));
      if (!a) return null;
      a.setAttribute('data-journey', '1');
      return a.innerText.trim();
    });
    if (formBtn) {
      await page.click('a[data-journey="1"]');
      await page.waitForLoadState('load');
      await page.waitForTimeout(900);
      await note('cta-to-contact');
      out.journey.contactState = await page.evaluate(() => ({
        formVisible: (() => { const b = document.getElementById('lead-form-block'); return b ? !b.hidden && b.getBoundingClientRect().height > 0 : false; })(),
        kickers: [...document.querySelectorAll('main .kicker')].map((k) => k.innerText.trim()),
        cards: [...document.querySelectorAll('main a.card')].map((a) => ({ text: a.innerText.trim().replace(/\s+/g, ' '), href: a.getAttribute('href') })),
        mailto: !!document.querySelector('a[href^="mailto:"]'),
      }));
    }
    out.journey.steps = steps;
    await ctx.close();
  }

  await browser.close();
  out.meta = { generated: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'ux-facts.json'), JSON.stringify(out, null, 1));
  console.log('wrote', path.join(OUT, 'ux-facts.json'));
})().catch((e) => { console.error(e); process.exit(1); });
