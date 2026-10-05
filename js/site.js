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
    // render first, translate second: every renderer emits [data-ru]/[data-en]
    // nodes, and translating before them left that content in the source language
    renderDynamic();
    document.querySelectorAll('[data-ru]').forEach((el) => {
      const value = lang === 'en' ? el.dataset.en || el.dataset.ru : el.dataset.ru;
      if (value == null) return;
      // buttons carry their label in an inner span (it has to paint above the
      // ring layers), so write into that span rather than nuking it
      const span = el.classList.contains('btn') ? el.querySelector(':scope > span') : null;
      (span || el).textContent = value;
    });
    document.querySelectorAll('[data-ru-html]').forEach((el) => {
      el.innerHTML = lang === 'en' ? el.dataset.enHtml || el.dataset.ruHtml : el.dataset.ruHtml;
    });
    document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.langBtn === lang));
    });
    try { localStorage.setItem(STORE_KEY, lang); } catch (_) { /* private mode */ }
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

  /* the overview doubles as a teaser (cards, case lede, og:description) and those
     surfaces render plain text, so the markdown markers are stripped rather than
     converted — a teaser full of literal asterisks is what that looks like */
  function plainMd(src) {
    return String(src || '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(?<![\w"'])\*([^*\n]+)\*(?![\w"'])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
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

  /* page metadata for the single case template: one HTML file serves every case,
     so the title / description / og:* / canonical have to be written per case or
     every link previews as the same generic page */
  function setMeta(title, description, canonical) {
    document.title = title;
    const setMetaTag = (attr, key, value) => {
      let el = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    };
    if (description) setMetaTag('name', 'description', description);
    setMetaTag('property', 'og:title', title);
    if (description) setMetaTag('property', 'og:description', description);
    setMetaTag('property', 'og:url', canonical);
    setMetaTag('property', 'og:type', 'article');
    setMetaTag('name', 'twitter:card', 'summary_large_image');
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', canonical);
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
      <a class="card clip ring reveal" href="case.html?project=${encodeURIComponent(c.id)}" style="transition-delay:${Math.min(index * 60, 360)}ms">
        <div class="card-top">
          <svg class="card-hex" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6 21 7v10l-9 5.4L3 17V7z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 6.4 16.8 9v5.2L12 16.9l-4.8-2.7V9z" fill="currentColor" opacity=".45"/></svg>
          ${flag}
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(plainMd(overview.split(/\n/)[0])).slice(0, 210)}</p>
        <div class="chips">${chips}</div>
      </a>`;
  }

  function renderFeatured() {
    const host = document.getElementById('featured-cases');
    if (!host) return;
    const featured = state.cases.filter((c) => c.featured).slice(0, 4);
    host.innerHTML = featured.map(caseCard).join('') ||
      `<p class="empty-state">${state.lang === 'en' ? 'no featured cases yet' : 'избранных кейсов пока нет'}</p>`;
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
    const list = state.filter === 'all'
      ? state.cases
      : state.cases.filter((c) => c.theme === state.filter);
    const empty = `<p class="empty-state">${state.lang === 'en' ? 'no cases in this category yet' : 'в этом направлении кейсов пока нет'}</p>`;

    const single = document.getElementById('case-grid');
    if (single) {
      single.innerHTML = list.map(caseCard).join('') || empty;
      observeReveals();
      return;
    }

    // projects page: client-applicable work first, engineering depth after
    [['client', 'case-grid-client', 'group-client'],
     ['depth', 'case-grid-depth', 'group-depth']].forEach(([aud, gridId, groupId]) => {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      const group = document.getElementById(groupId);
      const subset = list.filter((c) => (c.audience || 'depth') === aud);
      grid.innerHTML = subset.map(caseCard).join('') || empty;
      if (group) group.hidden = subset.length === 0;
    });
    observeReveals();
  }

  function renderCasePage() {
    const host = document.getElementById('case-root');
    if (!host) return;
    const id = new URLSearchParams(location.search).get('project');
    const c = caseById(id);
    const caseUrl = (cid) => `${location.href.split('?')[0]}?project=${encodeURIComponent(cid)}`;
    if (!c) {
      setMeta(state.lang === 'en' ? 'Case not found — MsBinaryLily' : 'Кейс не найден — MsBinaryLily',
        state.lang === 'en' ? 'No case with that id. All projects are on the projects page.' : 'Кейса с таким идентификатором нет. Все проекты — на странице проектов.',
        `${location.href.split('?')[0].replace(/case\.html$/, 'projects.html')}`);
      host.innerHTML = `<section class="section-panel"><div class="wrap">
        <p class="kicker">404</p>
        <h1 class="page-title">${state.lang === 'en' ? 'Case not found' : 'Кейс не найден'}</h1>
        <p class="lede">${state.lang === 'en' ? 'No case with the id' : 'Нет кейса с идентификатором'} <code>${escapeHtml(id || '')}</code>.</p>
        <p><a class="btn" href="projects.html"><span>${state.lang === 'en' ? 'All projects' : 'Все проекты'}</span></a></p>
      </div></section>`;
      return;
    }
    setMeta(`${t(c.title)} — MsBinaryLily`,
      plainMd(String(t(c.overview) || '').split(/\n/)[0]).slice(0, 180), caseUrl(c.id));

    const order = state.cases;
    const i = order.indexOf(c);
    const prev = order[i - 1];
    const next = order[i + 1];
    const sections = [
      ['role', 'role', { ru: 'Роль', en: 'Role' }],
      ['problem', 'context', { ru: 'Контекст', en: 'Context' }],
      ['solution', 'solution', { ru: 'Решение', en: 'Solution' }],
      ['impact', 'impact', { ru: 'Результат', en: 'Outcome' }],
      ['deepDive', 'deep-dive', { ru: 'Технические детали', en: 'Technical deep-dive' }],
      ['lessons', 'lessons', { ru: 'Выводы', en: 'Lessons learned' }],
      ['related', 'related', { ru: 'Связанное', en: 'Related' }],
    ].filter(([key]) => c[key] && t(c[key]));

    const status = (c.translation || {})[state.lang] || 'missing';
    const notice = status !== 'missing' ? '' : (state.lang === 'ru'
      ? `<p class="notice">Перевод на русский готовится — сейчас показан английский оригинал кейса.</p>`
      : `<p class="notice">EN translation pending — showing the RU source.</p>`);
    const translationNote = status === 'machine'
      ? `<p class="empty-state" style="margin-top:1.2rem">перевод: AI-assisted, вычитка вручную ещё не сделана</p>`
      : '';

    host.innerHTML = `
      <section class="case-head">
        <div class="wrap">
          <p class="kicker">${themeLabel(c.theme)} · ${state.lang === 'en' ? 'case' : 'кейс'}</p>
          <h1>${escapeHtml(t(c.title))}</h1>
          <p class="lede">${escapeHtml(plainMd(t(c.overview).split(/\n/)[0]))}</p>
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
                  <h2>${escapeHtml(t(label))}</h2>
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
          ${translationNote}
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
