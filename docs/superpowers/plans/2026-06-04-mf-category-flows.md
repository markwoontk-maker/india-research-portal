# MF Category Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "MF Category Flows" card to the Positioning tab — net inflows + AUM for the 6 equity cap categories, with an append-only monthly net-flow drill-down chart, sourced from AMFI.

**Architecture:** A committed `data/mf_categories.json` (AMFI-sourced, append-only `months`/`hist`) rendered by a sortable table + click-to-expand bar chart that mirror the existing FPI sector card (`secPosRender`/`secHistDraw`). Refreshed monthly by the existing Positioning Data Refresher. Verification via the preview server (`preview_eval`); no unit-test framework.

**Tech Stack:** Static `index.html` (inline CSS/JS), Chart.js (loaded), AMFI / finnovate data, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-06-04-mf-category-flows-design.md`

**Conventions:** colors `var(--up)`/`var(--down)`/`var(--saffron)`; preview root is `/`; commit to `main` and push; end commit messages with the Co-Authored-By line. The 6 categories, canonical names: **Large Cap, Large & Mid Cap, Mid Cap, Small Cap, Multi Cap, Flexi Cap**.

---

## Task 1: Source & seed `data/mf_categories.json`

**Files:** Create `data/mf_categories.json`

- [ ] **Step 1: Gather the last ~12 months of AMFI category data**

Today is June 2026; the latest completed AMFI month is **May 2026** (released ~10 Jun) or **Apr 2026** if May isn't out yet — use the latest available, and record which. For each of the last ~12 months, get the **net inflow (₹ cr)** for each of the 6 categories, plus the **latest** month's **AUM (₹ cr)** per category.

Sources (use PowerShell `Invoke-WebRequest` with TLS 1.2, or WebFetch; sequential with small gaps):
- finnovate monthly MF blogs: `https://www.finnovate.in/learn/blog/mutual-fund-data-<month>-2026` (e.g. `-march-2026`) — verified reachable; per-month category net flows.
- AMFI official monthly (`amfiindia.com/research-information/amfi-monthly`) if reachable (was flaky on a direct hit — try a proxy or WebFetch); use as the authoritative cross-check.
- Cross-check headline numbers against upstox/ventura coverage.
- A month with no clean figure for a category → `null`.

Known anchor (cross-check, Mar-2026 net inflows ₹ cr): Flexi Cap +10,054 · Small Cap +6,264 · Mid Cap +6,064 · Large & Mid +5,307 · Large Cap +2,998 · Multi Cap (find).

- [ ] **Step 2: Write the file**

Shape (UTF-8 no BOM), `months` ascending, each `hist` aligned 1:1 to `months`:
```json
{
  "asOf": "2026-05",
  "prevAsOf": "2026-04",
  "months": ["2025-06","2025-07","...","2026-05"],
  "categories": [
    { "name": "Flexi Cap", "flow": 0, "flowPrev": 0, "aum": 0, "aumShare": 0,
      "hist": [ /* monthly net flows ₹ cr aligned to months; null if unknown */ ] }
  ]
}
```
- Exactly the 6 categories, canonical names above.
- `flow` = `hist[last]`, `flowPrev` = `hist[last-1]`.
- `aum` = latest category AUM (₹ cr); `aumShare` = `round(aum / sum(all 6 aum) * 100, 1)`.

- [ ] **Step 3: Validate**

```bash
cd /c/Users/admin/India-Research-Portal && node -e "const d=require('./data/mf_categories.json'); if(d.categories.length!==6) throw 'cats '+d.categories.length; if(!d.months.length) throw 'no months'; d.categories.forEach(c=>{['name','flow','flowPrev','aum','aumShare'].forEach(k=>{if(c[k]===undefined) throw k+' on '+c.name}); if(!Array.isArray(c.hist)||c.hist.length!==d.months.length) throw 'hist len '+c.name; if(c.hist[c.hist.length-1]!==c.flow) throw 'flow!=hist[last] '+c.name}); console.log('ok',d.categories.length,'cats x',d.months.length,'months',d.asOf)"
```
Expected: `ok 6 cats x <N> months 2026-05`. Spot-check the latest month vs the source (e.g. Flexi Cap vs the finnovate print).

