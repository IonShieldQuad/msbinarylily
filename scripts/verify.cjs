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

/* Every page is loaded with an explicit browser locale: with no stored choice the
   site follows it, so a ru-* locale must land on RU (the source language) and any
   other locale on EN. The last entry starts in English on purpose. */
const pages = [
  ['index', 'index.html', 'ru-RU', 'ru'],
  ['projects', 'projects.html', 'ru-RU', 'ru'],
  ['services', 'services.html', 'ru-RU', 'ru'],
  ['about', 'about.html', 'ru-RU', 'ru'],
  ['laboratory', 'laboratory.html', 'ru-RU', 'ru'],
  ['lab-current-field', 'lab-current-field.html', 'ru-RU', 'ru'],
  ['contact', 'contact.html', 'ru-RU', 'ru'],
  ['case-tg', 'case.html?project=tg-aggregator', 'ru-RU', 'ru'],
  ['case-missing', 'case.html?project=does-not-exist', 'ru-RU', 'ru'],
  ['index-static', 'index.html?static', 'ru-RU', 'ru'],
  ['index-en-browser', 'index.html', 'en-US', 'en'],
];

const NAV = ['index.html', 'projects.html', 'services.html', 'laboratory.html', 'about.html', 'contact.html'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const report = [];

  for (const [name, rel, locale, wantLang] of pages) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale });
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
      // the icon set and the header mark are the brand surface: an SVG-only favicon
      // leaves Safari with nothing, and the mark is blue/red (the engine's poles)
      icons: [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')]
        .map((l) => l.getAttribute('href')),
      themeColor: document.head.querySelector('meta[name="theme-color"]')?.content || null,
      brandMark: (() => {
        const svg = document.querySelector('.brand svg');
        if (!svg) return null;
        // every element, not just path/circle: the poles are painted by <g fill> wrappers,
        // so reading leaves only would report the neutral core and call the mark uncoloured
        const shapes = [...svg.querySelectorAll('*')];
        const colours = shapes.flatMap((x) => [x.getAttribute('stroke'), x.getAttribute('fill')])
          .filter((c) => c && c !== 'none');
        return {
          colours: [...new Set(colours)],
          carriesOldCyan: svg.outerHTML.includes('#00e5ff'),
          box: svg.getAttribute('viewBox'),
        };
      })(),
      ambience: null,
      cyrillic: (() => {
        const txt = document.querySelector('#case-root')?.textContent || '';
        const letters = [...txt].filter((ch) => /\p{L}/u.test(ch));
        const cyr = letters.filter((ch) => /[а-яёА-ЯЁ]/i.test(ch)).length;
        return letters.length ? Math.round((cyr / letters.length) * 100) : 0;
      })(),
      docTitle: document.title,
      h1Count: document.querySelectorAll('h1').length,
      // the hero visual + copy treatment: the mark must actually load, its pocket
      // must exist, the copy must carry its dark halo and the gradient wordmark
      // must not (a shadow behind transparent glyphs doubles the headline)
      hero: (() => {
        const g = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
        const logo = document.querySelector('.hero-logo');
        return {
          present: !!document.querySelector('.hero-visual'),
          halo: !!document.querySelector('.hero-visual-halo'),
          logoLoaded: logo ? logo.naturalWidth > 0 : null,
          copyShadow: g('.hero .lede', 'textShadow'),
          gradientShadow: g('.hero h1 .binary-text', 'textShadow'),
        };
      })(),
      // markdown markers must never reach a surface that renders plain text
      literalMd: (document.body.innerText.match(/\*\*[^*\n]{0,40}\*\*/g) || []).slice(0, 4),
      // internal process vocabulary has no place in client-facing copy ("Arctic Code
      // Vault Contributor" is a real GitHub badge, so that one phrase is allowed)
      vocabulary: (document.body.innerText.match(/\bADR\b|(?<!Arctic Code )\bvault\b|премортем|pre-mortem|vanilla static site|SemVer/gi) || []).slice(0, 4),
      // the type floor (>=12px) is a standing UI constraint, so it is a test
      smallText: (() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const b = el.getBoundingClientRect();
          if (b.width < 2 || b.height < 2) continue;
          if (!el.textContent.trim()) continue;
          const fs = parseFloat(cs.fontSize);
          if (fs < 12) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}=${fs}px`);
        }
        return [...new Set(out)].slice(0, 6);
      })(),
      /* Every surface pair that broke contrast once: the label must BE the token for
         that surface and must clear 4.5:1 on it. Pairs whose surface is painted by a
         gradient are checked against the ring colour, which is the layer underneath. */
      contrastPairs: (() => {
        const lum = (rgb) => {
          const s = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
        };
        const toRgb = (css) => {
          const probe = document.createElement('span');
          probe.style.cssText = `color:${css};position:absolute;top:-9999px;left:-9999px`;
          document.body.appendChild(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          const m = c.match(/rgba?\(([^)]+)\)/);
          return m ? m[1].split(',').map(Number).slice(0, 3) : null;
        };
        const ratio = (a, b) => Math.round(((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)) * 100) / 100;
        const pairs = [
          ['.case-head .lede', 'var(--text-on-dark-dim)', 'var(--carbon)'],
          ['.case-head .chip', 'var(--text-on-dark-dim)', 'var(--carbon)'],
          ['.case-head .kicker', 'var(--neon-cyan)', 'var(--carbon)'],
          ['.section-carbon .kicker', 'var(--neon-cyan)', 'var(--carbon)'],
          ['.holo.ring .footer-meta', 'var(--text-on-dark-dim)', 'var(--line-dark)'],
          ['.holo.ring .chip:not(.chip-neon)', 'var(--text-on-dark-dim)', 'var(--line-dark)'],
          ['.lab-controls button:not([aria-pressed="true"]):not([data-act])', 'var(--ink-dim)', 'var(--panel)'],
          ['.card-flag', 'var(--neon-ink)', 'var(--line)'],
          ['.chip-neon[data-filter]', 'var(--neon-ink)', 'var(--panel)'],
          ['.holo.ring .chip-neon', 'var(--neon-cyan)', 'var(--line-dark)'],
          ['.section-carbon .chip-neon', 'var(--neon-cyan)', 'var(--carbon)'],
          ['.lab-badge', 'var(--text-on-dark-dim)', 'var(--carbon)'],
        ];
        const out = [];
        for (const [sel, fgExpr, bgExpr] of pairs) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const fg = toRgb(getComputedStyle(el).color);
          if (!fg) continue;
          out.push({
            sel,
            ratio: ratio(fg, toRgb(bgExpr)),
            tokenOk: fg.join() === toRgb(fgExpr).join(),
          });
        }
        return out;
      })(),
      // broad net: visible text on a solid surface below the AA floor (elements
      // painted over a gradient are skipped — the colour walk cannot know them)
      contrast: (() => {
        const lum = (rgb) => {
          const s = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
        };
        const parse = (s) => {
          const m = String(s).match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(',').map(Number);
          return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
        };
        const surface = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            for (const pe of ['::after', '::before', null]) {
              const cs = getComputedStyle(n, pe);
              if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
              const c = parse(cs.backgroundColor);
              if (c && c.a > 0.85) return c.rgb;
            }
            n = n.parentElement;
          }
          return [11, 12, 16];
        };
        const out = [];
        const seen = new Set();
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const b = el.getBoundingClientRect();
          if (b.width < 4 || b.height < 4) continue;
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
          const fg = parse(cs.color);
          if (!fg || fg.a < 0.5) continue;
          const bg = surface(el);
          if (!bg) continue;
          const l1 = lum(fg.rgb), l2 = lum(bg);
          const ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
          const px = parseFloat(cs.fontSize);
          const bold = parseInt(cs.fontWeight, 10) >= 700;
          const min = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
          const key = el.className + '|' + cs.color;
          if (ratio < min && !seen.has(key)) {
            seen.add(key);
            out.push({ sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''), text: el.textContent.trim().slice(0, 24), ratio, min });
          }
        }
        return out.slice(0, 6);
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

    // the site follows the browser when nothing is stored, so an English browser
    // must never show a frame of the Russian source on load
    if (wantLang === 'en') {
      facts.bodyCyrillic = await page.evaluate(() => {
      const allow = [/^Тамбов/];
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent.trim();
        if (!t || !/[а-яёА-ЯЁ]/.test(t)) continue;
        const el = n.parentElement;
        if (!el || !el.offsetParent || el.closest('script,style')) continue;
        if (allow.some((re) => re.test(t))) continue;
        out.push(t.slice(0, 40));
      }
      return [...new Set(out)].slice(0, 6);
      });
    }

    // language switch: the toggle must reach the other language, and once EN is on
    // nothing may stay in the source language
    let langFlip = null;
    const target = wantLang === 'ru' ? 'en' : 'ru';
    const toggle = await page.$(`[data-lang-btn="${target}"]`);
    if (toggle) {
      const before = await page.evaluate(() => ({
        title: document.title,
        first: document.querySelector('[data-ru]')?.textContent?.trim(),
      }));
      await toggle.click();
      await page.waitForTimeout(350);
      const after = await page.evaluate((lang) => ({
        lang: document.documentElement.lang,
        title: document.title,
        first: document.querySelector('[data-ru]')?.textContent?.trim(),
        pressed: document.querySelector(`[data-lang-btn="${lang}"]`)?.getAttribute('aria-pressed'),
        stored: localStorage.getItem('mbl-lang'),
        // pages that declare a bilingual pair must land on exactly that string;
        // a case page's tab title comes from the case data instead
        wantTitle: document.documentElement.dataset[lang === 'en' ? 'titleEn' : 'titleRu'] || null,
      }), target);
      langFlip = {
        target, before: before.first, after: after.first, lang: after.lang,
        title: after.title, wantTitle: after.wantTitle, titleChanged: before.title !== after.title,
        pressed: after.pressed, stored: after.stored, changed: before.first !== after.first,
      };
      if (target === 'en') {
        // nothing may stay in the source language once EN is on (a place name or the
        // language labels themselves are not translation leftovers)
        langFlip.leftoverCyrillic = await page.evaluate(() => {
      const allow = [/^Тамбов/];
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent.trim();
        if (!t || !/[а-яёА-ЯЁ]/.test(t)) continue;
        const el = n.parentElement;
        if (!el || !el.offsetParent || el.closest('script,style')) continue;
        if (allow.some((re) => re.test(t))) continue;
        out.push(t.slice(0, 40));
      }
      return [...new Set(out)].slice(0, 6);
        });
      }
      if (name === 'index-en-browser') {
        // an explicit click is remembered, and it outranks the browser locale
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(1500);
        langFlip.sticky = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          title: document.title,
          stored: localStorage.getItem('mbl-lang'),
        }));
      }
      await page.click(`[data-lang-btn="${wantLang}"]`);
      await page.waitForTimeout(250);
    }

    const shot = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: shot, fullPage: false });

    if (['index', 'case-tg', 'projects'].includes(name)) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${name}-mobile.png`), fullPage: false });
    }

    // 360px is the width the layout promises to hold: nothing may push it sideways
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(350);
    facts.overflow360 = await page.evaluate(() => {
      const de = document.documentElement;
      const off = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.ticker') || el.classList.contains('skip-link')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        if (b.right > de.clientWidth + 1) off.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
      }
      return {
        clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
        overflow: de.scrollWidth > de.clientWidth + 1,
        offenders: [...new Set(off)].slice(0, 5),
      };
    });

    report.push({ name, rel, locale, wantLang, errors, facts, langFlip, shot });
    await context.close();
  }

  // nav consistency across pages
  const navSets = report.filter((r) => r.facts.navLinks.length)
    .map((r) => JSON.stringify(r.facts.navLinks));
  const navConsistent = navSets.every((s) => s === navSets[0]) && JSON.parse(navSets[0] || '[]').join() === NAV.join();

  /* ------------------------------------------------------------------ asserts --
     Every defect found in QA keeps a check here, so it cannot come back silently. */
  const failures = [];
  const j = (v) => JSON.stringify(v);
  for (const r of report) {
    const f = r.facts;
    if (r.errors.length) failures.push(`${r.name}: ${r.errors.length} error(s) — ${r.errors[0]}`);
    if (f.lang !== r.wantLang) failures.push(`${r.name}: locale ${r.locale} loaded lang=${f.lang}, expected ${r.wantLang}`);
    if (f.bodyCyrillic && f.bodyCyrillic.length) failures.push(`${r.name}: Cyrillic visible in a page loaded as English — ${j(f.bodyCyrillic)}`);
    if (f.h1Count !== 1) failures.push(`${r.name}: ${f.h1Count} <h1> (exactly one expected)`);
    if (f.literalMd.length) failures.push(`${r.name}: markdown markers in plain text — ${j(f.literalMd)}`);
    if (f.vocabulary.length) failures.push(`${r.name}: internal vocabulary in visible copy — ${j(f.vocabulary)}`);
    if (f.hero && f.hero.present) {
      if (!f.hero.halo) failures.push(`${r.name}: hero mark has no dark pocket (.hero-visual-halo)`);
      if (f.hero.logoLoaded !== true) failures.push(`${r.name}: hero mark did not load (naturalWidth ${f.hero.logoLoaded})`);
      if (!f.hero.copyShadow || f.hero.copyShadow === 'none') failures.push(`${r.name}: hero copy lost its dark halo`);
      if (f.hero.gradientShadow !== 'none') failures.push(`${r.name}: the gradient wordmark carries a text-shadow (doubles the headline)`);
    }
    if (f.smallText.length) failures.push(`${r.name}: type below 12px — ${j(f.smallText)}`);
    if (f.overflow360.overflow) failures.push(`${r.name}: sideways at 360px (${f.overflow360.scrollWidth} > ${f.overflow360.clientWidth}) — ${j(f.overflow360.offenders)}`);
    if (f.contrast.length) failures.push(`${r.name}: contrast below the floor — ${j(f.contrast.slice(0, 3))}`);
    for (const p of f.contrastPairs) {
      if (!p.tokenOk) failures.push(`${r.name}: ${p.sel} does not use the token of its surface`);
      if (p.ratio < 4.5) failures.push(`${r.name}: ${p.sel} contrast ${p.ratio} < 4.5`);
    }
    if (f.ambient) {
      if (r.rel.includes('?static')) {
        if (f.ambience !== null) failures.push(`${r.name}: ?static must remove the canvas`);
      } else if (!f.ambience || !f.ambience.reactsToPointer || !f.ambience.lit) {
        failures.push(`${r.name}: ambience probe ${j(f.ambience)}`);
      }
    }
    if (r.langFlip) {
      if (!r.langFlip.changed) failures.push(`${r.name}: ${r.langFlip.target} toggle changed nothing`);
      if (r.langFlip.wantTitle && r.langFlip.title !== r.langFlip.wantTitle) {
        failures.push(`${r.name}: tab title ${j(r.langFlip.title)} is not the ${r.langFlip.target} pair ${j(r.langFlip.wantTitle)}`);
      }
      if (r.langFlip.pressed !== 'true') failures.push(`${r.name}: ${r.langFlip.target} button aria-pressed=${r.langFlip.pressed}`);
      if (r.langFlip.leftoverCyrillic && r.langFlip.leftoverCyrillic.length) failures.push(`${r.name}: Cyrillic left in EN mode — ${j(r.langFlip.leftoverCyrillic)}`);
      if (r.langFlip.stored !== r.langFlip.target) failures.push(`${r.name}: clicking ${r.langFlip.target} stored ${r.langFlip.stored}`);
      if (r.langFlip.sticky && r.langFlip.sticky.lang !== 'ru') failures.push(`${r.name}: the stored choice was ignored across a reload (lang=${r.langFlip.sticky.lang}, stored=${r.langFlip.sticky.stored})`);
    }
    if (r.name.startsWith('case-') && r.name !== 'case-missing' && f.h1 && !f.docTitle.includes(f.h1)) {
      failures.push(`${r.name}: document.title ${j(f.docTitle)} does not carry the case title`);
    }
  }
  if (!navConsistent) failures.push('nav is not identical on every page');

  // the icon files must exist on disk, since a 404 favicon is silent in a browser
  for (const f of ['assets/emblem.svg', 'assets/favicon-16.png', 'assets/favicon-32.png',
                   'assets/apple-touch-icon.png']) {
    if (!fs.existsSync(path.join(ROOT, f))) failures.push(`missing icon file ${f}`);
  }
  const EXPECTED_ICONS = ['assets/emblem.svg', 'assets/favicon-32.png', 'assets/favicon-16.png', 'assets/apple-touch-icon.png'];
  for (const r of report) {
    const f = r.facts;
    if (EXPECTED_ICONS.some((x) => !f.icons.includes(x))) failures.push(`${r.name}: icon links ${j(f.icons)}`);
    if (f.themeColor !== '#0b0c10') failures.push(`${r.name}: theme-color ${j(f.themeColor)}`);
    if (!f.brandMark) failures.push(`${r.name}: no header mark`);
    else {
      if (f.brandMark.carriesOldCyan) failures.push(`${r.name}: the header mark still carries the old cyan`);
      if (!f.brandMark.colours.includes('#2f7bff') || !f.brandMark.colours.includes('#ff3d5e')) {
        failures.push(`${r.name}: header mark colours ${j(f.brandMark.colours)}`);
      }
      if (f.brandMark.box !== '0 0 24 24') failures.push(`${r.name}: header mark viewBox ${j(f.brandMark.box)}`);
    }
  }

  await browser.close();
  console.log(JSON.stringify({ base, navConsistent, assertsOk: failures.length === 0, failures, report }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((err) => { console.error('HARNESS FAILURE:', err); process.exit(1); });
