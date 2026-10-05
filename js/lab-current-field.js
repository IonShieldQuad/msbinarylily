/* Laboratory controls for the current-field experiment.
   The simulation itself is the site's own hero engine (js/ambient.js), driven
   through the small window.AmbientEngine handle — the lab is the same piece of
   work with its parameters exposed, not a second implementation of it. */

(() => {
  'use strict';

  const api = window.AmbientEngine;
  const stage = document.querySelector('.lab-stage');
  if (!api || !stage) return;

  const base = api.base;

  /* Each variant is the shipped tuning plus its own overrides, applied on top
     of the base rather than merged into the previous variant — so switching
     back to "маршрут" really is the shipped configuration. */
  const VARIANTS = {
    route: {},
    wide: { spread: 130, fade: 1900 },
    busy: {
      cell: 64, apex: .50, hotspot: 6, hotR: [110, 320], hotGain: [.4, .8],
      spread: 70, rise: 140, hold: 80, fade: 1500,
      speed: [620, 980], runs: 4, gap: [.3, 1.1]
    }
  };

  function apply(key) {
    if (!VARIANTS[key]) return;
    api.tune(Object.assign({}, base, VARIANTS[key]));
    [...document.querySelectorAll('.lab-controls button[data-v]')]
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === key)));
  }

  [...document.querySelectorAll('.lab-controls button[data-v]')]
    .forEach((b) => b.addEventListener('click', () => apply(b.dataset.v)));

  [...document.querySelectorAll('.lab-controls button[data-act="fire"]')]
    .forEach((b) => b.addEventListener('click', () => {
      const r = stage.getBoundingClientRect();
      const spots = [[0.72, 0.40], [0.28, 0.66], [0.55, 0.22]];
      const s = spots[(Math.random() * spots.length) | 0];
      api.fire(r.width * s[0], r.height * s[1]);
    }));
})();
