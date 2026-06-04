# Strategy tab — daily auto-refresh design

**Date:** 2026-06-04
**Status:** Approved (build approach: gated Claude-headless step; auto-push live; inside existing daily task)

## Goal
Keep the dashboard's **Strategy** tab (sector-conviction grid, Recent Conviction
Changes, house cards, Cross-Broker Consensus) up to date automatically as new
India strategy reports are filed, with no manual step beyond the existing
rename/sort pipeline.

## Context (existing pipeline)
- **Task "Sorting Folder Rename"** → `C:\Users\admin\.claude\sorting-folder-rename\run-rename.ps1`
  renames + sorts new PDFs into `C:\Users\admin\Desktop\India Related Reports\India Strategy\`
  (and uploads to NotebookLM). Runs upstream.
- **Task "India Research Portal Daily Refresh"** → `scripts\daily-refresh.ps1`
  runs Mon–Fri 09:35 MYT *after* the sort, executes deterministic Node build
  steps that patch `index.html`, then **git commit + push** (auto-publishes via
  GitHub Pages).
- The Strategy tab is currently hand-authored HTML inside `#viewStrategy` in
  `index.html`. It is judgment-heavy: some house/sector cells are *inferred*
  from thematic commentary (marked `*`), Nomura's Bullish/Neutral/Bearish is
  mapped to OW/N/UW, and the consensus/conviction-change blocks are derived.

## Approach
Add one `Step "build-strategy"` to `daily-refresh.ps1` (after `build-financials`,
before the git stage). It is **gated**: it invokes Claude only when a new
strategy PDF has appeared, so it is a cheap no-op on the ~95% of days with no
new report.

### Gating
- Watermark file: `scripts\.strategy-state.json` (local, **gitignored**),
  storing the max `LastWriteTime` (ISO) of `*.pdf` in the India Strategy folder
  at the last successful run.
- Each run: compute the current max mtime. If `<=` watermark → log
  "no new strategy reports" and return (no Claude run). Else proceed.

### Headless build
- Prompt: `docs\strategy-build-prompt.md` (codifies the manual mining method).
- Invocation: `claude -p <prompt>` with allowed tools `Bash,Read,Edit,Grep,Glob`,
  cwd = repo, bounded by a timeout. The prompt instructs Claude to:
  1. List `…\India Strategy\` PDFs; select genuine top-down / earnings-strategy
     notes per house (JPMorgan, Nomura, CLSA, Jefferies, Bernstein, Kotak);
     ignore ESG, EM Money Trail, Global Asset Allocation, quant/fund-flow trackers.
  2. `pdftotext` each; mine per-house × per-GICS-sector stance (OW/N/UW;
     inferred ones marked `*`), conviction changes vs the prior note, and the
     cross-broker consensus (≥2-broker Buy/Sell, plus split calls with Net).
  3. Rewrite **only** the content inside the marker pairs below, preserving every
     CSS class and structural element, and updating the as-of date.

### HTML markers (the only mutable regions)
- `<!--STRAT:GRID:START-->` … `<!--STRAT:GRID:END-->` — the grid `<tbody>` rows.
- `<!--STRAT:BELOW:START-->` … `<!--STRAT:BELOW:END-->` — "Reading the grid" note
  + Recent Conviction Changes (`.changes`) + house cards (`.houses`).
- `<!--STRAT:CONS:START-->` … `<!--STRAT:CONS:END-->` — the three consensus
  tables + their headers + method note.
- `<!--STRAT:ASOF-->…<!--/STRAT:ASOF-->` — the as-of date phrase in the subtitle.

### Hard preservation rule
Everything **outside** the markers must never be edited, specifically: the scoped
`<style>`, the grid `<thead>` (incl. `<th class="mamg">` and the six house `<th>`),
the `.mamg-bar` toolbar, the MAMG `<script>`, and `data/mamg-views.json`. The
shared MAMG views survive every refresh. (The MAMG script only requires that each
regenerated grid row still contains a `<td class="sec">`.)

### Safety gate before publish
After the headless run, `build-strategy.ps1` validates `index.html`:
- all four marker pairs present and balanced;
- the MAMG script still present (grep `mamgViewDraft` and `data/mamg-views.json`);
- `<th class="mamg">` still present;
- the Cross-Broker Consensus `<h3>` still present;
- `data/mamg-views.json` unchanged (not in `git diff`).
If any check fails → `git checkout -- index.html` (revert) and log + skip. A
botched run never publishes. On pass, the existing commit+push step carries it,
and the watermark is updated.

## Files
- **new** `docs/strategy-build-prompt.md` — the mining prompt.
- **new** `scripts/build-strategy.ps1` — gate + invoke + validate + revert-on-fail.
- **edit** `index.html` — insert the four marker pairs around existing content.
- **edit** `scripts/daily-refresh.ps1` — add `Step "build-strategy"`.
- **edit** `.gitignore` — ignore `scripts/.strategy-state.json`.

## Risks & mitigations
- *LLM misreads a call.* Validator guards structure, not judgment; marker scope
  contains any error to the Strategy block; it shows in the daily commit diff.
- *Claude CLI unavailable in the task's environment.* The step logs and returns
  non-fatally (does not abort the rest of daily-refresh).
- *Folder noise (ESG/EM/quant in the same folder).* The prompt explicitly selects
  only genuine India strategy notes.

## Out of scope
- Converting the tab to a `data/strategy.json` data-driven renderer (larger
  refactor; not needed for the daily-update goal).
- Changing the schedule or the rename/sort step.
