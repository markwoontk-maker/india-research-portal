# Sector Positioning + Multi-House Model-Portfolio Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an FPI Sector Positioning card to the Positioning tab and a multi-house Model Portfolio Summary card to the bottom of the Strategy tab, both data-driven from committed JSON refreshed by one monthly routine.

**Architecture:** Two committed data files (`data/fpi_sectors.json`, `data/model_portfolios.json`) are sourced live and seeded at build time, then rendered by two independent client loaders added to `index.html`. A single scheduled remote agent refreshes both files. Stock 1-month returns come live from Yahoo at render. Verification is via the running preview server (`mam-hub`, serverId from `preview_list`) using `preview_eval`, not a unit-test framework (the project has none).

**Tech Stack:** Static `index.html` (inline CSS/JS), Chart.js (already loaded, not needed here), Yahoo Finance chart API, NSDL FPI data + aggregators, GitHub Pages, a remote-agent routine.

**Spec:** `docs/superpowers/specs/2026-06-04-sector-stock-positioning-design.md`

**Conventions to reuse:**
- Colors: `var(--up)` `#3fc78a`, `var(--down)` `#f06a6a`, `var(--saffron)` `#e9a23b`, `var(--text-mute)` `#646c7c`.
- Card markup: `<div class="card reveal"><div class="card-h"><div><h3>…</h3><p>…</p></div></div>…</div>`.
- Strategy tab already defines `.house`, `.chip`, `.rt.ow/.uw/.n`, `.up`, `.down` styles inside `#viewStrategy <style>`.
- The preview server root is the repo dir; load the app at `/` (NOT `/India-Research-Portal/…`).
- Commit to `main` and push (standing rule); end commit messages with the Co-Authored-By line.

---

## Task 1: Source & seed `data/fpi_sectors.json`

**Files:**
- Create: `data/fpi_sectors.json`

- [ ] **Step 1: Probe the sector-flow sources (latest + previous month)**

Run these and inspect output; pick the first that yields clean per-sector net flows for the two most recent completed months:

```powershell
# A) finnovate monthly sector breakdown (aggregator, prose+table)
Invoke-WebRequest "https://www.finnovate.in/learn/blog/fpi-selling-march-2026-sector-wise-breakdown-india" -Headers @{ "User-Agent"="Mozilla/5.0" } -UseBasicParsing | Select-Object -ExpandProperty Content | Out-File $env:TEMP\sec_a.html -Encoding utf8
# B) Trendlyne macro FII/DII sector page
Invoke-WebRequest "https://trendlyne.com/macro-data/fii-dii/latest/" -Headers @{ "User-Agent"="Mozilla/5.0" } -UseBasicParsing | Select-Object -ExpandProperty Content | Out-File $env:TEMP\sec_b.html -Encoding utf8
# C) NSDL fortnightly sector report listing (authoritative; ASP.NET form)
Invoke-WebRequest "https://www.fpi.nsdl.co.in/web/Reports/FPI_Fortnightly_Selection.aspx" -Headers @{ "User-Agent"="Mozilla/5.0" } -UseBasicParsing | Select-Object -ExpandProperty Content | Out-File $env:TEMP\sec_c.html -Encoding utf8
```

Also use `WebSearch`/`WebFetch` for "FPI sector wise net investment <latest month> 2026 crore NSDL" to cross-check the headline sector numbers. Record which source you used.

- [ ] **Step 2: Get Nifty 500 sector weights**

Fetch the Nifty 500 factsheet/constituents to compute each sector's index weight:

```powershell
Invoke-WebRequest "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv" -Headers @{ "User-Agent"="Mozilla/5.0" } -UseBasicParsing | Select-Object -ExpandProperty Content | Out-File data\_nifty500.csv -Encoding utf8
```

