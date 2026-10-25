# Case-study assets — manifest

Every case now has at least one visual, all produced in one session from the project's own
software or its own files (nothing here is a stock image or a generated cover). Files live in
`assets/cases/<case-id>/`, are PNG, ≤ 400 KB, and are wired into the site through
`assets/cases/manifest.json` (`scripts/generate.py` merges that into `data/cases.json`).
Alt text and captions are bilingual (RU first, EN second) because the site is RU-first.

Capture provenance: `capture-log-real.json`. Rows marked *earlier capture pass* were taken by
`scripts/capture-cases.cjs` before this pass and are kept as the evidence-link figure.

## Table

| Case | File path | Caption (EN) | Alt text (EN) | Type |
|---|---|---|---|---|
| tg-aggregator | `assets/cases/tg-aggregator/tg-aggregator-digest.png` | What the team actually receives: one message per lead, already triaged and with a reply draft attached. | Telegram-style digest message: a lead card with the source channel, the matched keywords, the model's relevance verdict and a drafted reply. | screenshot |
| tg-aggregator | `assets/cases/tg-aggregator/tg-aggregator-run-summary.png` | The same run's own summary: the funnel from channel posts down to delivered leads, and what the AI stage cost. | Summary panel of the offline demo run: how many posts were read, stored and sent to the model, and the total AI cost. | screenshot |
| tg-aggregator | `assets/cases/tg-aggregator/tg-aggregator-rejected.png` | Not every post deserves a model call: the keyword gate's droplist from the same run. | List of posts the keyword gate dropped before the model saw them, each labelled with the rule that matched. | screenshot |
| tg-aggregator | `assets/cases/tg-aggregator/pipeline-overview.png` | README excerpt: the quick-start commands and the service's operational contract — readiness checks and Prometheus metrics. | README excerpt for the service: local quick-start commands and the /health/live, /health/ready and /metrics endpoint table. | document *(earlier capture pass)* |
| ai-agents-automation | `assets/cases/ai-agents-automation/tg-aggregator-pipeline.png` | How the pipeline is wired — and the numbers one demo run actually produced. | Six-stage pipeline diagram: Telethon reader, ingestion with dedupe, keyword gate, DeepSeek classify-and-draft, delivery renderer, Telegram bot, with four counters from the demo run below. | diagram |
| ai-agents-automation | `assets/cases/ai-agents-automation/service-readme.png` | The service status section of the README: recoverable ingestion, versioned classification, an audited lead lifecycle, and a mandatory human review step. | The 'Current status' section of the telegram-parser README: the implemented capabilities, from recoverable ingestion to mandatory human review of reply drafts. | document *(earlier capture pass)* |
| lilys-innovations | `assets/cases/lilys-innovations/lilys-innovations-assets.png` | Shipped work, not a description of it: the systems' icons, effects and interface art from the repository, with 9,046 lines of Lua behind them. | Grid of the mod's own art: six system icons (ablative armour, auxiliary reactor, ECM suite, fibre liner, infusion bay, shock neutraliser) plus explosion, jammer and interface art, with file and line counts beside it. | artefact |
| lilys-innovations | `assets/cases/lilys-innovations/repository.png` | The published mod: a repository with 37 releases, separate graphics, audio and data folders, and Lua as the only language. | The mod's GitHub repository page: the graphics, data, img and audio folders, 37 tagged releases, and Lua as the only language. | screenshot *(earlier capture pass)* |
| android-apps | `assets/cases/android-apps/android-tetris-playfield.png` | Tetris, rebuilt from custom Views: the board, the next-piece preview and the score line, running on Android 9. | Android Tetris game running on an emulator: playfield with a stack of settled tetrominoes, score counter, next-piece preview and left/right/down controls. | screenshot |
| android-apps | `assets/cases/android-apps/android-planner-items.png` | Planner's Room-backed item list with three records added through the app's own add form. | Planner's Items list on an emulator: three records (Museum tour, Groceries run, Library pickup) with edit and delete actions, backed by a Room database. | screenshot |
| android-apps | `assets/cases/android-apps/planner-repository.png` | The Planner repository — the larger of the two Android apps in this case: a real Gradle project built on Room and Google Maps. | The Planner repository page on GitHub: the source tree of the Java Android app and its commit history. | screenshot *(earlier capture pass)* |
| compiler-translator | `assets/cases/compiler-translator/compiler-translation.png` | Source in, PL/1 out: the compiler's real output on its own test program. | Two side-by-side panes: a 17-line Pascal program and the 26-line PL/1 program the compiler generated from it. | screenshot |
| compiler-translator | `assets/cases/compiler-translator/analyzer-repository.png` | The Analyzer repository — one of the translator's two parts; the lexer lives in its own repository. | The Analyzer repository page on GitHub: the Java compiler sources and the commit history. | screenshot *(earlier capture pass)* |
| neural-net-from-scratch | `assets/cases/neural-net-from-scratch/neural-net-training.png` | The network learning in the browser: settings, the live simulation, and the score it is minimising. | The evasion-learning page mid-training: the simulation canvas with the obstacles and the agent, beside the settings and status panels showing iteration, pass and score. | screenshot |
| neural-net-from-scratch | `assets/cases/neural-net-from-scratch/evasion-learning-repository.png` | The repository of a network trained to dodge falling blocks: vanilla JavaScript, no libraries. | The Evasion-learning repository page on GitHub: the vanilla-JavaScript neural network sources and commit history. | screenshot *(earlier capture pass)* |
| cpu-from-nand | `assets/cases/cpu-from-nand/symphony-isa.png` | The instruction set the CPU was built around: three register fields and a 16-bit immediate in one 32-bit word. | Diagram of the Symphony CPU: six datapath layers from a NAND gate up to the bus, the register file, and four 32-bit instruction encodings. | diagram |
| compression-algorithms | `assets/cases/compression-algorithms/compression-results.png` | Both compressors measured on the same file, including the round-trip check. | Results table comparing the two compressors on one 3,442-byte Java file: Huffman 2,646 bytes at 1.30x with an exact round-trip; arithmetic 2,188 bytes at 1.57x with the decoder diverging after 2,406 characters. | artefact |
| compression-algorithms | `assets/cases/compression-algorithms/compressor-repository.png` | The file compressor with Huffman and arithmetic coding; the image RLE compressor lives in its own repository. | The Compressor-2 repository page on GitHub: Huffman and arithmetic coding implemented in Java. | screenshot *(earlier capture pass)* |
| sorting-visualizer | `assets/cases/sorting-visualizer/sorting-visualizer-1d.png` | Quicksort mid-flight in 1D: 99 values, the live comparison highlight, and the running status. | The sorting visualizer in 1D mode: 99 bars of a random array mid-quicksort with the compared pair highlighted, controls on the left and the status bar naming Quick sort. | screenshot |
| sorting-visualizer | `assets/cases/sorting-visualizer/sorting-visualizer-2d.png` | The 2D mode: the same array as a grid, sorting cell by cell. | The same visualizer in 2D mode: the values laid out as a grid of coloured cells being reordered by bubble sort. | screenshot |
| sorting-visualizer | `assets/cases/sorting-visualizer/sorting-repository.png` | The visualization page: 11 sorting algorithms in 1D and 2D, vanilla JavaScript with no dependencies. | The Sorting-algorithms repository page on GitHub: the JavaScript page that visualizes the sorting algorithms. | screenshot *(earlier capture pass)* |

