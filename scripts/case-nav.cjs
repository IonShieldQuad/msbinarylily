/* Navigation proof: every case is reachable from the projects index, every case
 * page renders its own title, and the pager + header links take you back and
 * onward. Fails on a case that shows the not-found state, a dead pager link, or a
 * card that does not lead to its case.
 *
 * Run:
 *   NODE_PATH="$LOCALAPPDATA/hermes/hermes-agent/node_modules" \
 *     "$LOCALAPPDATA/hermes/node/node.exe" scripts/case-nav.cjs [baseUrl]
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.PW_CHROMIUM ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const base = (process.argv[2] || 'file:///' + ROOT.replace(/\\/g, '/')).replace(/\/$/, '');
const url = (p) => `${base}/${p}`;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cases.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const failures = [];
  const rows = [];

  // 1. the index lists every case and each card leads to that case
  await page.goto(url('projects.html'), { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const cards = await page.$$eval('#case-grid-client .card, #case-grid-depth .card', (as) =>
    as.map((a) => ({ href: a.getAttribute('href'), title: (a.querySelector('h3')?.textContent || '').trim() })));
  if (cards.length !== manifest.cases.length) {
    failures.push(`projects.html lists ${cards.length} case(s), the manifest has ${manifest.cases.length}`);
  }
  for (const c of manifest.cases) {
    const hit = cards.find((x) => decodeURIComponent(x.href || '').includes(`project=${c.id}`));
    if (!hit) failures.push(`projects.html has no card for '${c.id}'`);
  }

  // 2. each case page renders its own title, and its pager/header links resolve
  for (const c of manifest.cases) {
    const rel = `case.html?project=${encodeURIComponent(c.id)}`;
    await page.goto(url(rel), { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    const facts = await page.evaluate(() => ({
      h1: (document.querySelector('#case-root h1, .case-head h1')?.textContent || '').trim(),
      notFound: !!document.querySelector('#case-root .kicker') &&
        (document.querySelector('#case-root .kicker').textContent || '').includes('404'),
      pager: [...document.querySelectorAll('.pager a')].map((a) => a.getAttribute('href')),
      back: [...document.querySelectorAll('#site-nav a')].map((a) => a.getAttribute('href')),
      sections: document.querySelectorAll('.case-section').length,
      figures: document.querySelectorAll('.case-figure img').length,
      title: document.title,
    }));
    const want = (c.title && (c.title.ru || c.title.en)) || c.id;
    if (facts.notFound) failures.push(`${c.id}: case page rendered the not-found state`);
    if (!facts.h1) failures.push(`${c.id}: case page has no <h1>`);
    else if (!facts.h1.toLowerCase().includes(String(want).toLowerCase().slice(0, 12))) {
      failures.push(`${c.id}: page title ${JSON.stringify(facts.h1)} does not match ${JSON.stringify(want)}`);
    }
    if (!facts.title.startsWith(facts.h1)) failures.push(`${c.id}: document.title ${JSON.stringify(facts.title)} does not start with the case title`);
    if (facts.sections < 4) failures.push(`${c.id}: only ${facts.sections} case section(s) rendered`);
    if (!facts.pager.length) failures.push(`${c.id}: no pager links`);
    for (const href of facts.pager) {
      if (!href || !href.includes('project=')) failures.push(`${c.id}: pager link ${JSON.stringify(href)} is malformed`);
    }
    for (const href of facts.back) {
      const file = path.join(ROOT, href.split('?')[0]);
      if (!fs.existsSync(file)) failures.push(`${c.id}: nav link ${href} does not exist on disk`);
    }
    rows.push({ id: c.id, h1: facts.h1, sections: facts.sections, figures: facts.figures, pager: facts.pager.length });
  }

  // 3. clicking a card lands on the matching case (the real click path, not a URL)
  await page.goto(url('projects.html'), { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const firstHref = await page.$eval('#case-grid-client .card', (a) => a.getAttribute('href'));
  await page.click('#case-grid-client .card');
  await page.waitForTimeout(2200);
  const landed = await page.evaluate(() => ({
    h1: (document.querySelector('#case-root h1, .case-head h1')?.textContent || '').trim(),
    search: location.search,
  }));
  if (!landed.search.includes('project=')) failures.push(`clicking a project card landed on ${landed.search || '(no query)'}`);
  if (!firstHref.includes(landed.search.replace('?', ''))) failures.push(`clicking ${firstHref} landed on ${landed.search}`);
  if (!landed.h1) failures.push('clicking a project card produced a page with no case heading');

  await browser.close();
  console.log(JSON.stringify({ ok: failures.length === 0, failures, cards: cards.length, rows }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((err) => { console.error('HARNESS FAILURE:', err); process.exit(1); });
