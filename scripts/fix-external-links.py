#!/usr/bin/env python3
"""Add `target="_blank"` to every external <a> in the site's static pages.

Only anchors are touched (not <link>, not the font <link> tags, not og:url meta),
and the repo is CRLF, so the file is read/written as text with newline='' to keep
its line endings byte-identical everywhere else.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = sorted(ROOT.glob("*.html"))
ANCHOR = re.compile(r"<a\b[^>]*>", re.IGNORECASE)
HREF = re.compile(r'href="(https?://[^"]+)"', re.IGNORECASE)


def fix_tag(tag: str) -> str:
    m = HREF.search(tag)
    if not m:
        return tag
    url = m.group(1)
    if "fonts.googleapis.com" in url or "fonts.gstatic.com" in url:
        return tag
    if 'target="' in tag:
        return tag
    # rel first so a missing rel gets one, then the target
    if 'rel="' in tag:
        tag = re.sub(r'rel="([^"]*)"',
                     lambda r: ('rel="' + r.group(1) + ' noreferrer"') if "noreferrer" not in r.group(1) else r.group(0),
                     tag, count=1)
    else:
        tag = tag[:-1] + ' rel="noopener noreferrer">'
    return tag[:-1] + ' target="_blank">'


def main() -> int:
    changed = 0
    for page in PAGES:
        text = page.read_text(encoding="utf-8", newline="")
        new = ANCHOR.sub(lambda m: fix_tag(m.group(0)), text)
        if new != text:
            page.write_text(new, encoding="utf-8", newline="")
            n = sum(1 for a, b in zip(ANCHOR.findall(text), ANCHOR.findall(new)) if a != b)
            print(f"{page.name}: {n} external link(s) set to open in a new tab")
            changed += 1
    print(f"{changed} page(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