## How each image was produced

| Case | Method |
|---|---|
| tg-aggregator | The project's offline demo (`H:\Work\tg-aggregator\demo\preview.html`) rendered in Chromium and screenshotted element by element. Synthetic fixtures, publishable as-is. |
| ai-agents-automation | Diagram rendered from `specs/system-architecture.md` in the vault; the counters are the demo run's own reported numbers. |
| lilys-innovations | Contact sheet of the mod's real PNGs from `IonShieldQuad/lilys-innovations`; file and line counts computed from the clone. |
| android-apps | Both APKs installed on an API 28 AVD (`casetest`), driven with `adb input`, captured with `adb exec-out screencap`; status and navigation bars cropped. Three records were added through Planner's own add form so the list is not empty. |
| compiler-translator | `javac` over the repo's sources (a 3-line `javafx.util.Pair` shim plus the bundled annotations jar), `java core.AnalyzerMain` run on the repo's own test program; both panes are the real `input.txt` / `generated.txt`. |
| neural-net-from-scratch | The repo's `evasionHTML.html` run in Chromium: initialised, started, left training, then the app card screenshotted. |
| cpu-from-nand | Diagram drawn from `notes/symphony-isa.md` (registers and instruction encodings transcribed from it). |
| compression-algorithms | A Java probe calling `HuffmanCompressor` / `ArithmeticCompressor` directly on a real file in the repo, measuring with the project's own `Utils.getSize()` and re-decoding through `decompress()`. |
| sorting-visualizer | The repo's `SortHTML.html` run in Chromium: array generated, algorithm selected, started, captured mid-sort in 1D and again in 2D. |

## Not available, and why

- **cpu-from-nand** — no Turing Complete schematic screenshot exists on disk and the game cannot be
  driven headlessly; the ISA/datapath diagram stands in. A real in-game capture is the only way to
  improve on it.
- **lilys-innovations** — an in-game capture needs the game running with the mod loaded. The asset
  sheet is the honest substitute; the workshop listing would be the next best thing.
- **android-apps** — Planner's map screen renders blank without a Google Maps API key, so it is not
  shown. The Room-backed list stands as the app's real UI.
- **tg-aggregator** — a real Telegram digest needs the live bot and a real account; the offline demo
  renders the same message shape from fixtures that contain no real channel, client or person.

## Findings this pass turned up (for the copy/implementation tasks, not fixed here)

1. **`lilys-innovations` copy says "13 Lua scripts, 10 000+ lines".** The repository at HEAD has
   **12 `.lua` files and 9,045 lines** (plus 564 PNGs). Either the copy or the count needs correcting.
2. **`compression-algorithms`: the arithmetic decoder is not lossless.** Compressing a 3,442-byte
   file and decoding it back through `ArithmeticCompressor.decompress()` reproduces the first
   2,406 of 3,343 characters, then diverges into garbage; Huffman is exact. The case copy should not
   claim three working lossless implementations until this is verified or the wording changes.
3. **`compiler-translator`: `<` is emitted as `<=`.** `PascalToPL1.java` lines 161–162 map the
   `<` operator to `"<="` while `<=` maps to itself, so one comparison direction is silently
   widened in the generated code. The figure above deliberately uses a sample whose output is
   faithful; the defect is unfixed.
4. **`assets/cases/` is shared.** A parallel pass wrote `manifest.json`, `capture-log.json` and the
   `*-repository.png` figures before this one. Those entries are preserved here, with the real
   software captures promoted to `thumb` — the previous manifest had no `cpu-from-nand` entry.
