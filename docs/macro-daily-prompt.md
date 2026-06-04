# India Macro daily refresher routine — prompt & setup

A **keyless, remote daily** routine that maintains a **rolling history** of
official India macro prints in `data/macro.json`. The India Macro Snapshot card
renders one column per period (Latest, Previous, 3rd, 4th, …) and grows a column
each time a new month is appended — old prints are **pushed right, never
deleted**. The page overlays each indicator's `history` onto its broker row by
`id` (see `applyMacroOverlay()` / `macroHist()` in `index.html`).

> Runs in the cloud and cannot see your local "India Macro" PDF folder — it
> sources from official releases + reputable wires via web search.

## JSON contract (what the dashboard reads)

`data/macro.json` — newest-first `history` per row `id`:

```json
{
  "updated": "2026-07-13T01:30:00Z",
  "indicators": {
    "iip": {
      "src": "MoSPI · 12 Jul 26",
      "tone": "pos",
      "history": [
        { "value": "+5.1%", "period": "May 2026" },
        { "value": "+4.9%", "period": "Apr 2026" },
        { "value": "+4.1%", "period": "Mar 2026" }
      ]
    }
  }
}
```

- Row `id`s: `gdp, iip, mfg, pmi, core, cpi, fisc, repo, monsoon`.
  **Skip `gst_g` / `gst_n`** — the analyst keeps the broker GST rows (do not overlay GST).
- `history[0]` is the latest; `tone`/`src` describe the latest. The page shows
  each entry's value over its period (small font); tone colours only the latest.
- **Preserve history**: never delete or reorder older entries.

## One-time setup (analyst)

1. **Create a routine** at https://claude.ai/code/routines (model
   `claude-sonnet-4-6`; tools `Bash, Read, Write, Edit, WebSearch, WebFetch`).
   Keyless — no secret required. **For auto-publish, the routine's GitHub
   integration must have Read+Write contents on the repo** (otherwise it falls
   back to a Gmail draft).
2. **Cron (UTC):** `30 1 * * *` — daily ~07:00 IST.
3. **Paste the prompt below**, then enable.

---

```
ROLE
You maintain data/macro.json in the checked-out repo markwoontk-maker/india-research-portal (static GitHub Pages site, branch main). It feeds the "India Macro Snapshot" card, which keeps a ROLLING HISTORY per indicator — one column per period, newest first. Each day you check for new official India macro prints and, when a NEW period is out, PREPEND it to that indicator's history. You NEVER delete or reorder older entries. Keyless — never add an API key. Never fabricate a number.

STEP 1 — DATE
- `date -u` for current UTC; convert to IST for source dates ("DD Mon YY").

STEP 2 — READ EXISTING HISTORY
- Read data/macro.json from the repo checkout and parse indicators[<id>].history (a newest-first array of {value,period}). If the file or a key is missing, treat that history as empty. Keep every existing entry — you only ever ADD to the front.

STEP 3 — FETCH LATEST (web search official sources first, then reputable wires)
For each id below find the most recent official print: value, its period, source, tone. Prefer mospi.gov.in, rbi.org.in, pib.gov.in, dea.gov.in, imd.gov.in; else a reputable wire (Reuters/Bloomberg/PTI/BS/Mint) citing the official number.
- gdp: Real GDP growth, YoY (MoSPI NSO).
- iip: Index of Industrial Production, YoY (MoSPI).
- mfg: IIP manufacturing sub-index, YoY (MoSPI).
- pmi: Manufacturing PMI, index level (S&P Global / HSBC India PMI).
- core: Eight core industries IP, YoY (DPIIT / OEA).
- cpi: CPI inflation, combined All-India, YoY (MoSPI).
- fisc: Central fiscal deficit, % of GDP (CGA / Budget).
- repo: RBI repo rate / MPC decision (RBI).
- monsoon: SW monsoon rainfall, % of LPA (IMD).
Do NOT touch gst_g / gst_n — the analyst manages those broker rows.

STEP 4 — MERGE (preserve history)
For each id where you verified a latest print:
- If history is empty OR history[0].period != <latest period> → PREPEND {value, period} to history.
- Else (same period as history[0], e.g. a revision) → replace history[0] with the new {value, period}. Do not add a duplicate.
- Set src and tone to the latest (tone: "pos" if favourable / growth>=0 / PMI>=50; "neg" if contraction / CPI>6.0 / unfavourable; else "").
- Cap history at the newest 24 entries.
If you could NOT verify an indicator, leave its existing history, src and tone unchanged. Never remove or reorder older entries.

STEP 5 — WRITE JSON
{
  "updated": "<ISO8601 UTC>",
  "indicators": {
    "<id>": { "src": "<Source · DD Mon YY>", "tone": "pos|neg|", "history": [ {"value":"<...>","period":"<Mon YYYY>"}, ... ] }
  }
}
Include every id that has any history (carry forward unchanged ones). Validate it parses: node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' < the-json

STEP 6 — DELIVER
Write data/macro.json, commit ("chore: refresh macro.json — <DD Mon YYYY>") and push to main (auto-publishes). If push fails (403/no write access), draft a Gmail (do NOT send) to markworktk@gmail.com with the FULL merged JSON in a fenced json block. Always also print the full JSON to session output.

STEP 7 — INTEGRITY
- Keyless only. No fabricated figures — every number traces to an official source or a wire citing one; cite the date. If you cannot verify, carry the old history forward unchanged. Preserve all history. Touch only data/macro.json.

Begin now.
```
