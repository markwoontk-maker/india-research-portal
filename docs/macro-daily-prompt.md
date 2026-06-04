# India Macro daily refresher routine — prompt & setup

A **keyless, remote daily** routine that checks for newly released India macro
prints and writes them into the **India Macro Snapshot** card via
`data/macro.json`. The page overlays each figure onto its broker row by `id`
(see `applyMacroOverlay()` in `index.html`), including the new **`prev`** field
that renders as the small "prev … · period" sub-line under the latest value.

> Note: this routine sources from **official releases + reputable wires via web
> search** (it runs in the cloud and cannot see your local "India Macro" PDF
> folder). It complements the hand-pulled broker rows already in `MACRO_REPORTS`
> and the optional MoSPI-keyed routine in `macro-refresher-prompt.md`.

## JSON contract (what the dashboard reads)

`data/macro.json` — overlay keyed by the row `id` in `MACRO_REPORTS`:

```json
{
  "updated": "2026-06-04T01:00:00Z",
  "indicators": {
    "iip": { "value": "+4.2%", "prev": "+4.9% (Mar 2026)", "period": "Apr 2026", "src": "MoSPI · 12 Jun 26", "tone": "pos" },
    "cpi": { "value": "5.1%",  "prev": "4.8% (Apr 2026)",  "period": "May 2026", "src": "MoSPI · 12 Jun 26", "tone": "neg" }
  }
}
```

- Row `id`s available to overlay: `gdp, iip, mfg, pmi, core, cpi, gst_g, gst_n, fisc, repo, monsoon`.
- `value` = latest reading; `prev` = the previous period's reading **with its month in brackets**, shown small under the value; `period` = latest reading's period; `src` = "Source · DD Mon YY"; `tone` = `"pos"` (green) | `"neg"` (red) | `""`.
- Only keys you can verify are written; absent keys leave the broker row as-is.

## One-time setup (analyst)

1. **Create a routine** at https://claude.ai/code/routines (model
   `claude-sonnet-4-6`; tools `Bash, Read, Write, Edit, WebSearch, WebFetch`;
   Gmail connector optional). Keyless — no secret required.
2. **Cron (UTC):** `30 1 * * *` — daily ~07:00 IST, after overnight releases.
3. **Paste the prompt below** into "Initial message", then enable.

---

```
ROLE
You maintain data/macro.json, which feeds the "India Macro Snapshot" card on the India Research Portal (static GitHub Pages site, repo markwoontk-maker/india-research-portal, branch main). Each day you check whether any India macro indicator has a NEW official print and, if so, write the latest value, the previous reading, the period, the source and the tone into data/macro.json. Keyless — never add an API key. Never fabricate a number.

STEP 1 — DATE
- `date -u` for current UTC; convert to IST for human-readable source dates ("DD Mon YY").

STEP 2 — CHECK EACH INDICATOR (web search official sources first, then reputable wires)
For each id below, find the most recent official print and the previous period's figure. Prefer mospi.gov.in, rbi.org.in, pib.gov.in, gst.gov.in, dea.gov.in, imd.gov.in; else a reputable wire (Reuters/Bloomberg/PTI/BS/Mint) citing the official number.
- gdp     : Real GDP growth, YoY (MoSPI NSO). 
- iip     : Index of Industrial Production, YoY (MoSPI).
- mfg     : IIP manufacturing sub-index, YoY (MoSPI).
- pmi     : Manufacturing PMI, index level (S&P Global / HSBC India PMI).
- core    : Eight core industries IP, YoY (DPIIT / Office of Economic Adviser).
- cpi     : CPI inflation, combined All-India, YoY (MoSPI).
- gst_g   : Gross GST receipts, ₹tn + YoY (GSTN / PIB monthly).
- gst_n   : Net GST receipts, ₹tn + YoY (GSTN / PIB monthly).
- fisc    : Central fiscal deficit, % of GDP (CGA / Budget).
- repo    : RBI repo rate / MPC decision (RBI).
- monsoon : SW monsoon rainfall, % of LPA (IMD).

STEP 3 — DECIDE WHAT CHANGED
- Only include an indicator if you found a CURRENT, verifiable print. If the latest print is the same one already shown (no newer release), you may still write it to keep prev/period accurate, but do NOT invent a newer period.
- prev: the immediately prior period's reading for that indicator, formatted with its month in brackets, e.g. "+4.9% (Mar 2026)". If you cannot verify the previous reading, omit the prev key (leave it off — the sub-line then shows just the period).
- tone: "pos" if the print is favourable (e.g. growth ≥ 0, PMI ≥ 50), "neg" if unfavourable (e.g. contraction, CPI > 6.0 RBI upper band, GST YoY negative), else "".

STEP 4 — BUILD JSON
{
  "updated": "<ISO8601 UTC>",
  "indicators": {
    "<id>": { "value": "<…>", "prev": "<… (Mon YYYY)>", "period": "<Mon YYYY>", "src": "<Source · DD Mon YY>", "tone": "pos|neg|" }
  }
}
Include only the ids you verified. Validate it parses: node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' < the-json

STEP 5 — DELIVER
If you have push access: clone/pull the repo, write data/macro.json, commit ("chore: refresh macro.json — <DD Mon YYYY>"), push to main (auto-publishes). Otherwise draft a Gmail (do NOT send) to markworktk@gmail.com with the JSON in a fenced ```json block. Always also print the JSON to session output.

STEP 6 — INTEGRITY
- Keyless only. No fabricated figures — every number traces to an official source or a wire citing one; cite the date. If you cannot verify an indicator, omit it. Touch only data/macro.json.

Begin now.
```
