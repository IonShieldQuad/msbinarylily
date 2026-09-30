/* MsBinaryLily portfolio — site behaviour (vanilla, no framework per ADR-001).
   Responsibilities: manifest loading, RU/EN toggle, case rendering, filters,
   scroll reveal, WebGL ambience with a ?static escape hatch. */

(() => {
  'use strict';

  const STORE_KEY = 'mbl-lang';
  const REQUIRED_LANG = new Set(['ru', 'en']);
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wantsStatic = new URLSearchParams(location.search).has('static');

  const state = {
    lang: 'ru',
    manifest: null,
    cases: [],
    filter: 'all',
  };

  /* ------------------------------------------------------------------ i18n -- */

  function applyLang(lang) {
    state.lang = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-ru]').forEach((el) => {
      const value = lang === 'en' ? el.dataset.en || el.dataset.ru : el.dataset.ru;
      if (value != null) el.textContent = value;
    });
    document.querySelectorAll('[data-ru-html]').forEach((el) => {
      el.innerHTML = lang === 'en' ? el.dataset.enHtml || el.dataset.ruHtml : el.dataset.ruHtml;
    });
    document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.langBtn === lang));
    });
    try { localStorage.setItem(STORE_KEY, lang); } catch (_) { /* private mode */ }
    renderDynamic();
  }

  function storedLang() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (REQUIRED_LANG.has(saved)) return saved;
    } catch (_) { /* ignore */ }
    return document.documentElement.lang === 'en' ? 'en' : 'ru';
  }

  const t = (pair) => {
    if (pair == null) return '';
    if (typeof pair === 'string') return pair;
    return (state.lang === 'en' ? pair.en : pair.ru) || pair.ru || '';
  };

  /* --------------------------------------------------------- markdown mini -- */

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function inline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<![\w"'])\*([^*\n]+)\*(?![\w"'])/g, '<em>$1</em>')
      .replace(/\b(https?:\/\/[^\s<)]+)/g, (m) => {
        const url = m.replace(/[.,;]+$/, '');
        const tail = m.slice(url.length);
        return `<a href="${url}" rel="noopener">${url}</a>${tail}`;
      });
  }

  function mdToHtml(src) {
    const out = [];
    let list = false;
    const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
    for (const raw of String(src || '').split('\n')) {
      const line = raw.trimEnd();
      if (!line.trim()) { closeList(); continue; }
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        if (!list) { out.push('<ul>'); list = true; }
        out.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      closeList();
      const head = line.match(/^(#{3,4})\s+(.*)$/);
      if (head) { out.push(`<h4>${inline(head[2])}</h4>`); continue; }
      const num = line.match(/^\s*(\d+)\.\s+(.*)$/);
      if (num) {
        if (!list) { out.push('<ul>'); list = true; }
        out.push(`<li>${inline(num[2])}</li>`);
        continue;
      }
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    return out.join('');
  }

  /* --------------------------------------------------------------- manifest -- */

  async function loadManifest() {
    if (window.MBL_CASES) return window.MBL_CASES;
    const res = await fetch('data/cases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`cases.json → HTTP ${res.status}`);
    return res.json();
  }

  function caseById(id) {
    return state.cases.find((c) => c.id === id) || null;
  }

  function themeLabel(theme) {
    return theme ? theme.toUpperCase() : '';
  }

  /* ------------------------------------------------------------- rendering -- */

  function caseCard(c, index) {
    const title = t(c.title);
    const overview = t(c.overview);
    const chips = (c.stack || []).slice(0, 4)
      .map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
    const flag = c.featured
      ? `<span class="card-flag" data-ru="featured" data-en="featured">featured</span>`
      : `<span class="chip">${themeLabel(c.theme)}</span>`;
    return `
      <a class="card clip reveal" href="case.html?project=${encodeURIComponent(c.id)}" style="transition-delay:${Math.min(index * 60, 360)}ms">
        <div class="card-top">
          <svg class="card-hex" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6 21 7v10l-9 5.4L3 17V7z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 6.4 16.8 9v5.2L12 16.9l-4.8-2.7V9z" fill="currentColor" opacity=".45"/></svg>
          ${flag}
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(overview.split(/\n/)[0]).slice(0, 210)}</p>
        <div class="chips">${chips}</div>
      </a>`;
  }

  function renderFeatured() {
    const host = document.getElementById('featured-cases');
    if (!host) return;
    const featured = state.cases.filter((c) => c.featured).slice(0, 4);
    host.innerHTML = featured.map(caseCard).join('') ||
      '<p class="empty-state">no featured cases yet</p>';
    observeReveals();
  }

  function renderFilterChips() {
    const host = document.getElementById('case-filters');
    if (!host) return;
    const themes = [...new Set(state.cases.filter((c) => c.theme).map((c) => c.theme))].sort();
    const all = `<button class="chip chip-neon" type="button" data-filter="all" aria-pressed="true" data-ru="все" data-en="all">все</button>`;
    host.innerHTML = all + themes.map((th) => {
      const active = state.filter === th;
      return `<button class="chip" type="button" data-filter="${th}" aria-pressed="${active}">${themeLabel(th)}</button>`;
    }).join('');
    host.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        host.querySelectorAll('[data-filter]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b === btn));
          b.classList.toggle('chip-neon', b === btn);
        });
        renderProjects();
      });
    });
  }

  function renderProjects() {
    const host = document.getElementById('case-grid');
    if (!host) return;
    const list = state.filter === 'all'
      ? state.cases
      : state.cases.filter((c) => c.theme === state.filter);
    host.innerHTML = list.map(caseCard).join('') ||
      '<p class="empty-state">no cases in this category yet</p>';
    observeReveals();
  }

  function renderCasePage() {
    const host = document.getElementById('case-root');
    if (!host) return;
    const id = new URLSearchParams(location.search).get('project');
    const c = caseById(id);
    if (!c) {
      host.innerHTML = `<section class="section-panel"><div class="wrap">
        <p class="kicker">404</p>
        <h2>${state.lang === 'en' ? 'Case not found' : 'Кейс не найден'}</h2>
        <p class="lede">${state.lang === 'en' ? 'No case with the id' : 'Нет кейса с идентификатором'} <code>${escapeHtml(id || '')}</code>.</p>
        <p><a class="btn" href="projects.html">${state.lang === 'en' ? 'All projects' : 'Все проекты'}</a></p>
      </div></section>`;
      return;
    }

    const order = state.cases;
    const i = order.indexOf(c);
    const prev = order[i - 1];
    const next = order[i + 1];
    const sections = [
      ['role', 'role', 'Роль'],
      ['problem', 'context', 'Контекст'],
      ['solution', 'solution', 'Решение'],
      ['impact', 'impact', 'Результат'],
      ['deepDive', 'deep-dive', 'Технические детали'],
      ['lessons', 'lessons', 'Выводы'],
      ['related', 'related', 'Связанное'],
    ].filter(([key]) => c[key] && t(c[key]));

    const srcLang = c.lang === 'ru' ? 'ru' : 'en';
    const untranslated = state.lang !== srcLang;
    const notice = !untranslated ? '' : (state.lang === 'ru'
      ? `<p class="notice">Перевод на русский готовится — сейчас показан английский оригинал кейса
         (<code>translation.ru: missing</code> в манифесте).</p>`
      : `<p class="notice">EN translation pending — showing the RU source
         (<code>translation.en: missing</code> in the manifest).</p>`);

    host.innerHTML = `
      <section class="case-head">
        <div class="wrap">
          <p class="kicker">${themeLabel(c.theme)} · case</p>
          <h1>${escapeHtml(t(c.title))}</h1>
          <p class="lede">${escapeHtml(t(c.overview).split(/\n/)[0])}</p>
          <div class="chips">${(c.stack || []).map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</div>
        </div>
      </section>
      <section class="section-panel">
        <div class="wrap">
          ${notice}
          <div class="case-body">
            <div class="prose">
              ${sections.map(([key, id, label]) => `
                <div class="case-section" id="${id}">
                  <h2>${label}</h2>
                  ${mdToHtml(t(c[key]))}
                </div>`).join('')}
            </div>
            <aside class="case-side">
              <div class="holo clip">
                <p class="kicker">timeline</p>
                <p>${escapeHtml(t(c.timeline))}</p>
              </div>
              ${(c.evidence || []).length ? `
              <div>
                <p class="kicker">evidence</p>
                <ul class="evidence">
                  ${c.evidence.map((e) => e.url
                    ? `<li><a href="${escapeHtml(e.url)}" rel="noopener">${escapeHtml(e.url.replace(/^https?:\/\//, ''))}</a></li>`
                    : `<li><span class="empty-state">${escapeHtml(e.label)} <span data-ru="(в заметках хранилища)" data-en="(vault note)">(в заметках хранилища)</span></span></li>`).join('')}
                </ul>
              </div>` : ''}
            </aside>
          </div>
          <nav class="pager">
            ${prev ? `<a href="case.html?project=${prev.id}" data-ru="← ${escapeHtml(t(prev.title))}" data-en="← ${escapeHtml(t(prev.title))}">← ${escapeHtml(t(prev.title))}</a>` : '<span></span>'}
            ${next ? `<a href="case.html?project=${next.id}" data-ru="${escapeHtml(t(next.title))} →" data-en="${escapeHtml(t(next.title))} →">${escapeHtml(t(next.title))} →</a>` : '<span></span>'}
          </nav>
        </div>
      </section>`;
  }

  function renderDynamic() {
    renderFeatured();
    renderProjects();
    renderFilterChips();
    renderCasePage();
    applyTicker();
  }

  function applyTicker() {
    const track = document.getElementById('ticker-track');
    if (!track || track.dataset.built === '1') return;
    track.innerHTML = '';
    const items = (track.dataset.items || '').split('|').map((s) => s.trim()).filter(Boolean);
    // duplicated once so the -50% marquee translate loops seamlessly
    track.innerHTML = `<span>${items.map((s) => escapeHtml(s)).join('</span><span>')}</span>`.repeat(2);
    track.dataset.built = '1';
  }

  /* ---------------------------------------------------------------- reveal -- */

  let observer = null;
  function observeReveals() {
    const targets = document.querySelectorAll('.reveal:not(.is-visible)');
    if (!targets.length) return;
    if (prefersReduced.matches || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    targets.forEach((el) => observer.observe(el));
  }

  /* -------------------------------------------------------------- ambience -- */

  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `
    precision mediump float;
    uniform vec2 R; uniform float T;
    float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}
    float glow(vec2 uv, vec2 c, float r){
      float d = length(uv-c);
      return r/(d*d*900.0 + r);
    }
    void main(){
      vec2 uv = (gl_FragCoord.xy - 0.5*R)/min(R.x,R.y);
      vec3 col = vec3(0.0);
      vec2 c1 = vec2(sin(T*0.13)*0.55, cos(T*0.11)*0.30);
      vec2 c2 = vec2(cos(T*0.09)*0.62, sin(T*0.17)*0.34);
      vec2 c3 = vec2(sin(T*0.07+2.1)*0.40, cos(T*0.05+1.3)*0.45);
      col += vec3(0.0,0.72,0.86) * glow(uv,c1,0.085);
      col += vec3(0.42,0.24,0.95) * glow(uv,c2,0.075);
      col += vec3(0.65,0.35,0.95) * glow(uv,c3,0.055);
      float scan = sin((uv.y*R.y*0.5) + T*1.2)*0.006;
      float grain = (hash(gl_FragCoord.xy + T) - 0.5)*0.05;
      col += scan + grain;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function initAmbient() {
    const canvas = document.getElementById('ambient');
    if (!canvas) return;
    if (wantsStatic || prefersReduced.matches) { canvas.remove(); return; }
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, powerPreference: 'low-power' });
    if (!gl) { canvas.remove(); return; }

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };

    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uR = gl.getUniformLocation(prog, 'R');
      const uT = gl.getUniformLocation(prog, 'T');

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
      };
      resize();
      window.addEventListener('resize', resize, { passive: true });

      let raf = 0;
      const start = performance.now();
      const frame = (now) => {
        gl.uniform2f(uR, canvas.width, canvas.height);
        gl.uniform1f(uT, (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        raf = requestAnimationFrame(frame);
      };
      const stop = () => { cancelAnimationFrame(raf); raf = 0; };
      const startLoop = () => { if (!raf) raf = requestAnimationFrame(frame); };

      startLoop();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop(); else startLoop();
      });
    } catch (err) {
      canvas.remove();           // shader failure → keep the CSS gradient
      console.warn('ambient disabled:', err.message);
    }
  }

  /* ------------------------------------------------------------------ boot -- */

  function initChrome() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('site-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
      });
    }
    document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
      btn.addEventListener('click', () => applyLang(btn.dataset.langBtn));
    });
  }

  async function boot() {
    initChrome();
    initAmbient();
    try {
      state.manifest = await loadManifest();
      state.cases = state.manifest.cases || [];
    } catch (err) {
      console.warn('manifest unavailable:', err.message);
      const note = document.querySelectorAll('[data-manifest-note]');
      note.forEach((el) => { el.hidden = false; });
    }
    applyLang(storedLang());
    observeReveals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
