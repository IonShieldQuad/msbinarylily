# Lead relay

The portfolio site is static (GitHub Pages), so a contact form needs somewhere to
POST. This is that somewhere — **zero dependencies, stdlib only**, so it runs
anywhere Python runs with no build step and no lockfile to age.

```
python relay.py            # serves on $PORT (default 8080)
```

| Route | What it is |
|---|---|
| `POST /lead` | `{"name","contact","task","source","website"}` → validates, stores, delivers |
| `GET /health` | JSON for monitors: status, uptime, lead counts, last lead, delivery state |
| `GET /status` (or `/`) | human status page, auto-refreshing every 30s |

## Behaviour worth knowing

- **Store first, deliver second.** A lead is written to SQLite *before* any
  network call, so an unreachable Telegram or SMTP never loses a message. The row
  is then updated with what was actually delivered.
- **Degrades instead of failing.** With no `TELEGRAM_BOT_TOKEN` the relay still
  accepts and stores leads and reports `telegram: "not-configured"` on `/status`.
- **`honeypot`** — a `website` field that must stay empty. Filled → accepted with
  `id: null`, stored nowhere. It still consumes a rate-limit slot, so bots that
  trip it get throttled too.
- **Rate limit** — `RATE_LIMIT_PER_HOUR` per IP (default 5), in memory.
- **CORS** — only `ALLOW_ORIGIN` may POST.
- **`DAILY_PING=true`** sends a "still alive" Telegram message twice a day, so
  silence is never ambiguous.

## Deploy (Render, same path as `simple-website-test`)

1. Push this repo, then on Render: **New → Web Service** from the repo,
   root directory `services/lead-relay`.
2. Build command: *none*. Start command: `python relay.py`.
3. Environment: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ALLOW_ORIGIN`
   (`https://ionshieldquad.github.io`), optionally the `SMTP_*` block and
   `DAILY_PING=true`. `PORT` is injected by Render.
4. **Persistent disk** (Render → Disks) mounted at `/var/data`, then set
   `DB_PATH=/var/data/leads.sqlite3` — without it the SQLite file is wiped on
   every deploy and your lead history disappears.
5. Check `https://<service>.onrender.com/status` — every cell should be green or
   "not-configured".

## Test

```
python test_relay.py
```

Runs the real server on a scratch database with a deliberately broken Telegram
token and asserts: a valid lead is stored and counted, thin input is rejected,
the honeypot stores nothing, the rate limit trips, delivery failures are reported
rather than fatal, and `/health` + `/status` stay honest throughout.
