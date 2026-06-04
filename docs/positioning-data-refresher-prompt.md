# Positioning Data Refresher — routine prompt

Paste this into the routine's **Initial message** field at
https://claude.ai/code/routines (or it is embedded directly when the routine is
created via the API), then ensure it is **enabled**.

Suggested cron (UTC): `30 1 2,17 * *` — **9:30 AM Malaysia time (MYT) on the 2nd
& 17th** of each month (after NSDL posts the fortnightly sector data; broker
model portfolios are monthly and handled idempotently).

Repo: `markwoontk-maker/india-research-portal` · branch `main`.
Tools: `Bash, Read, Write, Edit, WebFetch, WebSearch` · model `claude-sonnet-4-6`.

---

You maintain two data files for the India Research Portal (a static GitHub Pages
dashboard). Once per run you refresh them from public sources and push. The page
renders them: `data/fpi_sectors.json` → FPI Sector Positioning card on the
Positioning tab; `data/model_portfolios.json` → Model Portfolio Summary at the
bottom of the Strategy tab. **Never fabricate a number — only write values you
actually fetched. If a source fails, leave that file unchanged and report it.**

Use PowerShell `Invoke-WebRequest`/`Invoke-RestMethod` (force TLS 1.2:
`[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12`)
or WebFetch — plain `curl` is blocked in this environment.

## 1. `data/fpi_sectors.json` — FPI sector flows + OW/UW vs Nifty 500

Target the two most recent COMPLETED months (`asOf` = latest, `prevAsOf` = the
one before).

1. **Net flows + FPI sector weights — NSDL (authoritative).** NSDL publishes
   fortnightly sector-wise FPI reports at
   `https://www.fpi.nsdl.co.in/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/`
   (files like `FIIInvestSector_<Mon><dd><yyyy>.html`, e.g.
   `FIIInvestSector_May312026.html`). For each month, monthly net = sum of that
   month's two fortnights' **INR equity** column; `fpiWt` = each sector's
   month-end equity AUC / total equity AUC (%). The parse self-checks: summed
   sector flows must equal the report's Grand Total.
   - **Fallback for flows** if NSDL is unreachable: finnovate.in monthly
     sector blogs (`finnovate.in/learn/blog/fpi-…-<month>-2026-…`) and Trendlyne
     macro FII/DII. Cross-check the monthly Grand Total against finnovate when
     possible.
2. **Index weights (`idxWt`) — Nifty 500 factsheet.** Use the NSE archives PDF
   `https://nsearchives.nseindia.com/content/indices/ind_nifty_500.pdf`
   ("Sector Representation" weights). The Nifty 500 rebalances semi-annually
   (cut-offs Jan 31 / Jul 31), so the same `idxWt` applies to both months unless
   a rebalance fell between them.
3. **Normalize** source sectors to the Nifty taxonomy with this map (unmapped →
   keep own name, `idxWt` 0):
   `Banks/Banking/Financial Services→Financial Services; IT/Software & Services→Information Technology; Oil & Gas/Oil, Gas & Consumable Fuels→Energy; Power/Utilities→Power; Automobile/Auto/Automobile and Auto Components→Automobile; Industrials→Capital Goods; Pharma/Pharmaceuticals/Healthcare→Healthcare; Consumer Staples/FMCG→FMCG; Metals→Metals & Mining; Telecommunication→Telecom; Cement→Construction Materials`.
4. **Write** `data/fpi_sectors.json` (UTF-8 no BOM), sorted by `|flow|` desc:
   `{ "asOf":"YYYY-MM", "prevAsOf":"YYYY-MM", "benchmark":"Nifty 500",
   "sectors":[{ "name", "flow", "flowPrev", "fpiWt", "idxWt",
   "ow":round(fpiWt-idxWt,1), "owPrev":round(fpiWtPrev-idxWt,1) }] }`.
   Exclude the "Sovereign" row; equity column only.

## 2. `data/model_portfolios.json` — multi-house model portfolios

For each house with a FRESH (≤ ~6 weeks) publicly-disclosed model portfolio,
capture its top overweight / underweight names and each name's month-over-month
change. **Skip a house if nothing fresh is found — do not carry stale data or
invent holdings.** A 2-3 house summary of real data is the goal.

For every house also record:
- `url` — the **public source link you actually fetched the portfolio from**
  (the report PDF or article URL). The dashboard turns the house name into a
  clickable link to it. Use the real fetched URL; if you genuinely have no public
  URL for that house, set `url` to `""` (the name renders unlinked).
- `wt` (per stock) — the stock's **absolute portfolio weight as a number** (percent)
  when the house prints per-stock weights; otherwise `""` (the card shows "—").

- **Axis Securities** — monthly "Top Picks" PDF (e.g.
  `simplehai.axisdirect.in`, signed note); states adds/exits explicitly. Set
  `url` to that note's public link.
- **Motilal Oswal** — model-portfolio note / media coverage (whalesbook.com,
  motilaloswal.com news) with OW/UW sectors + stock weight changes. Set `url`
  to the article/report you used.
- Also try **Nuvama, ICICI Securities, Kotak (KIE)** — but their institutional
  model portfolios are often login-gated; include only if a fresh constituent
  list is genuinely public.

Map each stock to its NSE `ticker` (`.NS`) using `data/companies.json` first;
verify it resolves on Yahoo (`query1.finance.yahoo.com/v8/finance/chart/<t>.NS?range=5d&interval=1d`).
If a name is unlisted (no clean NSE/Yahoo symbol), set `ticker` to `""` (the page
shows "—" for its price) rather than a wrong ticker.

Write `data/model_portfolios.json` (UTF-8 no BOM):
`{ "asOf":"YYYY-MM", "houses":[{ "broker", "asOf":"YYYY-MM", "benchmark", "url",
"overweight":[{ "stock","ticker","wt","change","note" }], "underweight":[…] }] }`
where `change` ∈ `new | raised | trimmed | removed | held` and each side caps
~8 names. Carry the prior file's positioning into the new `note`/`change` where
you can infer the MoM move. Preserve a house's existing `url` if its source page
is unchanged.

## 3. Validate, commit, push

```bash
node -e "const d=require('./data/fpi_sectors.json'); if(!d.sectors.length) throw 'empty'; d.sectors.forEach(s=>['name','flow','flowPrev','fpiWt','idxWt','ow'].forEach(k=>{if(s[k]===undefined) throw k+' on '+s.name})); console.log('sectors ok', d.sectors.length)"
node -e "const d=require('./data/model_portfolios.json'); const ok=new Set(['new','raised','trimmed','removed','held']); if(!d.houses.length) throw 'no houses'; d.houses.forEach(h=>h.overweight.concat(h.underweight).forEach(s=>{if(!('ticker' in s)||!s.stock) throw 'bad row '+h.broker; if(!ok.has(s.change)) throw 'bad change '+s.change})); console.log('houses ok', d.houses.length)"
```

Commit only the file(s) that actually changed and push to `main`:
```
chore: refresh positioning data (fpi_sectors <asOf>, model_portfolios <asOf>)
```
GitHub Pages republishes within ~1 minute.

**Failure mode:** if a source for one file is unreachable or yields nothing
parseable, leave that file unchanged, refresh only the other, and note in the run
output which source failed. Never commit empty or fabricated data.
