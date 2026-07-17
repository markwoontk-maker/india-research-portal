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
   - **NSDL access caveat (important):** the `StaticReports/...` HTML path is
     WAF-protected — direct fetch/proxy returns a 247-byte "Request Rejected"
     page. Drive the official selection form instead:
     `https://www.fpi.nsdl.co.in/web/Reports/FPI_Fortnightly_Selection.aspx`
     (pick the fortnight in the dropdown / `__doPostBack('btnds1','')`). The
     **month-end report contains BOTH fortnights** of that month (1st–15th and
     16th–end INR-equity columns), so one report per month suffices — monthly net
     = group1 + group2. Note 3-letter months in NSDL's option values can be full
     ("June15/June30", "July31") — read the actual dropdown values.
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
   "months":[12 ascending "YYYY-MM"],
   "sectors":[{ "name", "flow", "flowPrev", "fpiWt", "idxWt",
   "ow":round(fpiWt-idxWt,1), "owPrev":round(fpiWtPrev-idxWt,1),
   "hist":[12 monthly net flows ₹ Cr aligned to months] }] }`.
   Exclude the "Sovereign" row; equity column only.
5. **Rolling 12-month history (`months` + per-sector `hist`).** Powers the
   click-a-sector-name drill-down chart. Each run, if `asOf` advanced to a new
   month: append the new month to `months` and each sector's `hist`, then trim
   both to the last **12** entries (drop the oldest). `hist[last]` must equal
   `flow` and `hist[last-1]` must equal `flowPrev`. A month with no parseable
   report → `null` in `hist` (never fabricate). A sector absent from an older
   month → `null` for that slot. Keep every `hist.length === months.length`.
   If `asOf` is unchanged (already current), leave `months`/`hist` as-is.

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

## 2b. `data/mf_categories.json` — MF category flows (AMFI, **APPEND-ONLY**)

Powers the "MF Category Flows" card on the Positioning tab. Official AMFI net
inflows + AUM for the **6 equity cap categories** (canonical names: `Large Cap`,
`Large & Mid Cap`, `Mid Cap`, `Small Cap`, `Multi Cap`, `Flexi Cap`). Run on the
**17th** (after AMFI's ~10th-of-month release).

1. Fetch the latest completed month's category **net inflow (₹ cr)** + **AUM**.
   Source: AMFI monthly (`amfiindia.com/research-information/amfi-monthly`, often
   flaky on a direct hit — try WebFetch/proxy); **fallback** the finnovate monthly
   MF blogs (`finnovate.in/learn/blog/mutual-fund-data-<month>-2026`) cross-checked
   vs upstox/ventura/moneycontrol. A category with no clean figure → `null`.
   **Also capture the single headline `equityTotal`** = the month's **total net
   inflow into ALL open-ended equity schemes (₹ cr)** as reported by AMFI (the
   widely-quoted "equity mutual funds saw net inflows of ₹X cr" figure, e.g.
   May-2026 = 22907.77). Cross-check 2 sources on the SAME definition (net inflow
   into open-ended equity schemes — NOT gross, NOT equity+hybrid). No clean figure
   → `null`. This drives the true YoY line on the Total Monthly Equity MF Flows card.
2. **APPEND-ONLY:** if `asOf` advanced to a new month, append that month to
   `months`, to `equityTotal`, and to each category's `hist`; update each category's
   `flow`(=hist last), `flowPrev`(=hist 2nd-last), `aum`, `aumShare`(=round(aum/Σaum×100,1)).
   **NEVER trim older months** — the history grows forever (a new bar each month).
   If `asOf` is unchanged (already current), leave the file untouched.
3. Keep the shape: `{ asOf, prevAsOf, months:[…asc…], equityTotal:[…aligned to months, null if unknown…],
   categories:[{ name, flow, flowPrev, aum, aumShare, hist:[…aligned to months…] }] }`,
   exactly the 6 categories, `hist.length === months.length` per category,
   `equityTotal.length === months.length`, UTF-8 no BOM. Never fabricate a figure.

## 2c. `data/sip_flows.json` — monthly SIP contribution (AMFI, **APPEND-ONLY**)

Powers the "MF SIP Flows" chart. Official AMFI **monthly SIP contribution (₹ cr)**
plus latest SIP AUM + accounts. Run on the **17th** (after AMFI's ~10th release).
1. Fetch the latest completed month's **total SIP contribution (₹ cr)** and the
   latest **SIP AUM (₹ cr)** + **SIP accounts (crore)**. Sources: AMFI monthly
   (often flaky — WebFetch/proxy), finnovate / cafemutual / valueresearch /
   rightadvise.com/sip-data-india.html (a clean monthly table); cross-check 2+.
   A month with no clean figure → `null` (never fabricate/interpolate).
2. **APPEND-ONLY:** if `asOf` advanced, append the new month to `months` and `sip`,
   and refresh `sipAum`/`sipAccounts`/`statsAsOf`. **Never trim** older months.
   If `asOf` unchanged, leave the file untouched.
3. Shape: `{ asOf, months:[…asc…], sip:[…aligned, null if unknown…], sipAum,
   sipAccounts, statsAsOf }`, `sip.length === months.length`, UTF-8 no BOM.

## 3. Validate, commit, push

```bash
node -e "const d=require('./data/fpi_sectors.json'); if(!d.sectors.length) throw 'empty'; if(!d.months||d.months.length!==12) throw 'months!=12'; d.sectors.forEach(s=>{['name','flow','flowPrev','fpiWt','idxWt','ow'].forEach(k=>{if(s[k]===undefined) throw k+' on '+s.name}); if(!Array.isArray(s.hist)||s.hist.length!==d.months.length) throw 'hist len '+s.name; if(s.hist[s.hist.length-1]!==s.flow) throw 'hist/flow mismatch '+s.name}); console.log('sectors ok', d.sectors.length, '| 12-mo hist ok')"
node -e "const d=require('./data/model_portfolios.json'); const ok=new Set(['new','raised','trimmed','removed','held']); if(!d.houses.length) throw 'no houses'; d.houses.forEach(h=>h.overweight.concat(h.underweight).forEach(s=>{if(!('ticker' in s)||!s.stock) throw 'bad row '+h.broker; if(!ok.has(s.change)) throw 'bad change '+s.change})); console.log('houses ok', d.houses.length)"
node -e "const d=require('./data/mf_categories.json'); if(d.categories.length!==6) throw 'cats'; if(!d.months.length) throw 'no months'; if(!Array.isArray(d.equityTotal)||d.equityTotal.length!==d.months.length) throw 'equityTotal len'; d.categories.forEach(c=>{['name','flow','flowPrev','aum','aumShare'].forEach(k=>{if(c[k]===undefined) throw k+' on '+c.name}); if(!Array.isArray(c.hist)||c.hist.length!==d.months.length) throw 'hist len '+c.name; if(c.hist[c.hist.length-1]!==c.flow) throw 'flow!=hist[last] '+c.name}); console.log('mf categories ok', d.categories.length, '|', d.months.length, 'months (append-only) | equityTotal', d.equityTotal.filter(v=>v!=null).length, 'filled')"
node -e "const d=require('./data/sip_flows.json'); if(d.sip.length!==d.months.length) throw 'sip len'; if(!d.months.length) throw 'no months'; if(typeof d.sipAum!=='number') throw 'aum'; console.log('sip ok', d.months.length, 'months (append-only)')"
```

**Do NOT git commit or push** — when run by the local `scripts/build-positioning.ps1`
wrapper (the only supported path; the cloud routine can't push), the wrapper
validates and the `daily-refresh.ps1` git step stages + commits + pushes whatever
changed. Just create/update + validate the data files, then stop.

**Failure mode:** if a source for one file is unreachable or yields nothing
parseable, leave that file unchanged, refresh only the others, and note in the run
output which source failed. Never write empty or fabricated data.
