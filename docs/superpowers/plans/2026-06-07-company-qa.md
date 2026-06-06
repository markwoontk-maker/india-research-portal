# Company-tab Bull/Bear/Key-Debate Q&A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Key Questions" card to the Company tab showing per-company bull/bear/key-debate questions with grounded, cited answers, produced by a questioner agent and an answerer agent run from the local refresh pipeline.

**Architecture:** A new gated local build step (`scripts/build-company-qa.ps1`) runs two headless-Claude passes — a **questioner** (generates company-specific questions via `nlm notebook describe`) and an **answerer** (answers each via `nlm notebook query --json`, grounded in the company's broker-PDF NotebookLM sources). Output lands in `data/company_qa.json`, which the static page fetches and renders in a new collapsible card, mirroring the existing Thesis/Drivers cards.

**Tech Stack:** Static `index.html` (inline CSS/JS, no build step), PowerShell + headless `claude` CLI miner, `nlm` CLI (NotebookLM), Node for JSON validation. No test runner exists in this repo — verification is by Node validators, `grep`, and the local preview server, not a unit-test framework.

**Spec:** `docs/superpowers/specs/2026-06-07-company-qa-design.md`

---

## Prerequisites (do this before Task 9's live run)

- **NotebookLM auth must be live.** `nlm notebook query` currently returns
  `Authentication expired`. The user must run `nlm login --profile work`
  interactively (Chrome fully closed; signs in as **markworktk@gmail.com**)
  before the answerer can fetch anything. Front-end tasks (1–4) and the
  prompt/script tasks (5–8) do **not** need auth; only the live run (Task 9) does.

## File Structure

- **Create**
  - `data/company_questions.json` — intermediate, hand-editable questions (seed).
  - `data/company_qa.json` — rendered Q&A data (seed with one real company).
  - `docs/company-qa-questioner-prompt.md` — questioner agent prompt.
  - `docs/company-qa-answerer-prompt.md` — answerer agent prompt.
  - `scripts/build-company-qa.ps1` — gated two-pass miner + validation.
- **Modify**
  - `index.html` — new `#cQACard` DOM, CSS, `COMPANY_QA` loader,
    `renderCompanyQA()`, select-handler call.
  - `scripts/daily-refresh.ps1` — new gated step + git stage list.
  - `CLAUDE.md` — document the card + miner.
- **Created at runtime:** `scripts/.company-qa-state.json` (window watermark).

---

## Task 1: Seed data files

Build the front-end against real data so it can be verified immediately. Adani
Power (notebook `2052a512-3b1a-4dd6-8ff4-f31a1250dbb3`) is the example.

**Files:**
- Create: `data/company_qa.json`
- Create: `data/company_questions.json`

- [ ] **Step 1: Write `data/company_qa.json`**

```json
{
  "asOf": "2026-06-07",
  "companies": {
    "Adani Power": {
      "asOf": "2026-06-07",
      "bull": [
        { "q": "What underpins the volume growth outlook?", "a": "Capacity additions and high plant load factors are the core upside lever cited by brokers.", "broker": "Jeff", "date": "260604", "url": "" }
      ],
      "bear": [
        { "q": "What is the single biggest downside risk?", "a": "Merchant-tariff and fuel-cost volatility is flagged as the main risk to earnings.", "broker": "", "date": "", "url": "" }
      ],
      "debates": [
        { "q": "Is the current valuation justified by the growth runway?", "a": "Brokers differ on whether the re-rating already prices in the capacity pipeline.", "broker": "", "date": "", "url": "" }
      ]
    }
  }
}
```

- [ ] **Step 2: Write `data/company_questions.json`**

```json
{
  "asOf": "2026-06-07",
  "companies": {
    "Adani Power": {
      "notebookId": "2052a512-3b1a-4dd6-8ff4-f31a1250dbb3",
      "bull":    [ { "q": "What underpins the volume growth outlook?", "pinned": false } ],
      "bear":    [ { "q": "What is the single biggest downside risk?", "pinned": false } ],
      "debates": [ { "q": "Is the current valuation justified by the growth runway?", "pinned": false } ]
    }
  }
}
```

- [ ] **Step 3: Verify both parse as JSON**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
node -e "require('./data/company_qa.json'); require('./data/company_questions.json'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add data/company_qa.json data/company_questions.json
git commit -m "Company Q&A: seed data files (Adani Power example)"
```

---

## Task 2: Front-end — card DOM + CSS

**Files:**
- Modify: `index.html` (insert card after `cThesisCard` closes at line ~1755; add CSS in the `<style>` block near the thesis styles at line ~551)

- [ ] **Step 1: Insert the card DOM**

Find the closing `</div>` of `#cThesisCard` (line ~1755, immediately before the
`<!-- Key drivers:` comment). Insert this block directly after that `</div>` and
before the `<!-- Key drivers:` comment:

```html
      <!-- Key Questions: per-company bull / bear / key-debate questions with
           grounded answers from data/company_qa.json (built by the
           questioner + answerer agents in scripts/build-company-qa.ps1).
           Collapsible: question visible, click to expand the answer. -->
      <div class="card reveal" id="cQACard" hidden>
        <div class="card-h">
          <div><h3>Key Questions</h3>
          <p id="cQASub">Bull / bear / key-debate questions, answered from this company's NotebookLM broker library</p></div>
        </div>
        <div id="cQABody"></div>
        <p class="co-desc-src">Questions are generated per company; answers are grounded in the company's NotebookLM broker-report library and evaluated by the answerer agent. Click a question to expand its answer. Citations open the source PDF where identifiable.</p>
      </div>
```

- [ ] **Step 2: Add CSS**

Find the `.thesis-col.bear h4{color:var(--down)}` rule (line ~554). Insert the
following CSS rules immediately after it:

```css
  /* Key Questions card — collapsible Q&A by bull / bear / key-debate */
  .qa-sec{margin-bottom:14px}
  .qa-sec:last-child{margin-bottom:0}
  .qa-sec-h{font-size:11px;text-transform:uppercase;letter-spacing:.14em;margin:0 0 8px}
  .qa-sec-h.bull{color:var(--up)}
  .qa-sec-h.bear{color:var(--down)}
  .qa-sec-h.debates{color:var(--text-dim)}
  .qa-item{background:var(--ink-2);border:1px solid var(--line);border-radius:8px;margin-bottom:6px;padding:9px 11px}
  .qa-item:last-child{margin-bottom:0}
  .qa-item summary{cursor:pointer;font-weight:600;color:var(--text-dim);font-size:13px;line-height:1.5;list-style:none}
  .qa-item summary::-webkit-details-marker{display:none}
  .qa-item summary::before{content:"\25B8\00a0";color:var(--text-mute)}
  .qa-item[open] summary::before{content:"\25BE\00a0"}
  .qa-item .qa-a{margin-top:8px;font-size:12.5px;line-height:1.65;color:var(--text-dim)}
```

- [ ] **Step 3: Verify the card markup is present and well-formed**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
grep -n 'id="cQACard"' index.html && grep -n 'qa-sec-h.bull' index.html
```
Expected: one match for each (the card DOM and the CSS rule both exist).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Company Q&A: add #cQACard DOM + collapsible CSS"
```

---

## Task 3: Front-end — loader + renderCompanyQA()

**Files:**
- Modify: `index.html` (loader near the `THESES` loader at line ~5458; render function near `renderCompanyDrivers` at line ~6347; select-handler calls at lines ~6464 and ~6524)

- [ ] **Step 1: Add the data loader**

Find the `THESES` loader block (line ~5458):
```js
window.THESES=null;
fetch('data/theses.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{
```
Insert this block immediately **before** `window.THESES=null;`:

```js
// Per-company bull/bear/key-debate Q&A, built by scripts/build-company-qa.ps1
// (questioner + answerer agents). Top-level file is {asOf, companies:{}};
// we keep the companies map on window.COMPANY_QA, keyed by company name.
window.COMPANY_QA=null;
fetch('data/company_qa.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{
  if(!j||typeof j!=='object'||!j.companies) return;
  window.COMPANY_QA=j.companies;
  if(typeof renderCompanyQA==='function') renderCompanyQA();
}).catch(()=>{});
```

- [ ] **Step 2: Add `renderCompanyQA()`**

Find the end of `renderCompanyDrivers()` (the closing `}` at line ~6347, just
before the `// Financial Summary card` comment at ~6349). Insert this function
immediately after `renderCompanyDrivers()`'s closing brace:

```js
// Key Questions card — bull/bear/key-debate Q&A for the selected company.
// Mirrors renderCompanyDrivers: keyed on currentCompany, hidden for sectors
// and when there's no entry. Data from window.COMPANY_QA (data/company_qa.json).
function renderCompanyQA(){
  const card=document.getElementById('cQACard');
  const body=document.getElementById('cQABody');
  const sub=document.getElementById('cQASub');
  if(!card||!body) return;
  if(!currentCompany ||
     (typeof SECTOR_NAMES!=='undefined' && SECTOR_NAMES.has(currentCompany))){
    card.hidden=true; return;
  }
  const Q=(window.COMPANY_QA||{})[currentCompany];
  if(!Q){ card.hidden=true; return; }
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function fmtCite(item){
    const d=String(item.date||'');
    if(d.length<6) return '';
    const yy=d.slice(0,2), mm=d.slice(2,4);
    const label=`(${item.broker||'?'}, ${mm}/${yy})`;
    if(item.url){
      return `<a class="thesis-cite" href="${esc(item.url)}" target="_blank" rel="noopener" title="${esc(item.broker||'')} · ${esc(d)}">${esc(label)}</a>`;
    }
    return `<span class="thesis-cite">${esc(label)}</span>`;
  }
  const sections=[['bull','Bull case'],['bear','Bear case'],['debates','Key debates']];
  let total=0, html='';
  sections.forEach(([key,label])=>{
    const items=Array.isArray(Q[key])?Q[key]:[];
    if(!items.length) return;
    total+=items.length;
    html+=`<div class="qa-sec"><h4 class="qa-sec-h ${key}">${esc(label)}</h4>`;
    html+=items.map(it=>{
      const q=esc(it.q||'');
      const a=esc(it.a||'').replace(/\s*$/,'');
      const cite=it.a?fmtCite(it):'';
      return `<details class="qa-item"><summary>${q}</summary><div class="qa-a">${a||'<span class="empty">No grounded answer yet.</span>'} ${cite}</div></details>`;
    }).join('');
    html+='</div>';
  });
  if(!total){ card.hidden=true; return; }
  card.hidden=false;
  body.innerHTML=html;
  if(sub){
    sub.textContent=`${total} question${total===1?'':'s'} · answers grounded in this company's broker library · click to expand`;
  }
}
```

- [ ] **Step 3: Call it from the select handler**

There are two places that fan out the per-company renders. Find the line (~6524):
```js
  if (name) { updateCoDesc(); renderCompanyResearch(); renderCompanyNews(name); renderCompanyThesis(); renderCompanyDrivers(); renderCompanyHouseViews(); renderCompanyConflicts(); renderCompanyFinancials(); }
```
Add `renderCompanyQA();` right after `renderCompanyDrivers();`:
```js
  if (name) { updateCoDesc(); renderCompanyResearch(); renderCompanyNews(name); renderCompanyThesis(); renderCompanyDrivers(); renderCompanyQA(); renderCompanyHouseViews(); renderCompanyConflicts(); renderCompanyFinancials(); }
```

Then find the block at line ~6462 that lists the render calls guarded by
`typeof`:
```js
  if(typeof renderCompanyThesis==='function') renderCompanyThesis();
  if(typeof renderCompanyDrivers==='function') renderCompanyDrivers();
  if(typeof renderCompanyHouseViews==='function') renderCompanyHouseViews();
```
Insert this line immediately after the `renderCompanyDrivers` guard:
```js
  if(typeof renderCompanyQA==='function') renderCompanyQA();
```

- [ ] **Step 4: Verify all three wirings are present**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
grep -c "renderCompanyQA" index.html
```
Expected: `6` — the identifier appears: once in the function definition
(`function renderCompanyQA(){`), once in the `if(name){…}` select-handler line,
and twice each in the two `if(typeof renderCompanyQA==='function') renderCompanyQA();`
lines (the loader block and the guard block) = 1 + 1 + 2 + 2 = 6.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Company Q&A: COMPANY_QA loader + renderCompanyQA() wired into select handler"
```

---

## Task 4: Verify the card renders in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the preview server**

Use the preview tool (`preview_start`) on the repo's `index.html` (the existing
"mam-hub" static preview). If using the bundled static server instead:
```bash
node "C:\Users\admin\.claude\static-server.cjs"
```
and open the served `index.html`.

- [ ] **Step 2: Select the example company**

In the preview: go to the **Company** tab, pick **Adani Power** in the Company
Selector. (Or via `preview_eval`, set the selector value to `Adani Power` and
dispatch its `change` event.)

- [ ] **Step 3: Confirm the card**

Via `preview_snapshot` / `preview_console_logs`, confirm:
- A **Key Questions** card appears (after the Bull & Bear Thesis card).
- Three sections render: **Bull case**, **Bear case**, **Key debates**.
- Each question is collapsed; clicking one (`preview_click` on a `summary`)
  expands the answer, and the bull item shows the `(Jeff, 06/26)` citation.
- No console errors.

- [ ] **Step 4: Confirm it hides for a no-data company**

Select a company **not** in `company_qa.json` (e.g. "Asian Paints"). Confirm the
Key Questions card is hidden (`#cQACard` has `hidden`).

