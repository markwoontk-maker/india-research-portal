# Financial Summary: standalone/consolidated split + segmentals

**Date:** 2026-06-07
**Status:** approved (inline)

## Goal
Make the Company-tab Financial Summary card distinguish **standalone** vs
**consolidated** financials, and add **segment-wise revenue + profit (PBIT)**.
Apply retroactively to all existing hand-verified entries (A–C first).

## Operating rule (standalone-first)
Broker reports almost always present ONE basis per table.
- **Primary table** = standalone *if the source provides it*, else consolidated.
  Every table carries an explicit **basis label** (`Standalone` / `Consolidated`).
- **Only when a single report carries both** bases do we split into two tables:
  standalone on top, consolidated below.
- **No holdco special-casing.** A consolidated-only holdco (e.g. Adani
  Enterprises) keeps its consolidated table as primary, simply *labelled*
  Consolidated.

## Schema (backward-compatible) — `data/financials-manual.json`
```jsonc
"Company": {
  "currency": "₹ mn",
  "basis": "Standalone",                 // NEW: label for the primary metrics table
  "metrics": { "revenue":{}, "ebitda":{}, "netProfit":{} },   // primary (unchanged shape)
  "alt": {                               // NEW, optional: the OTHER basis -> 2nd table
    "basis": "Consolidated",
    "source": "…",
    "metrics": { "revenue":{}, "ebitda":{}, "netProfit":{} }
  },
  "segments": {                          // existing block; now also fed by screener.in
    "<source>": {
      "date": "YYMMDD", "url": "…", "source": "…",
      "metrics": {
        "revenue": { "<seg>": { "FYxx": <num> }, "Total": {…} },
        "profit":  { "<seg>": { "FYxx": <num> }, "Total": {…} }   // Segment Results / PBIT
      }
    }
  },
  "notes": "…"
}
```
- New segment metric key `profit` = annual-report "Segment Results / PBIT".
- Entries without `basis` get a neutral label; nothing breaks.

## UI — `renderCompanyFinancials()` in index.html
- Print the `basis` label on the primary table heading.
- If `alt.metrics` exists, render a second table headed "Consolidated (alternate basis)".
- Map segment key `profit` → "Segment Profit (PBIT)" heading.
- Subtitle/footnote notes the segmental source.

## Data-sourcing rules (no fabrication)
- Standalone/consolidated come from the broker report. screener.in only fills a
  *missing* basis when both are wanted — transcribed verbatim, cited, skipped
  silently where unavailable.
- Segmentals: broker report if it has a segment table; else screener.in segment
  P&L (revenue + PBIT), cited to the screener URL; skip where not public.

## Phasing (each phase = its own commit + push)
1. **Plumbing** — schema + render changes; existing entries render identically.
2. **Retrofit** the ~28 entries with basis labels (+ `alt` where a report has both).
3. **A–C next batch** — clean end-of-report tables from `scripts/logs/eor-probe.txt`:
   AWL (Jeff Ex21), Adani Ports (Kotak), Apollo Hospitals (Kotak),
   Amara Raja (Kotak Ex9), Amber (Kotak), ABHFL (Jeff Ex11) — standalone-first.
4. **Segmentals** for A–C from broker/screener.

## Constraints (from CLAUDE.md / prior intents)
- No paid/keyed APIs; no secrets in code. Commit + push on every change.
- Do not fabricate; ask when uncertain. `*.docx` stays out of the public repo.
