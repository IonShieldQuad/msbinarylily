#!/usr/bin/env python3
"""Check that every external link the site ships actually resolves.

Sources: `data/cases.json` (case evidence) and every `*.html` page (footer, CTAs,
contact cards). Fonts are skipped. Run this after touching links — a 404 under a
flagship case is worse than no link at all.

    python scripts/check-links.py [--timeout 30]

Exit codes: 0 = every URL returned 2xx, 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = ("fonts.googleapis.com", "fonts.gstatic.com")
HREF = re.compile(r'href="(https?://[^"]+)"')
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def collect() -> dict[str, list[str]]:
    """-> {url: [where it is used]}"""
    found: dict[str, list[str]] = {}

    def add(url: str, where: str) -> None:
        url = url.strip().rstrip(".,;")
        if not url or any(s in url for s in SKIP):
            return
        found.setdefault(url, []).append(where)

    manifest = ROOT / "data" / "cases.json"
    if manifest.is_file():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        for case in data.get("cases", []):
            for ev in case.get("evidence") or []:
                if ev.get("url"):
                    add(ev["url"], f"case {case['id']}")
    for page in sorted(ROOT.glob("*.html")):
        for url in HREF.findall(page.read_text(encoding="utf-8")):
            add(url, page.name)
    return found


def check(url: str, timeout: float) -> tuple[int | str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, url
    except Exception as exc:  # noqa: BLE001 - a link check reports, it does not raise
        return f"ERR {exc.__class__.__name__}", url


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify every external link on the site.")
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args()

    urls = collect()
    failures: list[str] = []
    for url, where in sorted(urls.items()):
        status, final = check(url, args.timeout)
        ok = isinstance(status, int) and 200 <= status < 400
        print(f"{'ok  ' if ok else 'FAIL'} {status}  {url}")
        if not ok:
            failures.append(f"{url} ({', '.join(sorted(set(where)))}) -> {status}")
        elif final.rstrip("/") != url.rstrip("/"):
            print(f"     redirects to {final}")

    print()
    if failures:
        print(f"{len(failures)} broken link(s) of {len(urls)} checked:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"all {len(urls)} external link(s) resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
