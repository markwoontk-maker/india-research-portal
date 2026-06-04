# Sector Positioning + Multi-House Model-Portfolio Summary — design

**Date:** 2026-06-04
**Status:** Approved design, pending spec review
**Builds on:** the Positioning tab (`#viewPositioning`) from
`2026-06-04-positioning-tab-fii-dii-design.md`, and the hand-curated Strategy
tab (`#viewStrategy`).

## Goal

Two independent additions:

1. **FPI Sector Positioning** — a card on the **Positioning** tab: sector
   inflows/outflows (latest month vs previous) and overweight/underweight vs the
   **Nifty 500**, from FPI flow data.
2. **Model Portfolio Summary** — a card at the **bottom of the Strategy** tab:
   **per-house blocks** summarising several research houses' monthly model
   portfolios — each house's top overweight / underweight stocks, each stock's
   **change vs the previous month** (added / raised / trimmed / removed) and its
   **1-month price return**.

Both are data-driven (committed `data/*.json` + a scheduled refresher), matching
`fii_dii.json`.

## Decisions (from brainstorming)

- Sector OW/UW is measured **vs Nifty 500** weights.
- The model-portfolio summary spans **multiple research houses** (Motilal Oswal +
  others), shown as **per-house blocks** (not a blended portfolio, not a single
  consensus list).
- It lives at the **bottom of the Strategy tab**, NOT on the Positioning tab.
- Stock "how did it fare vs previous month" = **both** the stance change (added/
  raised/trimmed/removed) **and** the 1-month price return.
- Kept current by an **auto monthly routine** (data-driven), even though the rest
  of the Strategy tab is hand-curated.

## Component 1 — FPI Sector Positioning (Positioning tab)

### Data: `data/fpi_sectors.json`
```json
{
  "asOf": "2026-05", "prevAsOf": "2026-04", "benchmark": "Nifty 500",
  "sectors": [
    { "name": "Financial Services", "flow": -12345.6, "flowPrev": 6789.0,
      "fpiWt": 31.2, "idxWt": 33.5, "ow": -2.3, "owPrev": -1.9 }
  ]
}
```
`flow`/`flowPrev` = net FPI flow (₹ Cr) latest/previous month; `fpiWt` = sector
share of FPI equity AUC (%); `idxWt` = Nifty 500 sector weight (%);
`ow = fpiWt − idxWt` (+ = overweight); `owPrev` = prior month's `ow`.

### Render: `loadSectorPositioning()`
One card on the Positioning tab (below the FII/DII charts), a sortable table
(default sort |flow| desc):

| Sector | Net flow (this mo) | Prev mo | OW/UW vs N500 | Δ MoM |

- Net-flow cell: signed ₹ Cr, green inflow / red outflow, inline diverging bar.
- OW/UW: chip — green `+1.2% OW` / red `−0.8% UW`.
- Δ MoM: ▲/▼ change in `ow` vs `owPrev`.
- Header: `FPI Sector Positioning · May 2026 vs Apr 2026 · vs Nifty 500`.
- Fails independently to a "sector data unavailable" placeholder.

## Component 2 — Model Portfolio Summary (Strategy tab, bottom)

### Data: `data/model_portfolios.json`
```json
{
  "asOf": "2026-05",
  "houses": [
    {
      "broker": "Motilal Oswal", "asOf": "2026-05", "benchmark": "Nifty 50",
      "overweight": [
        { "stock": "State Bank of India", "ticker": "SBIN.NS",
          "change": "raised", "note": "+100 bps, funded by trimming HDFC Bank" },
        { "stock": "Hindustan Aeronautics", "ticker": "HAL.NS",
          "change": "new", "note": "added — cheap defence exposure" }
      ],
      "underweight": [
        { "stock": "HDFC Bank", "ticker": "HDFCBANK.NS",
          "change": "trimmed", "note": "−100 bps to fund SBI" }
      ]
    }
  ]
}
```
- `houses[]` — one entry per research house that publishes a trackable monthly
  model portfolio. Focus list: **Motilal Oswal, Nuvama, ICICI Securities, Kotak,
  Axis** (include any other clearly-disclosed house; skip a house for a month if
  no fresh portfolio is found rather than carry stale data).
- `overweight` / `underweight` — that house's top names (cap ~8 each). `change` ∈
  `new | raised | trimmed | removed | held`; `note` = short MoM description.
- `ticker` = NSE ticker (for the Yahoo price lookup).

### Render: `loadModelPortfolios()`
A new card appended at the **end of `#viewStrategy`**, titled
`Model Portfolio Summary — house by house · <Month>`, styled to match the tab's
existing `.house` blocks. One block per house:

- House name + `as-of` month.
- **Overweight** list and **Underweight** list. Each stock row:
  `STOCK · <change badge> · <1-month price return>`.
  - Change badge: ✚ new · ▲ raised · ▼ trimmed · ✕ removed · = held (the `note`
    on hover). This is the positioning half of "how did it fare".
  - 1-month price return: green/red %, the performance half.
- Sub-line: "Each house's latest model portfolio vs its prior one · positioning
  change + 1-month price move."
