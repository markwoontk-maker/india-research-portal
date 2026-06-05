# India Research Portal — project notes

## Hosting & deploy
- **Static GitHub Pages site.** Public repo `markwoontk-maker/india-research-portal`, branch `main`. Pushing to `main` auto-publishes — no build minutes, no credits, nothing to babysit.
- Live URL: https://markwoontk-maker.github.io/india-research-portal/ (project subpath `/india-research-portal/`).
- `.nojekyll` at repo root so files serve as-is.
- **Netlify path is deprecated/blocked** (free build-minute cap kept failing deploys). The `netlify/functions/*` + `netlify.toml` are kept only as optional server proxies; do not rely on them.
- Single self-contained `index.html` (inline CSS/JS); Chart.js + Google Fonts via CDN. No build step.
- **Always commit + push on any dashboard change** (the user expects the live site updated every time).

## Data sources (all free, no API keys, ever)
- Yahoo Finance `v8/finance/spark` & `chart` (20-symbol/request cap → chunked).
- Google News RSS (`news.google.com/rss/search?...&hl=en-IN&gl=IN&ceid=IN:en`, `when:Nd`).
- DBnomics (`api.db.nomics.world/v22/series/<id>`, CORS-ok; IMF/IFS monthly, BIS policy rate).
- BSE forthcoming-results API (earnings calendar).
- Because it is static, every feature has a **client-side public-proxy fallback** (`corsproxy.io` → `allorigins.win`); server functions are primary only when the Netlify path happens to be live.
- Never introduce a paid/keyed API. No secrets in code or chat (Netlify token/Site ID, if ever needed, live only in GitHub Actions secrets).

## India Macro Snapshot card (News/Markets tab)
- Three data layers, all in `index.html` (see `MACRO_REPORTS`, `MACRO_LIVE`, `loadMacro()`):
  1. **Curated broker rows** (`MACRO_REPORTS`) — hand-pulled from the `India Macro` PDF library; each has a stable `id`. Primary/always-shown.
  2. **DBnomics live rows** (`MACRO_LIVE`) — keyless, CORS-ok IMF/BIS aggregator (`api.db.nomics.world/v22/series/<id>?observations=1`, proxy fallback via `fetchText`). Appended below the broker rows, tagged `IMF/BIS · live`, rendered only if the fetch succeeds (no stale hardcoded fallback). **Caveat: these series lag ~12 months** (e.g. as of Jun 2026 the latest IMF/BIS print is Jun 2025), so the period column shows the true as-of month — they complement, never override, the fresher broker rows.
  3. **`data/macro.json` overlay** (`applyMacroOverlay()`) — fresh official MoSPI prints (IIP/CPI) written **server-side** by the macro-refresher routine using a keyed data.gov.in API. Overlays a broker row by `id`. The API key lives only in the routine secret, never in this bundle.
- **Macro refresher routine:** not yet created. Prompt + one-time setup (register data.gov.in key, store as routine secret `DATA_GOV_KEY`, paste prompt, enable) in `docs/macro-refresher-prompt.md`. Suggested cron `0 2 13-16 * *` (mid-month, after the ~12th IIP/CPI release).

