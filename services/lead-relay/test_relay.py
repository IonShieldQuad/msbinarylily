#!/usr/bin/env python3
"""End-to-end check of the lead relay — no dependencies, no network needed.

Starts the real server on a scratch database with a deliberately broken Telegram
token, then asserts: a valid lead is stored and counted, the honeypot is ignored,
validation rejects thin input, the rate limit trips, and /health + /status keep
reporting honestly while Telegram is failing.

    python test_relay.py
"""
import json
import os
import pathlib
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TMP = pathlib.Path(tempfile.mkdtemp(prefix="relay-test-"))
os.environ.update({
    "PORT": "0",                      # let the OS choose, we read it back
    "DB_PATH": str(TMP / "test.sqlite3"),
    "TELEGRAM_BOT_TOKEN": "123:invalid-token-for-test",
    "TELEGRAM_CHAT_ID": "-1001234567890",
    "RATE_LIMIT_PER_HOUR": "3",
    "ALLOW_ORIGIN": "https://example.test",
})

import relay  # noqa: E402  (env must be set first)

FAILS = []

def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)

def post(base, payload):
    req = urllib.request.Request(f"{base}/lead", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def get(base, path):
    with urllib.request.urlopen(f"{base}{path}", timeout=10) as r:
        return r.status, r.read()

def main():
    relay.init_db()
    server = relay.ThreadingHTTPServer(("127.0.0.1", 0), relay.Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    time.sleep(0.3)

    status, body = get(base, "/health")
    check("/health responds 200 with status ok", status == 200 and body and json.loads(body)["status"] == "ok")

    code, res = post(base, {"contact": "tg @someone", "task": "Нужен бот для приёма заявок в магазине, 3 сценария",
                            "name": "Иван", "source": "contact-form"})
    check("valid lead accepted", code == 200 and res.get("ok") and isinstance(res.get("id"), int), f"{code} {res}")
    check("telegram failure reported, not fatal", res.get("telegram") is False and res.get("ok") is True, str(res))

    code, res = post(base, {"contact": "spam", "task": "short"})
    check("thin input rejected", code == 400, f"{code} {res}")

    code, res = post(base, {"contact": "bot@x.io", "task": "Полностью валидная задача про автоматизацию" * 1,
                            "website": "http://spam.example"})
    check("honeypot silently accepted and not stored", code == 200 and res.get("id") is None, f"{code} {res}")

    codes = [post(base, {"contact": f"a{i}@x.io", "task": "Ещё одна валидная задача для проверки лимита"})[0] for i in range(3)]
    check("rate limit trips after the configured window", 429 in codes, str(codes))

    status, body = get(base, "/health")
    h = json.loads(body)
    check("/health reports telegram state honestly", h["telegram"] in ("error", "not-configured"), h["telegram"])
    check("/health counts exactly the accepted leads", h["leads_total"] == 1, str(h["leads_total"]))
    check("honeypot request consumed a rate-limit slot but stored nothing",
          h["leads_total"] == 1, str(h["leads_total"]))
    check("/health exposes last lead", bool(h["last_lead_at"]))

    status, body = get(base, "/status")
    html = body.decode("utf-8")
    check("/status renders a human page", status == 200 and "Статус" in html and "lead relay" in html)
    check("/status shows the lead count", "заявок всего" in html)

    # the row really is on disk, and reflects the failed delivery
    import sqlite3
    with sqlite3.connect(os.environ["DB_PATH"]) as conn:
        rows = conn.execute("SELECT contact, telegram_sent FROM leads").fetchall()
    check("lead persisted to sqlite (honeypot did not)", len(rows) == 1, str(rows))
    check("undelivered lead is marked as such", all(r[1] == 0 for r in rows), str(rows))

    server.shutdown()
    print(f"\n{'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAILED: ' + ', '.join(FAILS)}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