- [ ] **Step 5: Screenshot proof**

Capture `preview_screenshot` of the rendered card for the record. No commit
(verification only).

---

## Task 5: Questioner agent prompt

**Files:**
- Create: `docs/company-qa-questioner-prompt.md`

- [ ] **Step 1: Write the prompt**

```markdown
# Company Q&A — Questioner Agent

You generate per-company **questions** for the India Research Portal "Key
Questions" card. You do NOT answer them — a separate answerer agent does that.

## What to do

1. Read `data/company_questions.json` if it exists (it holds prior questions and
   any user-pinned ones). Read the company → notebook map: prefer the
   `NOTEBOOKS` array in `index.html` (entries whose `url` contains a
   `notebook/<id>`), falling back to `C:\Users\admin\nlm_notebooks.csv`
   (columns: company, notebook_id). Only companies **with a notebook id** are in
   scope.
2. For each in-scope company, unless it already has a full, non-empty set of
   questions where ALL items are `"pinned": true`:
   - Run `nlm notebook describe <notebook_id>` (via Bash) to see what the
     company's broker sources actually cover. If it errors/auth-fails, skip that
     company (leave any existing entry untouched).
   - Generate company-specific questions tailored to that company's real
     drivers and risks (not generic): **~3 bull-case**, **~3 bear-case**, **~2
     key-debate** questions. Bull = upside drivers / what moves the stock up.
     Bear = downside risks / what could break the thesis. Key debates = open
     questions / what to watch.
   - **Preserve edits:** never modify or drop an existing item with
     `"pinned": true`. Only (re)generate the non-pinned items. If a company has
     some pinned items, keep them and top up the rest to the target counts.
3. Write `data/company_questions.json` with this exact shape:

   {
     "asOf": "<today YYYY-MM-DD>",
     "companies": {
       "<Company Name>": {
         "notebookId": "<id>",
         "bull":    [ { "q": "...", "pinned": false } ],
         "bear":    [ { "q": "...", "pinned": false } ],
         "debates": [ { "q": "...", "pinned": false } ]
       }
     }
   }

   - Company names MUST match the `NOTEBOOKS` map names exactly (so the page can
     key on them).
   - Keep every previously-present company in the file (do not drop names).

## Rules

- Output ONLY the file write. Do NOT run git. Do NOT answer questions.
- Do NOT invent a notebook id. A company with no id is out of scope.
- Questions are short (one sentence), specific, and answerable from broker
  research. No yes/no trivia; favour "what / why / how much / which" framings.
- If you can do nothing (no auth, no map), leave the file unchanged and stop.
```

- [ ] **Step 2: Verify the file exists**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
test -f docs/company-qa-questioner-prompt.md && echo ok
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add docs/company-qa-questioner-prompt.md
git commit -m "Company Q&A: questioner agent prompt"
```

---

## Task 6: Answerer agent prompt

**Files:**
- Create: `docs/company-qa-answerer-prompt.md`

- [ ] **Step 1: Write the prompt**

```markdown
# Company Q&A — Answerer Agent

You answer the questions produced by the questioner, grounded ONLY in each
company's NotebookLM broker-report sources, and write the rendered Q&A file.

## What to do

1. Read `data/company_questions.json` (the questions) and `data/company_qa.json`
   (prior answers, if any).
2. Determine the current fortnight window: "H2" if today's day-of-month >= 17,
   else "H1". A company is **fresh** if its `asOf` in `data/company_qa.json`
   falls in the current window of the current month. Process companies in
   stable alphabetical order, and **skip companies that are already fresh** —
   this makes the run resumable across days within a window.