The CSV has an `Industry` column per constituent. Index sector weight ≈ share of Nifty 500 free-float market cap by sector; if per-name weights aren't in the CSV, approximate sector weight by each name's market cap (from the portal's Yahoo feed or `data/companies.json`) — OR use the published Nifty 500 factsheet sector weights from `WebFetch("https://www.niftyindices.com/reports/monthly-report")`. Record the method.

- [ ] **Step 3: Build the normalization map (NSDL/aggregator sector → Nifty sector)**

Define this exact map in your build script:

```js
const SECTOR_MAP = {
  "Financial Services":"Financial Services","Banks":"Financial Services","Banking":"Financial Services",
  "Information Technology":"Information Technology","IT":"Information Technology","Software & Services":"Information Technology",
  "Oil & Gas":"Energy","Oil, Gas & Consumable Fuels":"Energy","Power":"Power","Utilities":"Power",
  "Automobile and Auto Components":"Automobile","Automobile":"Automobile","Auto":"Automobile",
  "Capital Goods":"Capital Goods","Industrials":"Capital Goods",
  "Healthcare":"Healthcare","Pharma":"Healthcare","Pharmaceuticals":"Healthcare",
  "Fast Moving Consumer Goods":"FMCG","FMCG":"FMCG","Consumer Staples":"FMCG",
  "Consumer Services":"Consumer Services","Consumer Durables":"Consumer Durables",
  "Metals & Mining":"Metals & Mining","Metals":"Metals & Mining",
  "Telecommunication":"Telecom","Telecom":"Telecom","Realty":"Realty","Construction":"Construction",
  "Chemicals":"Chemicals","Cement":"Construction Materials","Media":"Media","Services":"Services"
};
// Any unmapped source sector → keep its own name (still shown, idxWt may be 0).
```

- [ ] **Step 4: Assemble and write `data/fpi_sectors.json`**

Produce exactly this shape (one row per sector, ₹ Crore, weights in %), sorted by `|flow|` descending:

```json
{
  "asOf": "2026-05",
  "prevAsOf": "2026-04",
  "benchmark": "Nifty 500",
  "sectors": [
    { "name": "Financial Services", "flow": -12345.6, "flowPrev": 6789.0, "fpiWt": 31.2, "idxWt": 33.5, "ow": -2.3, "owPrev": -1.9 }
  ]
}
```

Where `ow = round(fpiWt - idxWt, 1)`. If `owPrev` can't be derived (no prior AUC), set it equal to `ow` (Δ shows 0) and note it. Write the file with `node`/PowerShell as UTF-8 without BOM.

- [ ] **Step 5: Validate**

Run:
```bash
node -e "const d=require('./data/fpi_sectors.json'); if(!d.sectors.length) throw 'empty'; d.sectors.forEach(s=>['name','flow','flowPrev','fpiWt','idxWt','ow'].forEach(k=>{if(s[k]===undefined) throw k+' missing on '+s.name})); console.log('ok', d.sectors.length, 'sectors', d.asOf, 'vs', d.prevAsOf)"
```
Expected: `ok <N> sectors 2026-05 vs 2026-04` (N ≈ 12–23). Spot-check 2–3 sectors' `flow` against the source print recorded in Step 1.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && rm -f data/_nifty500.csv && git add data/fpi_sectors.json && git commit -m "data: seed FPI sector positioning (fpi_sectors.json)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Source & seed `data/model_portfolios.json`

**Files:**
- Create: `data/model_portfolios.json`

- [ ] **Step 1: Gather each house's latest model portfolio**

For each house in the focus list — **Motilal Oswal, Nuvama, ICICI Securities, Kotak, Axis** — run `WebSearch` and `WebFetch` to find its most recent model-portfolio disclosure (top OW/UW names + month-over-month changes). Example queries:

```
<house> model portfolio 2026 overweight underweight stocks added removed Nifty
<house> model portfolio rejig <latest month> 2026 top picks
```

Capture, per house: the as-of month, top overweight names, top underweight/funded-from names, and each name's change (new / raised / trimmed / removed / held) with a one-line note. Skip a house if no fresh (≤ ~6 weeks old) portfolio is found — do not invent holdings.

- [ ] **Step 2: Map each stock to its NSE ticker**

Reuse `data/companies.json` (it has `"<Name>": {"ticker":"XXXX.NS", …}`); for names not present, derive the NSE symbol + `.NS` from the company's known listing. Verify a ticker resolves on Yahoo before using it:

```powershell
Invoke-RestMethod "https://query1.finance.yahoo.com/v8/finance/chart/SBIN.NS?range=5d&interval=1d" -Headers @{ "User-Agent"="Mozilla/5.0" } | ForEach-Object { $_.chart.result[0].meta.symbol }
```

- [ ] **Step 3: Write `data/model_portfolios.json`**

Exactly this shape (cap ~8 names per side per house):

```json
{
  "asOf": "2026-05",
  "houses": [
    {
      "broker": "Motilal Oswal", "asOf": "2026-05", "benchmark": "Nifty 50",
      "overweight": [
        { "stock": "State Bank of India", "ticker": "SBIN.NS", "change": "raised", "note": "+100 bps, funded by trimming HDFC Bank" }
      ],
      "underweight": [
        { "stock": "HDFC Bank", "ticker": "HDFCBANK.NS", "change": "trimmed", "note": "-100 bps to fund SBI" }
      ]
    }
  ]
}
```

`change` must be one of `new | raised | trimmed | removed | held`.

- [ ] **Step 4: Validate**

```bash
node -e "const d=require('./data/model_portfolios.json'); const ok=new Set(['new','raised','trimmed','removed','held']); if(!d.houses.length) throw 'no houses'; d.houses.forEach(h=>{['broker','asOf','overweight','underweight'].forEach(k=>{if(h[k]===undefined) throw k+' missing on '+h.broker}); h.overweight.concat(h.underweight).forEach(s=>{if(!s.stock||!s.ticker) throw 'bad row '+h.broker; if(!ok.has(s.change)) throw 'bad change '+s.change})}); console.log('ok', d.houses.length, 'houses')"
```
Expected: `ok <N> houses` (N ≥ 2). Spot-check 2 names per house against the disclosure from Step 1.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && git add data/model_portfolios.json && git commit -m "data: seed multi-house model portfolios (model_portfolios.json)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: FPI Sector Positioning card markup (Positioning tab)

**Files:**
- Modify: `index.html` — inside `#viewPositioning`, after the final caption `<p>` (the "Bars = …" line), before the closing `</div>` of `#viewPositioning`.

- [ ] **Step 1: Add the card markup**

Insert immediately after the caption `<p style="font-size:11px;color:var(--text-mute);text-align:center"> … fatafatniftylevels.in. </p>`:

```html
      <div class="card reveal">
        <div class="card-h">
          <div>
            <h3>FPI Sector Positioning</h3>
            <p id="secPosSub">Net FPI flow by sector · ₹ Cr · latest month vs previous · OW/UW vs Nifty 500</p>
          </div>
        </div>
        <div id="secPosBox" style="overflow-x:auto">
          <table id="secPosTbl" style="width:100%;border-collapse:collapse;min-width:560px;font-size:12.5px">
            <thead>
              <tr style="color:var(--text-mute);font-size:10px;letter-spacing:.1em;text-transform:uppercase">
                <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)">Sector</th>
                <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--line)">Net flow (this mo)</th>
                <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--line)">Prev mo</th>
                <th style="text-align:center;padding:8px 10px;border-bottom:1px solid var(--line)">OW/UW vs N500</th>
                <th style="text-align:center;padding:8px 10px;border-bottom:1px solid var(--line)">Δ MoM</th>
              </tr>
            </thead>
            <tbody id="secPosBody"><tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-mute)">Loading sector positioning…</td></tr></tbody>
          </table>
        </div>
      </div>
```

- [ ] **Step 2: Verify markup parses (no render yet)**

Run `preview_list` to get the serverId, then:
```
preview_eval: (async()=>{ location.href='/'; return 'go'; })()
```
Then after ~2s:
```
preview_eval: (()=>({ hasCard: !!document.getElementById('secPosTbl'), bodyText: document.getElementById('secPosBody').innerText.slice(0,40) }))()
```
Expected: `{ hasCard: true, bodyText: "Loading sector positioning…" }`.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && git add index.html && git commit -m "feat: FPI sector positioning card markup (Positioning tab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `loadSectorPositioning()` + wire-in

**Files:**
- Modify: `index.html` — add the function next to `loadPositioning()` (just before the `/* ---------- Sidebar tab routing ---------- */` comment), and call it from inside `loadPositioning()`.

- [ ] **Step 1: Add the loader function**

Insert before the routing comment:

```js
/* ---------- Positioning tab · FPI sector positioning ---------- */
function secCr(v){ const s=v<0?'−':'+'; return s+'₹'+Math.abs(Math.round(v)).toLocaleString('en-IN'); }
async function loadSectorPositioning(){
  const body=document.getElementById('secPosBody'); if(!body) return;
  try{
    const res=await fetch('data/fpi_sectors.json',{cache:'no-store'});
    if(!res.ok) throw new Error('http '+res.status);
    const d=await res.json();
    const maxAbs=Math.max(1,...d.sectors.map(s=>Math.abs(s.flow)));
    const mon=iso=>{ const [y,m]=iso.split('-'); return new Date(y,m-1,1).toLocaleDateString('en-IN',{month:'short',year:'numeric'}); };
    document.getElementById('secPosSub').textContent=
      'Net FPI flow by sector · ₹ Cr · '+mon(d.asOf)+' vs '+mon(d.prevAsOf)+' · OW/UW vs '+(d.benchmark||'Nifty 500');
    body.innerHTML=d.sectors.map(s=>{
      const up=s.flow>=0, col=up?'var(--up)':'var(--down)';
      const w=Math.round(Math.abs(s.flow)/maxAbs*100);
      const bar=`<div style="height:5px;border-radius:3px;margin-top:4px;background:${col};width:${w}%;margin-left:${up?'auto':'0'}"></div>`;
      const owUp=s.ow>=0; const owTxt=(owUp?'+':'−')+Math.abs(s.ow).toFixed(1)+'% '+(owUp?'OW':'UW');
      const owChip=`<span style="font-family:'IBM Plex Mono';font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;border:1px solid ${owUp?'rgba(63,199,138,.40)':'rgba(240,106,106,.40)'};background:${owUp?'var(--up-soft)':'var(--down-soft)'};color:${owUp?'var(--up)':'var(--down)'}">${owTxt}</span>`;
      const dOw=(s.owPrev==null)?0:+(s.ow-s.owPrev).toFixed(1);
      const dTxt=dOw===0?'·':(dOw>0?'▲ +':'▼ ')+(dOw>0?'':'')+dOw.toFixed(1);
      const dCol=dOw===0?'var(--text-mute)':(dOw>0?'var(--up)':'var(--down)');
      return `<tr>
        <td style="padding:9px 10px;border-bottom:1px solid var(--line-soft);font-weight:600">${s.name}</td>
        <td style="padding:9px 10px;border-bottom:1px solid var(--line-soft);text-align:right;font-family:'IBM Plex Mono';color:${col}">${secCr(s.flow)}${bar}</td>
        <td style="padding:9px 10px;border-bottom:1px solid var(--line-soft);text-align:right;font-family:'IBM Plex Mono';color:var(--text-mute)">${secCr(s.flowPrev)}</td>
        <td style="padding:9px 10px;border-bottom:1px solid var(--line-soft);text-align:center">${owChip}</td>
        <td style="padding:9px 10px;border-bottom:1px solid var(--line-soft);text-align:center;font-family:'IBM Plex Mono';font-size:11px;color:${dCol}">${dTxt}</td>
      </tr>`;
    }).join('');
  }catch(e){
    body.innerHTML='<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-mute)">Sector positioning unavailable — could not load <code>data/fpi_sectors.json</code>.</td></tr>';
  }
}
```

- [ ] **Step 2: Call it from `loadPositioning()`**

In `loadPositioning()`, immediately after `posRows=rows;` add:
```js
    loadSectorPositioning();
```
(It runs once when the Positioning tab is first opened, same as the charts.)

- [ ] **Step 3: Verify render in the browser**

```
preview_eval: (async()=>{ location.href='/'; return 'go'; })()
```
After ~2s:
```
preview_eval: (async()=>{ const c=[...document.querySelectorAll('.nav-item')].find(n=>n.dataset.view==='positioning'); c.click(); for(let i=0;i<30 && document.getElementById('secPosBody').innerText.includes('Loading');i++){await new Promise(r=>setTimeout(r,200));} const rows=document.querySelectorAll('#secPosBody tr').length; return { rows, sub: document.getElementById('secPosSub').textContent, firstRow: document.querySelector('#secPosBody tr').innerText.replace(/\s+/g,' ').slice(0,80) }; })()
```
Expected: `rows` ≥ 10, `sub` shows the two months, `firstRow` shows a sector + a ₹ value. Then check no errors:
```
preview_console_logs: level error
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && git add index.html && git commit -m "feat: loadSectorPositioning render + wire into Positioning tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Model Portfolio Summary card markup + Strategy lazy-load

**Files:**
- Modify: `index.html` — append a card just before the closing `</div>` of `#viewStrategy` (the strategy view container that opens at `<div id="viewStrategy" hidden>`); and add a lazy-load guard in the `showView` routing.

- [ ] **Step 1: Add the card at the end of `#viewStrategy`**

Find the last `</div>` that closes `#viewStrategy` (it is followed by `<div id="viewPositioning"` or `<div id="viewMarkets"`). Immediately before that closing `</div>`, insert:

```html
      <div class="card reveal">
        <div class="card-h"><div>
          <h3>Model Portfolio Summary — house by house</h3>
          <p class="strat-sub" id="mpSub">Each house's latest model portfolio vs its prior one · positioning change + 1-month price move.</p>
        </div></div>
        <div id="mpHouses" class="houses">
          <div class="house"><div class="stance">Loading model portfolios…</div></div>
        </div>
        <p class="ch-note">Source: each house's published model-portfolio note / coverage. A house appears only when a fresh portfolio is available. Prices: Yahoo Finance, 1-month change.</p>
      </div>
```

- [ ] **Step 2: Add a lazy-load guard in `showView`**

In the routing IIFE, find the `let marketsLoaded=false, watchlistLoaded=false, positioningLoaded=false;` line and add `strategyLoaded=false`:
```js
  let marketsLoaded=false, watchlistLoaded=false, positioningLoaded=false, strategyLoaded=false;
```
Then, inside `showView`, directly after the line `vStrat.hidden=v!=='strategy';` add:
```js
    if(v==='strategy' && !strategyLoaded){ strategyLoaded=true; loadModelPortfolios(); }
```

- [ ] **Step 3: Verify markup + guard (loader added next task)**

Temporarily confirm the container exists and the guard references a name that will exist:
```
preview_eval: (async()=>{ location.href='/'; return 'go'; })()
```
After ~2s, click Strategy and confirm the placeholder shows (the loader is defined in Task 6; expect a ReferenceError in console which Task 6 fixes — confirm the container exists):
```
preview_eval: (()=>({ hasContainer: !!document.getElementById('mpHouses'), placeholder: document.getElementById('mpHouses').innerText.slice(0,30) }))()
```
Expected: `{ hasContainer: true, placeholder: "Loading model portfolios…" }`.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && git add index.html && git commit -m "feat: model portfolio summary card markup + Strategy lazy-load guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `loadModelPortfolios()` render + 1-month Yahoo returns

**Files:**
- Modify: `index.html` — add the function near `loadSectorPositioning()` (before the routing comment).

- [ ] **Step 1: Add the loader + Yahoo 1-month helper**

```js
/* ---------- Strategy tab · multi-house model portfolios ---------- */
const mpRetCache={};
async function oneMonthReturn(ticker){
  if(ticker in mpRetCache) return mpRetCache[ticker];
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker)+'?range=1mo&interval=1d';
  try{
    let j;
    try{ j=await (await fetch(url)).json(); }
    catch(_){ j=JSON.parse(await (await fetch('https://corsproxy.io/?url='+encodeURIComponent(url))).text()); }
    const q=j.chart.result[0].indicators.quote[0].close.filter(x=>x!=null);
    const r=q.length>1 ? (q[q.length-1]/q[0]-1)*100 : null;
    mpRetCache[ticker]=r; return r;
  }catch(e){ mpRetCache[ticker]=null; return null; }
}
function mpBadge(change){
  const m={ new:['✚ new','var(--up)'], raised:['▲ raised','var(--up)'], trimmed:['▼ trimmed','var(--down)'],
            removed:['✕ removed','var(--down)'], held:['= held','var(--text-mute)'] }[change]||['·','var(--text-mute)'];
  return `<span style="font-size:10px;font-weight:700;color:${m[1]}">${m[0]}</span>`;
}
async function loadModelPortfolios(){
  const wrap=document.getElementById('mpHouses'); if(!wrap) return;
  try{
    const res=await fetch('data/model_portfolios.json',{cache:'no-store'});
    if(!res.ok) throw new Error('http '+res.status);
    const d=await res.json();
    const mon=iso=>{ const [y,m]=iso.split('-'); return new Date(y,m-1,1).toLocaleDateString('en-IN',{month:'short',year:'numeric'}); };
    if(d.asOf) document.getElementById('mpSub').textContent="Each house's latest model portfolio ("+mon(d.asOf)+") vs its prior one · positioning change + 1-month price move.";
    const sideHtml=(title,arr,col)=>`<div class="pk-label" style="color:${col}">${title}</div>`+
      `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">`+
      (arr.length?arr.map(s=>`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px">
          <span style="font-weight:600;color:var(--text)">${s.stock}</span>
          ${mpBadge(s.change)}
          <span class="mpret" data-t="${s.ticker||''}" title="${(s.note||'').replace(/"/g,'&quot;')}" style="margin-left:auto;font-family:'IBM Plex Mono';font-size:11px;color:var(--text-mute)">…</span>
        </div>`).join(''):'<div style="font-size:11.5px;color:var(--text-mute)">—</div>')+`</div>`;
    wrap.innerHTML=d.houses.map(h=>`<div class="house">
      <h4>${h.broker}</h4>
      <div class="src">Model portfolio · ${h.asOf?mon(h.asOf):''}${h.benchmark?' · vs '+h.benchmark:''}</div>
      <div style="margin-top:10px">
        ${sideHtml('Overweight',h.overweight||[],'var(--up)')}
        ${sideHtml('Underweight',h.underweight||[],'var(--down)')}
      </div>
    </div>`).join('');
    // fill 1-month returns lazily
    const cells=[...wrap.querySelectorAll('.mpret')];
    for(const cell of cells){
      const t=cell.dataset.t; if(!t){ cell.textContent='—'; continue; }
      const r=await oneMonthReturn(t);
      if(r==null){ cell.textContent='—'; }
      else{ cell.textContent=(r>=0?'+':'')+r.toFixed(1)+'%'; cell.style.color=r>=0?'var(--up)':'var(--down)'; }
    }
  }catch(e){
    wrap.innerHTML='<div class="house"><div class="stance">Model-portfolio data unavailable — could not load <code>data/model_portfolios.json</code>.</div></div>';
  }
}
```

- [ ] **Step 2: Verify render + returns in the browser**

```
preview_eval: (async()=>{ location.href='/'; return 'go'; })()
```
After ~2s:
```
preview_eval: (async()=>{ [...document.querySelectorAll('.nav-item')].find(n=>n.dataset.view==='strategy').click(); for(let i=0;i<40 && document.getElementById('mpHouses').innerText.includes('Loading');i++){await new Promise(r=>setTimeout(r,200));} await new Promise(r=>setTimeout(r,3000)); const houses=document.querySelectorAll('#mpHouses .house').length; const rets=[...document.querySelectorAll('#mpHouses .mpret')].map(c=>c.textContent); return { houses, retCount: rets.length, filled: rets.filter(x=>x.includes('%')).length, sample: rets.slice(0,5) }; })()
```
Expected: `houses` ≥ 2, `retCount` > 0, `filled` > 0 (some 1-month % values present), `sample` shows `%` strings.
```
preview_console_logs: level error
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && git add index.html && git commit -m "feat: loadModelPortfolios render + 1-month Yahoo returns (Strategy tab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Refresher routine prompt doc