## Research Notes tab
- "Latest Research Notes" = single-row digest grouped by research house: **date | company | clickable headline | colour-coded call chip**. The NotebookLM per-company list was removed from this tab (the `NOTEBOOKS` map still feeds the Screener tab).
- Two data sources: (1) **local PDF library** under `C:\Users\admin\Desktop\India Related Reports\` — parsed by filename pattern `[YYMMDD] [House] Folder - Thesis.pdf`, parent folder name matches NOTEBOOKS entries; (2) **external broker calls** (Motilal Oswal, ICICI Securities, Morgan Stanley, Citi, UBS, Nuvama, Axis, HDFC Securities, etc.) refreshed by the routine below into `data/research.json`.
- Title is clickable → opens the company's NotebookLM workspace (local reports) or the source article (external calls) in a new tab; `authuser=markworktk@gmail.com` appended so the right Google account is selected.
- Call chip: extracts the broker's explicit rating (Buy/Sell/Hold/OW/UW/EW/Neutral/Add/Reduce/OP/UP) from the headline when stated, otherwise falls back to a sentiment-derived label (Positive/Negative/Neutral). Date is plain, only the call is colour-coded.

## Positioning tab (FII/DII daily flows)
- Sidebar tab **Positioning** (`data-view="positioning"`, `#viewPositioning`). Two stacked cards — **Net FII Flows** and **Net DII Flows** — each a Chart.js combo: daily net **bars** (green +/red −, left axis) + running **cumulative line** (saffron, right axis). The two y-axes share a zero gridline (`posZeroAlign()` snaps both axes' ticks so 0 lines up). Native tooltips show date · daily net · cumulative. Lazy-loaded once via `loadPositioning()`; full history kept in `posRows`, the view is re-rendered by `renderPositioning()`.
- **Period selector** (`#posSeg`, `.seg` on the FII card header): **MTD · QTD · YTD · All** (`posFilter()`, anchored on the latest data date). It drives **both** charts; the cumulative line restarts at the selected period's first day, and the card chips relabel (MTD/QTD/YTD cumulative). `All` shows the entire file — so **2026 stays viewable after the year rolls to 2027** (the data file + refresher are append-only, never trimmed).
- **Gotcha:** `#viewPositioning` uses `display:flex` for card spacing, so an inline `display:flex` would override the `[hidden]` attribute and leak the charts onto every other tab. Hiding is handled by CSS `#viewPositioning[hidden]{display:none}` (id+attr specificity beats the id-only flex rule) — do not move the flex back inline.
- Data: committed **`data/fii_dii.json`** — ascending array of `{date:"YYYY-MM-DD", fii_net, dii_net}` (NSE/BSE **provisional cash-market net**, ₹ Cr, signed), daily since **1 Jan 2026**. The page derives the cumulative client-side. No live fetch (FII/DII is a once-daily post-close print).
- **Data-source provenance (important):** backfilled from `fatafatniftylevels.in/fii-dii.php` — the only free source found with a complete, *correct* daily series back to 1 Jan. It matches Groww (the reference) and NSE-published daily + monthly figures exactly (e.g. 2 Mar 2026 = FII −3295.64 / DII +8593.87; March total ≈ FII −1.22L cr / DII +1.43L cr vs reported −1.18L / +1.16L). **`MrChartist/fii-dii-data` was rejected** — its Jan–Mar values are wrong (disagreed on 49/78 overlapping days) and it has large gaps. Do **not** swap the source or "correct" historical rows without re-verifying against NSE-published figures.
- **Refresher (LOCAL):** appended daily by `scripts/refresh-fii-dii.js`, a step in `scripts/daily-refresh.ps1` (local Windows Task Scheduler, which commits+pushes). Fetches fatafatniftylevels (needs `Accept`/`Accept-Language` headers or it 502s); append-only, idempotent, never throws. **The cloud routine `trig_01Y9QCbBV86F1GGa4eJiWF1g` was DISABLED** — it fired daily but its `git push` silently failed (the CCR env clones the public repo read-only / no write token), so its appends never reached GitHub. **General gotcha: remote CCR routines can't push to this repo** — anything that must commit has to run from the local pipeline (or deliver via Gmail draft, like the research refresher). The monthly `fpi_sectors`/`mf_categories`/`sip_flows`/`model_portfolios` are likewise refreshed **locally** by `scripts/build-positioning.ps1` — a headless-Claude miner (like `build-strategy.ps1`) gated to ~twice a month (2nd & 17th windows via `scripts/.positioning-state.json`), running `docs/positioning-data-refresher-prompt.md`, with per-file validate + selective revert; `daily-refresh.ps1` stages+commits+pushes the result. The cloud "Positioning Data Refresher" (`trig_016k…`) is **DISABLED** (couldn't push).