3. For each not-fresh company that has questions:
   - For each question, run (via Bash):
     `nlm notebook query <notebookId> "<question>" --json --timeout 90`
   - The result is JSON. On `{"status":"error",...}` (e.g. auth expired): STOP
     the whole run immediately (do not corrupt the file) and report the error.
   - On success, read the answer text from the JSON (probe the fields present —
     e.g. `answer` / `response` / `text`). **Evaluate and synthesize** it into a
     concise 1–3 sentence answer in your own words (do not paste raw markdown or
     source dumps).
   - **Citation (best-effort):** if the JSON exposes which source(s) were cited,
     map the cited source title to a broker + date using the filename pattern
     `[YYMMDD] [House] Folder - Thesis.pdf` → `broker` (House), `date` (YYMMDD).
     Use the broker abbreviations in `CLAUDE.md`. If no clean source is
     identifiable, set `broker:"" , date:"", url:""` — DO NOT fabricate a cite.
   - Write that company's entry into `data/company_qa.json` immediately (so
     partial progress persists), stamping the company's `asOf` to today.
4. After each company, check elapsed time; if you are near a 20-minute budget,
   stop cleanly — the next run resumes with the remaining companies.
5. Set the top-level `asOf` to today.

## Output shape (`data/company_qa.json`)

   {
     "asOf": "<today YYYY-MM-DD>",
     "companies": {
       "<Company Name>": {
         "asOf": "<today YYYY-MM-DD>",
         "bull":    [ { "q": "...", "a": "...", "broker": "Jeff", "date": "260604", "url": "" } ],
         "bear":    [ { "q": "...", "a": "...", "broker": "", "date": "", "url": "" } ],
         "debates": [ { "q": "...", "a": "...", "broker": "", "date": "", "url": "" } ]
       }
     }
   }

## Rules

- Output ONLY file writes. Do NOT run git. The local wrapper commits + pushes.
- Keep companies you did not touch this run unchanged in the file.
- Never fabricate an answer: if a query returns nothing usable, set
  `a: ""` for that item (the page shows "No grounded answer yet.").
- Company names and the three array keys (`bull`/`bear`/`debates`) MUST match
  the questions file and the front-end exactly.
```

- [ ] **Step 2: Verify the file exists**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
test -f docs/company-qa-answerer-prompt.md && echo ok
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add docs/company-qa-answerer-prompt.md
git commit -m "Company Q&A: answerer agent prompt"
```

---

## Task 7: build-company-qa.ps1 (gated two-pass miner)

**Files:**
- Create: `scripts/build-company-qa.ps1`

- [ ] **Step 1: Write the script**

Modeled on `scripts/build-positioning.ps1` (gating, snapshot/validate/revert,
always exit 0), but runs **two** headless passes (questioner then answerer).

