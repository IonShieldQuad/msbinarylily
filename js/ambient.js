/* Hero ambience: a black circuit board with energy running through its channels.
   Canvas2D (crisp lines, cheap): the board itself is baked once per resize, and
   per frame only the pulses are drawn. The pointer lights the channel it is over
   and accelerates a pulse toward the cursor. `?static` /
   prefers-reduced-motion remove the canvas entirely, leaving the CSS board. */

(() => {
  'use strict';

  const canvas = document.getElementById('ambient');
  if (!canvas) return;
  const params = new URLSearchParams(location.search);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (params.has('static') || reduced.matches) { canvas.remove(); return; }

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  const CELL = 48;          // board pitch
  const TRACE_ALPHA = 0.16; // resting brightness of the wiring
  const PAD_ALPHA = 0.26;
  const PULSES = 26;

  const COLD = [0, 229, 255], MID = [124, 77, 255], HOT = [255, 61, 94];
  const rgb = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  let W = 0, H = 0, dpr = 1;
  const base = document.createElement('canvas');
  const baseCtx = base.getContext('2d');
  let traces = [];      // { pts:[{x,y}], len, cum:[], lane: 0..1, hot: bool }
  let pads = [];
  let greebles = [];
  let pulses = [];
  const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
  let lastPointer = 0, raf = 0, lastDraw = 0;

  const laneColor = (lane) => (lane < 0.5
    ? [COLD[0] + (MID[0] - COLD[0]) * lane * 2, COLD[1] + (MID[1] - COLD[1]) * lane * 2, COLD[2] + (MID[2] - COLD[2]) * lane * 2]
    : [MID[0] + (HOT[0] - MID[0]) * (lane - 0.5) * 2, MID[1] + (HOT[1] - MID[1]) * (lane - 0.5) * 2, MID[2] + (HOT[2] - MID[2]) * (lane - 0.5) * 2]);

  function buildTraces() {
    traces = [];
    pads = [];
    greebles = [];
    const gx = Math.floor(W / CELL), gy = Math.floor(H / CELL);
    const snap = (v) => Math.round(v / CELL) * CELL;

    const makePath = (x, y, steps, lane, hot) => {
      const pts = [{ x, y }];
      for (let i = 0; i < steps; i++) {
        const r = Math.random();
        const cur = pts[pts.length - 1];
        let nx = cur.x, ny = cur.y;
        if (r < 0.45) nx += (Math.random() < 0.5 ? -1 : 1) * CELL;      // straight run
        else if (r < 0.75) ny += (Math.random() < 0.5 ? -1 : 1) * CELL;
        else { nx += (Math.random() < 0.5 ? -1 : 1) * CELL; ny += (Math.random() < 0.5 ? -1 : 1) * CELL; } // 45° jog
        nx = Math.max(CELL, Math.min(W - CELL, nx));
        ny = Math.max(CELL, Math.min(H - CELL, ny));
        if (nx === cur.x && ny === cur.y) continue;
        // keep runs axis-aligned or 45°, never arbitrary angles
        if (nx !== cur.x && ny !== cur.y) {
          const d = Math.min(Math.abs(nx - cur.x), Math.abs(ny - cur.y));
          nx = cur.x + Math.sign(nx - cur.x) * d;
          ny = cur.y + Math.sign(ny - cur.y) * d;
        }
        pts.push({ x: nx, y: ny });
      }
      if (pts.length < 3) return null;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      }
      return { pts, cum, len: cum[cum.length - 1], lane, hot };
    };

    const count = Math.max(10, Math.round((W * H) / 260000) * 3);
    for (let i = 0; i < count; i++) {
      const lane = Math.random();
      const hot = i === 2;   // exactly one hot lane on the board
      const t = makePath(snap(Math.random() * W), snap(Math.random() * H), 3 + ((Math.random() * 4) | 0), hot ? 0.93 : lane * 0.62, hot);
      if (t) traces.push(t);
    }

    // solder pads at trace joints
    traces.forEach((t) => {
      t.pts.forEach((p, i) => {
        if (i % 2 === 0 && Math.random() < 0.5) pads.push({ x: p.x, y: p.y, r: 2 + Math.random() * 1.6 });
      });
    });

    // greebles: small angular machinery, axis-aligned only
    for (let i = 0; i < 26; i++) {
      const w = CELL * (0.35 + Math.random() * 0.7);
      const h = CELL * (0.2 + Math.random() * 0.5);
      greebles.push({
        x: snap(Math.random() * W), y: snap(Math.random() * H),
        w: Math.round(w), h: Math.round(h),
        rows: 1 + ((Math.random() * 3) | 0),
      });
    }

    pulses = [];
    for (let i = 0; i < PULSES; i++) pulses.push(spawnPulse());
  }

  function spawnPulse() {
    const t = traces[(Math.random() * traces.length) | 0];
    return { t, s: Math.random() * t.len, v: 55 + Math.random() * 95, boost: 0 };
  }

  function pointAt(t, s) {
    const d = Math.max(0, Math.min(t.len, s));
    let i = 1;
    while (i < t.cum.length - 1 && t.cum[i] < d) i++;
    const a = t.pts[i - 1], b = t.pts[i];
    const seg = t.cum[i] - t.cum[i - 1] || 1;
    const k = (d - t.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  function distanceToTrace(t, x, y) {
    let best = 1e9;
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1], b = t.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      let k = ((x - a.x) * dx + (y - a.y) * dy) / l2;
      k = Math.max(0, Math.min(1, k));
      const px = a.x + dx * k, py = a.y + dy * k;
      best = Math.min(best, Math.hypot(px - x, py - y));
    }
    return best;
  }

  function drawBoard() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = canvas.clientWidth || 1200;
    H = canvas.clientHeight || 620;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    base.width = canvas.width;
    base.height = canvas.height;
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, W, H);

    buildTraces();

    baseCtx.lineCap = 'square';
    traces.forEach((t) => {
      const col = laneColor(t.lane);
      baseCtx.beginPath();
      baseCtx.moveTo(t.pts[0].x, t.pts[0].y);
      for (let i = 1; i < t.pts.length; i++) baseCtx.lineTo(t.pts[i].x, t.pts[i].y);
      baseCtx.lineWidth = t.hot ? 2 : 1;
      baseCtx.strokeStyle = rgb(col, t.hot ? TRACE_ALPHA * 1.5 : TRACE_ALPHA);
      baseCtx.stroke();
    });

    pads.forEach((p) => {
      baseCtx.beginPath();
      baseCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      baseCtx.fillStyle = `rgba(226, 238, 248, ${PAD_ALPHA})`;
      baseCtx.fill();
      baseCtx.beginPath();
      baseCtx.arc(p.x, p.y, p.r + 3, 0, Math.PI * 2);
      baseCtx.strokeStyle = `rgba(226, 238, 248, 0.06)`;
      baseCtx.stroke();
    });

    greebles.forEach((g) => {
      baseCtx.strokeStyle = 'rgba(206, 226, 240, 0.14)';
      baseCtx.lineWidth = 1;
      baseCtx.strokeRect(g.x, g.y, g.w, g.h);
      for (let i = 1; i < g.rows; i++) {
        const y = g.y + (g.h / g.rows) * i;
        baseCtx.beginPath();
        baseCtx.moveTo(g.x + 2, y);
        baseCtx.lineTo(g.x + g.w - 2, y);
        baseCtx.stroke();
      }
    });
  }

  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (now - lastDraw < 33) return;
    const dt = Math.min(0.05, (now - lastDraw) / 1000 || 0.033);
    lastDraw = now;

    if (now - lastPointer > 2600) {           // idle: the board keeps working
      pointer.tx = W * (0.5 + 0.34 * Math.sin(now / 7000));
      pointer.ty = H * (0.5 + 0.22 * Math.sin(now / 5200));
      pointer.active = true;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.15;
    pointer.y += (pointer.ty - pointer.y) * 0.15;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);

    // channels near the cursor light up and their pulses speed toward it
    const R = 150;
    if (pointer.active) {
      traces.forEach((t) => {
        const d = distanceToTrace(t, pointer.x, pointer.y);
        if (d > R) return;
        const k = (1 - d / R) ** 2;
        const col = laneColor(t.lane);
        ctx.beginPath();
        ctx.moveTo(t.pts[0].x, t.pts[0].y);
        for (let i = 1; i < t.pts.length; i++) ctx.lineTo(t.pts[i].x, t.pts[i].y);
        ctx.lineWidth = t.hot ? 2 : 1;
        ctx.strokeStyle = rgb(col, 0.5 * k);
        ctx.stroke();
      });
    }

    pulses.forEach((p) => {
      const near = pointer.active ? Math.max(0, 1 - distanceToTrace(p.t, pointer.x, pointer.y) / (R * 1.6)) : 0;
      p.s += p.v * dt * (1 + near * 5);
      if (p.s > p.t.len) Object.assign(p, spawnPulse(), { s: 0 });
      const head = pointAt(p.t, p.s);
      const tail = pointAt(p.t, p.s - (34 + near * 70));
      const col = p.t.hot ? [224, 92, 110] : laneColor(p.t.lane);   // muted: a signal, not a spotlight
      const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      g.addColorStop(0, rgb(col, 0));
      g.addColorStop(1, rgb(col, 0.55 + near * 0.45));
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = g;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.1 + near * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = rgb(col, 0.75 + near * 0.25);
      ctx.fill();
    });
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
  window.addEventListener('resize', () => drawBoard(), { passive: true });
  reduced.addEventListener('change', (e) => { if (e.matches) { cancelAnimationFrame(raf); canvas.remove(); } });

  drawBoard();
  raf = requestAnimationFrame(draw);
})();