**Files:**
- Create: `docs/positioning-data-refresher-prompt.md`

- [ ] **Step 1: Write the prompt doc**

Write `docs/positioning-data-refresher-prompt.md` containing: the cron (`30 1 2,17 * *` UTC = 9:30 AM MYT on the 2nd & 17th), repo/branch, tools (`Bash, Read, Write, Edit, WebFetch, WebSearch`), model `claude-sonnet-4-6`, and a self-contained prompt that performs Task 1's sector procedure (sources, normalization map, `data/fpi_sectors.json` schema) and Task 2's model-portfolio procedure (focus list, schema, ticker mapping, skip-if-stale), validates both JSON files (the two `node -e` checks), then commits + pushes to `main`. Include the failure mode: if a source is unreachable, leave that file unchanged and report which failed. Mirror the structure of `docs/fii-dii-refresher-prompt.md`.

- [ ] **Step 2: Commit**

```bash
cd /c/Users/admin/India-Research-Portal && git add docs/positioning-data-refresher-prompt.md && git commit -m "docs: positioning data refresher routine prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Create the refresher routine (enabled)

**Files:** none (uses the `RemoteTrigger` tool)

- [ ] **Step 1: Create the routine**

Load the tool: `ToolSearch select:RemoteTrigger`. Generate a fresh lowercase v4 UUID (`python -c "import uuid;print(uuid.uuid4())"`). Call `RemoteTrigger action:create` with:
- `name`: "India Positioning Data Refresher"
- `cron_expression`: `30 1 2,17 * *`
- `enabled`: true
- `job_config.ccr.environment_id`: `env_01A6oT7Kk4nVsTSDH7KRBavk`
- `session_context.model`: `claude-sonnet-4-6`
- `sources`: `[{git_repository:{url:"https://github.com/markwoontk-maker/india-research-portal"}}]`
- `allowed_tools`: `["Bash","Read","Write","Edit","WebFetch","WebSearch"]`
- `events[0].data.message.content`: the full self-contained prompt from `docs/positioning-data-refresher-prompt.md` (embed verbatim).

- [ ] **Step 2: Confirm**

Verify the response has `enabled:true` and a sane `next_run_at` (the 2nd or 17th, 01:30 UTC). Record the routine ID and URL `https://claude.ai/code/routines/<id>`.