```powershell
# Company Q&A build step (invoked by daily-refresh.ps1).
#
# Two headless-Claude passes against the company NotebookLM library:
#   1. Questioner (docs/company-qa-questioner-prompt.md) -> data/company_questions.json
#   2. Answerer   (docs/company-qa-answerer-prompt.md)   -> data/company_qa.json
# Grounding is NotebookLM-only (nlm CLI, profile 'work'). No web, no keys.
#
# Gated twice-monthly (H1 on/after the 2nd, H2 on/after the 17th) via
# scripts/.company-qa-state.json, like build-positioning.ps1. The answerer is
# resumable (skips companies already fresh in the window), so the watermark is
# advanced only after a window's pass completes without timing out; a timed-out
# partial run leaves the watermark UNset so the next daily run keeps going.
# Per-file validation; revert a malformed file individually. ALWAYS exits 0.
#
# Manual run:  powershell -ExecutionPolicy Bypass -File scripts\build-company-qa.ps1

$ErrorActionPreference = "Continue"

$repo        = "C:\Users\admin\India-Research-Portal"
$node        = "C:\Program Files\nodejs\node.exe"
$qPrompt     = Join-Path $repo "docs\company-qa-questioner-prompt.md"
$aPrompt     = Join-Path $repo "docs\company-qa-answerer-prompt.md"
$stateFile   = Join-Path $repo "scripts\.company-qa-state.json"
$claude      = "C:\Users\admin\.local\bin\claude.exe"
$model       = "sonnet"
$timeoutSec  = 1200

function Out-Log([string]$m){ Write-Output ("[build-company-qa] " + $m) }

# file -> node validation expression (throws on malformed result)
$validators = [ordered]@{
  "data/company_questions.json" = 'const d=require("./data/company_questions.json"); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["bull","bear","debates"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(!it.q) throw 0});});});'
  "data/company_qa.json"        = 'const d=require("./data/company_qa.json"); if(!d.companies) throw 0; Object.values(d.companies).forEach(c=>{["bull","bear","debates"].forEach(k=>{if(!Array.isArray(c[k])) throw 0; c[k].forEach(it=>{if(typeof it.q!=="string"||typeof it.a!=="string") throw 0});});});'
}
$files = @($validators.Keys)

# --- locate claude -----------------------------------------------------------
if (-not (Test-Path -LiteralPath $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source } else { Out-Log "claude CLI not found - skipping."; exit 0 }
}
if (-not (Test-Path -LiteralPath $qPrompt) -or -not (Test-Path -LiteralPath $aPrompt)) {
  Out-Log "prompt file(s) missing - skipping."; exit 0
}

# --- gate: fortnightly window ------------------------------------------------
$now = Get-Date
$ym  = $now.ToString("yyyy-MM")
$window = if ($now.Day -ge 17) { "$ym-H2" } elseif ($now.Day -ge 2) { "$ym-H1" } else { $null }
if (-not $window) { Out-Log "1st of month - too early; skipping."; exit 0 }
$lastWindow = ""
if (Test-Path -LiteralPath $stateFile) {
  try { $lastWindow = (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).lastWindow } catch { $lastWindow = "" }
}
if ($window -eq $lastWindow) { Out-Log "window $window already done - skipping."; exit 0 }
Out-Log "window $window not yet done - running miner..."

Set-Location $repo

# --- snapshot for per-file revert --------------------------------------------
$pre = @{}
foreach ($f in $files) {
  $p = Join-Path $repo $f
  $pre[$f] = if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" }
}

# --- helper: run one headless pass with a timeout; returns $true if it finished
function Invoke-Pass([string]$promptPath, [string]$label) {
  $prompt = (Get-Content -LiteralPath $promptPath -Raw) +
    "`n`nWRAPPER OVERRIDE: Do NOT run git commit/push and do NOT branch. Only create/update the data file(s), then stop. The local wrapper commits + pushes."
  $job = Start-Job -ScriptBlock {
    param($claude,$prompt,$repo,$model)
    Set-Location $repo
    & $claude -p $prompt `
        --permission-mode bypassPermissions `
        --allowedTools Bash Read Write Edit `
        --model $model 2>&1
  } -ArgumentList $claude,$prompt,$repo,$model
  if (Wait-Job $job -Timeout $script:timeoutSec) {
    $out = Receive-Job $job
    if ($out) { $out | ForEach-Object { Out-Log ("$label> " + ($_ | Out-String).TrimEnd()) } }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    return $true
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Out-Log "$label pass timed out."
    return $false
  }
}

# --- pass 1: questioner ------------------------------------------------------
$qDone = Invoke-Pass $qPrompt "questioner"

# --- pass 2: answerer (resumable; runs even if questioner partial) -----------
$aDone = Invoke-Pass $aPrompt "answerer"

# --- per-file validate; revert only the bad ones -----------------------------
$changed = 0
foreach ($f in $files) {
  $p = Join-Path $repo $f
  $post = if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash } else { "" }
  if ($post -eq $pre[$f]) { continue }
  & $node -e $validators[$f] 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Out-Log "VALIDATION FAILED: $f - reverting just this file."
    & git checkout -- $f 2>&1 | Out-Null
  } else {
    Out-Log "$f updated + validated."
    $changed++
  }
}

# --- advance watermark only if BOTH passes completed (not timed out) ----------
# A timed-out answerer is resumable: leaving the watermark unset lets the next
# daily run continue the remaining companies within the same window.
if ($qDone -and $aDone) {
  @{ lastWindow = $window; asOf = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  Out-Log "window $window complete - watermark advanced."
} else {
  Out-Log "a pass timed out - watermark NOT advanced (will resume next run)."
}
Out-Log ("done - $changed file(s) updated this run.")
exit 0
```

- [ ] **Step 2: Verify PowerShell parses the script (no execution)**

Run (PowerShell):
```powershell
$ErrorActionPreference='Stop'
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw 'C:\Users\admin\India-Research-Portal\scripts\build-company-qa.ps1'), [ref]$null)
'parse ok'
```
Expected: `parse ok` (no parse errors).

- [ ] **Step 3: Verify the gate skips correctly (state-file watermark)**

Run (PowerShell) — simulate "already done this window" and confirm it exits early:
```powershell
$repo='C:\Users\admin\India-Research-Portal'
$state=Join-Path $repo 'scripts\.company-qa-state.json'
$now=Get-Date
$ym=$now.ToString('yyyy-MM')
$w= if($now.Day -ge 17){"$ym-H2"} elseif($now.Day -ge 2){"$ym-H1"} else {$null}
if($w){ @{lastWindow=$w} | ConvertTo-Json | Set-Content $state -Encoding utf8
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\build-company-qa.ps1')
  Remove-Item $state -Force }
