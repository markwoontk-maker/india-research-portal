# Sector Monthly-Flow Drill-down — design

**Date:** 2026-06-04
**Status:** Approved design, pending spec review
**Builds on:** the FPI Sector Positioning card (`#secPosTbl`, `loadSectorPositioning()` /
`secPosRender()`) on the Positioning tab, and `data/fpi_sectors.json`
(see `2026-06-04-sector-stock-positioning-design.md`).

## Goal

Let the user click a **sector name** in the FPI Sector Positioning table to
reveal that sector's **monthly net FPI flow** as a **bar chart**, expanded inline
directly beneath the clicked row. History = a **rolling last 12 months**.

## Decisions (from brainstorming)

- History depth: **rolling last 12 months**.
- Placement: **inline expand below the clicked row** (one sector open at a time;
  click again to collapse).
- Chart: **bars only** (monthly net flow, ₹ Cr; green inflow / red outflow). No
  cumulative line.
- Source: NSDL fortnightly sector reports (verified fetchable for historical
  months with a Referer header + request spacing). Backfill once; the existing
  routine rolls it forward.
- Extend the existing `data/fpi_sectors.json` — **no new data file**.

## Data model

Extend `data/fpi_sectors.json`:
```json
{
  "asOf": "2026-05", "prevAsOf": "2026-04", "benchmark": "Nifty 500",
  "months": ["2025-06","2025-07", ... ,"2026-05"],
  "sectors": [
    { "name": "Financial Services", "flow": -23141, "flowPrev": -30856,
      "fpiWt": 29.5, "idxWt": 30.34, "ow": -0.8, "owPrev": -0.2,
      "hist": [ /* 12 monthly net flows ₹ Cr, aligned to months */ ] }
  ]
}
```
- `months`: 12 ascending `"YYYY-MM"` labels (rolling window ending at `asOf`).
- `hist`: per sector, 12 monthly net flows aligned 1:1 to `months`. The last two
  entries equal `flow` / `flowPrev`, so the existing table render is unchanged.
- A sector missing a given month uses `null` in that slot (chart skips nulls); a
  sector with no `hist` at all is handled in the UI.

## UI — inline expand

In `index.html`, in the sector card render path (`secPosRender()`):
- The **sector-name `<td>`** gets `class="secname"`, `data-name="<sector>"`,
  `cursor:pointer`, and a subtle hover (underline / saffron). A small caret/hint
  signals it's expandable.
- Expansion state: `let secPosExpanded=null, secHistChart=null;`.
- `secPosRender()` builds the rows as today; when a sector equals
  `secPosExpanded`, it appends a chart row right after that sector's `<tr>`:
  `<tr class="secexp"><td colspan="5"><div class="chart-box" style="height:200px"><canvas id="secHistChart"></canvas></div></td></tr>`.
  After setting `innerHTML`, if `secPosExpanded` is set, it (re)builds the
  Chart.js bar chart on `#secHistChart` from that sector's `hist` + `months`.
  Because the expansion is part of the render, it **composes with sorting** — the
  open chart follows its sector when the table is re-sorted.
- A **delegated click handler** on `#secPosBody`: if the click target is a
  `.secname` cell, set `secPosExpanded = (same name ? null : name)`, destroy any
  existing `secHistChart`, and call `secPosRender()`. (Column-header sort clicks
  are on `<th>` and unaffected.)
- Chart config (reuse the portal's Chart.js styling): `type:'bar'`, `labels` =
  months formatted `MMM ''YY` (e.g. "Jun '25"); per-bar `backgroundColor` green
  (`#3fc78a`) for ≥0 / red (`#f06a6a`) for <0; tooltip shows the month + signed
  `₹<n> Cr`; y-axis ticks shortened (reuse `posShort`/`secCr`-style); a small
  panel title "<Sector> — monthly net FPI flow (₹ Cr)".
- If the clicked sector has no usable `hist`, the panel shows
  "Monthly history unavailable for this sector."
- `devicePixelRatio` capped (matches existing charts); chart destroyed on
  collapse / re-render to avoid leaks.

## Backfill (one-time, at build)

Assemble the rolling 12-month `months` + per-sector `hist` from NSDL fortnightly
sector reports
(`fpi.nsdl.co.in/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/FIIInvestSector_<Mon><dd><yyyy>.html`):
- For each of the last 12 months, fetch the **two fortnightly files** (mid-month
  and month-end) and sum the **INR equity** column per sector → that month's net.
  Self-check: summed sectors == report Grand Total.
- Fetch sequentially with a **Referer: https://www.fpi.nsdl.co.in/** header and a
  ~2–3s gap between requests (rate-limit avoidance — verified necessary).
- Normalize sector names with the same map used for the current `fpi_sectors.json`
  so `hist` keys line up with the existing rows.
- Months with no/partial NSDL report → `null` in `hist` for that month.
- Merge into the existing `data/fpi_sectors.json` (keep current `flow`/`flowPrev`/
  weights; add `months` + `hist`).

## Refresher update

The existing **Positioning Data Refresher** routine (`trig_016kRFwRmUB53VbyXJF96TGQ`,
`docs/positioning-data-refresher-prompt.md`) additionally maintains the rolling
window: each run, after computing the new latest month, append it to `months`
and each sector's `hist`, and drop entries older than 12 months. Same NSDL
fetch discipline (Referer + spacing). Idempotent — if the latest month is already
present, leave `months`/`hist` unchanged.

## Error handling & testing

- Card still renders the table if `months`/`hist` are absent (older file) — the
  drill-down simply shows "unavailable" on click; nothing else breaks.
- Verify locally: open Positioning tab → click a sector name → bar chart expands
  beneath it with 12 monthly bars, correct colors, hover tooltips; click again →
  collapses; click another → previous closes; sort the table with a chart open →
  chart stays attached to its sector. Spot-check 2 sectors' recent monthly bars
  against `flow`/`flowPrev`.
- Validate the JSON: `months.length` consistent; each `hist.length === months.length`.

## Risks

1. **NSDL rate-limiting / historical gaps** — mitigated by sequential fetch with
   Referer + spacing (verified working for May & Mar 2026); missing months become
   `null` rather than failing the backfill.
2. **Sector-name alignment** across months — the fixed normalization map keeps
   `hist` keys consistent with the table rows; a sector absent in an older report
   gets `null` for that month.

## Out of scope (YAGNI)

- Cumulative line / OW-UW history in the drill-down (monthly net-flow bars only).
- A separate history file or more-than-12-month archive.
- Drill-down for the model-portfolio blocks (this is the sector table only).

## Files touched

- `index.html` — `.secname` clickable cells + expansion logic in `secPosRender()`,
  a delegated click handler, and a `secHistChart` Chart.js bar chart.
- `data/fpi_sectors.json` — add `months` + per-sector `hist` (backfilled).
- `docs/positioning-data-refresher-prompt.md` — rolling-12-month maintenance.
- `CLAUDE.md` — note the drill-down + the extended data shape.
