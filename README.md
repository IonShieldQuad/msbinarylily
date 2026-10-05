# MsBinaryLily — portfolio site

Static portfolio for **Lilia Grinina** (MsBinaryLily). Zero-framework vanilla
HTML/CSS/JS plus a small Python generator that turns the vault's case studies
into the manifest the site renders. Decision record: **ADR-001** (in the vault).

Vault project (source of truth for content, specs and design):
`H:\ObsidianVaultCentral\Work\Personal\portfolio-site\`

## Layout

```
index.html          hero, ticker, featured cases, approach, bio teaser, contact CTA
projects.html       case grid + theme filters + technical-docs block
case.html           one template for any case: case.html?project=<id>
about.html          bio, education, stack, values, process
laboratory.html     experiments (deliberately not full cases)
contact.html        Telegram / GitHub / email + availability
css/main.css        design system: tokens, components, responsive
js/site.js          manifest rendering, RU/EN toggle, filters, case metadata
js/ambient.js       the seam-graph ambience engine (hero + laboratory)
js/lead-form.js     contact form wiring (hidden until site-config.js has a relay)
assets/emblem.svg   brand emblem (flower of data-streams on a chip)
scripts/generate.py vault cases/*.md  →  data/cases.json + data/cases.js
scripts/verify.cjs  real-browser check of every page (errors, DOM, screenshots)
data/cases.json     GENERATED — do not hand-edit
data/cases.js       GENERATED — same payload as `window.MBL_CASES` so the pages
                    also work from file:// (no web server, no CORS)
shots/              verification screenshots (git-ignored)
```

## Regenerate the content

```
python scripts/generate.py            # writes data/cases.json + data/cases.js
python scripts/generate.py --check    # validate only, write nothing
```

Exit codes: `0` clean, `1` warnings (missing translations, missing metrics,
missing evidence links), `2` validation errors — nothing is written on `2`.
Output is deterministic: `meta.generated_at` is the newest case-file mtime, not
the wall clock, so an unchanged input produces a byte-identical manifest.

The generator reads the vault path directly (see `DEFAULT_SOURCE`); override
with `--source <dir>`.

## Verify

```
NODE_PATH="%LOCALAPPDATA%/hermes/hermes-agent/node_modules" \
  "%LOCALAPPDATA%/hermes/node/node" scripts/verify.cjs        # file:// (double-click case)
NODE_PATH=... node scripts/verify.cjs http://localhost:8000    # served case
```

It loads every page with a real Chromium, fails loudly on console/page errors
and failed requests, asserts the manifest-driven DOM (cards, case sections,
ticker, nav order), flips RU→EN, and writes desktop + mobile screenshots into
`shots/`. Last run: **10 page states, 0 errors, all assertions green.**

It also asserts, so a regression fails the run (`exit 1`) instead of only printing
numbers: exactly one `<h1>` per state; no text below 12px; nothing pushing the page
sideways at 360px; no source-language text left once EN is on; the case title in
`document.title`; contrast pairs (each label must use the token of its surface and
clear 4.5:1) plus a sweep for any visible text below the AA floor; and the ambience
probe (reacts to the pointer on the hero, absent under `?static`). Every defect found
in QA kept a check here.

## Serve locally

```
python -m http.server 8000        # then open http://localhost:8000
```

Opening `index.html` straight from disk also works — that is why the manifest is
shipped as `data/cases.js` in addition to `data/cases.json`.

## Conventions worth keeping

- **`data/cases.json` and `data/cases.js` are generated.** They are committed
  because the host serves the repo as-is; never edit them by hand, edit the
  vault case and re-run the generator.
- **No frameworks** (ADR-001), no build step, no `mobile-fixes.css`: the mobile
  layout is the base and desktop is the media query.
- **Bilingual by attribute**: every UI string carries `data-ru` / `data-en`;
  case text comes from the manifest `{ru, en}` pairs. Language choice persists
  in `localStorage`. Default is RU.
- **Case source language** is detected per case (`lang`, `translation` in the
  manifest). The vault cases are written in English, so in RU mode a case page
  says so instead of pretending the RU slot is filled.
- **Ambience is optional**: `?static` or `prefers-reduced-motion` removes the
  ambience canvas entirely and keeps the `.hero-fallback` CSS backdrop.

## Status vs. the acceptance criteria (build handoff, 2026-09-22)

| # | Criterion | State |
|---|-----------|-------|
| 1 | `generate.py` deterministic, validates, exit 0/1/2, idempotent | ✅ |
| 2 | `data/cases.json` generated only, never hand-edited | ✅ documented |
| 3 | Every kept case renders through one template, no orphan pages | ✅ 10/10 |
| 4 | Bilingual toggle on every page, default RU | ✅ UI + case bodies (RU is AI-assisted, human review pending) |
| 5 | Responsive from 360 px, no mobile-fixes stylesheet | ✅ verified at 360 px, asserted by the harness |
| 6 | Nav identical everywhere; `?static` + reduced-motion kill the ambience canvas | ✅ verified |
| 7 | Live at a public URL, URL recorded in the vault `_index.md` | ✅ https://ionshieldquad.github.io/msbinarylily/ |

Still open (needs a decision, not code): hosting target and domain, whether the
RU resume ships as a PDF, whether Laboratory stays in the primary nav, and the
RU translation pass for case bodies.