else { 'before the 2nd - gate would skip as too early' }
```
Expected: log line `window <...> already done - skipping.` (and the temp state
file is removed). This confirms gating without invoking the miner.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-company-qa.ps1
git commit -m "Company Q&A: gated two-pass miner (questioner + answerer)"
```

---

## Task 8: Wire into daily-refresh.ps1

**Files:**
- Modify: `scripts/daily-refresh.ps1` (add a step after `build-positioning`, ~line 137; extend the git stage list, ~line 141)

- [ ] **Step 1: Add the build step**

Find the `build-positioning` step block (ends at line ~137, the closing `}`
before the `# 9. Commit + push` comment). Insert this step immediately after it:

```powershell
# 8d. Refresh the Company-tab Key Questions Q&A (data/company_qa.json +
#     data/company_questions.json) via the two-pass questioner+answerer miner.
#     Gated twice-monthly (2nd & 17th); resumable; NotebookLM-grounded.
#     Per-file validate + selective revert. Always exits 0.
Step "build-company-qa" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-company-qa.ps1"
}
```

- [ ] **Step 2: Extend the git stage list**

Find the `git stage` step (line ~141) and add the two new data files to the
`git add` list (append before `index.html`):

```powershell
  & git add data/pdfdata.json data/pdfmap.json data/theses.json data/theses-manual.json data/financials.json data/financials-manual.json data/model_portfolios_house.json data/mf_sectors.json data/fii_dii.json data/highs.json data/fpi_sectors.json data/mf_categories.json data/sip_flows.json data/model_portfolios.json data/company_qa.json data/company_questions.json index.html scripts/notes-recent.txt scripts/notes-prior.txt
```

- [ ] **Step 3: Verify the wiring**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
grep -n 'build-company-qa' scripts/daily-refresh.ps1 && grep -c 'data/company_qa.json' scripts/daily-refresh.ps1
```
Expected: the step line is found, and `data/company_qa.json` appears `1` time
(in the git add list).

- [ ] **Step 4: Commit**

```bash
git add scripts/daily-refresh.ps1
git commit -m "Company Q&A: wire build-company-qa step into daily-refresh"
```

---

## Task 9: Live end-to-end dry run (one company)

**Files:** none (produces `data/company_qa.json` / `data/company_questions.json` content)

> **Requires NotebookLM auth** (see Prerequisites). If `nlm` is not
> authenticated, run `nlm login --profile work` first.

- [ ] **Step 1: Confirm auth is live**

Run:
```bash
/c/Users/admin/.local/bin/nlm.exe notebook query 2052a512-3b1a-4dd6-8ff4-f31a1250dbb3 "What is the biggest downside risk?" --json --timeout 90
```
Expected: JSON **without** `"status":"error"`. If it shows auth expired, run
`nlm login --profile work` (interactive) and retry.

- [ ] **Step 2: Run the questioner pass manually on one company**

Temporarily confirm the prompt works by running the questioner headless against
just Adani Power (do not push):
```bash
cd /c/Users/admin/India-Research-Portal
"C:/Users/admin/.local/bin/claude.exe" -p "$(cat docs/company-qa-questioner-prompt.md)

SCOPE OVERRIDE: Only process the single company 'Adani Power'. Do NOT run git." --permission-mode bypassPermissions --allowedTools Bash Read Write Edit --model sonnet
```
Then verify the questions file validated:
```bash
node -e 'const d=require("./data/company_questions.json"); const c=d.companies["Adani Power"]; if(!c||!c.bull.length||!c.bear.length) throw "bad"; console.log("questions ok:", c.bull.length, c.bear.length, c.debates.length)'
```
Expected: `questions ok: <n> <n> <n>` with non-zero counts.

- [ ] **Step 3: Run the answerer pass manually on one company**

```bash
cd /c/Users/admin/India-Research-Portal
"C:/Users/admin/.local/bin/claude.exe" -p "$(cat docs/company-qa-answerer-prompt.md)