- [ ] **Step 4: Commit**
```bash
cd /c/Users/admin/India-Research-Portal && git add data/mf_categories.json && git commit -m "data: seed MF category flows (mf_categories.json, AMFI)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Card markup

**Files:** Modify `index.html` — inside `#viewPositioning`, immediately after the MF Sector Positioning card's closing `</div>` (the card whose header is "MF Sector Positioning"), before the `</div>` that closes `#viewPositioning`.

- [ ] **Step 1: Insert the card**

Find the MF Sector Positioning card's end — the line `      </div>` that follows its `</table></div>` (the `<tbody id="mfPosBody">` table). Insert immediately after it:
```html
      <div class="card reveal">
        <div class="card-h"><div>
          <h3>MF Category Flows</h3>
          <p id="mfCatSub">Net equity-MF flows + AUM by category · AMFI</p>
        </div></div>
        <div style="overflow-x:auto">
          <table id="mfCatTbl" style="width:100%;border-collapse:collapse;min-width:560px;font-size:12.5px">
            <thead>
              <tr style="color:var(--text-mute);font-size:10px;letter-spacing:.1em;text-transform:uppercase;user-select:none">
                <th data-key="name" data-label="Category" title="Click to sort" style="cursor:pointer;text-align:left;padding:6px 10px;border-bottom:1px solid var(--line)">Category</th>
                <th data-key="flow" data-label="Net flow (this mo)" title="Click to sort" style="cursor:pointer;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">Net flow (this mo)</th>
                <th data-key="flowPrev" data-label="Prev mo" title="Click to sort" style="cursor:pointer;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">Prev mo</th>
                <th data-key="ytd" data-label="YTD" title="Calendar year-to-date · click to sort" style="cursor:pointer;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">YTD</th>
                <th data-key="oneY" data-label="1Y" title="Trailing 12-month · click to sort" style="cursor:pointer;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">1Y</th>
                <th data-key="aum" data-label="AUM" title="Click to sort" style="cursor:pointer;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">AUM</th>
                <th data-key="aumShare" data-label="Share" title="Click to sort" style="cursor:pointer;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line)">Share</th>
              </tr>
            </thead>
            <tbody id="mfCatBody"><tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-mute)">Loading MF category flows…</td></tr></tbody>
          </table>
        </div>
      </div>
```

- [ ] **Step 2: Verify markup**
```
preview_eval (serverId from preview_list): (async()=>{ location.href='/'; return 'go'; })()
```
then after ~2s: `(()=>({ has: !!document.getElementById('mfCatTbl'), txt: document.getElementById('mfCatBody').innerText.slice(0,30) }))()`
Expected: `{ has:true, txt:"Loading MF category flows…" }`.

- [ ] **Step 3: Commit**
```bash
cd /c/Users/admin/India-Research-Portal && git add index.html && git commit -m "feat: MF Category Flows card markup (Positioning tab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Loader + render + drill-down chart

**Files:** Modify `index.html` — add the functions next to `loadMfSectors()` (just before the `/* ---------- Strategy tab · multi-house model portfolios ---------- */` comment), and call the loader from `loadPositioning()`.

- [ ] **Step 1: Add the functions**

Insert before the `/* ---------- Strategy tab · multi-house model portfolios ---------- */` comment:
```js
/* ---------- Positioning tab · MF category flows (AMFI, append-only) ---------- */
let mfCatData=null, mfCatMonths=[], mfCatSort={key:null,dir:-1}, mfCatExpanded=null, mfCatChart=null;
function mfAum(v){ return v==null?'—':'₹'+(v/100000).toFixed(1)+'L cr'; }
function mfCatYtd(c){ if(!Array.isArray(c.hist)) return null; const y=(mfCatMonths[mfCatMonths.length-1]||'').slice(0,4);
  let s=0,a=false; c.hist.forEach((v,i)=>{ if(v!=null && (mfCatMonths[i]||'').slice(0,4)===y){ s+=v; a=true; } }); return a?Math.round(s):null; }
