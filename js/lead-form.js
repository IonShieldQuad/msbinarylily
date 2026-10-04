/* Contact form wiring. The form only appears when site-config.js points at a
   deployed relay, so the site never shows a form that cannot deliver — and the
   relay itself accepts nothing unless it is reachable, which is what /status is
   for. */
(() => {
  'use strict';
  const cfg = window.MBL_CONFIG || {};
  const block = document.getElementById('lead-form-block');
  const form = document.getElementById('lead-form');
  if (!block || !form) return;

  const statusLink = document.getElementById('relay-status-link');
  const note = document.getElementById('lead-form-note');

  if (!cfg.leadEndpoint) return;          // leave it hidden: Telegram/email stand in
  block.hidden = false;
  if (cfg.statusUrl && statusLink) {
    statusLink.href = cfg.statusUrl;
    statusLink.hidden = false;
  }

  const say = (text, kind) => {
    if (!note) return;
    note.textContent = text;
    note.dataset.kind = kind || 'info';
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.contact || !data.task || data.task.trim().length < 10) {
      say('заполните контакт и задачу (минимум 10 символов) / contact and task are required', 'error');
      return;
    }
    if (button) button.disabled = true;
    say('отправляю… / sending…', 'info');
    try {
      const res = await fetch(cfg.leadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, source: 'contact-form' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        form.reset();
        say('заявка ушла — отвечу в течение дня / sent — I reply within a day', 'ok');
      } else {
        say(`не отправилось (${res.status}). напишите в Telegram / failed — use Telegram`, 'error');
      }
    } catch (_) {
      say('сеть недоступна. напишите в Telegram / network error — use Telegram', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
