You are running UNATTENDED as a scheduled job. Do NOT ask questions. Make
reasonable decisions and proceed. Keep output terse. Use the Bash tool
(git-bash) for shell/pdftotext; use Read/Edit/Grep/Glob for files.

# TASK
Refresh the **Strategy** tab of the India Research Portal dashboard from the
latest India strategy reports on disk, by rewriting ONLY the marked regions of
`index.html`. The repo is your cwd: `C:\Users\admin\India-Research-Portal`.

# SOURCE FILES
Folder: `C:\Users\admin\Desktop\India Related Reports\India Strategy\`
List the `*.pdf` there. SELECT only genuine **top-down India equity-strategy /
earnings-strategy** notes from these six houses: JPMorgan, Nomura, CLSA,
Jefferies, Bernstein, Kotak. INCLUDE files whose name matches
`[YYMMDD] [House] India (Equity )?Strategy - …` and Kotak strategy/flows notes.
IGNORE: ESG notes, "EM Money Trail", "Global Asset Allocation", single-company
notes, and pure quant/fund-flow trackers UNLESS they carry an explicit
top-down sector call.

For each selected PDF, extract text with:
`pdftotext -layout -f 1 -l 40 "FILE" -` (read more pages if needed).
Use the **two most recent** notes per house to detect changes (current vs prior).
Today's date for the as-of label: run `date +%Y-%m-%d`.

# WHAT TO MINE (same method as the existing hand-built content)
1. **Sector grid** — for each of the 11 GICS sectors below, each house's stance:
   OW (favoured/Overweight), UW (not favoured/Underweight), N (Neutral/mixed),
   or — (no explicit view). Only JPMorgan & Nomura publish formal top-down
   sector models; for CLSA & Bernstein you may INFER a stance from
   earnings-momentum / thematic commentary — mark those inferred cells with the
   `inf` class (renders a `*`). Jefferies (macro/flows) and Kotak (flows/ownership
   + stock-level KIE only) usually have no sector model → leave `—`.
   Map Nomura's Bullish/Neutral/Bearish → OW/N/UW.
2. **Recent Conviction Changes** — every explicit SECTOR-level weighting change a
   house made vs its prior note (e.g. "upgrade Industrials to OW from Neutral").
   Group by house. Note Nomura's native labels in the footnote.
3. **House views & recommended stocks** — one card per house: a one-line stance
   and the names each flags positively (top picks / model-portfolio OW /
   Buy/Add-rated). Keep to names actually stated in the reports.
4. **Cross-Broker Consensus** — only the four houses that name stocks
   (JPMorgan, Nomura, CLSA, Kotak; Jefferies & Bernstein are thematic):
   - Buy/OW favoured by 2+ brokers (with a count),
   - Sell/UW avoided by 2+ brokers (with a count),
   - Split calls (one house Buy, another Sell) with **Net = buys − sells**
     (+N green `cnt buy`, 0 amber `cnt flat`).

GICS sectors, IN THIS ROW ORDER: Energy, Materials, Industrials, Consumer
Discretionary, Consumer Staples, Health Care, Financials, Information Technology,
Communication Services, Utilities, Real Estate.
House COLUMN ORDER (must match the static header): JPMorgan, Nomura, CLSA,
Jefferies, Bernstein, Kotak.

# HOW TO EDIT (critical — keep it surgical)
Replace ONLY the text BETWEEN these marker pairs in `index.html`. Keep the
marker comments themselves intact. Do not touch anything outside them.
- `<!--STRAT:ASOF-->` … `<!--/STRAT:ASOF-->` → the as-of date phrase, e.g.
  `18 May – 3 Jun 2026` (earliest–latest selected report date).
- `<!--STRAT:GRID:START-->` … `<!--STRAT:GRID:END-->` → 11 `<tr>` rows.
- `<!--STRAT:CHANGES:START-->` … `<!--STRAT:CHANGES:END-->` → the "Reading the
  grid" note + the `.changes` block.
- `<!--STRAT:HOUSES:START-->` … `<!--STRAT:HOUSES:END-->` → the `.house` cards.
- `<!--STRAT:CONS:START-->` … `<!--STRAT:CONS:END-->` → the three consensus
  tables + their headers + the Method note.

## DO NOT TOUCH (hard rule)
The scoped `<style>`, the grid `<thead>` (incl. `<th class="mamg">` and the six
house `<th>`), the `.mamg-bar` toolbar, the MAMG `<script>` at the bottom, and
`data/mamg-views.json`. These power the editable MAMG-view column and its shared
state — leaving them intact is mandatory.

## EXACT HTML TEMPLATES (reuse these classes verbatim so styling holds)
Grid row (first cell MUST be `<td class="sec">` — the MAMG script depends on it):
```
<tr><td class="sec">Energy</td>
  <td class="cell na" title="reason">—</td>      <!-- JPMorgan -->
  <td class="cell uw" title="reason">UW</td>     <!-- Nomura -->
  <td class="cell n inf" title="reason">N</td>   <!-- CLSA (inferred → inf) -->
  <td class="cell na">—</td>                     <!-- Jefferies -->
  <td class="cell ow inf" title="reason">OW</td> <!-- Bernstein (inferred) -->
  <td class="cell na" title="reason">—</td></tr> <!-- Kotak -->