function mfCatOneY(c){ if(!Array.isArray(c.hist)) return null; const h=c.hist.slice(-12).filter(v=>v!=null);
  return h.length?Math.round(h.reduce((x,y)=>x+y,0)):null; }
function mfCatVal(c,k){ if(k==='ytd') return mfCatYtd(c)??0; if(k==='oneY') return mfCatOneY(c)??0; return c[k]; }
function mfCatHistDraw(c){
  const cv=document.getElementById('mfCatChart'); if(!cv) return;
  if(mfCatChart){ mfCatChart.destroy(); mfCatChart=null; }
  const hist=c.hist||[], labels=mfCatMonths.map(secMonLbl);
  const colors=hist.map(v=> v==null?'#646c7c':(v>=0?'#3fc78a':'#f06a6a'));
  mfCatChart=new Chart(cv,{ type:'bar',
    data:{labels,datasets:[{data:hist.map(v=>v==null?0:v),backgroundColor:colors,borderWidth:0,categoryPercentage:.8,barPercentage:.9}]},
    options:{responsive:true,maintainAspectRatio:false,devicePixelRatio:Math.max(2,window.devicePixelRatio||1),
      plugins:{legend:{display:false},
        tooltip:{backgroundColor:'#11151c',borderColor:'#252c39',borderWidth:1,titleColor:'#646c7c',bodyColor:'#e9e6dd',padding:10,
          callbacks:{ label:x=> hist[x.dataIndex]==null?'no data':'  '+secCr(hist[x.dataIndex])+' cr' }}},
      scales:{ x:{grid:{display:false},border:{display:false},ticks:{color:'#646c7c',font:{family:'IBM Plex Mono',size:10},maxRotation:0,autoSkip:true,maxTicksLimit:14}},
        y:{grid:{color:'#1f2530'},border:{display:false},ticks:{color:'#646c7c',font:{family:'IBM Plex Mono',size:10},callback:v=>(Math.abs(v)>=1000?(v/1000).toFixed(0)+'k':v)}} } }
  });
}
function mfCatRender(){
  const body=document.getElementById('mfCatBody'); if(!body||!mfCatData) return;
  const rows=mfCatData.slice();
  if(mfCatSort.key){ const k=mfCatSort.key, dir=mfCatSort.dir;
    rows.sort((a,b)=> k==='name'?dir*String(a.name).localeCompare(String(b.name)):dir*(mfCatVal(a,k)-mfCatVal(b,k))); }
  const td='padding:3px 10px;border-bottom:1px solid var(--line-soft)';
  const money=(v)=>`<td style="${td};text-align:right;font-family:'IBM Plex Mono';color:${v==null?'var(--text-mute)':(v>=0?'var(--up)':'var(--down)')}">${v==null?'—':secCr(v)}</td>`;
  body.innerHTML=rows.map(c=>{
    const ytd=mfCatYtd(c), oy=mfCatOneY(c), open=mfCatExpanded===c.name;
    const caret=`<span style="color:var(--text-mute);font-size:9px;margin-left:5px">${open?'▾':'▸'}</span>`;
    const hasHist=c.hist&&c.hist.some(v=>v!=null);
    const exp=open?`<tr class="mfcatexp"><td colspan="7" style="padding:4px 10px 14px;border-bottom:1px solid var(--line-soft)">
        <div style="font-size:11px;color:var(--text-mute);margin:2px 0 6px">${c.name} — monthly net flow (₹ cr) · green inflow / red outflow · full history</div>
        ${hasHist?'<div class="chart-box" style="height:190px"><canvas id="mfCatChart"></canvas></div>':'<div style="color:var(--text-mute);font-size:11.5px;padding:10px 0">Monthly history unavailable.</div>'}
      </td></tr>`:'';
    return `<tr>
      <td class="mfcatname" data-name="${c.name.replace(/"/g,'&quot;')}" title="Show monthly flow chart" style="${td};font-weight:600;cursor:pointer">${c.name}${caret}</td>
      ${money(c.flow)}${money(c.flowPrev)}${money(ytd)}${money(oy)}
      <td style="${td};text-align:right;font-family:'IBM Plex Mono';color:var(--text-dim)">${mfAum(c.aum)}</td>
      <td style="${td};text-align:right;font-family:'IBM Plex Mono';color:var(--text-mute)">${c.aumShare!=null?c.aumShare.toFixed(1)+'%':'—'}</td>
    </tr>${exp}`;
  }).join('');
  document.querySelectorAll('#mfCatTbl th[data-key]').forEach(th=>{
    const act=mfCatSort.key===th.dataset.key, arr=mfCatSort.dir>0?'▲':'▼';
    th.innerHTML=th.dataset.label+(act?' <span style="color:var(--saffron)">'+arr+'</span>':'');
  });
  if(mfCatExpanded){ const c=mfCatData.find(x=>x.name===mfCatExpanded); if(c&&c.hist&&c.hist.some(v=>v!=null)) mfCatHistDraw(c); }
}
async function loadMfCategories(){
  const body=document.getElementById('mfCatBody'); if(!body) return;
  try{
    const res=await fetch('data/mf_categories.json',{cache:'no-store'});
    if(!res.ok) throw new Error('http '+res.status);
    const d=await res.json();
    mfCatData=d.categories; mfCatMonths=d.months||[];
    const mon=iso=>{ const [y,m]=iso.split('-'); return new Date(y,m-1,1).toLocaleDateString('en-IN',{month:'short',year:'numeric'}); };
    const totalAum=d.categories.reduce((s,c)=>s+(c.aum||0),0);
    const sub=document.getElementById('mfCatSub'); if(sub) sub.textContent=
      'Net equity-MF flows + AUM by category · AMFI · '+(d.asOf?mon(d.asOf):'')+' · 6 cap categories ₹'+(totalAum/100000).toFixed(1)+'L cr · click a name for its monthly chart';
    const tbl=document.getElementById('mfCatTbl');
    if(tbl && !tbl.dataset.wired){ tbl.dataset.wired='1';
      tbl.querySelectorAll('th[data-key]').forEach(th=>th.addEventListener('click',()=>{
        const k=th.dataset.key; if(mfCatSort.key===k) mfCatSort.dir=-mfCatSort.dir; else { mfCatSort.key=k; mfCatSort.dir=(k==='name'?1:-1); }
        mfCatRender(); }));
      body.addEventListener('click',e=>{ const cell=e.target.closest&&e.target.closest('.mfcatname'); if(!cell) return;
        const n=cell.dataset.name; mfCatExpanded=(mfCatExpanded===n?null:n);
        if(mfCatChart){ mfCatChart.destroy(); mfCatChart=null; } mfCatRender(); });
    }
    mfCatRender();
  }catch(e){
    body.innerHTML='<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-mute)">MF category data unavailable — could not load <code>data/mf_categories.json</code>.</td></tr>';
  }
}
```

- [ ] **Step 2: Call from `loadPositioning()`**

Find `loadMfSectors();` inside `loadPositioning()` and add a line after it:
```js
    loadMfCategories();
