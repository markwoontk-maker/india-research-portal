# Sector & Stock Positioning — design

**Date:** 2026-06-04
**Status:** Approved design, pending spec review
**Builds on:** the Positioning tab (`#viewPositioning`) created in
`2026-06-04-positioning-tab-fii-dii-design.md`.

## Goal

Add two cards to the **Positioning** tab, below the FII/DII charts:

1. **FPI Sector Positioning** — sector inflows/outflows (latest month vs previous
   month) and overweight/underweight vs the **Nifty 500**, from FPI flow data.
2. **Top Overweight / Underweight Stocks** — from a single broker's monthly
   **model portfolio (Motilal Oswal)**: the top OW and UW names, each with its
   **1-month price performance** and its **change vs the previous month**
   (added / weight raised / trimmed / removed / held).

Both are data-driven, delivered through the portal's established **committed
`data/*.json` + scheduled-refresher** pattern.

## Decisions (from brainstorming)

- Sector OW/UW is measured **vs Nifty 500** weights.
- Stock OW/UW comes from a **real broker model portfolio**, NOT a broker-ratings
  consensus (the library has no structured model-portfolio table). Broker =
  **Motilal Oswal** (best publicly-trackable monthly model portfolio; user had
  no preference).
- Stock "how did it fare vs previous month" = **both** 1-month price return
  **and** stance change.
- Baked JSON + routine (not client-live scraping), matching `fii_dii.json`.

## Component 1 — FPI Sector Positioning

### Data: `data/fpi_sectors.json`
```json
{
  "asOf": "2026-05",
  "prevAsOf": "2026-04",
  "benchmark": "Nifty 500",
  "sectors": [
    { "name": "Financial Services", "flow": -12345.6, "flowPrev": 6789.0,
      "fpiWt": 31.2, "idxWt": 33.5, "ow": -2.3, "owPrev": -1.9 }
  ]
}
```
- `flow` / `flowPrev` = net FPI flow (₹ Cr) for the latest / previous month.
- `fpiWt` = sector's share of FPI equity AUC (%); `idxWt` = sector's Nifty 500
  weight (%); `ow` = `fpiWt − idxWt` (signed %, + = overweight); `owPrev` = prior
  month's `ow` (for the Δ).

### Render: `loadSectorPositioning()`
Fetches the file, builds one card with a sortable table (default sort: |flow|
desc):

| Sector | Net flow (this mo) | Prev mo | OW/UW vs N500 | Δ MoM |
|---|---|---|---|---|

- Net-flow cell: signed ₹ Cr, green inflow / red outflow, with an inline
  diverging CSS bar (width ∝ |flow|, left/right of a centre line).
- OW/UW: a chip — green `+1.2% OW` / red `−0.8% UW`.
- Δ MoM: ▲/▼ + the change in `ow` vs `owPrev`.
- Card header: `FPI Sector Positioning · May 2026 vs Apr 2026 · vs Nifty 500`.
- Error: if the file is missing/unparseable, the card shows a "sector data
  unavailable" message; the rest of the tab is unaffected.

## Component 2 — Top OW/UW Stocks (Motilal Oswal model portfolio)

### Data: `data/model_portfolio.json`
```json
{
  "broker": "Motilal Oswal",
  "asOf": "2026-05",
  "prevAsOf": "2026-04",
  "benchmark": "Nifty 50",
  "holdings": [
    { "stock": "State Bank of India", "ticker": "SBIN.NS",
      "wt": 8.0, "benchWt": 3.0, "ow": 5.0, "prevOw": 4.0,
      "change": "raised", "note": "+100 bps, funded by trimming HDFC Bank" }
  ]
}
```
- `wt` = model-portfolio weight (%); `benchWt` = Nifty weight (%);
  `ow` = `wt − benchWt`; `prevOw` = prior month's OW.
- `change` ∈ `new | raised | trimmed | held | removed`.
- `note` = short human description of the MoM change (optional).
- When the source discloses only *changes* (not full weights), `ow`/`wt` may be
  null and the row is driven by `change` + `note`; OW/UW lists then fall back to
  ranking by disclosed direction. (See risks.)

### Render: `loadModelPortfolio()`
One card, two side-by-side lists (~10 rows each):
- **Top Overweight** (largest positive `ow`, plus `new`/`raised`) and
  **Top Underweight** (largest negative `ow`, plus `removed`/`trimmed`).
- Each row: stock · OW/UW chip · stance-change badge
  (▲ raised / ▼ trimmed / ✚ new / ✕ removed / = held; `note` on hover) ·
  **1-month price return** (green/red).