---

## Task 9: Document in CLAUDE.md + final push

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a section to CLAUDE.md**

Under the Positioning tab section, document: `data/fpi_sectors.json` (NSDL + Nifty-500 weights, sector card on Positioning tab) and `data/model_portfolios.json` (multi-house model portfolios, per-house blocks at the bottom of the **Strategy** tab, 1-month Yahoo returns), and the "India Positioning Data Refresher" routine (ID from Task 8, cron `30 1 2,17 * *`, prompt in `docs/positioning-data-refresher-prompt.md`). Note the source-provenance caveats (NSDL parsing risk + aggregator fallback; multi-house coverage varies, skip-if-stale).

- [ ] **Step 2: Commit + push everything**

```bash
cd /c/Users/admin/India-Research-Portal && git add CLAUDE.md && git commit -m "docs: document sector positioning + model portfolio data + routine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" && git push origin main
```
Expected: push succeeds; GitHub Pages republishes within ~1 min.

- [ ] **Step 3: Final browser smoke test**

```
preview_eval: (async()=>{ location.href='/'; return 'go'; })()
```
After ~2s, confirm both features and that the model portfolio is NOT on the Positioning tab:
```
preview_eval: (async()=>{ const click=v=>[...document.querySelectorAll('.nav-item')].find(n=>n.dataset.view===v).click(); click('positioning'); await new Promise(r=>setTimeout(r,2500)); const posHasMP=/model portfolio/i.test(document.getElementById('viewPositioning').innerText); const secRows=document.querySelectorAll('#secPosBody tr').length; click('strategy'); await new Promise(r=>setTimeout(r,3500)); const mpHouses=document.querySelectorAll('#mpHouses .house').length; return { secRows, mpHouses, modelPortfolioLeakedToPositioning: posHasMP }; })()
```
Expected: `secRows` ≥ 10, `mpHouses` ≥ 2, `modelPortfolioLeakedToPositioning: false`.

---

## Self-Review notes

- **Spec coverage:** sector card (Tasks 3–4) ✓; multi-house per-house model portfolio at Strategy bottom (Tasks 5–6) ✓; both data files (Tasks 1–2) ✓; one routine for both (Tasks 7–8) ✓; NOT on Positioning tab (verified in Task 9 Step 3) ✓; 1-month return + change badge = "both" (Task 6) ✓; OW/UW vs Nifty 500 (Task 1) ✓.
- **Names are consistent:** `loadSectorPositioning`, `secPosBody`, `loadModelPortfolios`, `mpHouses`, `oneMonthReturn`, `strategyLoaded` used identically across tasks.
- **No unit-test framework** in this repo — verification is the documented `preview_eval` browser checks (matches how FII/DII was verified). The screenshot tool times out in this sandbox; rely on `preview_eval` + `preview_console_logs`.
- **Data-sourcing tasks** give the exact procedure + schema + validation rather than literal values (values are live and unknown until sourced) — this is the same approach that produced `fii_dii.json`.
