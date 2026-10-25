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
# screenshots live in the site repo, not the vault: assets/cases/<case-id>/<file>.png
# plus assets/cases/manifest.json describing them (file, type, alt, caption).
DEFAULT_ASSETS = Path(__file__).resolve().parent.parent / "assets" / "cases"

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
    ("Visuals", "visuals", False),
    ("Technical deep-dive", "deepDive", False),
    ("Lessons learned", "lessons", False),
    ("Related", "related", False),
]

# sections whose content is parsed, not copied into a text field
PARSED_SECTIONS = {"stack", "evidence", "visuals"}

PLACEHOLDER = re.compile(r"\[\[\s*SCREENSHOT:\s*(.*?)\s*\]\]", re.IGNORECASE | re.DOTALL)
MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(\s*([^)\s]+)\s*(?:\"([^\"]*)\")?\s*\)")

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
MD_LINK = re.compile(r"\[([^\]\n]+)\]\((https?://[^\s)]+)\)")
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
    """Collect the evidence items in the order the author wrote them.

    A markdown link carries the words the reader should see; a bare URL only
    carries itself. Both are evidence, so they are gathered with their offsets and
    sorted, instead of one kind being appended after the other.
    """
    md_spans = [(m.start(), m.end()) for m in MD_LINK.finditer(text)]

    def inside_md_link(pos: int) -> bool:
        return any(a <= pos < b for a, b in md_spans)

    found: list[tuple[int, str, str, bool]] = []
    for m in MD_LINK.finditer(text):
        found.append((m.start(), m.group(2).rstrip(".,;)"), m.group(1).strip(), True))
    for m in URL.finditer(text):
        if inside_md_link(m.start()):
            continue
        url = m.group(0).rstrip(".,;)")
        found.append((m.start(), url, url.split("//")[-1].split("/")[0], False))
    for m in BARE_URL.finditer(text):
        if inside_md_link(m.start()):
            continue
        found.append((m.start(), "https://" + m.group(1), m.group(1).split("/")[0], False))
    for m in WIKILINK.finditer(text):  # [[related-note|Label]] references
        found.append((m.start(), "", (m.group(2) or m.group(1)).strip(), False))

    links: list[dict] = []
    seen: set[str] = set()
    for _, url, label, titled in sorted(found, key=lambda t: t[0]):
        key = (url or label).lower()
        if not label or key in seen:
            continue
        seen.add(key)
        links.append({"url": url, "label": label, "titled": titled})
    return links


ASSET_TYPES = {"screenshot", "document", "artefact", "diagram"}


def load_assets(assets_dir: Path) -> tuple[dict, list[str], list[str]]:
    """Read assets/cases/manifest.json -> {case_id: {thumb, figures}}, errors, warnings.

    A figure whose file is missing or whose alt text is empty is dropped rather
    than shipped: a broken image and an image nobody can describe are both worse
    than a case with one visual fewer, and both are reported.
    """
    out: dict[str, dict] = {}
    errors: list[str] = []
    warnings: list[str] = []
    manifest_path = assets_dir / "manifest.json"
    if not manifest_path.is_file():
        return out, [], [f"no asset manifest at {manifest_path.as_posix()} — cases ship without visuals"]
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return out, [f"assets/cases/manifest.json: invalid JSON — {exc}"], []

    for case_id, entry in (data.get("cases") or {}).items():
        visuals: list[dict] = []
        for fig in entry.get("figures") or []:
            rel = str(fig.get("file") or "").strip()
            alt = fig.get("alt") or {}
            caption = fig.get("caption") or {}
            if not rel:
                warnings.append(f"assets/{case_id}: figure without a 'file' — dropped")
                continue
            if not (assets_dir / rel).is_file():
                warnings.append(f"assets/{case_id}: '{rel}' not found under assets/cases — figure dropped")
                continue
            alt_en = str(alt.get("en") or "").strip()
            alt_ru = str(alt.get("ru") or "").strip()
            if not (alt_en or alt_ru):
                warnings.append(f"assets/{case_id}: '{rel}' has no alt text — figure dropped")
                continue
            kind = str(fig.get("type") or "screenshot").strip()
            if kind not in ASSET_TYPES:
                warnings.append(f"assets/{case_id}: '{rel}' has unknown type '{kind}' — treated as screenshot")
                kind = "screenshot"
            visuals.append({
                "src": f"assets/cases/{rel}",
                "type": kind,
                "alt": {"ru": alt_ru or alt_en, "en": alt_en or alt_ru},
                "caption": {
                    "ru": str(caption.get("ru") or "").strip() or str(caption.get("en") or "").strip(),
                    "en": str(caption.get("en") or "").strip() or str(caption.get("ru") or "").strip(),
                },
            })

        thumb = str(entry.get("thumb") or "").strip()
        if thumb and not (assets_dir / thumb).is_file():
            warnings.append(f"assets/{case_id}: thumb '{thumb}' not found — falling back to the first figure")
            thumb = ""
        if thumb:
            out.setdefault(case_id, {})["thumb"] = f"assets/cases/{thumb}"
        if visuals:
            block = out.setdefault(case_id, {})
            block["visuals"] = visuals
            block.setdefault("thumb", visuals[0]["src"])

    return out, errors, warnings


