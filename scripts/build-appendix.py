#!/usr/bin/env python3
"""Publish the technical appendices the case studies cite as evidence.

Two cases (CPU from NAND, TG Aggregator, and the AI Agents case that builds on
it) have no public repository: one is a CPU built inside a game, the other is a
team's private service. The honest public artefact for both is the document
itself — the instruction set with its programs, and the specification that was
agreed before implementation.

This script renders those documents from the vault into static pages on the
site, so the published page cannot drift from the note it came from. The page
shell (head, header/nav, footer, scripts) is lifted from about.html, so a nav
change propagates here on the next build instead of silently diverging.

Run: python scripts/build-appendix.py
"""

from __future__ import annotations

import html
import os
import re
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[1]
VAULT = Path(os.environ.get("MBL_VAULT", r"H:\ObsidianVaultCentral\Work\Personal"))

# Words that belong to internal working vocabulary and must never reach a
# client-facing page (scripts/verify.cjs measures the same list in the browser).
BANNED = ("ADR", "vault", "pre-mortem", "SemVer")

PAGES = [
    {
        "out": "symphony-cpu.html",
        "title_ru": "Symphony — система команд и программы",
        "title_en": "Symphony — instruction set and programs",
        "desc_ru": "Полный набор инструкций процессора Symphony: кодировки, регистры, "
                   "переходы и память, плюс пять программ на его ассемблере.",
        "desc_en": "The complete Symphony CPU instruction set — encodings, registers, "
                   "jumps and memory — plus the five programs written in its assembly.",
        "kicker_ru": "приложение к кейсу · CPU from NAND",
        "kicker_en": "case appendix · CPU from NAND",
        "lede_ru": "Процессор Symphony собран снизу вверх — от одного NAND-вентиля до "
                   "32-битной системы команд. Здесь она целиком: кодировки, регистры, "
                   "переходы, работа с памятью и пять программ, написанных на её "
                   "ассемблере и прогнанных на самом процессоре.",
        "lede_en": "The Symphony CPU was built bottom-up, from a single NAND gate to a "
                   "32-bit instruction set. Here is that instruction set in full: "
                   "encodings, registers, jumps, memory access, and the five programs "
                   "written in its assembly and run on the machine itself.",
        "note_ru": "Исходный технический документ, поэтому ниже он на английском. "
                   "Публичного репозитория нет: процессор существует внутри игры "
                   "Turing Complete как схема, а не как код. Схему и запись прогона "
                   "можно показать по запросу.",
        "note_en": "This is the original technical document, so it stays in English "
                   "throughout. There is no public repository: the CPU exists as a "
                   "circuit inside the game Turing Complete, not as a codebase. The "
                   "schematic and a run can be shown on request.",
        "sources": [
            ("portfolio-site/notes/symphony-isa.md", None),
            ("portfolio-site/notes/symphony-programs.md", None),
        ],
        "drop": {"Related"},
    },
    {
        "out": "tg-aggregator-architecture.html",
        "title_ru": "TG Aggregator — архитектура, контракт AI, лимиты",
        "title_en": "TG Aggregator — architecture, AI contract, rate limits",
        "desc_ru": "Спецификация Telegram-пайплайна TG Aggregator: схема, контракт "
                   "AI-этапа и политика лимитов — согласованы до первой строки кода.",
        "desc_en": "The TG Aggregator specification: pipeline design, the AI stage's "
                   "contract, and the Telegram rate-limit policy — agreed before code.",
        "kicker_ru": "приложение к кейсу · TG Aggregator",
        "kicker_en": "case appendix · TG Aggregator",
        "lede_ru": "Спецификация, написанная и согласованная до первой строки "
                   "продуктового кода: схема пайплайна и поток данных, контракт "
                   "AI-этапа (схема ответа, правило решения, версионирование, "
                   "бюджет) и политика лимитов Telegram для чтения и отправки.",
        "lede_en": "This is the specification written and agreed before the first line "
                   "of product code: the pipeline and its data flow, the AI stage's "
                   "contract (output schema, decision rule, versioning, cost budget), "
                   "and the Telegram rate-limit policy for the read and send paths.",
        "note_ru": "Документ публикуется в оригинале, на английском. Код сервиса "
                   "приватный — он работает с сессией аккаунта и списком "
                   "каналов команды, поэтому в открытый доступ не выкладывается. "
                   "Публично то, что можно проверить и прочитать: проектные решения. "
                   "Разбор кода и прогон — по запросу.",
        "note_en": "The document is published as written, in English. The service's "
                   "code is private: it runs against a team's account session and "
                   "channel list, so it is not published. What is public is the part "
                   "a client can actually read and check — the design. A code "
                   "walkthrough and a live run are available on request.",
        "sources": [
            ("tg-aggregator/specs/system-architecture.md", "System architecture"),
            ("tg-aggregator/specs/ai-contract.md", "AI contract"),
            ("tg-aggregator/specs/rate-limiting-policy.md", "Rate limiting policy"),
        ],
        "drop": {"Related", "Open Decisions Before Implementation",
                 "Document Status and Decision Precedence"},
    },
]