- Card header attributes the source: `Top Overweight / Underweight · Motilal
  Oswal model portfolio · May 2026`.

### Price performance
1-month return per `ticker` from Yahoo (`v8/finance/chart/<ticker>?range=1mo`),
reusing the portal's existing chunked Yahoo fetch + proxy fallback. Computed
client-side at render; if a quote fails the row shows "—" for performance.

## Refresh routine (one new routine, both files)

A single **Positioning Data Refresher** remote agent:
- **Cron:** `30 1 2,17 * *` UTC = **9:30 AM MYT on the 2nd & 17th** (after NSDL's
  fortnightly sector data posts; Motilal updates ~monthly, handled idempotently).
- **Each run:**
  1. **Sectors** — assemble `data/fpi_sectors.json` from NSDL fortnightly
     sector-wise FPI data (sum the month's fortnights for `flow`; AUC for
     `fpiWt`) + Nifty 500 sector weights (niftyindices factsheet). Fallback
     aggregator for flows: finnovate / Trendlyne macro.
  2. **Model portfolio** — refresh `data/model_portfolio.json` from Motilal
     Oswal's latest model-portfolio disclosure (broker note / media coverage via
     WebSearch). Carry forward the prior file's `ow` into `prevOw` and set
     `change`/`note` from what's disclosed. If no new model portfolio since the
     last run, leave the file unchanged.
  3. Validate JSON, commit + push to `main` (standing versioning rule).
- **Idempotent / append-safe:** never overwrites with empty/garbage; if a source
  fails, that file is left as-is and the run notes which source failed.
- Prompt stored in `docs/positioning-data-refresher-prompt.md`; created enabled
  via the routines API (the newer trigger family accepts the embedded prompt, as
  used for the FII/DII refresher).

## Integration

- Both cards appended inside `#viewPositioning`, after the existing FII/DII
  caption. Each is an independent unit with its own loader + error handling.
- Lazy-loaded on first Positioning-tab open: `loadPositioning()` also kicks off
  `loadSectorPositioning()` and `loadModelPortfolio()` (guarded so each runs
  once).
- Reuses existing `.card`, table styles, `.up`/`.down` chips, and the Yahoo
  fetch helpers. Sector name normalization maps NSDL sectors → Nifty 500 sector
  buckets (a small lookup in the routine).

## Sector-name normalization

NSDL's ~23 sectors and Nifty 500's GICS-style sectors don't match 1:1. The
routine carries a fixed map (e.g. NSDL "Financial Services" + "Banks" →
Nifty "Financial Services"; "Information Technology" → "IT"; etc.) so `fpiWt`
and `idxWt` are computed on the same sector taxonomy. The map lives in the
routine prompt/doc and is the single source of truth for the bucketing.

## Error handling & testing

- Each card fails independently to a "data unavailable" placeholder; the FII/DII
  charts and the rest of the dashboard are never blocked.
- Verify locally: open the Positioning tab, confirm both cards render from the
  committed JSON, sector flows colour correctly, OW/UW chips match `fpiWt−idxWt`,
  the model-portfolio change badges and 1-month returns populate, and tooltips
  work. Spot-check 2–3 sector flows against the NSDL/aggregator print and 2–3
  model-portfolio names against the Motilal disclosure.
- Validate both JSON files parse and have the documented shape.

## Risks

1. **NSDL parsing** — the fortnightly report is an ASP.NET/static page; exact
   extraction is the main implementation risk. Mitigation: finnovate / Trendlyne
   monthly sector aggregators as fallback; verified reachable during design.
2. **Model-portfolio completeness** — media coverage sometimes discloses only
   *changes*, not full weights. Mitigation: drive the lists by `change` +
   relative OW when full weights are absent; always show the MoM change (the most
   reliably disclosed part).
3. **Ticker mapping** — stock name → NSE ticker for Yahoo. Mitigation: reuse the
   name→ticker mapping already in `data/companies.json` where possible; the
   routine writes an explicit `ticker` per holding.

## Out of scope (YAGNI)

- Blending multiple brokers' model portfolios (one house only).
- Real-time / intraday (monthly–fortnightly cadence).
- A historical archive of sector weights or model-portfolio snapshots (latest vs
  previous month only).

## Files touched

- `index.html` — two cards in `#viewPositioning` + `loadSectorPositioning()` and
  `loadModelPortfolio()` loaders, wired into `loadPositioning()`.
- `data/fpi_sectors.json` — new, committed (seed at build).
- `data/model_portfolio.json` — new, committed (seed at build).
- `docs/positioning-data-refresher-prompt.md` — new, routine prompt.
- `CLAUDE.md` — document the two new data files, sources, and the routine.
