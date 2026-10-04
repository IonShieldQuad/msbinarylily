#!/usr/bin/env python3
"""Vault -> site manifest generator for the MsBinaryLily portfolio.

Contract: specs/content-pipeline.md in the vault project
(H:/ObsidianVaultCentral/Work/Personal/portfolio-site/specs/content-pipeline.md).

Reads every `cases/*.md` whose frontmatter carries `type/case`, validates it
against specs/case-study-model.md, and emits:

    data/cases.json   the manifest the site consumes (contract output)
    data/cases.js     the same payload as `window.MBL_CASES` so the pages also
                      work when opened straight from disk (file:// blocks fetch)

Exit codes: 0 = ok, 1 = validation warnings, 2 = validation errors.
Idempotent: identical input produces byte-identical output (generated_at is the
newest source mtime, never the wall clock).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = "1"

DEFAULT_SOURCE = Path(
    r"H:\ObsidianVaultCentral\Work\Personal\portfolio-site\cases"
)
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data"

THEMES = {
    "ai", "lowlevel", "algorithms", "modding", "industrial",
    "mobile", "web", "graphics", "crypto", "tools",
}

# vault heading -> manifest field, and whether the field is required
SECTION_MAP = [
    ("Overview", "overview", True),
    ("Role", "role", True),
    ("Problem / Context", "problem", True),
    ("Solution", "solution", True),
    ("Stack", "stack", True),
    ("Timeline", "timeline", True),
    ("Impact / Metrics", "impact", False),
    ("Evidence", "evidence", False),
    ("Technical deep-dive", "deepDive", False),
    ("Lessons learned", "lessons", False),
    ("Related", "related", False),
]

FRONTMATTER_REQUIRED = ["case-title", "case-theme", "case-order", "featured"]


# --------------------------------------------------------------------------- #
# frontmatter
# --------------------------------------------------------------------------- #

def split_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    return parse_frontmatter(parts[1]), parts[2]


def parse_frontmatter(block: str) -> dict:
    """Minimal YAML subset: flat `key: value` pairs, lists as [a, b]."""
    data: dict[str, object] = {}
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if value.startswith("[") and value.endswith("]"):
            data[key] = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
        elif value.lower() in {"true", "false"}:
            data[key] = value.lower() == "true"
        elif re.fullmatch(r"-?\d+", value or ""):
            data[key] = int(value)
        else:
            data[key] = value.strip("'\"")
    return data


# --------------------------------------------------------------------------- #
# body
# --------------------------------------------------------------------------- #

def sections(body: str) -> dict[str, str]:
    found: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []
    for line in body.splitlines():
        if line.startswith("## "):
            if current:
                found[current] = "\n".join(buf).strip()
            current, buf = line[3:].strip(), []
        elif current is not None:
            buf.append(line)
    if current:
        found[current] = "\n".join(buf).strip()
    return found


WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
URL = re.compile(r"https?://[^\s`)\]<>]+")
BARE_URL = re.compile(r"(?<![\w/.])((?:www\.)?(?:github\.com|gitlab\.com|t\.me|[a-z0-9-]+\.(?:pro|dev|io|ru|com|net|org))/[^\s`)\]<>|,]+)")


def delink(text: str) -> str:
    """[[note|label]] -> label, [[note]] -> note, plus markdown link flattening."""
    text = WIKILINK.sub(lambda m: (m.group(2) or m.group(1)).strip(), text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    return text


def stack_list(text: str) -> list[str]:
    flat = text.replace("\n", " ")
    return [s.strip() for s in re.split(r"[,\n]", flat) if s.strip() and len(s.strip()) < 40]


CYRILLIC = re.compile(r"[а-яёА-ЯЁ]")


def body_lang(text: str) -> str:
    """Source language of a case body — the vault cases are written in English,
    the UI is RU-first, so the manifest must not claim the RU slot is filled."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "ru"
    cyr = len(CYRILLIC.findall(text)) / len(letters)
    return "ru" if cyr > 0.15 else "en"


