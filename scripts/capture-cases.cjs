/* Capture the case-study screenshots into assets/cases/<case-id>/.
 *
 * Run:
 *   NODE_PATH="$LOCALAPPDATA/hermes/hermes-agent/node_modules" \
 *     "$LOCALAPPDATA/hermes/node/node.exe" scripts/capture-cases.cjs [case-id ...]
 *
 * Two capture kinds:
 *   github  — the public repository page (proves the code exists and is public)
 *   readme  — an excerpt of a local repository's README, rendered in the site's
 *             own typography (the project is private, so there is no public page)
 *
 * Output is deterministic in size (1280 wide, max 900 tall, dpr 1) so the gallery
 * grid keeps a consistent aspect ratio.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'cases');
const CHROME = process.env.PW_CHROMIUM ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');

const VIEW = { width: 1280, height: 900 };
const MAX_H = 820;

const SPECS = [
  { id: 'tg-aggregator', kind: 'readme', name: 'pipeline-overview', file: 'H:/Work/tg-aggregator/README.md',
    heading: '## Quick start (local)' },
  { id: 'ai-agents-automation', kind: 'readme', name: 'service-readme', file: 'H:/Work/parser/README.md',
    heading: '## Current status' },
  { id: 'lilys-innovations', kind: 'github', name: 'repository', url: 'https://github.com/IonShieldQuad/lilys-innovations' },
  { id: 'android-apps', kind: 'github', name: 'planner-repository', url: 'https://github.com/IonShieldQuad/Planner' },
  { id: 'compiler-translator', kind: 'github', name: 'analyzer-repository', url: 'https://github.com/IonShieldQuad/Analyzer' },
  { id: 'neural-net-from-scratch', kind: 'github', name: 'evasion-learning-repository', url: 'https://github.com/IonShieldQuad/Evasion-learning' },
  { id: 'compression-algorithms', kind: 'github', name: 'compressor-repository', url: 'https://github.com/IonShieldQuad/Compressor-2' },
  { id: 'sorting-visualizer', kind: 'github', name: 'sorting-repository', url: 'https://github.com/IonShieldQuad/Sorting-algorithms' },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* A README excerpt rendered with the site's own fonts and spacing, so a private
   project still has a readable, honest artefact on its case page. */
function readmeHtml(md, heading) {
  const lines = md.split(/\r?\n/);
  const start = heading ? Math.max(0, lines.findIndex((l) => l.trim() === heading)) : 0;
  const slice = lines.slice(start, start + 46).join('\n');
  const body = slice.split('\n').map((line) => {
    const t = line.trimEnd();
    if (!t.trim()) return '';
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) return `<h${h[1].length + 1}>${esc(h[2].replace(/[*`]/g, ''))}</h${h[1].length + 1}>`;
    const li = t.match(/^\s*[-*]\s+(.*)$/);
    if (li) return `<li>${esc(li[1].replace(/`/g, ''))}</li>`;
    const ol = t.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) return `<li>${esc(ol[1].replace(/`/g, ''))}</li>`;
    if (/^\|/.test(t)) return `<pre class="row">${esc(t.replace(/`/g, ''))}</pre>`;
    if (/^```/.test(t)) return '';
    return `<p>${esc(t.replace(/`/g, '').replace(/\*\*/g, ''))}</p>`;
  }).join('\n').replace(/<\/li>\s*<li>/g, '</li><li>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --carbon:#0b0c10; --carbon2:#13151c; --ink:#10141a; --ink-dim:#4a545f; --line:#dce1e8; --accent-ink:#0b64a8; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Inter","Segoe UI",system-ui,sans-serif; color:var(--ink); background:#f5f7fa;
           font-size:16px; line-height:1.55; }
    .doc { width:1280px; padding:44px 56px 40px; background:#f5f7fa;
           background-image:linear-gradient(#ffffff,#ffffff); }
    .doc::before { content:"README"; display:block; font-family:"JetBrains Mono",ui-monospace,monospace;
           font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--accent-ink);
           border-bottom:1px solid var(--line); padding-bottom:12px; margin-bottom:22px; }
    h2,h3,h4 { font-family:"Space Grotesk","Segoe UI",system-ui,sans-serif; margin:22px 0 8px; line-height:1.25; }
    h2 { font-size:30px; } h3 { font-size:20px; } h4 { font-size:17px; }
    p { margin:0 0 10px; max-width:74ch; color:#1d2530; }
    li { margin:0 0 5px; color:#1d2530; }
    ul,ol { margin:0 0 12px; padding-left:22px; }
    pre.row { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:12.5px; color:var(--ink-dim);
             margin:0 0 2px; white-space:pre-wrap; }
    .overflow { max-height:820px; overflow:hidden; }
  </style></head><body><div class="doc"><div class="overflow">${body}</div></div></body></html>`;
}

(async () => {
  const only = process.argv.slice(2);
  const specs = only.length ? SPECS.filter((s) => only.includes(s.id)) : SPECS;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--font-render-hinting=none'] });
  const results = [];
  for (const spec of specs) {
    const dir = path.join(OUT, spec.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${spec.name}.png`);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, locale: 'en-US',
      reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    try {
      if (spec.kind === 'github') {
        await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.markdown-body, article', { timeout: 30000 }).catch(() => {});
        // the repo header carries the verification signal: keep it in frame
        const header = await page.$('.repository-content, main');
        if (header) {
          const box = await header.boundingBox();
          if (box) {
            await page.screenshot({ path: file, clip: {
              x: Math.max(0, box.x), y: Math.max(0, box.y),
              width: Math.min(VIEW.width, box.width),
              height: Math.min(MAX_H, Math.max(400, Math.min(box.height, 1400))),
            } });
          } else {
            await page.screenshot({ path: file, clip: { x: 0, y: 0, width: VIEW.width, height: MAX_H } });
          }
        } else {
          await page.screenshot({ path: file, clip: { x: 0, y: 0, width: VIEW.width, height: MAX_H } });
        }
        const title = await page.title();
        results.push({ id: spec.id, file, kind: spec.kind, source: spec.url, title });
      } else {
        const md = fs.readFileSync(spec.file, 'utf8');
        await page.setContent(readmeHtml(md, spec.heading), { waitUntil: 'load' });
        await page.screenshot({ path: file, clip: { x: 0, y: 0, width: VIEW.width, height: MAX_H } });
        results.push({ id: spec.id, file, kind: spec.kind, source: spec.file });
      }
      const st = fs.statSync(file);
      console.log(`ok   ${spec.id}/${spec.name}.png  ${Math.round(st.size / 1024)} KB`);
    } catch (err) {
      console.log(`FAIL ${spec.id}/${spec.name}: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'capture-log.json'), JSON.stringify(results, null, 2));
})();