```
Cell class = `cell` + one of `ow|uw|n|na`, add `inf` for inferred. Content text
is `OW` / `UW` / `N` / `—` to match.

Conviction change row:
```
<div class="ch-house"><span class="ch-name">Nomura</span>
  <ul class="ch-list">
    <li><span class="ch-sec">Materials · Cement</span><span class="ch-move"><span class="rt ow">OW</span><span class="arr">→</span><span class="rt n">N</span></span><span class="ch-why">reason</span></li>
  </ul>
</div>
```
House card. Put `data-broker` (the house tag) and `data-report` (the path,
relative to the India Related Reports root, of THIS house's India sector report
that the card's views are based on) on the `<h4>` — the page turns the house name
into a link to that report. Use these for JPMorgan, Nomura and CLSA (the houses
with a formal India sector report); omit `data-report` for houses without one.
```
<div class="house"><h4 data-broker="JPMorgan" data-report="India Strategy/[YYMMDD] [JPMorgan] India Equity Strategy - ….pdf">JPMorgan <span class="src">· dates</span></h4>
  <div class="stance">one-line stance</div>
  <div class="pk-label">Recommended</div>
  <div class="chips"><span class="chip">Name</span>…</div>
</div>
```
Consensus rows (note the `# Brokers` / Net column):
```
<tr><td class="nm">Coforge</td><td class="sc">Information Technology</td><td class="num"><span class="cnt buy">3</span></td><td class="bk"><span class="bchip buy">Nomura</span>…</td></tr>
```
Split-call Net cell: `<td class="num"><span class="cnt buy">+1</span></td>` when
net>0, `<td class="num"><span class="cnt flat">0</span></td>` when net=0.

# ALSO REWRITE data/model_portfolios_house.json
Separately, regenerate the file `data/model_portfolios_house.json` (overwrite the
whole file) with each covered house's formal MODEL PORTFOLIO, if it publishes one
in the selected reports. This powers the "Model Portfolio Summary" card and is
kept separate from data/model_portfolios.json (which a remote routine owns).

Entries must be INDIVIDUAL STOCKS (never sector names). Include ONLY houses that
publish a genuine model portfolio / focus list / top-pick list:
- JPMorgan & Nomura: list their model-portfolio / top-pick STOCKS with Yahoo
  tickers. They do NOT publish per-stock weights → set `"wt":""` (card shows "—").
- CLSA: its India Focus Portfolio / High-Conviction Outperform names as stocks
  with tickers. Per-stock weights are login-gated → `"wt":""`. Don't fabricate weights.
- Kotak Alphabet quant: the **All-Season multifactor BROAD portfolio** STOCKS —
  the ~15-stock "Broad Portfolio (%)" column in the All-Season constituents table
  (e.g. Exhibit 6, "All-Season portfolio constituents") — with their published
  broad weights → `"wt":<number>` (e.g. 11.51) and Yahoo tickers. Use the **BROAD**
  configuration, NOT the Concentrated (top-5) one. Append the KIE analyst rating
  (BUY/ADD/REDUCE/SELL/NR) into each stock's `note`.
- Any other covered house that prints a stock-level model portfolio with weights:
  include the stocks and their `wt` numbers.
- Bernstein, Jefferies, and Kotak's ownership/macro notes: usually NO model
  portfolio → omit them entirely. Never invent positions or weights.

`wt` = absolute portfolio weight as a NUMBER (percent) where the house prints
per-stock weights; otherwise the empty string `""`. Use correct Yahoo NSE tickers
(e.g. "LT.NS","ICICIBANK.NS","M&M.NS"); leave `"ticker":""` only if you can't
determine it (name still shows, return shows "—").

