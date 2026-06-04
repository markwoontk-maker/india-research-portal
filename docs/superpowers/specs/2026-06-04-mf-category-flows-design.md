# MF Category Flows — design

**Date:** 2026-06-04
**Status:** Approved design, pending spec review
**Builds on:** the Positioning tab and the FPI Sector Positioning card / drill-down
(`secPosRender`, `secHistDraw`) — this card mirrors that layout.

## Goal

A new card on the **Positioning** tab showing where mutual-fund money is going
across the **6 equity cap categories** — **Large Cap, Large & Mid Cap, Mid Cap,
Small Cap, Multi Cap, Flexi Cap** — with monthly **net inflows** and **AUM**,
sourced from AMFI. Each category opens an inline **monthly net-flow bar chart**.

## Decisions (from brainstorming)

- Show **both net flows and AUM** per category.
- **6 equity cap categories** (not all ~11 equity sub-categories).
- Layout **mirrors the FPI sector card**: a sortable table + click-a-name inline
  bar chart.
- **History is APPEND-ONLY** — each new month adds a bar; **old months are never
  trimmed** (the chart grows over time). Not a rolling window.
- This is **clean official AMFI data** — no "approximate" disclaimer (unlike the
  qualitative MF *sector* tilt card).

## Data

`data/mf_categories.json` (committed, AMFI-sourced):
```json
{
  "asOf": "2026-03",
  "prevAsOf": "2026-02",
  "months": ["2025-04","2025-05", "...", "2026-03"],
  "categories": [
    { "name": "Flexi Cap", "flow": 10054, "flowPrev": 6925,
      "aum": 512345, "aumShare": 22.4,
      "hist": [ /* monthly net flows ₹ cr, aligned 1:1 to months */ ] }
  ]
}
```
- `flow` / `flowPrev` = net inflow (₹ cr) for the latest / previous month
  (= `hist[last]` / `hist[last-1]`).
- `aum` = category AUM (₹ cr); `aumShare` = % of the 6-category equity AUM.
- `months` + each category's `hist` are **append-only** and stay aligned 1:1
  (`hist.length === months.length`); a missing month is `null`.
- Net flows are official AMFI net-of-redemption figures.

## UI

A card titled **MF Category Flows** appended after the MF Sector Positioning card
in `#viewPositioning`, rendered by `loadMfCategories()` / `mfCatRender()`:

- Sortable table — columns: **Category · Net flow (this mo) · Prev mo · YTD · 1Y ·
  AUM · Share %**.
  - Net-flow cells (this mo / prev / YTD / 1Y) green for inflow / red for
    outflow, ₹-cr formatted.
  - YTD = sum of the current calendar year's months in `hist`; 1Y = sum of the
    trailing 12 months of `hist` (both derived client-side, same approach as the
    FPI card's `secYtd`/`secOneY`).
  - AUM in ₹ lakh cr (or ₹ cr); Share % of the 6-category equity AUM.
  - Click-to-sort headers with the saffron ▲/▼ indicator (reuse the FPI pattern).
- **Click a category name** → inline expanded row with a Chart.js **bar chart of
  that category's full monthly net-flow history** (all accumulated months, green
  inflow / red outflow, hover = month + ₹ cr). One open at a time; composes with
  sort; reuses the `secHistDraw`-style chart. Because history is append-only the
  chart **grows a bar each month**.
- Header sub-line: "Net equity-MF flows + AUM by category · AMFI · `<asOf>` ·
  total equity AUM ₹`<x>` lakh cr". No approximate disclaimer (clean source).
- Independent error handling: if `data/mf_categories.json` is missing/short, the
  card shows "MF category data unavailable" and nothing else breaks.

## Backfill (one-time)

Seed `months` + per-category `hist` with the **last ~12 months** of AMFI category
net flows (a sensible starting span — it then accumulates forever), plus the
latest `aum`/`aumShare`. Source: AMFI monthly data; the **finnovate monthly MF
blogs** (`finnovate.in/learn/blog/mutual-fund-data-<month>-2026`) are the verified
reachable per-month source, cross-checked against other aggregators (upstox,
ventura) and AMFI official where reachable. Months with no clean figure → `null`.

## Refresher

Fold into the existing **Positioning Data Refresher** routine
(`trig_016kRFwRmUB53VbyXJF96TGQ`, cron `30 1 2,17 * *`; the **17th** run lands
after AMFI's ~10th-of-month release):
- Fetch the latest completed month's category net flows + AUM.
- **Append** the new month to `months` and each category's `hist` (and update
  `flow`/`flowPrev`/`aum`/`aumShare`). **Never trim** older months.
- Idempotent: if the latest month is already present, leave the file unchanged.
- Same fetch discipline / fallbacks as NSDL (sequential, aggregator fallback).
- Doc updated in `docs/positioning-data-refresher-prompt.md`.

## Error handling & testing

- Card renders the table from the committed JSON; each category's chart builds on
  click. Verify locally: open Positioning tab → MF Category Flows table shows 6
  rows with flow/AUM, sort works, click a category → its full-history bar chart
  expands; spot-check the latest month vs the AMFI/finnovate print (e.g. Mar-2026:
  Flexi Cap +₹10,054 cr, Small Cap +₹6,264, Mid Cap +₹6,064, Large & Mid +₹5,307,
  Large Cap +₹2,998).
- Validate JSON: `months.length` ≥ 1, every `hist.length === months.length`,
  6 categories.

## Risks

1. **AMFI direct fetch flaky** — mitigated by the finnovate/aggregator fallback
   (verified) + sequential discipline; exact endpoint locked during the build.
2. **Category-label drift** — fixed to the 6 canonical AMFI category names; a
   source using a variant label is normalized to these.
3. **AUM share denominator** — defined as % of the 6 cap categories' combined
   equity AUM (stated in the header), to keep it self-consistent.

## Out of scope (YAGNI)

- All ~11 equity sub-categories / sectoral-thematic / ELSS / hybrid.
- Within-portfolio large/mid/small *stock* composition (a different, messier
  measure).
- Rolling-window trimming (history is append-only by design).

## Files touched

- `index.html` — MF Category Flows card + `loadMfCategories()`/`mfCatRender()`
  (+ chart), wired into `loadPositioning()`.
- `data/mf_categories.json` — new, committed (backfilled).
- `docs/positioning-data-refresher-prompt.md` — append-only monthly maintenance.
- `CLAUDE.md` — document the card, data shape (append-only), and source.