SCOPE OVERRIDE: Only process the single company 'Adani Power'. Ignore the freshness skip for this run. Do NOT run git." --permission-mode bypassPermissions --allowedTools Bash Read Write Edit --model sonnet
```
Then validate:
```bash
node -e 'const d=require("./data/company_qa.json"); const c=d.companies["Adani Power"]; const all=[...c.bull,...c.bear,...c.debates]; if(!all.length||all.some(x=>typeof x.a!=="string")) throw "bad"; console.log("answers ok:", all.length, "answered:", all.filter(x=>x.a).length)'
```
Expected: `answers ok: <n> answered: <m>` — real grounded answers present.

- [ ] **Step 4: Re-verify in the browser**

Restart/reload the preview (Task 4) and confirm Adani Power's Key Questions card
now shows the freshly-generated, grounded answers (with citations where the
answerer found a clean source). Screenshot for proof.

- [ ] **Step 5: Commit the generated data**

```bash
git add data/company_qa.json data/company_questions.json
git commit -m "Company Q&A: first live generation (Adani Power)"
```

---

## Task 10: Document + memory

**Files:**
- Modify: `CLAUDE.md`
- Update user memory (Company Q&A card + miner)

- [ ] **Step 1: Add a CLAUDE.md section**

Add this section to `CLAUDE.md` after the "ATH + 52-week-high card" section:

```markdown
## Company tab — Key Questions Q&A
- New `#cQACard` on the Company tab (after the Bull & Bear Thesis card). Three
  collapsible sections — **Bull case / Bear case / Key debates** — of
  per-company questions with grounded, cited answers. Rendered by
  `renderCompanyQA()` from `window.COMPANY_QA` (the `companies` map of
  `data/company_qa.json`); same loader shape as `THESES`. Hidden for sectors and
  companies with no entry; only the ~78 notebook-backed names get Q&A.
- **Two agents, one local miner:** `scripts/build-company-qa.ps1` runs a
  **questioner** (`docs/company-qa-questioner-prompt.md` → `data/company_questions.json`,
  hand-editable; `"pinned":true` items are preserved) then an **answerer**
  (`docs/company-qa-answerer-prompt.md` → `data/company_qa.json`) that queries
  each company's NotebookLM notebook via `nlm notebook query --json` and
  evaluates the grounded result. Citations are best-effort (parsed from the
  source filename pattern); omitted if no clean source.
- Gated twice-monthly (2nd & 17th) via `scripts/.company-qa-state.json`;
  **resumable** (answerer skips companies already fresh in the window, so a
  timed-out run continues next day). Wired as the `build-company-qa` step in
  `daily-refresh.ps1`, which commits + pushes. NotebookLM-only grounding, no web,
  no keys. Requires the `nlm` `work` profile to be authenticated.
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /c/Users/admin/India-Research-Portal
grep -n "Company tab — Key Questions Q&A" CLAUDE.md
```
Expected: one match.

- [ ] **Step 3: Update user memory**

Append a memory file at
`C:\Users\admin\.claude\projects\C--Users-admin\memory\company_qa_card.md`
(type `project`) describing the card + two-agent miner + twice-monthly gate +
nlm-auth dependency, and add a one-line pointer to `MEMORY.md`. Link
`[[notebooklm-research-portal]]` and `[[feedback-routine-versioning]]`.

- [ ] **Step 4: Commit + push**

```bash
git add CLAUDE.md
git commit -m "Company Q&A: document the card + miner in CLAUDE.md"
git push origin main
```

---

## Self-Review notes

- **Spec coverage:** card + 3 sections (T2/T3), questioner agent (T5), answerer
  agent (T6), two-pass gated resumable miner (T7), daily-refresh wiring (T8),
  data contracts (T1/T5/T6 schemas match), front-end loader/render (T3),
  citations best-effort + omit-if-unclear (T6), validation/revert (T7), docs
  (T10). NotebookLM-only grounding, no keys, twice-monthly gate — all covered.
- **Edit preservation** (`pinned`) is in T5 + validator allows it.
- **Resumability** (freshness skip + watermark-only-on-complete) in T6 + T7.
- **Naming consistency:** `renderCompanyQA`, `window.COMPANY_QA` (assigned the
  `.companies` map), `#cQACard`/`#cQABody`/`#cQASub`, keys `bull`/`bear`/`debates`,
  cite fields `broker`/`date`(YYMMDD)/`url` — consistent across T1, T3, T5, T6.
- **No test runner** in this repo; verification uses Node validators, grep, and
  the preview server, which is honest for a static single-file site.
```
