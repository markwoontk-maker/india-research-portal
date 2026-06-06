# Charts Tab — Extracted Graph Gallery (Design)

**Date:** 2026-06-07
**Status:** Approved design → ready for implementation plan
**Repo:** markwoontk-maker/india-research-portal (`index.html`, GitHub Pages)

## 1. Goal

Add a new **Charts** tab to the research portal that displays every visual exhibit
(charts, tables, maps, diagrams) extracted from the broker research PDFs as a
filterable card gallery. Each card carries a two-level tag bar (the report's
theme/sector + the specific company/sector the exhibit depicts), the analyst's own
caption verbatim where available, and a short commentary written by an agent.

This spec covers a **pilot** over the 5 most-covered folders. The pipeline is
designed to scale to all 261 folders / 621 PDFs afterward, but full rollout is out
of scope here (storage + compute decisions deferred — see §9).

## 2. Scope (pilot)

Process these 5 folders under `C:\Users\admin\Desktop\India Related Reports\`
(the most PDFs; all chart-rich thematic/sector decks):

| Folder | PDFs | Type |
|---|---|---|
| India Macro | 26 | theme — macro |
| India Strategy | 23 | theme — strategy |
| Indian Financials | 16 | sector — Financials |
| Indian Autos | 9 | sector — Autos |
| Indian Consumer | 8 | sector — Consumer |

("Unknown", 13 PDFs, is intentionally excluded from the pilot.)

**Aggressiveness: everything visual.** Capture every exhibit — line/bar/area/scatter
graphs, valuation bands, data tables, maps, process/flow diagrams. Each gets a
`chart_type` field so the gallery can later be filtered down to just graphs. Skip
only pure decoration: house logos, analyst headshots, page furniture, disclaimers.

## 3. Existing plumbing reused

- **`data/pdfmap.json`** — canonical key `House|YYMMDD|Company|titleslug` → absolute
  PDF path. The charts manifest reuses this key as the report identifier.
- **`data/companies.json`** — `company → {ticker, sector, desc}`. Used to resolve the
  per-chart **subject** company/sector tag when an exhibit names a specific stock.
- **`data/pdfdata.json`** — `{currCall, currTP, prevTP, summary}` per report key.
  Fed to the commentary agent as report-level context.
- Filename pattern `[YYMMDD] [House] Folder - Title.pdf` → date, broker, theme.

## 4. Pipeline (three phases)

### Phase A — Render (deterministic, no model)
A Python script run via `uv run --with pymupdf` (no system pip install; `uv` is at
`C:\Users\admin\.local\bin\uv`). Python 3.14 may lack a pymupdf wheel, so pin a
working interpreter (`uv run --python 3.12 --with pymupdf …`).

For each pilot PDF: render every page to a PNG at ~180 dpi into a scratch dir
(`scripts/.charts-work/<key>/p<NN>.png`). Record page count and page dimensions
(points) per PDF for later coordinate conversion.

### Phase B — Analyze (vision, model)
Dispatch subagents (one unit of work = one page image, batched per PDF) that look at
each rendered page and return **structured JSON** per exhibit on that page:

```json
{
  "charts": [
    {
      "bbox": [x0, y0, x1, y1],            // normalized 0..1 of the page
      "chart_title": "string",             // the exhibit's own title/heading
      "chart_type": "line|bar|area|scatter|valuation_band|table|map|diagram|other",
      "subject_company": "string|null",    // specific stock depicted, if any
      "subject_sectors": ["string", ...],  // sectors/themes the exhibit depicts
      "analyst_caption": "string|null",    // verbatim caption/footnote the report places with the exhibit
      "commentary": "string"               // 1-2 sentence agent read of the exhibit
    }
  ]
}
```

Rules for the agent: skip logos/headshots/disclaimers; `analyst_caption` must be
**verbatim** from the page (null if the exhibit has none — do not invent one);
`commentary` is the agent's own brief interpretation; resolve `subject_company`
against `companies.json` names where possible.

### Phase C — Crop + assemble (deterministic, no model)
The Python script converts each normalized `bbox` to page-point coordinates, pads
slightly (~2%), and re-renders just that region with
`page.get_pixmap(clip=rect, dpi=200)`, then downscales to ≤1100px width and saves as
**WebP (q80)** via Pillow (`uv … --with pymupdf --with pillow`). WebP keeps the
committed image set ~5-10x smaller than PNG. Outputs:

- Images: `charts/<Folder_slug>/<slug>_p<NN>_<n>.webp` where `<slug>` is the report
  key sanitized to a filesystem-safe form (`House_YYMMDD_titleslug` — the `|` and `#`
  separators in the pdfmap key are **illegal in Windows filenames**, so they are
  replaced); `<Folder_slug>` is the source folder name slugified too (no spaces, so
  the web path needs no %20 encoding).