def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            return parts[2].lstrip("\n")
    return text


def plain(text: str) -> str:
    """Strip the vault's linking and internal vocabulary out of a document."""
    # decision references first: [[adr-003-ai-pipeline]] would otherwise flatten into
    # the words "adr 003 ai pipeline"
    text = re.sub(r"adr-(\d+)-[\w-]+", r"decision \1", text)
    # [[note|label]] -> label ; [[note]] -> note (readable form)
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", lambda m: m.group(1).replace("-", " "), text)
    text = text.replace("documentation vault", "project documentation")
    text = re.sub(r"\bADRs\b", "decisions", text)
    text = re.sub(r"\bADR\b", "decision", text)
    text = re.sub(r"\bvault\b", "documentation", text, flags=re.I)
    text = re.sub(r"\bpre-mortem\b", "risk review", text, flags=re.I)
    return text


def sections(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Split a note into (h1 title, [(h2 heading, body)])."""
    text = strip_frontmatter(text)
    title = ""
    m = re.search(r"^#\s+(.+)$", text, re.M)
    if m:
        title = m.group(1).strip()
        text = text[:m.start()] + text[m.end():]
    chunks = re.split(r"(?m)^##\s+(.+)$", text)
    out: list[tuple[str, str]] = []
    for i in range(1, len(chunks), 2):
        out.append((chunks[i].strip(), chunks[i + 1]))
    return title, out


def render(body: str) -> str:
    body = re.sub(r"(?m)^###\s+", "#### ", body)      # h3 -> h4 inside a document
    raw = markdown.markdown(body, extensions=["tables", "fenced_code", "sane_lists"])
    raw = re.sub(r"<table>", '<div class="table-wrap"><table>', raw)
    raw = re.sub(r"</table>", "</table></div>", raw)
    return raw


def document(path: Path, heading: str | None, drop: set[str]) -> tuple[str, list[str], list[str]]:
    """Render one source document as an h2 section of the appendix page."""
    warnings: list[str] = []
    if not path.is_file():
        raise SystemExit(f"missing source: {path}")
    title, parts = sections(plain(path.read_text(encoding="utf-8")))
    h2 = heading or title or path.stem.replace("-", " ")
    anchor = re.sub(r"[^a-z0-9]+", "-", h2.lower()).strip("-")
    out = [f'<h2 id="{anchor}">{html.escape(h2)}</h2>']
    kept = 0
    for name, body in parts:
        if name in drop:
            continue
        out.append(f"<h3>{html.escape(name)}</h3>")
        out.append(render(body))
        kept += 1
    if not kept:
        warnings.append(f"{path.name}: every section was dropped")
    return "\n".join(out), [h2], [anchor]


def shell(page: dict, content: str, contents: list[tuple[str, str]]) -> str:
    about = (ROOT / "about.html").read_text(encoding="utf-8")
    head = about.split("</head>")[0]
    header = re.search(r'(<a class="skip-link".*?</header>)', about, re.S).group(1)
    footer = re.search(r"(<footer class=\"site-footer\">.*?</footer>)", about, re.S).group(1)

    esc = lambda s: html.escape(s, quote=True)
    contents_html = ""
    if contents:
        items = "\n".join(
            f'            <li><a href="#{anchor}">{html.escape(label)}</a></li>'
            for label, anchor in contents)
        contents_html = (
            '          <nav class="appendix-contents" aria-label="Contents">\n'
            '            <p class="kicker" data-ru="содержание" data-en="contents">содержание</p>\n'
            '            <ol>\n' + items + '\n            </ol>\n'
            '          </nav>')
    head = re.sub(r"<html [^>]*>",
                  f'<html lang="ru" data-title-ru="{esc(page["title_ru"])}" '
                  f'data-title-en="{esc(page["title_en"])}" '
                  f'data-desc-ru="{esc(page["desc_ru"])}" '
                  f'data-desc-en="{esc(page["desc_en"])}">', head, count=1)
    head = re.sub(r"<title>.*?</title>", f'<title>{esc(page["title_ru"])}</title>', head, count=1, flags=re.S)
    head = re.sub(r'<meta name="description" content="[^"]*">',
                  f'<meta name="description" content="{esc(page["desc_ru"])}">', head, count=1)

    main = f"""<main id="main">

  <section class="section-panel">
    <div class="wrap">
      <p class="kicker" data-ru="{esc(page['kicker_ru'])}" data-en="{esc(page['kicker_en'])}">{html.escape(page['kicker_ru'])}</p>
      <h1 class="page-title" data-ru="{esc(page['title_ru'])}" data-en="{esc(page['title_en'])}">{html.escape(page['title_ru'])}</h1>
      <p class="lede" data-ru="{esc(page['lede_ru'])}" data-en="{esc(page['lede_en'])}">{html.escape(page['lede_ru'])}</p>

      <div class="case-body" style="margin-top:2.2rem">
        <div class="prose prose-wide">
          <p class="footer-meta" data-ru="{esc(page['note_ru'])}" data-en="{esc(page['note_en'])}">{html.escape(page['note_ru'])}</p>
{contents_html}
{content}
          <p class="footer-meta" style="margin-top:2rem" data-ru="Вопрос по документу или нужен разбор кода — напишите." data-en="Questions about the document, or you want a code walkthrough — get in touch.">Вопрос по документу или нужен разбор кода — напишите.</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="contact.html" data-ru="написать" data-en="get in touch"><span data-ru="написать" data-en="get in touch">написать</span></a>
            <a class="btn" href="projects.html" data-ru="все кейсы" data-en="all cases"><span data-ru="все кейсы" data-en="all cases">все кейсы</span></a>
          </div>
        </div>
      </div>
    </div>
  </section>

</main>
"""
    return (head + "</head>\n<body>\n" + header + "\n\n" + main + "\n" + footer +
            '\n\n<script src="data/cases.js"></script>\n'
            '<script src="js/ambient.js"></script>\n'
            '<script src="js/site.js"></script>\n</body>\n</html>\n')


def check_vocabulary(name: str, page: str) -> list[str]:
    """Prose may not carry internal working vocabulary.

    Code spans and code blocks are exempt: an instruction mnemonic such as
    `[%adr]` is literal machine text, not copy, and the mnemonic is part of the
    artefact being published.
    """
    body = re.sub(r"<script.*?</script>", "", page, flags=re.S)
    body = re.sub(r"<pre\b.*?</pre>", " ", body, flags=re.S)
    body = re.sub(r"<code\b.*?</code>", " ", body, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", body)
    bad = []
    for word in BANNED:
        if re.search(rf"\b{re.escape(word)}\b", text, re.I):
            bad.append(word)
    if "[[" in text:
        bad.append("unresolved wikilink")
    return [f"{name}: {w}" for w in bad]


def main() -> int:
    problems: list[str] = []
    for page in PAGES:
        chunks = []
        heads: list[tuple[str, str]] = []
        for rel, heading in page["sources"]:
            chunk, labels, anchors = document(VAULT / rel, heading, page["drop"])
            chunks.append(chunk)
            heads.extend(zip(labels, anchors))
        out = shell(page, "\n".join(chunks), heads)
        dest = ROOT / page["out"]
        dest.write_text(out, encoding="utf-8")
        problems.extend(check_vocabulary(page["out"], out))
        print(f"wrote {page['out']} ({len(out) // 1024} KB)")
    if problems:
        print("\nPROBLEMS:", file=sys.stderr)
        for p in problems:
            print(" -", p, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