Each house also gets a `"report"` = the path of the source PDF you mined it from,
relative to the India Related Reports root, e.g.
`"India Strategy/[260601] [Nomura] India Equity Strategy - 4QFY26 earnings review.pdf"`
(exact filename, including the `[YYMMDD] [House]` prefix). The card turns the
house name into a link to it via the local PDF server.

Schema (valid JSON; keep the leading "_note"):
```json
{
  "_note": "Mined from the local India Strategy PDFs; separate from model_portfolios.json so the remote refresher can't clobber it.",
  "asOf": "YYYY-MM",
  "houses": [
    { "broker": "Kotak — Alphabet All-Season (broad)", "asOf": "YYYY-MM", "benchmark": "Nifty 50",
      "report": "India Strategy/[260601] [Kotak] Quant Research - (no title).pdf",
      "note": "All-Season multifactor BROAD portfolio (top-15 by factor score).",
      "overweight": [ { "stock": "ICICI Bank", "ticker": "ICICIBANK.NS", "wt": 11.51, "change": "", "note": "KIE BUY" } ],
      "underweight": [] }
  ]
}
```
Use `change` values: `new`/`raised`/`trimmed`/`removed`/`held`, or `""` when the
prior stance is unknown (renders a neutral dot). Validate the file parses as JSON.

# ALSO REWRITE data/mf_sectors.json (mutual-fund sector tilt)
If the selected reports include a **Kotak "KS-Ownership Navigator"** note (filename
contains "Ownership Navigator"), refresh `data/mf_sectors.json` from the LATEST one.
Otherwise leave the file untouched (do NOT invent or carry stale dates).

This powers the "MF Sector Positioning" card on the Positioning tab. It is a
QUALITATIVE mutual-fund holdings tilt (overweight/underweight vs Nifty 500), NOT
flows. From the report's body text (use `pdftotext -layout` on the PDF), extract:
- the explicit MF sector OW/UW list, e.g. "MFs overweight on automobiles &
  components, banks and pharmaceuticals; underweight on consumer staples, metals &
  mining and oil, gas & consumable fuels" → set each named sector's `stance` to
  `OW`/`UW`. Sectors with no explicit call get `stance:""`.
- the latest-quarter MF buy/sell direction, e.g. "MF bought banks and IT services;
  sold metals & mining" → set `move` to `bought`/`sold` for those sectors, else `""`.
- the MF share of the Nifty 500 (e.g. 11.9%) → `mfOwnershipPct`.
- the report's as-of quarter (e.g. "Mar 2026 quarter") → `asOf`.

Do NOT fabricate per-sector magnitudes (the precise OW/UW bps live in chart images
that don't parse cleanly) — qualitative `stance`/`move` only. Map sector names to
the FPI table's taxonomy: Banks→"Financial Services", Automobiles & Components→
"Automobile", Pharmaceuticals→"Healthcare", Consumer Staples→"FMCG", Oil, Gas &
Consumable Fuels→"Energy", IT Services→"Information Technology", Metals & Mining
unchanged. KEEP the existing `_note`, `benchmark`, `disclaimer`, `source`, `report`
fields (update `report` to the Ownership Navigator filename you used, and `asOf`).
Schema:
```json
{ "_note":"…keep…", "asOf":"Mar 2026 quarter", "benchmark":"Nifty 500",
  "mfOwnershipPct":11.9, "source":"Kotak — KS-Ownership Navigator (<date>)",
  "report":"India Strategy/[YYMMDD] [Kotak] … Ownership Navigator … .pdf",
  "disclaimer":"…keep the not-clean wording…",
  "sectors":[ { "name":"Financial Services", "stance":"OW", "move":"bought", "note":"why" } ] }
```
Validate it parses as JSON with a non-empty `sectors[]`.

# FINISH
After editing, run `grep -n "STRAT:" index.html` and confirm all 5 marker pairs
are still present, and confirm `data/model_portfolios_house.json` and
`data/mf_sectors.json` are valid JSON
(`node -e "JSON.parse(require('fs').readFileSync('data/model_portfolios_house.json'));JSON.parse(require('fs').readFileSync('data/mf_sectors.json'))"`).
Print exactly one line:
`STRATEGY UPDATED: <n_reports> reports, asof <date>` (or
`STRATEGY UNCHANGED` if no selected report was newer than what the grid already
reflects). Do not commit or push — the wrapper handles git.