```

- [ ] **Step 3: Verify in the browser**
```
preview_eval: (async()=>{ location.href='/'; return 'go'; })()
```
after ~2s:
```
preview_eval: (async()=>{ [...document.querySelectorAll('.nav-item')].find(n=>n.dataset.view==='positioning').click(); for(let i=0;i<30 && document.getElementById('mfCatBody').innerText.includes('Loading');i++){await new Promise(r=>setTimeout(r,200));} const rows=[...document.querySelectorAll('#mfCatBody tr')]; const first=rows[0]?[...rows[0].cells].map(c=>c.innerText.split('\n')[0]):null; // sort by flow then expand
  [...document.querySelectorAll('#mfCatTbl th')].find(t=>t.dataset.key==='flow').click();
  document.querySelector('#mfCatBody td.mfcatname').click(); await new Promise(r=>setTimeout(r,500));
  return { rowsWithData: document.querySelectorAll('#mfCatBody td.mfcatname').length, first, chart: !!(window.Chart&&Chart.getChart('mfCatChart')), expColspan: document.querySelector('#mfCatBody tr.mfcatexp td')?.getAttribute('colspan') }; })()
```
Expected: `rowsWithData:6`, `first` shows a category + ₹ values, `chart:true`, `expColspan:"7"`. Then `preview_console_logs level error` → none.

- [ ] **Step 4: Commit**
```bash
cd /c/Users/admin/India-Research-Portal && git add index.html && git commit -m "feat: loadMfCategories render + monthly drill-down (Positioning tab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Refresher doc — append-only monthly maintenance