def resolve_visuals(case_id: str, section: str, assets: list[dict]) -> tuple[list[dict], list[str]]:
    """Map a case's `## Visuals` section onto the asset manifest for that case.

    Two ways the section can name an image, and both are wired through the vault:
      - an explicit markdown image line `![alt](assets/cases/<id>/file.png "caption")`
      - the `[[SCREENSHOT: …]]` placeholder the copy pass leaves behind, which is
        matched to the case's manifest figures in order
    With neither, the case shows every figure the manifest has for it. The manifest
    owns the bilingual alt text and caption, so a single-language markdown alt is a
    fallback, not the norm.
    """
    warnings: list[str] = []
    by_src = {f["src"]: f for f in assets}
    images = MD_IMAGE.findall(section or "")
    placeholders = PLACEHOLDER.findall(section or "")
    visuals: list[dict] = []

    def from_parts(src: str, alt: str, caption: str) -> dict | None:
        src = src.strip().lstrip("./")
        if not src.startswith("assets/cases/"):
            warnings.append(f"{case_id}: visual '{src}' is not under assets/cases/ — dropped")
            return None
        if src in by_src:
            return dict(by_src[src])
        # not in the manifest: keep the single-language text rather than losing the image
        def pair(text: str) -> dict:
            half = [p.strip() for p in text.split("|")]
            return {"en": half[0] if half else "", "ru": half[1] if len(half) > 1 else (half[0] if half else "")}
        warnings.append(f"{case_id}: visual '{src}' has no entry in assets/cases/manifest.json (single-language alt)")
        return {"src": src, "type": "screenshot", "alt": pair(alt), "caption": pair(caption)}

    if images:
        for alt, src, title in images:
            fig = from_parts(src, alt, title)
            if fig:
                visuals.append(fig)
        if len(images) < len(placeholders):
            warnings.append(f"{case_id}: {len(placeholders)} placeholders but only {len(images)} image line(s)")
    elif placeholders and assets:
        for i, text in enumerate(placeholders):
            if i < len(assets):
                visuals.append(dict(assets[i]))
            else:
                warnings.append(
                    f"{case_id}: placeholder '{text[:60]}' has no matching asset in the manifest — "
                    "add the image or drop the placeholder"
                )
        if len(assets) > len(placeholders):
            for extra in assets[len(placeholders):]:
                visuals.append(dict(extra))
                warnings.append(f"{case_id}: asset '{extra['src']}' is not referenced by any placeholder — appended")
    else:
        visuals = [dict(a) for a in assets]

    seen: set[str] = set()
    unique = []
    for fig in visuals:
        if fig["src"] in seen:
            continue
        seen.add(fig["src"])
        unique.append(fig)
    return unique, warnings


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
            # `## Visuals` is optional in the case markdown: the asset manifest can
            # carry the images on its own, and build() warns when a case ends up
            # with none at all
            if field == "visuals":
                continue
            (errors if required else warnings).append(
                f"{path.name}: {'missing required' if required else 'no'} section '## {heading}'"
            )
            continue
        if field in PARSED_SECTIONS:
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
    # a titled evidence link is copy, so it carries both languages; the RU note's
    # own wording wins where it exists, and a bare URL (a host) stays neutral
    ru_evidence = evidence_links(ru_found.get("Evidence", "")) if ru_found.get("Evidence") else []
    ru_labels = {e["url"]: e["label"] for e in ru_evidence if e.get("url") and e.get("titled")}
    for entry in evidence:
        if not entry.get("titled"):
            continue
        entry["label"] = {"ru": ru_labels.get(entry["url"]) or entry["label"], "en": entry["label"]}
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
            # who a case speaks to: client-facing work sorts first on the site
            "audience": str(fm.get("audience", "depth")).strip() or "depth",
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
            # the raw `## Visuals` section: resolve_visuals() maps it onto the asset
            # manifest once the manifest is loaded (it needs the case id)
            "_visualsSection": found.get("Visuals") or "",
            "updated": str(fm.get("updated", "")),
        },
        errors,
        warnings,
    )


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def build(source: Path, assets_dir: Path) -> tuple[dict, list[str], list[str]]:
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

    assets, asset_errors, asset_warnings = load_assets(assets_dir)
    errors += asset_errors
    warnings += asset_warnings
    known = {c["id"] for c in cases}
    for stray in sorted(set(assets) - known):
        warnings.append(f"assets/cases/manifest.json: '{stray}' is not a case id — ignored")
    for case in cases:
        block = assets.get(case["id"], {})
        # always present, so a page never has to guess: an empty list means the
        # case genuinely has no visual yet
        visuals, visual_warnings = resolve_visuals(
            case["id"], case.pop("_visualsSection", ""), block.get("visuals", []))
        warnings += visual_warnings
        case["visuals"] = visuals
        case["thumb"] = block.get("thumb") or (visuals[0]["src"] if visuals else None)
        if not visuals:
            warnings.append(
                f"{case['id']}: no visual — add a screenshot to assets/cases/manifest.json "
                "(the evidence gate needs one visual per case)")

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
    ap.add_argument("--assets", type=Path, default=DEFAULT_ASSETS,
                    help="site assets/cases/ directory (manifest.json + images)")
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    args = ap.parse_args(argv)

    if not args.source.is_dir():
        print(f"ERROR source directory not found: {args.source}", file=sys.stderr)
        return 2

    manifest, errors, warnings = build(args.source, args.assets)

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
