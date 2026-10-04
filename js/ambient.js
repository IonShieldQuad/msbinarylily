/* Interactive hero ambience: a grid of binary glyphs and greebles that lights up
   under the pointer, cold on the left, hot on the right (the brand's binary
   duality). Deliberately Canvas2D, not WebGL: glyphs stay crisp, and the cost is
   paid only where the pointer is, because the base layer is drawn once into an
   offscreen canvas. `?static` or prefers-reduced-motion removes it entirely and
   leaves the CSS greeble backdrop. */

(() => {
  'use strict';

  const canvas = document.getElementById('ambient');
  if (!canvas) return;
  const params = new URLSearchParams(location.search);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (params.has('static') || reduced.matches) { canvas.remove(); return; }

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  const CELL = 26;
  const RADIUS = 175;
  const GREEBLES = '▪▫◆◇□▣┼╋▤▥';
  const BASE_ALPHA = 0.19;

  let W = 0, H = 0, cols = 0, rows = 0, dpr = 1;
  let base = document.createElement('canvas');
  let baseCtx = base.getContext('2d');
  let cells = [];
  const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false, burst: 0 };
  let raf = 0, lastDraw = 0, lastPointer = 0;
  const HOTSPOTS = [];

  /* cold -> violet -> hot across the width: the binary pole split */
  const COLD = [47, 123, 255], VIOLET = [124, 77, 255], HOT = [255, 61, 94];
  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  const poleColor = (t) => (t < 0.5 ? mix(COLD, VIOLET, t * 2) : mix(VIOLET, HOT, (t - 0.5) * 2));

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth || 1200;
    const h = canvas.clientHeight || 600;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    cols = Math.ceil(w / CELL) + 1;
    rows = Math.ceil(h / CELL) + 1;

    cells = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const roll = Math.random();
        row.push({
          glyph: roll < 0.72 ? (Math.random() < 0.5 ? '0' : '1')
            : roll < 0.9 ? '·' : GREEBLES[(Math.random() * GREEBLES.length) | 0],
          greeble: roll >= 0.9,
          phase: Math.random() * Math.PI * 2,
        });
      }
      cells.push(row);
    }

    /* a few permanent glows, so the field has structure rather than an even
       noise floor; baked into the base layer, so they cost nothing per frame */
    HOTSPOTS.length = 0;
    [[0.16, 0.68, 150], [0.62, 0.24, 135], [0.88, 0.74, 160], [0.36, 0.18, 120]]
      .forEach(([fx, fy, r]) => HOTSPOTS.push({ x: fx * W, y: fy * H, r }));

    /* base layer: every cell at its dim resting alpha, drawn once */
    base.width = canvas.width;
    base.height = canvas.height;
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, W, H);
    baseCtx.font = '12px "JetBrains Mono", ui-monospace, monospace';
    baseCtx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r][c];
        const x = c * CELL + 6, y = r * CELL + 13;
        let a = BASE_ALPHA;
        let col = '214, 236, 246';
        for (const h of HOTSPOTS) {
          const d = Math.hypot(x - h.x, y - h.y);
          if (d < h.r) {
            const fall = (1 - d / h.r) ** 2 * 0.38;
            if (fall > 0) {
              const [rr, gg, bb] = poleColor(x / W);
              a = Math.max(a, BASE_ALPHA + fall);
              col = `${rr}, ${gg}, ${bb}`;
            }
          }
        }
        baseCtx.fillStyle = `rgba(${col}, ${a})`;
        baseCtx.fillText(cell.glyph, x, y);
      }
    }
  }

  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (now - lastDraw < 33) return;           // ~30fps is plenty for ambience
    lastDraw = now;

    // no mouse for a while? sweep the light across so the texture is alive and
    // the interactivity is discoverable instead of looking like static noise
    if (now - lastPointer > 2500) {
      pointer.tx = W * (0.5 + 0.4 * Math.sin(now / 6500));
      pointer.ty = H * (0.48 + 0.14 * Math.sin(now / 9000));
      pointer.active = true;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.18;
    pointer.y += (pointer.ty - pointer.y) * 0.18;
    if (pointer.burst > 0) pointer.burst *= 0.94;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);

    const radius = RADIUS + pointer.burst * 260;
    const c0 = Math.max(0, Math.floor((pointer.x - radius) / CELL));
    const c1 = Math.min(cols - 1, Math.ceil((pointer.x + radius) / CELL));
    const r0 = Math.max(0, Math.floor((pointer.y - radius) / CELL));
    const r1 = Math.min(rows - 1, Math.ceil((pointer.y + radius) / CELL));

    ctx.font = '12px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    if (pointer.active) {
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = cells[r][c];
          const dx = c * CELL + 6 - pointer.x;
          const dy = r * CELL + 13 - pointer.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius) continue;
          const fall = 1 - d / radius;
          const pulse = 0.5 + 0.5 * Math.sin(now / 900 + cell.phase);
          const a = Math.min(0.95, fall * fall * (0.55 + 0.45 * pulse) + pointer.burst * 0.25);
          const [rr, gg, bb] = poleColor((c * CELL) / W);
          ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${a})`;
          if (cell.greeble) {
            ctx.fillRect(c * CELL + 4, r * CELL + 5, 16, 16);
            ctx.fillStyle = `rgba(11, 12, 16, ${a * 0.85})`;
            ctx.fillRect(c * CELL + 7, r * CELL + 8, 10, 10);
          } else {
            ctx.fillText(cell.glyph, c * CELL + 6, r * CELL + 13);
          }
        }
      }
    }
  }

  const hero = canvas.closest('.hero') || canvas.parentElement;
  hero.addEventListener('pointermove', (e) => {
    lastPointer = performance.now();
    const rect = canvas.getBoundingClientRect();
    pointer.tx = e.clientX - rect.left;
    pointer.ty = e.clientY - rect.top;
    if (!pointer.active) { pointer.x = pointer.tx; pointer.y = pointer.ty; pointer.active = true; }
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer.active = false; });
  hero.addEventListener('pointerdown', () => { pointer.burst = 1; });

  const onResize = () => { build(); };
  window.addEventListener('resize', onResize, { passive: true });
  reduced.addEventListener('change', (e) => { if (e.matches) { cancelAnimationFrame(raf); canvas.remove(); } });

  build();
  raf = requestAnimationFrame(draw);
})();