- Manifest: `data/charts.json` (see §5)

Two-level tags resolved here:
- **Source tag** (from the folder/key): theme or sector + broker + date.
- **Subject tag** (from Phase B): the specific company/sector the exhibit depicts;
  `sector` cross-checked against `companies.json` when `subject_company` is known.

## 5. Data shape — `data/charts.json`

```json
{
  "updated": "2026-06-07",
  "charts": [
    {
      "id": "Jefferies|260603|India Macro|...#p4_1",   // JSON string; may keep | and #
      "report_key": "Jefferies|260603|India Macro|...",
      "house": "Jefferies",
      "date": "2026-06-03",
      "source": "India Macro",          // folder/theme — the card's source tag
      "source_type": "theme|sector|company",
      "report_title": "string",
      "page": 4,
      "image": "charts/India_Macro/Jefferies_260603_<titleslug>_p04_1.webp",  // slugified dir + WebP
      "chart_title": "string",
      "chart_type": "line",
      "subject_company": "string|null",  // per-chart subject tag
      "subject_sectors": ["string", ...],
      "sector": "string|null",           // resolved from companies.json if subject_company known
      "analyst_caption": "string|null",
      "commentary": "string"
    }
  ]
}
```

Append-only by `id` so reruns/scale-ups merge rather than clobber.

## 6. UI

New sidebar nav item between Sector and Watchlist:
`<div class="nav-item" data-view="charts" data-title="Charts">` (grid/graph SVG).

New view container `<div id="viewCharts" hidden>`. **Gotcha (from CLAUDE.md):** if
`#viewCharts` uses `display:flex`/`grid`, add a matching
`#viewCharts[hidden]{display:none}` rule so id+attr specificity beats the layout
rule — otherwise the gallery leaks onto every tab.

Lazy-load like Positioning: a `chartsLoaded` guard in `showView`
(`if(v==='charts' && !chartsLoaded){ chartsLoaded=true; loadCharts(); }`), and
`loadCharts()` fetches `data/charts.json` (`cache:'no-store'`), with a graceful
empty/error state.

**Layout:** responsive card grid. Each card:
- chart image (lazy `loading="lazy"`; click → lightbox enlarge)
- `chart_title` heading
- **bottom tag bar:** source chip (theme/sector) · subject company chip (if any) ·
  subject sector chip(s) · broker · date
- **Analyst:** `analyst_caption` block (hidden if null)
- **Commentary:** `commentary` block

**Controls:** text search + filter chips for source, subject sector, broker, and
`chart_type` (so the user can collapse to just graphs). Styled to match existing
cards (`--panel`, `--line`, `--saffron`, Roboto Mono accents).

## 7. Workflow / orchestration

Phase B is the model-heavy step. For the pilot (~82 PDFs, a few hundred pages) use a
subagent-per-page fan-out with a strict JSON schema (validated at the tool layer so
agents retry on mismatch). A small driver script sequences A → B → C. Phase B
results are cached to disk per page so a rerun of C doesn't re-invoke the model.

## 8. Versioning

Per the standing rule ([[feedback-routine-versioning]] / CLAUDE.md "always commit +
push on any dashboard change"): commit the new tab + `data/charts.json` + the pilot
PNGs + this spec and push to `main`. GitHub Pages auto-publishes.

## 9. Scaling notes (out of scope, recorded for later)

- **Storage:** crops are committed as capped-width WebP (q80, ≤1100px), so the full
  621-PDF rollout stays ~120-200 MB — under the GitHub Pages ~1 GB budget. The
  full-page render intermediates live in git-ignored `scripts/.charts-work/` and are
  never committed. **Do not use Git LFS** — Pages serves the LFS pointer text, not
  the binary, so images would break. If bandwidth ever matters, serve `charts/` via
  jsDelivr (mirrors the public repo, no account/keys).
- **Auto-refresh:** any future "new report → new charts" automation must run
  **locally** (like `build-highs.ps1` / `build-positioning.ps1`) — cloud CCR
  routines clone this repo read-only and cannot push (documented gotcha).
- **Crop accuracy:** vision bounding boxes are approximate; the ~2% pad mitigates
  clipping. The pilot output is eyeballed before any scale-up; if crops are too
  loose/tight, fall back to page-region or per-exhibit heuristics.

## 10. Out of scope

- Processing folders beyond the 5 pilot folders.
- Interactive/redrawn Chart.js versions of the exhibits (gallery shows images).
- Per-chart standalone `.html` files (chosen: single in-dashboard gallery).
- Any paid/keyed API (project rule: free sources only).
