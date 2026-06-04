# Positioning tab — FII/DII daily flows — design

**Date:** 2026-06-04
**Status:** Approved design, pending spec review

## Goal

Add a new **Positioning** tab to the India Research Portal (`index.html`) showing
daily Foreign (FII) and Domestic (DII) institutional cash-market net flows since
**1 Jan 2026**, modelled on the Groww FII/DII page
(<https://groww.in/fii-dii-data>).

Two charts: **Net FII Flows** and **Net DII Flows**. Each is a combined
bar + line chart:

- **Bars** — each trading day's net flow (₹ Crore), green when positive,
  red when negative.
- **Line** — running cumulative sum from 1 Jan 2026, on a secondary y-axis.
- **Hover tooltips** — show the date, that day's net, and the cumulative-to-date
  figure (native Chart.js, already loaded).

## Decisions (from brainstorming)

- **Metric:** NSE/BSE provisional **cash-market net** — the Groww headline number.
  Not F&O / FPI totals.
- **Freshness model:** committed `data/fii_dii.json` (baked file) + a daily
  refresh routine. Matches the portal's established `data/*.json` + scheduled-agent
  pattern. **No** live client-side overlay (FII/DII is a once-daily post-close
  print; the routine refreshes within minutes of release, so an on-load live fetch
  adds fragility for negligible freshness gain). Can be added later as a
  routine-miss fallback if ever needed.
- **Layout:** two **stacked** cards (FII on top, DII below), full content width.

## Architecture

Single self-contained `index.html` (inline CSS/JS), Chart.js 4.4.1 via CDN,
static GitHub Pages, no build step, no API keys — unchanged. This feature adds:

### 1. Sidebar nav + tab panel
- New `.nav-item` in the left sidebar (new inline SVG icon, label "Positioning"),
  wired into the existing tab-switch mechanism exactly like the other tabs.
- New `<section>` panel (hidden until activated) containing two `.card`s:
  - **Net FII Flows** — header (title + sub: "Cash-market provisional net · ₹ Cr ·
    since 1 Jan 2026 · source"), a `.chart-box` with `<canvas id="fiiChart">`.
  - **Net DII Flows** — same structure, `<canvas id="diiChart">`.
- Styling reuses existing tokens: `.card`, `.chart-box`, dark theme,
  `var(--up)` / `var(--down)` for positive/negative bars.

### 2. Charts (Chart.js combo)
For each canvas, one chart with two datasets over a shared category x-axis of
trading-day dates:
- `type:'bar'` dataset — daily net; per-bar `backgroundColor` green/red by sign;
  left y-axis (`y`).
- `type:'line'` dataset — cumulative net; right y-axis (`y1`), no fill, thin line,
  no point markers (or small ones).
- Tooltip callback formats ₹ Crore with sign and thousands separators, and labels
  the two values ("Daily net" / "Cumulative").
- Lazy-init on first activation of the tab (consistent with how other charts are
  built), guarded so it only constructs once.

### 3. Data file: `data/fii_dii.json`
Ascending-by-date array of daily records:

```json
[
  { "date": "2026-01-14", "fii_net": -6440.0, "dii_net": 7353.0 },
  { "date": "2026-01-15", "fii_net": -1234.5, "dii_net": 2345.6 }
]
```

- `date` ISO `YYYY-MM-DD`; `fii_net` / `dii_net` in ₹ Crore (signed).
- Page fetches it (relative path) on tab activation; the loader computes the
  cumulative series client-side and feeds both charts. Cumulative is derived,
  not stored, so it always equals the running sum of whatever bars are present.
- Reuses the existing `fetchText`/proxy helper only if needed; a same-origin
  relative fetch of a committed file needs no proxy.

### 4. Backfill (one-time, at build)
**Target: a true 1-Jan-2026 start.**
- Seed the bulk of `data/fii_dii.json` from `MrChartist/fii-dii-data` raw
  `data/history.json`
  (<https://raw.githubusercontent.com/MrChartist/fii-dii-data/main/data/history.json>),
  which carries **100 daily records, 14-Jan-2026 → present**, each with
  `date` / `fii_net` / `dii_net`. Map to the schema above, sorted ascending.
- **Fill the 1–13 Jan 2026 sessions** (the ~8 trading days
  Jan 1,2,5,6,7,8,9,12,13 — weekends Jan 3-4 & 10-11 excluded; verify each against
  the NSE 2026 trading-holiday list) from a deeper-history source. Candidate
  sources to try in order during implementation:
  1. Trendlyne FII/DII history (already used elsewhere in the portal) —
     `trendlyne.com/macro-data/fii-dii/...`.
  2. Moneycontrol `fii_dii_activity` historical (via the proxy helper if a direct
     fetch is blocked).
  3. Other public daily FII/DII datasets / NSE provisional archive PDFs.
- Cross-check any Jan 1–13 values that overlap a second source before committing.
- **Only if every source for that window fails** do we start the series at the
  earliest available date, and we note the gap explicitly in the commit message
  and card sub-text. The default expectation is a complete 1-Jan series.

### 5. Daily refresh routine (new scheduled remote agent)
- Same family as the existing research/highs refreshers.
- **Cron:** **9:30 AM Malaysia time (MYT, UTC+8) on weekdays → `30 1 * * 1-5`
  UTC.** By that hour the prior day's provisional print (published ~7 pm IST the
  evening before) is final, and it lines up with the portal's other ~09:3x MYT
  morning routines. A Monday run picks up Friday's print; the idempotent
  catch-up (below) appends any dates missed over weekends/holidays.
- **Each run:** fetch the latest trading day's FII/DII cash net (niftytrader
  `webapi/Resource/fii-dii-activity-data` JSON, fields `created_at`,
  `fii_net_value`, `dii_net_value`; MrChartist raw file as fallback). If that
  date is newer than the last entry in `data/fii_dii.json`, append it, then
  **commit + push** to `main` (standing versioning rule).
- **Idempotent:** if the latest date already present, do nothing (no duplicate
  rows, no empty commit).
- Prompt stored at `docs/fii-dii-refresher-prompt.md`; created as a stub and the
  prompt pasted into the routines UI (same constraint as the research refresher),
  then enabled.

## Data sources (free, no key, CORS-OK)

| Use | Source | Fields | Notes |
|---|---|---|---|
| Backfill | `raw.githubusercontent.com/MrChartist/fii-dii-data/main/data/history.json` | `date`, `fii_net`, `dii_net` | 100 days from 14-Jan-2026; updated daily |
| Daily refresh (primary) | `webapi.niftytrader.in/webapi/Resource/fii-dii-activity-data` | `created_at`, `fii_net_value`, `dii_net_value` | clean JSON, ~2mo rolling |
| Daily refresh (fallback) | MrChartist raw file (above) | same | their cron, 6–7 pm IST Mon–Fri |

Cross-check the two sources' latest value during the routine; on disagreement
keep niftytrader (closer to the NSE provisional wording) and note it.

## Error handling
- Fetch of `data/fii_dii.json` fails → card shows a "data unavailable" message
  in place of the chart; rest of the dashboard is unaffected (per the portal's
  per-feature isolation convention).
- Empty/short series → charts still render with whatever days are present;
  cumulative is the running sum of those days.
- Routine source down on a given day → that run appends nothing (no gap-filling
  fabrication); the next successful run catches up by appending all missing dates
  it can see.

## Testing / verification
- Local: open `index.html`, switch to Positioning tab, confirm both charts draw,
  bars are correctly green/red, cumulative line is monotonic-where-expected, and
  hovering a bar shows date + daily + cumulative.
- Validate `data/fii_dii.json`: ascending dates, no duplicates, plausible
  magnitudes (₹ Cr, low thousands), spot-check 2–3 days against Groww.
- Routine: dry-run the fetch + append logic on a copy; confirm idempotency
  (re-running same day adds nothing).

## Out of scope (YAGNI)
- F&O / FPI / sector-split positioning (cash net only for now).
- Live on-load overlay.
- Date-range selector / weekly/monthly aggregation (full YTD daily series only).
- Side-by-side layout.

## Files touched
- `index.html` — nav item, section panel, two cards, chart init + data loader.
- `data/fii_dii.json` — new, committed (backfilled).
- `docs/fii-dii-refresher-prompt.md` — new, routine prompt.
- `CLAUDE.md` — short "Positioning tab" section documenting the data file,
  sources, and routine.