- Reuses existing `#viewStrategy .house`, `.chip`, `.rt`, `.up`/`.down` styles.
- Fails independently to a "model-portfolio data unavailable" placeholder; the
  rest of the (hand-curated) Strategy tab is unaffected.

### Price performance
1-month return per `ticker` from Yahoo (`v8/finance/chart/<ticker>?range=1mo`),
reusing the portal's chunked Yahoo fetch + proxy fallback, computed client-side
at render. A failed quote shows "—".

## Refresh routine (one routine, both files)

A single **Positioning Data Refresher** remote agent maintains both
`data/fpi_sectors.json` and `data/model_portfolios.json`:
- **Cron:** `30 1 2,17 * *` UTC = **9:30 AM MYT on the 2nd & 17th** (after NSDL's
  fortnightly sector data; model portfolios are monthly, handled idempotently).
- **Each run:**
  1. **Sectors** — assemble `data/fpi_sectors.json` from NSDL fortnightly
     sector-wise FPI data (sum the month's fortnights for `flow`; AUC for
     `fpiWt`) + Nifty 500 sector weights (niftyindices factsheet). Fallback for
     flows: finnovate / Trendlyne macro aggregators.
  2. **Model portfolios** — for each house on the focus list, WebSearch its
     latest model-portfolio disclosure (broker note / media coverage), extract
     top OW/UW names + MoM change vs the prior `data/model_portfolios.json`, and
     rebuild the file. Skip a house this month if nothing fresh is found.
  3. Map each stock to its NSE `ticker` (reuse `data/companies.json` where
     possible).
  4. Validate JSON, commit + push to `main`.
- **Idempotent / safe:** never overwrites a file with empty/garbage; if a source
  fails, that file is left as-is and the run notes which source failed.
- Prompt in `docs/positioning-data-refresher-prompt.md`; created **enabled** via
  the routines API (newer trigger family accepts the embedded prompt, as the
  FII/DII refresher does).

## Integration

- **Positioning tab:** sector card appended inside `#viewPositioning` after the
  FII/DII caption; `loadPositioning()` also fires `loadSectorPositioning()` once.
  The model portfolio is **not** on this tab.
- **Strategy tab:** model-portfolio card appended at the end of `#viewStrategy`;
  `loadModelPortfolios()` runs when the Strategy tab is first shown (add a
  one-shot guard in the `showView('strategy', …)` branch, mirroring how
  `markets`/`watchlist` lazy-load).
- Each loader is an independent unit with its own fetch + error handling.

## Sector-name normalization

NSDL's ~23 sectors and Nifty 500's GICS sectors don't match 1:1. The routine
carries a fixed map (e.g. NSDL "Financial Services" + "Banks" → Nifty "Financial
Services"; "Information Technology" → "IT") so `fpiWt` and `idxWt` are on the
same taxonomy. The map lives in the routine doc and is the single source of
truth for bucketing.

## Error handling & testing

- Each card fails independently to a placeholder; the FII/DII charts, the curated
  Strategy content, and the rest of the dashboard are never blocked.
- Verify locally: Positioning tab → sector card renders from committed JSON,
  flows colour correctly, OW/UW chips equal `fpiWt − idxWt`. Strategy tab →
  scroll to the bottom, per-house blocks render, change badges + 1-month returns
  populate, tooltips work. Spot-check 2–3 sector flows vs the NSDL/aggregator
  print and 2–3 model-portfolio names vs each house's disclosure.
- Validate both JSON files parse and match the documented shapes.

## Risks

1. **NSDL parsing** — fortnightly report is ASP.NET/static; main implementation
   risk. Mitigation: finnovate / Trendlyne aggregators (verified reachable).
2. **Multi-house model-portfolio coverage** — not every house discloses a full
   portfolio publicly each month; coverage will vary. Mitigation: a focus list,
   skip-if-stale, and the per-house block format degrades gracefully (a house
   simply doesn't appear that month). MoM change is the most reliably disclosed
   part; full weights are not required.
3. **Ticker mapping** — stock name → NSE ticker for Yahoo. Mitigation: reuse
   `data/companies.json`; routine writes an explicit `ticker` per holding.

## Out of scope (YAGNI)

- A single blended/consensus portfolio (per-house blocks only).
- Real-time / intraday (monthly–fortnightly cadence).
- Historical archive of sector weights or model-portfolio snapshots (latest vs
  previous month only).
- Touching the existing hand-curated Strategy cards (Sector Conviction Grid,
  House Views, consensus) — the model-portfolio card is purely additive.

## Files touched

- `index.html` — sector card + `loadSectorPositioning()` in `#viewPositioning`;
  model-portfolio card + `loadModelPortfolios()` at the end of `#viewStrategy`,
  wired into the `strategy` lazy-load.
- `data/fpi_sectors.json` — new, committed (seed at build).
- `data/model_portfolios.json` — new, committed (seed at build).
- `docs/positioning-data-refresher-prompt.md` — new, routine prompt.
- `CLAUDE.md` — document the two new data files, sources, and the routine.