def evidence_links(text: str) -> list[dict]:
    links: list[dict] = []
    seen: set[str] = set()

    def add(url: str, label: str) -> None:
        url = url.rstrip(".,;)")
        key = (url or label).lower()
        if not label or key in seen:
            return
        seen.add(key)
        links.append({"url": url, "label": label})

    for m in URL.finditer(text):
        url = m.group(0)
        add(url, url.split("//")[-1].split("/")[0])
    for m in BARE_URL.finditer(text):
        add("https://" + m.group(1), m.group(1).split("/")[0])
    for line in text.splitlines():  # [[related-note]] style references
        for label in re.findall(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", line):
            add("", (label[1] or label[0]).strip())
    return links


def to_manifest_case(path: Path) -> tuple[dict, list[str], list[str]]:
    """-> (case dict, errors, warnings)

    `path` is the English source case. A Russian sibling at `ru/<name>` is used
    for the RU slots when present (see specs/content-pipeline.md).
    """
    errors: list[str] = []
    warnings: list[str] = []
    text = path.read_text(encoding="utf-8")
    fm, body = split_frontmatter(text)

    ru_path = path.parent / "ru" / path.name
    ru_fm: dict = {}
    ru_found: dict[str, str] = {}
    if ru_path.exists():
        ru_text = ru_path.read_text(encoding="utf-8")
        ru_fm, ru_body = split_frontmatter(ru_text)
        ru_found = sections(ru_body)
        for heading, _field, required in SECTION_MAP:
            if required and not (ru_found.get(heading) or "").strip():
                errors.append(f"ru/{path.name}: missing required section '## {heading}'")
    tags = fm.get("tags", [])
    if isinstance(tags, list) and "type/case" not in tags:
        warnings.append(f"{path.name}: frontmatter tags lack 'type/case'")

    for key in FRONTMATTER_REQUIRED:
        if key not in fm:
            errors.append(f"{path.name}: missing frontmatter key '{key}'")

    theme = str(fm.get("case-theme", "")).strip()
    if theme and theme not in THEMES:
        errors.append(f"{path.name}: unknown case-theme '{theme}' (allowed: {', '.join(sorted(THEMES))})")

    order = fm.get("case-order")
    if not isinstance(order, int):
        errors.append(f"{path.name}: case-order must be an integer")

    found = sections(body)
    fields: dict[str, dict[str, str]] = {}
    for heading, field, required in SECTION_MAP:
        content = found.get(heading)
        if content is None or not content.strip():
            (errors if required else warnings).append(
                f"{path.name}: {'missing required' if required else 'no'} section '## {heading}'"
            )
            continue
        if field in ("stack", "evidence"):
            continue
        en_text = delink(content).strip()
        ru_source = (ru_found.get(heading) or "").strip()
        fields[field] = {
            "ru": delink(ru_source).strip() if ru_source else en_text,
            "en": en_text,
        }

    stack = stack_list(found.get("Stack", ""))
    if not stack:
        errors.append(f"{path.name}: '## Stack' produced no chips")

    evidence = evidence_links(found.get("Evidence", "")) if found.get("Evidence") else []
    if not evidence:
        warnings.append(f"{path.name}: no evidence links (repo/site/metric)")
    if "impact" not in fields:
        warnings.append(f"{path.name}: no metrics — high priority for this case per the model")

    case_id = path.stem
    src = body_lang(body)
    title_pair = {
        "ru": str(ru_fm.get("case-title") or fm.get("case-title", case_id)),
        "en": str(fm.get("case-title-en", fm.get("case-title", case_id))),
    }
    # a sibling file is an AI-assisted translation until someone marks it reviewed
    ru_status = str(ru_fm.get("translation", "machine")).strip().lower()
    if ru_status not in {"machine", "human"}:
        warnings.append(f"ru/{path.name}: unknown translation value '{ru_status}' — treated as machine")
        ru_status = "machine"
    return (
        {
            "id": case_id,
            "theme": theme,
            "order": order if isinstance(order, int) else 999,
            "featured": bool(fm.get("featured", False)),
            "title": title_pair,
            "stack": stack,
            "evidence": evidence,
            "status": str(fm.get("status", "draft")),
            # the body is stored in both language slots so the site always has
            # something to render; `lang` / `translation` say which slot is the
            # real source and which still needs a human (or machine) pass.
            "lang": src,
            "translation": {"ru": "source" if src == "ru" else (ru_status if ru_found else "missing"),
                            "en": "source" if src == "en" else "missing"},
            **fields,
            "updated": str(fm.get("updated", "")),
        },
        errors,
        warnings,
    )


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def build(source: Path) -> tuple[dict, list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    files = sorted(source.glob("*.md"))  # non-recursive: cases/ru/*.md is never a case
    if not files:
        return {}, [f"no case files under {source}"], []

    cases = []
    for path in files:
        case, errs, warns = to_manifest_case(path)
        errors += errs
        warnings += warns
        if not errs:
            cases.append(case)

    cases.sort(key=lambda c: (c["order"], c["id"]))
    seen_order: dict[int, str] = {}
    for case in cases:
        if case["order"] in seen_order:
            warnings.append(
                f"case-order {case['order']} shared by '{seen_order[case['order']]}' and '{case['id']}' "
                "— tie broken by id"
            )
        seen_order.setdefault(case["order"], case["id"])

    ids = [c["id"] for c in cases]
    for dupe in {i for i in ids if ids.count(i) > 1}:
        errors.append(f"duplicate case id '{dupe}'")

    for lang_code, label in (("ru", "RU"), ("en", "EN")):
        missing = [c["id"] for c in cases if c["translation"][lang_code] == "missing"]
        if missing:
            warnings.append(
                f"{len(missing)} case(s) have no {label} translation: {', '.join(missing)}"
            )
    machine = [c["id"] for c in cases if c["translation"]["ru"] == "machine"]
    if machine:
        warnings.append(
            f"{len(machine)} RU translation(s) are AI-assisted and not human-reviewed yet "
            f"(mark `translation: human` in the ru/ frontmatter once reviewed): {', '.join(machine)}"
        )

    newest = max((f.stat().st_mtime for f in files), default=0)
    generated = dt.datetime.fromtimestamp(newest, dt.timezone.utc).replace(microsecond=0)
    manifest = {
        "meta": {
            "generated_at": generated.isoformat().replace("+00:00", "Z"),
            "source": str(source).replace("\\", "/"),
            "schema_version": SCHEMA_VERSION,
            "case_count": len(cases),
        },
        "cases": cases,
    }
    return manifest, errors, warnings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate the portfolio case manifest from the vault.")
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="vault cases/ directory")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="site data/ directory")
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    args = ap.parse_args(argv)

    if not args.source.is_dir():
        print(f"ERROR source directory not found: {args.source}", file=sys.stderr)
        return 2

    manifest, errors, warnings = build(args.source)

    for w in warnings:
        print(f"warn  {w}", file=sys.stderr)
    for e in errors:
        print(f"error {e}", file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} error(s) — nothing written.", file=sys.stderr)
        return 2

    if args.check:
        print(f"ok — {manifest['meta']['case_count']} case(s) valid, {len(warnings)} warning(s), nothing written")
        return 1 if warnings else 0

    args.out.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False)
    (args.out / "cases.json").write_text(payload + "\n", encoding="utf-8")
    (args.out / "cases.js").write_text(
        "/* GENERATED by scripts/generate.py — do not edit. */\n"
        f"window.MBL_CASES = {payload};\n",
        encoding="utf-8",
    )
    print(
        f"wrote {args.out / 'cases.json'} and cases.js — "
        f"{manifest['meta']['case_count']} case(s), {len(warnings)} warning(s)"
    )
    return 1 if warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
