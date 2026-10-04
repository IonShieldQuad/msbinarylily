#!/usr/bin/env python3
"""Lead relay for the portfolio site — stdlib only, no dependencies.

The site is static (GitHub Pages), so a form needs somewhere to POST. This is
that somewhere: it validates a lead, stores it in SQLite, pushes it to Telegram
and (optionally) email, and exposes a health/status surface so you can see it is
alive without opening a terminal.

    python relay.py                 # serve on $PORT (default 8080)
    GET  /health                    # JSON for monitors
    GET  /status  (or /)            # human status page, auto-refreshing
    POST /lead                      # {"name","contact","task","source"} + honeypot

Config comes from the environment or a sibling .env file (see .env.example).
Nothing is required to run it: without a Telegram token it still records leads
and reports `telegram: "not-configured"`, so a misconfigured deploy degrades
instead of losing messages.
"""

from __future__ import annotations

import hashlib
import json
import os
import smtplib
import sqlite3
import string
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.0.0"
STARTED = time.time()
HERE = Path(__file__).resolve().parent


# --------------------------------------------------------------- configuration --
def load_env(path: Path) -> None:
    """Minimal .env reader: KEY=value, no export, no interpolation."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(HERE / ".env")

PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = Path(os.environ.get("DB_PATH", str(HERE / "leads.sqlite3")))
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
MAIL_TO = os.environ.get("MAIL_TO", "").strip()
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "https://ionshieldquad.github.io").strip()
RATE_LIMIT = int(os.environ.get("RATE_LIMIT_PER_HOUR", "5"))
MAX_BODY = int(os.environ.get("MAX_BODY_BYTES", "16384"))
DAILY_PING = os.environ.get("DAILY_PING", "").lower() in {"1", "true", "yes"}

DB_LOCK = threading.Lock()
RATE: dict[str, list[float]] = {}
LAST_DELIVERY = {"telegram": "not-configured", "email": "not-configured"}
LAST_ERROR = {"value": ""}


# --------------------------------------------------------------------- storage --
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with DB_LOCK, db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                name TEXT, contact TEXT NOT NULL, task TEXT NOT NULL, source TEXT,
                ip_hash TEXT, telegram_sent INTEGER DEFAULT 0, email_sent INTEGER DEFAULT 0
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)")
        conn.commit()


def record_lead(payload: dict, ip_hash: str) -> int:
    """Store first, deliver second: a lead is never lost to a delivery failure."""
    with DB_LOCK, db() as conn:
        cur = conn.execute(
            "INSERT INTO leads (created_at, name, contact, task, source, ip_hash)"
            " VALUES (?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(timespec="seconds"), payload.get("name", ""),
             payload["contact"], payload["task"], payload.get("source", ""), ip_hash),
        )
        conn.commit()
        return int(cur.lastrowid)


def mark_delivery(lead_id: int, telegram_ok: bool, email_ok: bool) -> None:
    with DB_LOCK, db() as conn:
        conn.execute("UPDATE leads SET telegram_sent=?, email_sent=? WHERE id=?",
                     (int(telegram_ok), int(email_ok), lead_id))
        conn.commit()


def stats() -> dict:
    now = datetime.now(timezone.utc)
    with DB_LOCK, db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
        day = conn.execute("SELECT COUNT(*) FROM leads WHERE created_at >= ?",
                           ((now.replace(hour=0, minute=0, second=0, microsecond=0)).isoformat(timespec="seconds"),)).fetchone()[0]
        last = conn.execute("SELECT created_at, contact, telegram_sent, email_sent FROM leads ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "leads_total": total,
        "leads_today": day,
        "last_lead_at": last["created_at"] if last else None,
        "last_lead_contact": last["contact"] if last else None,
        "last_delivery_ok": bool(last["telegram_sent"]) if last else None,
    }


# ------------------------------------------------------------------- delivery --
def send_telegram(text: str) -> bool:
    global LAST_DELIVERY
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        LAST_DELIVERY["telegram"] = "not-configured"
        return False
    try:
        body = urllib.parse.urlencode({
            "chat_id": TELEGRAM_CHAT_ID, "text": text[:3900],
            "parse_mode": "HTML", "disable_web_page_preview": "true",
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage", data=body)
        with urllib.request.urlopen(req, timeout=15) as resp:
            ok = resp.status == 200
        LAST_DELIVERY["telegram"] = "ok" if ok else f"http {resp.status}"
        return ok
    except Exception as exc:                      # noqa: BLE001 - report, never crash a lead
        LAST_DELIVERY["telegram"] = "error"
        LAST_ERROR["value"] = f"telegram: {type(exc).__name__}: {exc}"[:200]
        return False


def send_email(subject: str, body: str) -> bool:
    global LAST_DELIVERY
    if not (SMTP_HOST and SMTP_USER and MAIL_TO):
        LAST_DELIVERY["email"] = "not-configured"
        return False
    try:
        msg = EmailMessage()
        msg["From"] = SMTP_USER
        msg["To"] = MAIL_TO
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
        LAST_DELIVERY["email"] = "ok"
        return True
    except Exception as exc:                      # noqa: BLE001
        LAST_DELIVERY["email"] = "error"
        LAST_ERROR["value"] = f"smtp: {type(exc).__name__}: {exc}"[:200]
        return False


def format_lead(payload: dict, lead_id: int) -> str:
    return (
        "🟢 <b>Новая заявка с портфолио</b>\n"
        f"<b>Контакты:</b> {payload['contact']}\n"
        f"<b>Имя:</b> {payload.get('name') or '—'}\n"
        f"<b>Задача:</b>\n{payload['task']}\n"
        f"<i>#{lead_id} · {payload.get('source') or 'site'}</i>"
    )


# ------------------------------------------------------------------ rate limit --
def rate_ok(ip: str) -> bool:
    now = time.time()
    window = RATE.setdefault(ip, [])
    window[:] = [t for t in window if now - t < 3600]
    if len(window) >= RATE_LIMIT:
        return False
    window.append(now)
    return True


# -------------------------------------------------------------------- heartbeat --
def heartbeat() -> None:
    """Optional daily 'still alive' ping, so silence is never ambiguous."""
    while DAILY_PING:
        time.sleep(6 * 3600)
        s = stats()
        send_telegram(f"⏱ <b>Lead relay alive</b>\nuptime {int(time.time()-STARTED)}s · leads {s['leads_total']}"
                      f"\nlast: {s['last_lead_at'] or '—'}")


# ----------------------------------------------------------------------- pages --
STATUS_HTML = string.Template("""<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead relay — status</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;background:#0b0c10;color:#e6ebf2;font:14px/1.55 ui-monospace,"JetBrains Mono",monospace}
 .wrap{max-width:760px;margin:0 auto;padding:3rem 1.2rem}
 h1{font-size:1.3rem;letter-spacing:.06em;margin:0 0 .3rem}
 .k{color:#7d8895;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;background:#2a2f3a;margin:1.6rem 0}
 .cell{background:#13151c;padding:1rem}
 .v{font-size:1.4rem;color:#00e5ff;margin-top:.3rem}
 .ok{color:#39d98a} .bad{color:#ff5c7a} .warn{color:#ffc466}
 pre{background:#13151c;border:1px solid #2a2f3a;padding:1rem;overflow:auto}
 a{color:#00e5ff}
</style></head><body><div class="wrap">
<div class="k">msbinarylily · lead relay</div>
<h1>Статус приёмника заявок</h1>
<p class="k">страница обновляется каждые 30 секунд</p>
<div class="grid">
  <div class="cell"><div class="k">процесс</div><div class="v $status_class">$status</div></div>
  <div class="cell"><div class="k">uptime</div><div class="v">$uptime</div></div>
  <div class="cell"><div class="k">заявок всего</div><div class="v">$leads_total</div></div>
  <div class="cell"><div class="k">заявок сегодня</div><div class="v">$leads_today</div></div>
  <div class="cell"><div class="k">telegram</div><div class="v $tg_class">$telegram</div></div>
  <div class="cell"><div class="k">email</div><div class="v $mail_class">$email</div></div>
  <div class="cell"><div class="k">последняя заявка</div><div class="v" style="font-size:1rem">$last_lead</div></div>
  <div class="cell"><div class="k">версия</div><div class="v" style="font-size:1rem">$version</div></div>
</div>
<div class="k">/health — то же в json, для мониторов</div>
<pre>$health_json</pre>
$error_block
</div><script>setTimeout(function(){location.reload()},30000)</script></body></html>""")

def status_page() -> bytes:
    s = stats()
    h = health()
    alive = h["status"] == "ok"
    tg = LAST_DELIVERY["telegram"]
    mail = LAST_DELIVERY["email"]
    cls = lambda v: "ok" if v in ("ok", "not-configured") else "warn" if v.startswith("http") else "bad"  # noqa: E731
    err = h.get("last_error")
    html = STATUS_HTML.substitute(
        status="работает" if alive else "деградация",
        status_class="ok" if alive else "warn",
        uptime=f"{int(h['uptime_s'] // 3600)}ч {int((h['uptime_s'] % 3600) // 60)}м",
        leads_total=s["leads_total"], leads_today=s["leads_today"],
        telegram=tg, tg_class=cls(tg), email=mail, mail_class=cls(mail),
        last_lead=(s["last_lead_at"] or "—").replace("T", " ").replace("+00:00", "Z"),
        version=VERSION,
        health_json=json.dumps(h, ensure_ascii=False, indent=2),
        error_block=f'<div class="k">последняя ошибка</div><pre style="color:#ff5c7a">{err}</pre>' if err else "",
    )
    return html.encode("utf-8")


def health() -> dict:
    s = stats()
    db_ok = True
    try:
        with db() as conn:
            conn.execute("SELECT 1")
    except Exception:                             # noqa: BLE001
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "version": VERSION,
        "uptime_s": round(time.time() - STARTED, 1),
        "db": "ok" if db_ok else "error",
        "telegram": LAST_DELIVERY["telegram"],
        "email": LAST_DELIVERY["email"],
        "last_error": LAST_ERROR["value"] or None,
        **s,
    }


# ---------------------------------------------------------------------- handler --
class Handler(BaseHTTPRequestHandler):
    server_version = f"lead-relay/{VERSION}"

    def log_message(self, fmt, *args):           # keep stderr useful, drop the noise
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Vary", "Origin")

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_OPTIONS(self) -> None:                # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:                    # noqa: N802
        path = self.path.split("?")[0]
        if path == "/health":
            self._json(200, health())
        elif path in ("/", "/status"):
            self._send(200, status_page(), "text/html; charset=utf-8")
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:                   # noqa: N802
        if self.path.split("?")[0] != "/lead":
            self._json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"ok": False, "error": "bad body size"})
            return
        raw = self.rfile.read(length)
        ip = (self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
              or self.client_address[0])
        if not rate_ok(ip):
            self._json(429, {"ok": False, "error": "too many requests"})
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:                        # noqa: BLE001
            self._json(400, {"ok": False, "error": "invalid json"})
            return
        if str(payload.get("website") or "").strip():     # honeypot
            self._json(200, {"ok": True, "id": None})
            return
        contact = str(payload.get("contact") or "").strip()
        task = str(payload.get("task") or "").strip()
        if len(contact) < 3 or len(task) < 10:
            self._json(400, {"ok": False, "error": "contact and task are required (task >= 10 chars)"})
            return
        payload["contact"], payload["task"] = contact[:200], task[:4000]
        payload["name"] = str(payload.get("name") or "").strip()[:100]
        payload["source"] = str(payload.get("source") or "").strip()[:60]

        ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:16]
        lead_id = record_lead(payload, ip_hash)          # never lose the lead
        tg_ok = send_telegram(format_lead(payload, lead_id))
        mail_ok = send_email(f"Заявка с портфолио: {payload['contact']}",
                             f"{payload['task']}\n\ncontact: {payload['contact']}\nname: {payload['name']}")
        mark_delivery(lead_id, tg_ok, mail_ok)
        print(f"lead #{lead_id} stored (telegram={tg_ok} email={mail_ok})", file=sys.stderr)
        self._json(200, {"ok": True, "id": lead_id, "telegram": tg_ok, "email": mail_ok})


def main() -> int:
    init_db()
    if DAILY_PING:
        threading.Thread(target=heartbeat, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"lead-relay {VERSION} on :{PORT} | db={DB_PATH} | telegram="
          f"{'configured' if TELEGRAM_TOKEN and TELEGRAM_CHAT_ID else 'NOT configured'} | origin={ALLOW_ORIGIN}",
          file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