## Sector positioning + multi-house model portfolios
- **FPI Sector Positioning** card on the Positioning tab (`#secPosTbl`, `loadSectorPositioning()`, called from `loadPositioning()`). Sortable table: net FPI flow this month vs prev (₹ Cr, green in/red out, inline diverging bar), OW/UW chip vs **Nifty 500**, and Δ-MoM. Data: **`data/fpi_sectors.json`** `{asOf,prevAsOf,benchmark,sectors:[{name,flow,flowPrev,fpiWt,idxWt,ow,owPrev}]}`. Sourced from **NSDL fortnightly sector reports** (`fpi.nsdl.co.in/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/` — fetch via PowerShell with TLS 1.2; summed sector flows must equal the report Grand Total; cross-checked vs finnovate.in) + Nifty 500 sector weights from the NSE factsheet PDF (`nsearchives.nseindia.com/content/indices/ind_nifty_500.pdf`). finnovate/Trendlyne are flow fallbacks. **Note:** NSDL's `StaticReports/...` HTML path is now WAF-protected ("Request Rejected") — pull reports via the `FPI_Fortnightly_Selection.aspx` dropdown (`__doPostBack`); the month-end report carries BOTH fortnights of the month.
- **MF Sector Positioning** card (`#mfPosBody`, `loadMfSectors()`, below the FPI card on the Positioning tab). **Qualitative, flagged APPROXIMATE with a disclaimer banner at the top** — there is NO clean DII/MF sector-wise net-flow series (NSDL sectoral = FPI only; NSDL's new DII reporting is category-wise, not sector-wise). This is a mutual-fund holdings **tilt** (OW/UW vs Nifty 500), MF-slice only, lagged ~1 quarter, mined from **Kotak's KS-Ownership Navigator** (`data/mf_sectors.json`: `{asOf, benchmark, mfOwnershipPct, disclaimer, sectors:[{name, stance:OW|UW|N|'', move:bought|sold|''}]}`). Do not present it as flows or add fabricated magnitudes — the report only gives qualitative sector OW/UW (charts aren't cleanly parseable). DII (the impossible clean version) is intentionally left out.
- **MF Category Flows** card (`#mfCatBody`, `loadMfCategories()`/`mfCatRender()`, below the MF Sector card on the Positioning tab). **Clean official AMFI data — no disclaimer.** Net inflows + AUM for the 6 equity cap categories (Large Cap, Large & Mid Cap, Mid Cap, Small Cap, Multi Cap, Flexi Cap). Sortable table (Category · net flow this-mo · prev · YTD · 1Y · **Flow share** · AUM · AUM%). **Flow share** = the category's % of the month's total net flow + MoM change in pp (`mfCatFlowShare`/`mfCatFlowShareMoM`, all computed client-side from totals across the 6 cats). Click-a-name inline chart = monthly net-flow **bars + a "% of net flow" share line** on a right axis (`mfCatHistDraw`, `mfCatTotals`/`mfCatShareAt`). An auto **gist** line above the table (`mfCatGist` → `#mfCatGist`) names the leading category + its consecutive-month streak + biggest MoM share gainer + total net inflow. Data **`data/mf_categories.json`**: `{asOf, prevAsOf, months[], categories:[{name, flow, flowPrev, aum, aumShare, hist[]}]}`, history back to **Jan 2024**. **`months`/`hist` are APPEND-ONLY — never trimmed** (`mfCatOneY` uses `slice(-12)`, `mfCatYtd` filters by current year; YTD/1Y/share all derive from `hist`). Refreshed monthly (17th) by the LOCAL `build-positioning.ps1` from AMFI (finnovate fallback); `null` for unsourced cells.
- **MF SIP Flows** chart (`#sipChart`, `loadSipFlows()`, below MF Category Flows). Monthly AMFI **SIP contribution** bar chart (all green; **append-only** — grows a bar each month), header shows latest SIP / SIP AUM / accounts. Data **`data/sip_flows.json`**: `{asOf, months[], sip[], sipAum, sipAccounts, statsAsOf}` (`sip` aligned to `months`, `null` if unsourced). **No clean SIP-by-category data exists** (AMFI gives only total SIP), so there is no SIP-allocation breakdown — only the total series. Reuses `secMonLbl`.
- **Monthly drill-down:** clicking a **sector name** (`.secname` cell) expands an inline Chart.js **bar chart** of that sector's last-12-months net flow (`secHistChart`, `secPosExpanded`/`secHistDraw` in `secPosRender`; one open at a time, composes with sort/collapse). Powered by extra fields in `data/fpi_sectors.json`: top-level **`months`** (12 ascending `YYYY-MM`) + per-sector **`hist`** (12 net flows aligned to `months`, `null` for gaps; `hist[last]`==`flow`). The refresher rolls this 12-month window forward.
- **Model Portfolio Summary** card at the **bottom of the Strategy tab** (`#mpHouses`, `loadModelPortfolios()`, lazy-loaded via the `strategyLoaded` guard in `showView`). Per-house blocks (NOT on the Positioning tab). Each block: house + as-of, Overweight / Underweight lists, each name with a change badge (✚ new · ▲ raised · ▼ trimmed · ✕ removed · = held) and a **1-month price return** fetched live from Yahoo (`oneMonthReturn()`, corsproxy fallback; unlisted names use `ticker:""` → "—"). Data: **`data/model_portfolios.json`** `{asOf,houses:[{broker,asOf,benchmark,overweight:[{stock,ticker,change,note}],underweight:[...]}]}`. **Coverage varies** — only houses with a fresh *public* model portfolio appear (Axis Securities "Top Picks" PDF + Motilal Oswal coverage are reliably public; Nuvama/ICICI/Kotak are usually login-gated). Skip-if-stale; never fabricate.
- **Both files** refreshed by the **India Positioning Data Refresher** routine — `trig_016kRFwRmUB53VbyXJF96TGQ` (https://claude.ai/code/routines/trig_016kRFwRmUB53VbyXJF96TGQ), cron `30 1 2,17 * *` UTC = **9:30 AM MYT on the 2nd & 17th**, enabled, prompt embedded + saved at `docs/positioning-data-refresher-prompt.md`. Commits only changed files; leaves a file unchanged if its source fails.

## Broker abbreviations (use these in citations everywhere)
Inline citation format: `(<Abbrev>, YYYY/MM/DD)`. Used in `data/companies.json` descriptions and any other research-derived prose.

| Abbrev | Broker |
|---|---|
| Bern | Bernstein |
| CLSA | CLSA |
| Jeff | Jefferies |
| JP | JPMorgan |
| Kotak | Kotak Mahindra |
| Nomura | Nomura |
| AR | Anand Rathi |
| Axis | Axis Direct |
| DC | Deven Choksey |
| Geojit | Geojit BNP Paribas |
| ICICI | ICICI Direct |
| IDBI | IDBI Capital |
| KS | Khambatta Securities |
| PL | Prabhudas Lilladhar |

## ATH + 52-week-high card
- The Overview tab's **All-Time-High / 52-Week-High** card reads `data/highs.json` `{asOf, ath:[{name,cmp,ath}], w52:[{name,cmp,w52h}]}` via the lightweight overlay at the bottom of index.html (`HI_ATH`/`HI_W52` are `let`, not `const`, so the JSON overrides the inline seed). Skip-if-stale: if the fetch fails the page falls back to the committed seed.
- **Refresher (LOCAL):** `scripts/build-highs.ps1` (a step in `scripts/daily-refresh.ps1`) runs the Claude headless miner against `docs/highs-refresher-prompt.md`. Sources: Dhan ATH list + Groww `?index=GIDXNIFTY500` 52WH list + the Nifty 500 constituents CSV. Validates JSON structure (asOf format, ath/w52 arrays, required fields per row, non-empty) and reverts on failure. Always exits 0 so it never aborts the rest of the daily refresh. `daily-refresh.ps1` stages `data/highs.json` with the rest of the day's diffs and pushes once at the end. **No cloud routine** — same git-push gotcha as the FII/DII refresher.

## Research refresher routine
- **Trigger:** `trig_018gy39x8QiAfrp9UxSPzPyA` — "India Research Notes Refresher"
- **URL:** https://claude.ai/code/routines/trig_018gy39x8QiAfrp9UxSPzPyA
- **Cron (UTC):** `0 1 * * 1-5` (Mon–Fri 1:00 UTC = 6:30 AM IST, just after the daily-email routine fires).
- **Status:** stub created via API; **prompt has to be pasted into the routines UI** (the create/update API for this trigger family doesn't expose the prompt field in the schema this session can hit — `event_type` / `messages` / `prompt` all rejected). Once the prompt is in, flip `enabled` to true in the UI.
- **What it does each run:** WebSearches Indian broker research calls from the previous 2 days (Motilal Oswal, ICICI Securities, Morgan Stanley, Citi, UBS, Nuvama, HDFC Securities, Axis Capital, Emkay, JM Financial, Sharekhan, etc. — explicitly NOT the six houses in the local library), builds an `ext` array, drafts a Gmail to markworktk@gmail.com containing the JSON to paste into `data/research.json`. Page picks it up via the fetch at the bottom of index.html.
- **Prompt:** stored in `docs/research-refresher-prompt.md` — copy-paste into the routine UI under "Initial message".

## Local dev / preview
- Node at `C:\Program Files\nodejs`. Optional `netlify dev` on 8899; `C:\Users\admin\.claude\static-server.cjs` preview proxy on 4178 (`launch.json`).
- Just opening `index.html` works (client fallbacks cover all data).

## NotebookLM (separate tooling, see user memory `notebooklm-research-portal`)
- `nlm` CLI at `C:\Users\admin\.local\bin\nlm.exe`, profile **`work`** = markworktk@gmail.com (NOT the markwoontk@gmail.com default — easy to confuse).