**Files:** Modify `docs/positioning-data-refresher-prompt.md`

- [ ] **Step 1: Add a section**

Add a "## 3b. `data/mf_categories.json` — MF category flows (AMFI, APPEND-ONLY)" section after the model-portfolios section: instruct the routine (on the 17th run, after AMFI's ~10th release) to fetch the latest completed month's net inflow + AUM for the 6 cap categories (Large Cap, Large & Mid Cap, Mid Cap, Small Cap, Multi Cap, Flexi Cap) from AMFI (finnovate aggregator fallback, verified). **Append** the new month to `months` and each category's `hist`, update `flow`/`flowPrev`/`aum`/`aumShare`; **never trim older months** (append-only). Idempotent if the latest month is already present. Validate with the Task-1 node check. Keep the exact data shape from the spec.

- [ ] **Step 2: Commit**
```bash
cd /c/Users/admin/India-Research-Portal && git add docs/positioning-data-refresher-prompt.md && git commit -m "docs: refresher maintains mf_categories.json (append-only monthly)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Update the routine + CLAUDE.md + push

**Files:** Modify `CLAUDE.md`; update routine via `RemoteTrigger`.

- [ ] **Step 1: Update the Positioning Data Refresher routine**

Load `RemoteTrigger` (`ToolSearch select:RemoteTrigger`). `RemoteTrigger action:update trigger_id:trig_016kRFwRmUB53VbyXJF96TGQ` with the full `job_config` (same as current) but the embedded message extended to mention it also maintains `data/mf_categories.json` (append-only, AMFI) per the doc. Confirm `enabled:true` and a sane `next_run_at`.

- [ ] **Step 2: Document in CLAUDE.md**

Add a bullet under the Sector-positioning section: the **MF Category Flows** card (`#mfCatBody`, `loadMfCategories()`/`mfCatRender()`), `data/mf_categories.json` (AMFI, 6 cap categories, flows+AUM, **append-only `months`/`hist`** — never trimmed), drill-down chart `mfCatChart`, refreshed monthly by the Positioning Data Refresher.

- [ ] **Step 3: Commit + push + final smoke test**
```bash
cd /c/Users/admin/India-Research-Portal && git add CLAUDE.md docs/superpowers/plans/2026-06-04-mf-category-flows.md && git commit -m "docs: document MF Category Flows card + refresher

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" && git push origin main
```
Then `preview_eval`: open Positioning tab, confirm both MF cards (Sector Positioning + Category Flows) render and the category drill-down chart opens. Expected: 6 category rows, chart on click, no console errors.

---

## Self-Review notes
- **Spec coverage:** data file append-only `months`/`hist` (Task 1) ✓; flows+AUM+share columns + YTD/1Y (Task 2–3) ✓; 6 cap categories (Task 1) ✓; drill-down full-history bar chart (Task 3) ✓; clean source, no approximate disclaimer (markup has none) ✓; refresher append-only (Task 4–5) ✓; mirrors FPI card (reuses `secMonLbl`/`secCr`, same sort/expand pattern) ✓.
- **Names consistent:** `mfCatData`/`mfCatMonths`/`mfCatSort`/`mfCatExpanded`/`mfCatChart`/`mfCatRender`/`loadMfCategories`/`mfCatYtd`/`mfCatOneY`/`mfCatHistDraw`/`#mfCatBody`/`#mfCatTbl`/`#mfCatChart` used identically across tasks; reuses existing `secMonLbl`, `secCr`.
- **No test framework** — verification is `preview_eval` + `preview_console_logs` (matches the FPI card build).
- **Append-only:** `hist`/`months` grow; `mfCatOneY` uses `slice(-12)` (trailing 12) and `mfCatYtd` filters by current year, so both windows stay correct as history grows; the drill-down chart plots ALL months.
