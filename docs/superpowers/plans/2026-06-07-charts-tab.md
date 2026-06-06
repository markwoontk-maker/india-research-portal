# Charts Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Charts tab to the India research portal that displays every visual exhibit extracted from the pilot folders' broker PDFs as a filterable card gallery with two-level company/sector tags, verbatim analyst captions, and agent commentary.

**Architecture:** A three-phase pipeline — (A) a Python/pymupdf script renders pilot PDF pages to PNGs, (B) vision subagents locate every exhibit per page and return structured JSON, (C) a Python script clip-crops each bbox to a PNG and writes `data/charts.json`. The dashboard's single `index.html` gains a lazy-loaded `#viewCharts` tab that renders the manifest as cards.

**Tech Stack:** Python 3.12 + PyMuPDF (run via `uv`, no system install), vanilla JS/CSS inside `index.html`, Chart.js already present (not needed here), GitHub Pages static hosting.

**Conventions used throughout:**
- Repo root: `C:\Users\admin\India-Research-Portal` (all commands run from here).
- Python runner: `uv run --python 3.12 --with pymupdf [--with pytest] python <script>` — `uv` is at `C:\Users\admin\.local\bin\uv`. **Never** `pip install` (system pip is denied; Python 3.14 lacks a pymupdf wheel, hence pinning 3.12).
- Work on branch `charts-tab` (already created; the design spec is committed there).
- Pilot folders: `India Macro`, `India Strategy`, `Indian Financials`, `Indian Autos`, `Indian Consumer` under `C:\Users\admin\Desktop\India Related Reports`.

---

## File Structure

**Create:**
- `scripts/charts/lib.py` — pure helpers (filename parse, slug, bbox math, tag resolution). Testable, no I/O of PDFs.
- `scripts/charts/test_lib.py` — pytest unit tests for `lib.py`.
- `scripts/charts/render_pages.py` — Phase A: scan pilot folders, render pages → PNGs + `index.json`.
- `scripts/charts/crop_assemble.py` — Phase C: read analyses, clip-crop exhibits, write `data/charts.json`.
- `scripts/charts/analysis_prompt.md` — the Phase B subagent prompt template.
- `scripts/charts/run.ps1` — driver: runs Phase A, prints the Phase B instructions, runs Phase C.
- `data/charts.json` — output manifest (generated).
- `charts/<Folder_slug>/*.webp` — generated cropped exhibit images (capped-width WebP).
- `scripts/.charts-work/` — scratch: rendered pages + per-PDF `analysis.json` (git-ignored).

**Modify:**
- `index.html` — nav item, `#viewCharts` container, CSS, `loadCharts()` + render/filter/lightbox JS, `showView` wiring.
- `.gitignore` — ignore `scripts/.charts-work/`.

**Data contracts (locked here):**
- Phase A → `scripts/.charts-work/index.json`:
  ```json
  {"pdfs":[{"key":"House|YYMMDD|Folder|slug","slug":"House_YYMMDD_titleslug",
    "folder":"India Macro","house":"Jefferies","date":"2026-06-03",
    "report_title":"...","path":"C:\\...pdf",
    "pages":[{"page":1,"png":"...p01.png","w_pt":612.0,"h_pt":792.0}]}]}
  ```
- Phase B → `scripts/.charts-work/<slug>/analysis.json`:
  ```json
  {"pages":[{"page":1,"charts":[{
    "bbox":[0.1,0.2,0.9,0.6],"chart_title":"India CPI vs repo",
    "chart_type":"line","subject_company":null,
    "subject_sectors":["Macro"],"analyst_caption":"Source: CMIE, ...",
    "commentary":"..." }]}]}
  ```
- Phase C → `data/charts.json` (shape per design spec §5).

---

### Task 1: Pure helpers (`lib.py`) with TDD

**Files:**
- Create: `scripts/charts/lib.py`
- Test: `scripts/charts/test_lib.py`

- [ ] **Step 1: Write the failing tests**

```python
# scripts/charts/test_lib.py
import json
from pathlib import Path
import lib

def test_parse_report_filename_basic():
    r = lib.parse_report_filename("[260603] [Jefferies] Adani - Day 1.pdf")
    assert r == {"yymmdd":"260603","date":"2026-06-03","house":"Jefferies","title":"Adani - Day 1"}

def test_parse_report_filename_brackets_in_house():
    r = lib.parse_report_filename("[260518] [MorganStanley] X - Y.pdf")
    assert r["house"] == "MorganStanley" and r["date"] == "2026-05-18"

def test_parse_report_filename_rejects_junk():
    assert lib.parse_report_filename("notes.pdf") is None

def test_fs_slug_strips_illegal_chars():
    s = lib.fs_slug("Jefferies", "260603", "What's changed: a|b#c")
    assert "|" not in s and "#" not in s and "'" not in s and " " not in s
    assert s.startswith("Jefferies_260603_")

def test_pad_bbox_clamps():
    assert lib.pad_bbox([0.0, 0.0, 1.0, 1.0], 0.02) == [0.0, 0.0, 1.0, 1.0]
    out = lib.pad_bbox([0.5, 0.5, 0.6, 0.6], 0.1)
    assert out == [0.4, 0.4, 0.7, 0.7]

def test_norm_to_points():
    assert lib.norm_to_points([0.0,0.0,0.5,0.5], 600, 800) == [0.0,0.0,300.0,400.0]

def test_source_type():
    assert lib.source_type("India Macro") == "theme"
    assert lib.source_type("Indian Financials") == "sector"
    assert lib.source_type("Bajaj Finance") == "company"

def test_company_sector(tmp_path):
    p = tmp_path / "companies.json"
    p.write_text(json.dumps({"Bajaj Finance":{"ticker":"X","sector":"NBFC","desc":"d"}}), encoding="utf-8")
    assert lib.company_sector("Bajaj Finance", str(p)) == "NBFC"
    assert lib.company_sector("Nonexistent", str(p)) is None
    assert lib.company_sector(None, str(p)) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --python 3.12 --with pytest python -m pytest scripts/charts/test_lib.py -v`
(run from `scripts/charts` so `import lib` resolves: `cd scripts/charts; uv run --python 3.12 --with pytest python -m pytest test_lib.py -v`)
Expected: FAIL — `ModuleNotFoundError: No module named 'lib'`.

- [ ] **Step 3: Write `lib.py`**

```python
# scripts/charts/lib.py
"""Pure helpers for the Charts pipeline. No PDF I/O here (keep testable)."""
import json
import re
import unicodedata
from pathlib import Path

PILOT_FOLDERS = ["India Macro", "India Strategy", "Indian Financials",
                 "Indian Autos", "Indian Consumer"]
REPORTS_ROOT = Path(r"C:\Users\admin\Desktop\India Related Reports")

_FNAME_RE = re.compile(r'^\[(\d{6})\]\s*\[([^\]]+)\]\s*(.+)\.pdf$', re.IGNORECASE)

def parse_report_filename(name):
    """'[YYMMDD] [House] Title.pdf' -> dict, or None if it doesn't match."""
    m = _FNAME_RE.match(name)
    if not m:
        return None
    yymmdd, house, title = m.group(1), m.group(2).strip(), m.group(3).strip()
    date = f"20{yymmdd[:2]}-{yymmdd[2:4]}-{yymmdd[4:6]}"
    return {"yymmdd": yymmdd, "date": date, "house": house, "title": title}

def fs_slug(*parts):
    """Filesystem-safe slug ('|', '#', spaces, quotes -> '_'). Max 120 chars."""
    s = "_".join(p for p in parts if p)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')
    return s[:120]

def pad_bbox(b, pad=0.02):
    """Expand a normalized bbox by `pad`, clamped to [0,1]."""
    x0, y0, x1, y1 = b
    return [max(0.0, x0 - pad), max(0.0, y0 - pad),
            min(1.0, x1 + pad), min(1.0, y1 + pad)]

def norm_to_points(b, w_pt, h_pt):
    """Normalized bbox -> PDF-point coords for a page of size (w_pt,h_pt)."""
    x0, y0, x1, y1 = b
    return [x0 * w_pt, y0 * h_pt, x1 * w_pt, y1 * h_pt]

def source_type(folder):
    if folder.startswith("India "):
        return "theme"
    if folder.startswith("Indian "):
        return "sector"
    return "company"

_companies_cache = {}
def company_sector(name, companies_path):
    """Look up a company's sector from companies.json; None if unknown."""
    if not name:
        return None
    data = _companies_cache.get(companies_path)
    if data is None:
        data = json.loads(Path(companies_path).read_text(encoding="utf-8"))
        _companies_cache[companies_path] = data
    rec = data.get(name)
    return rec.get("sector") if rec else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scripts/charts; uv run --python 3.12 --with pytest python -m pytest test_lib.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/charts/lib.py scripts/charts/test_lib.py
git commit -m "feat(charts): pure helpers for the charts pipeline with tests"
```

---

### Task 2: Phase A renderer (`render_pages.py`)

**Files:**
- Create: `scripts/charts/render_pages.py`
- Modify: `.gitignore`

- [ ] **Step 1: Ignore the scratch dir**

Append to `.gitignore`:
```
# Charts pipeline scratch (rendered pages + per-PDF analyses)
scripts/.charts-work/
```

- [ ] **Step 2: Write `render_pages.py`**

```python
# scripts/charts/render_pages.py
"""Phase A: render every page of each pilot-folder PDF to a PNG and emit index.json."""
import json
from pathlib import Path
import fitz  # PyMuPDF
from lib import PILOT_FOLDERS, REPORTS_ROOT, parse_report_filename, fs_slug

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "scripts" / ".charts-work"
DPI = 180

def main():
    WORK.mkdir(parents=True, exist_ok=True)
    pdfs = []
    for folder in PILOT_FOLDERS:
        d = REPORTS_ROOT / folder
        if not d.is_dir():
            print("MISSING FOLDER:", folder)
            continue
        for pdf in sorted(d.glob("*.pdf")):
            meta = parse_report_filename(pdf.name)
            if not meta:
                print("SKIP (unparseable):", pdf.name)
                continue
            slug = fs_slug(meta["house"], meta["yymmdd"], meta["title"])
            outdir = WORK / slug
            outdir.mkdir(parents=True, exist_ok=True)
            try:
                doc = fitz.open(pdf)
            except Exception as e:
                print("SKIP (open failed):", pdf.name, e)
                continue
            pages = []
            for i, page in enumerate(doc, start=1):
                png = outdir / f"p{i:02d}.png"
                page.get_pixmap(dpi=DPI).save(png)
                pages.append({"page": i, "png": str(png),
                              "w_pt": page.rect.width, "h_pt": page.rect.height})
            doc.close()
            pdfs.append({
                "key": f'{meta["house"]}|{meta["yymmdd"]}|{folder}|{slug}',
                "slug": slug, "folder": folder, "house": meta["house"],
                "date": meta["date"], "report_title": meta["title"],
                "path": str(pdf), "pages": pages,
            })
            print(f"rendered {slug}: {len(pages)} pages")
    (WORK / "index.json").write_text(json.dumps({"pdfs": pdfs}, indent=2), encoding="utf-8")
    print(f"TOTAL PDFs: {len(pdfs)}, pages: {sum(len(p['pages']) for p in pdfs)}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it**

Run: `cd scripts/charts; uv run --python 3.12 --with pymupdf python render_pages.py`
Expected: prints a `rendered …` line per PDF and a `TOTAL PDFs: ~82` summary; creates `scripts/.charts-work/index.json` and per-PDF page PNGs.

- [ ] **Step 4: Verify output**

Run: `cd ../..; uv run --python 3.12 python -c "import json,os; d=json.load(open('scripts/.charts-work/index.json',encoding='utf-8')); print('pdfs',len(d['pdfs'])); p=d['pdfs'][0]; print(p['slug'], len(p['pages']), 'pages; first png exists:', os.path.exists(p['pages'][0]['png']))"`
Expected: `pdfs` > 0 and `first png exists: True`. Open one PNG visually with the Read tool to confirm pages rendered legibly.

- [ ] **Step 5: Commit** (code only — scratch is git-ignored)

```bash
git add scripts/charts/render_pages.py .gitignore
git commit -m "feat(charts): Phase A page renderer (uv+pymupdf)"
```

---

### Task 3: Phase B analysis contract — prompt + schema

This task produces the prompt and the structured-output schema the orchestrator uses when dispatching one vision subagent per PDF. No app code runs here; it locks the contract that Phase C consumes.

**Files:**
- Create: `scripts/charts/analysis_prompt.md`

- [ ] **Step 1: Write the prompt template**

```markdown
<!-- scripts/charts/analysis_prompt.md -->
You are extracting every VISUAL EXHIBIT from one broker research report.

Report context:
- Source folder / theme: {{FOLDER}}
- Broker: {{HOUSE}}   Date: {{DATE}}   Title: {{TITLE}}
- Broker call / target (if any): {{PDFDATA_SUMMARY}}

You are given the rendered page images of this report at these paths. Read EACH
image with the Read tool (one at a time), then return your findings.
Page images:
{{PAGE_LIST}}

For every visual exhibit on every page — line/bar/area/scatter graphs, valuation
bands, DATA TABLES, maps, and process/flow diagrams — emit one entry. Capture
EVERYTHING visual (tables, maps and diagrams included). Skip ONLY pure decoration:
house logos, analyst headshots, page headers/footers, and the disclaimer block.

For each exhibit provide:
- bbox: [x0,y0,x1,y1] as fractions 0..1 of the page (x right, y down), tight around
  the exhibit INCLUDING its title and any source/footnote line directly attached.
- chart_title: the exhibit's own heading/caption text (verbatim; "" if none).
- chart_type: one of line|bar|area|scatter|valuation_band|table|map|diagram|other.
- subject_company: the single specific listed company the exhibit is about, matching
  a name as it appears in the report, else null (most macro/strategy exhibits = null).
- subject_sectors: array of sectors/themes the exhibit depicts (e.g. ["Banks"],
  ["Macro"], ["Autos","2-wheelers"]); [] if none.
- analyst_caption: the report's OWN caption/footnote text for this exhibit, VERBATIM.
  null if the exhibit has none. Never invent or paraphrase.
- commentary: YOUR OWN 1-2 sentence read of what the exhibit shows and why it matters.

Return ONLY the structured object (the tool enforces the schema): {"pages":[{"page":N,
"charts":[ ...entries for that page... ]}, ...]}. Include a page entry only if it has
at least one exhibit.
```

- [ ] **Step 2: Record the structured-output schema (used at dispatch time)**

The orchestrator passes this JSON Schema as the Agent `schema` so responses are validated:

```json
{
  "type": "object",
  "required": ["pages"],
  "properties": {
    "pages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["page", "charts"],
        "properties": {
          "page": {"type": "integer"},
          "charts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["bbox","chart_title","chart_type","subject_company","subject_sectors","analyst_caption","commentary"],
              "properties": {
                "bbox": {"type":"array","items":{"type":"number"},"minItems":4,"maxItems":4},
                "chart_title": {"type":"string"},
                "chart_type": {"type":"string","enum":["line","bar","area","scatter","valuation_band","table","map","diagram","other"]},
                "subject_company": {"type":["string","null"]},
                "subject_sectors": {"type":"array","items":{"type":"string"}},
                "analyst_caption": {"type":["string","null"]},
                "commentary": {"type":"string"}
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/charts/analysis_prompt.md
git commit -m "feat(charts): Phase B analysis prompt + output schema"
```

---

### Task 4: Phase C crop + assemble (`crop_assemble.py`)

**Files:**
- Create: `scripts/charts/crop_assemble.py`

- [ ] **Step 1: Write `crop_assemble.py`**

```python
# scripts/charts/crop_assemble.py
"""Phase C: read per-PDF analyses, clip-crop each exhibit, write data/charts.json.

Crops are saved as capped-width WebP (q80) to keep the committed image set small
(~5-10x smaller than PNG). Run with: uv run --python 3.12 --with pymupdf --with pillow.
"""
import io
import json
from datetime import date
from pathlib import Path
import fitz  # PyMuPDF
from PIL import Image
from lib import pad_bbox, norm_to_points, source_type, company_sector, fs_slug

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "scripts" / ".charts-work"
CHARTS_DIR = ROOT / "charts"
COMPANIES = str(ROOT / "data" / "companies.json")
OUT = ROOT / "data" / "charts.json"
CROP_DPI = 200      # render the clip at 200 dpi, then downscale to MAX_W for storage
MAX_W = 1100        # cap stored image width (px); charts stay crisp, files stay small
WEBP_Q = 80         # WebP quality

def main():
    index = json.loads((WORK / "index.json").read_text(encoding="utf-8"))
    out = []
    for pdf in index["pdfs"]:
        ana_path = WORK / pdf["slug"] / "analysis.json"
        if not ana_path.exists():
            print("no analysis yet:", pdf["slug"])
            continue
        ana = json.loads(ana_path.read_text(encoding="utf-8"))
        page_charts = {p["page"]: p.get("charts", []) for p in ana.get("pages", [])}
        if not page_charts:
            continue
        doc = fitz.open(pdf["path"])
        page_dims = {p["page"]: (p["w_pt"], p["h_pt"]) for p in pdf["pages"]}
        folder_seg = fs_slug(pdf["folder"])  # web/FS-safe dir (no spaces)
        for pageno, charts in sorted(page_charts.items()):
            w_pt, h_pt = page_dims[pageno]
            page = doc[pageno - 1]
            for n, c in enumerate(charts, start=1):
                rect = fitz.Rect(*norm_to_points(pad_bbox(c["bbox"]), w_pt, h_pt))
                img_name = f'{pdf["slug"]}_p{pageno:02d}_{n}.webp'
                (CHARTS_DIR / folder_seg).mkdir(parents=True, exist_ok=True)
                pix = page.get_pixmap(clip=rect, dpi=CROP_DPI)
                img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
                if img.width > MAX_W:
                    img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
                img.save(CHARTS_DIR / folder_seg / img_name, "WEBP", quality=WEBP_Q, method=6)
                subj = c.get("subject_company")
                out.append({
                    "id": f'{pdf["key"]}#p{pageno}_{n}',
                    "report_key": pdf["key"], "house": pdf["house"], "date": pdf["date"],
                    "source": pdf["folder"], "source_type": source_type(pdf["folder"]),
                    "report_title": pdf["report_title"], "page": pageno,
                    "image": f'charts/{folder_seg}/{img_name}',
                    "chart_title": c.get("chart_title") or "",
                    "chart_type": c.get("chart_type") or "other",
                    "subject_company": subj,
                    "subject_sectors": c.get("subject_sectors") or [],
                    "sector": company_sector(subj, COMPANIES),
                    "analyst_caption": c.get("analyst_caption"),
                    "commentary": c.get("commentary") or "",
                })
        doc.close()
        print("assembled", pdf["slug"], sum(len(v) for v in page_charts.values()), "exhibits")
    out.sort(key=lambda r: (r["date"], r["source"], r["page"]))
    OUT.write_text(json.dumps({"updated": date.today().isoformat(), "charts": out},
                              indent=2, ensure_ascii=False), encoding="utf-8")
    print("TOTAL charts written:", len(out))

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test with a synthetic analysis (before real Phase B)**

Pick the first slug from `index.json`, write a one-exhibit `analysis.json` covering its page 1 full bleed, then run Phase C and confirm a PNG + manifest row appear.

```bash
uv run --python 3.12 python -c "import json,pathlib; d=json.load(open('scripts/.charts-work/index.json',encoding='utf-8')); s=d['pdfs'][0]['slug']; pathlib.Path('scripts/.charts-work',s,'analysis.json').write_text(json.dumps({'pages':[{'page':1,'charts':[{'bbox':[0.05,0.05,0.95,0.6],'chart_title':'SMOKE','chart_type':'other','subject_company':None,'subject_sectors':['Macro'],'analyst_caption':None,'commentary':'smoke test'}]}]}),encoding='utf-8'); print('seeded',s)"
cd scripts/charts; uv run --python 3.12 --with pymupdf --with pillow python crop_assemble.py; cd ../..
```
Expected: `TOTAL charts written: 1`; a `.webp` exists under `charts/<folder_slug>/`; `data/charts.json` has one row whose `image` path points to that file. Open the `.webp` with Read to confirm it's a valid crop. Then delete the synthetic `analysis.json` so the real run replaces it.

- [ ] **Step 3: Commit**

```bash
git add scripts/charts/crop_assemble.py
git commit -m "feat(charts): Phase C clip-crop + charts.json assembler"
```

---

### Task 5: Driver script (`run.ps1`)

**Files:**
- Create: `scripts/charts/run.ps1`

- [ ] **Step 1: Write the driver**

```powershell
# scripts/charts/run.ps1  — orchestrates the charts pipeline
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "== Phase A: render pages ==" -ForegroundColor Cyan
uv run --python 3.12 --with pymupdf python render_pages.py

Write-Host ""
Write-Host "== Phase B: vision analysis (run by Claude) ==" -ForegroundColor Yellow
Write-Host "For each PDF in .charts-work/index.json, dispatch a subagent with"
Write-Host "analysis_prompt.md (filled with that PDF's page PNG paths + context) and"
Write-Host "the Task 3 schema, then write its response to"
Write-Host ".charts-work/<slug>/analysis.json. Re-run this script (or just Phase C)"
Write-Host "once analyses exist."
if (-not (Test-Path ".charts-work")) { exit 0 }
$pending = (Get-ChildItem ".charts-work" -Directory | Where-Object {
    -not (Test-Path (Join-Path $_.FullName "analysis.json")) }).Count
Write-Host "PDFs still awaiting analysis.json: $pending"
if ($pending -gt 0) { Write-Host "Stopping before Phase C (analyses incomplete)."; exit 0 }

Write-Host ""
Write-Host "== Phase C: crop + assemble ==" -ForegroundColor Cyan
uv run --python 3.12 --with pymupdf --with pillow python crop_assemble.py
```

- [ ] **Step 2: Run it (Phase A + the gate)**

Run: `powershell -ExecutionPolicy Bypass -File scripts/charts/run.ps1`
Expected: Phase A renders, then it reports `PDFs still awaiting analysis.json: N` and stops before Phase C.

- [ ] **Step 3: Commit**

```bash
git add scripts/charts/run.ps1
git commit -m "feat(charts): pipeline driver (A -> gate -> C)"
```

---

### Task 6: UI — nav item, view container, CSS

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the nav item** after the Sector nav item (the `<div class="nav-item" data-view="sector" …>…</div>` block ends at the line before `data-view="watchlist"`). Insert:

```html
      <div class="nav-item" data-view="charts" data-title="Charts">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5M4 19h16M8 16l3-4 3 2 4-6"/></svg>
        Charts
      </div>
```

- [ ] **Step 2: Add the view container.** Locate the `#viewPositioning` container (`grep -n 'id="viewPositioning"' index.html`) and, immediately after its closing `</div>`, OR adjacent to the other top-level view containers (right before `<div id="viewSoon"`), insert:

```html
    <div id="viewCharts" hidden>
      <div class="card">
        <div class="card-h"><div>
          <h3>Charts</h3>
          <p class="ch-sub" id="galCount">Every chart, table and exhibit pulled from the research PDFs.</p>
        </div></div>
        <div class="gal-controls">
          <input id="galSearch" class="gal-search" type="search" placeholder="Search titles, companies, captions…" />
          <div id="galChips" class="gal-chips"></div>
        </div>
        <div id="galGrid" class="gal-grid"></div>
        <div id="galEmpty" class="gal-empty" hidden>No charts match these filters.</div>
      </div>
    </div>
    <div id="galLightbox" class="gal-lb" hidden><img id="galLbImg" alt="" /><div id="galLbCap" class="gal-lb-cap"></div></div>
```

- [ ] **Step 3: Add CSS.** After the `#viewPositioning[hidden]{display:none}` rule (around line 158), insert:

```css
  /* Charts gallery: grid layout, but [hidden] must still win (see Positioning note). */
  #viewCharts{display:block}
  #viewCharts[hidden]{display:none}
  .gal-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:4px 0 14px}
  .gal-search{flex:1;min-width:200px;background:var(--panel-2);border:1px solid var(--line);
    color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit}
  .gal-chips{display:flex;flex-wrap:wrap;gap:6px}
  .gal-chip{background:var(--panel-2);border:1px solid var(--line);color:var(--text-dim);
    font-size:11.5px;padding:4px 10px;border-radius:999px;cursor:pointer;transition:.12s;font-family:'Roboto Mono'}
  .gal-chip.on{background:var(--saffron);color:#1a1206;border-color:var(--saffron);font-weight:600}
  .gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .gal-card{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;
    overflow:hidden;display:flex;flex-direction:column}
  .gal-card img{width:100%;display:block;background:#fff;cursor:zoom-in;border-bottom:1px solid var(--line)}
  .gal-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  .gal-title{font-size:13px;font-weight:600;color:var(--text);line-height:1.3}
  .gal-tags{display:flex;flex-wrap:wrap;gap:5px}
  .gal-tag{font-size:10.5px;padding:2px 8px;border-radius:999px;font-family:'Roboto Mono';
    background:var(--panel);border:1px solid var(--line);color:var(--text-dim)}
  .gal-tag.src{border-color:var(--saffron);color:var(--saffron)}
  .gal-tag.co{color:var(--text)}
  .gal-note{font-size:11.5px;line-height:1.45;color:var(--text-dim)}
  .gal-note b{color:var(--text-mute);font-weight:600}
  .gal-empty{padding:30px;text-align:center;color:var(--text-mute)}
  .gal-lb{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:30px;cursor:zoom-out}
  .gal-lb[hidden]{display:none}
  .gal-lb img{max-width:94vw;max-height:82vh;background:#fff;border-radius:6px}
  .gal-lb-cap{color:#eee;font-size:12.5px;max-width:80vw;text-align:center}
```

- [ ] **Step 4: Verify the tab shows (empty state) without leaking.** Start the preview server, open the app, click the Charts nav item: the card + controls show; switch to another tab: the gallery does NOT leak (the `[hidden]{display:none}` rule). See Task 9 for the preview commands; you can do a quick check here or defer to Task 9.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(charts): Charts tab nav, container, and CSS"
```

---

### Task 7: UI — `loadCharts()` render + `showView` wiring

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Wire `showView`.** In the IIFE near line 7485: add `vC` to the `const` list and a `chartsLoaded` flag, then a hide line + lazy-load trigger.

Change the declaration block to include:
```javascript
        vC=document.getElementById('viewCharts'),
```
Change the flags line to:
```javascript
  let marketsLoaded=false, watchlistLoaded=false, positioningLoaded=false, sectorLoaded=false, strategyLoaded=false, chartsLoaded=false;
```
After the `vP.hidden=…` line add:
```javascript
    vC.hidden=v!=='charts';
    if(v==='charts' && !chartsLoaded){ chartsLoaded=true; loadCharts(); }
```

- [ ] **Step 2: Add the `loadCharts` module.** Place it next to the other loaders (e.g. just before `async function loadPositioning(){` near line 7075):

```javascript
let _galAll=[], _galFilters={};
async function loadCharts(){
  const grid=document.getElementById('galGrid');
  try{
    const res=await fetch('data/charts.json',{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const data=await res.json();
    _galAll=data.charts||[];
  }catch(e){
    grid.innerHTML='<p class="gal-empty">Charts data not available yet.</p>';
    return;
  }
  document.getElementById('galCount').textContent=
    `${_galAll.length} exhibits from ${new Set(_galAll.map(c=>c.report_key)).size} reports.`;
  galBuildChips();
  galRender();
  const s=document.getElementById('galSearch');
  s.addEventListener('input', galRender);
}

function galEsc(x){return String(x==null?'':x).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

function galBuildChips(){
  // Scalar facets (one value per chart) + the array-valued subject-sector facet.
  const scalar={source:'Source', chart_type:'Type', house:'Broker'};
  const wrap=document.getElementById('galChips');
  wrap.innerHTML='';
  _galFilters={};
  const addChip=(key,v)=>{
    const chip=document.createElement('button');
    chip.type='button'; chip.className='gal-chip';
    chip.textContent=v;
    chip.addEventListener('click',()=>{
      chip.classList.toggle('on');
      const set=_galFilters[key]||(_galFilters[key]=new Set());
      chip.classList.contains('on')?set.add(v):set.delete(v);
      galRender();
    });
    wrap.appendChild(chip);
  };
  Object.keys(scalar).forEach(key=>{
    [...new Set(_galAll.map(c=>c[key]).filter(Boolean))].sort().forEach(v=>addChip(key,v));
  });
  // subject_sectors is an array per chart — flatten to a single "__sector" facet.
  const sectors=new Set();
  _galAll.forEach(c=>(c.subject_sectors||[]).forEach(s=>s&&sectors.add(s)));
  [...sectors].sort().forEach(v=>addChip('__sector',v));
}

function galMatch(c){
  for(const [k,set] of Object.entries(_galFilters)){
    if(!set.size) continue;
    if(k==='__sector'){
      if(!(c.subject_sectors||[]).some(s=>set.has(s))) return false;
    }else if(!set.has(c[k])){
      return false;
    }
  }
  const q=document.getElementById('galSearch').value.trim().toLowerCase();
  if(q){
    const hay=[c.chart_title,c.subject_company,(c.subject_sectors||[]).join(' '),
               c.analyst_caption,c.commentary,c.report_title].join(' ').toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}

function galRender(){
  const grid=document.getElementById('galGrid');
  const rows=_galAll.filter(galMatch);
  document.getElementById('galEmpty').hidden=rows.length>0;
  grid.innerHTML=rows.map(c=>{
    const tags=[`<span class="gal-tag src">${galEsc(c.source)}</span>`];
    if(c.subject_company) tags.push(`<span class="gal-tag co">${galEsc(c.subject_company)}</span>`);
    (c.subject_sectors||[]).forEach(s=>tags.push(`<span class="gal-tag">${galEsc(s)}</span>`));
    tags.push(`<span class="gal-tag">${galEsc(c.house)}</span>`);
    tags.push(`<span class="gal-tag">${galEsc(c.date)}</span>`);
    const analyst=c.analyst_caption?`<div class="gal-note"><b>Analyst:</b> ${galEsc(c.analyst_caption)}</div>`:'';
    const comm=c.commentary?`<div class="gal-note"><b>Commentary:</b> ${galEsc(c.commentary)}</div>`:'';
    const cap=galEsc(c.chart_title||c.report_title);
    return `<div class="gal-card">
      <img loading="lazy" src="${galEsc(c.image)}" alt="${cap}" data-cap="${cap}" />
      <div class="gal-body">
        ${c.chart_title?`<div class="gal-title">${galEsc(c.chart_title)}</div>`:''}
        <div class="gal-tags">${tags.join('')}</div>
        ${analyst}${comm}
      </div></div>`;
  }).join('');
  grid.querySelectorAll('img').forEach(img=>img.addEventListener('click',()=>galLightbox(img.src,img.dataset.cap)));
}

function galLightbox(src,cap){
  const lb=document.getElementById('galLightbox');
  document.getElementById('galLbImg').src=src;
  document.getElementById('galLbCap').textContent=cap||'';
  lb.hidden=false;
  lb.onclick=()=>{lb.hidden=true;};
}
```

- [ ] **Step 2b: Verify no identifier collisions.** Run: `grep -n "function galRender\|function loadCharts\|_galAll" index.html` — expect exactly one definition of each. Run `grep -n "id=\"galGrid\"\|id=\"galSearch\"\|id=\"galChips\"\|id=\"galCount\"\|id=\"galEmpty\"\|id=\"galLightbox\"" index.html` — each appears once.

- [ ] **Step 3: Seed a tiny `data/charts.json` to test render before the real pilot run.**

```bash
uv run --python 3.12 python -c "import json; json.dump({'updated':'2026-06-07','charts':[{'id':'t#1','report_key':'k','house':'Jefferies','date':'2026-06-03','source':'India Macro','source_type':'theme','report_title':'Test note','page':1,'image':'charts/placeholder.png','chart_title':'India CPI vs repo rate','chart_type':'line','subject_company':None,'subject_sectors':['Macro'],'sector':None,'analyst_caption':'Source: CMIE.','commentary':'CPI easing toward target gives the RBI room.'}]}, open('data/charts.json','w',encoding='utf-8'), indent=2)"
```

- [ ] **Step 4: Verify in preview** (see Task 9 for preview commands): open Charts tab → one card renders with title, tags (India Macro/Macro/Jefferies/date), Analyst + Commentary lines; search box and chips filter live; clicking the image opens the lightbox (broken-image is fine — the placeholder path doesn't exist yet). Take a `preview_snapshot` to confirm structure.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(charts): loadCharts render, filters, search, lightbox"
```

---

### Task 8: Run the pilot end-to-end (real data)

This is the model-driven execution step. It produces the real `analysis.json` files, cropped PNGs, and final `data/charts.json`.

**Files:**
- Generated: `scripts/.charts-work/<slug>/analysis.json` (scratch), `charts/<folder_slug>/*.png`, `data/charts.json`

- [ ] **Step 1: Ensure Phase A has run** (`scripts/.charts-work/index.json` exists from Task 5). If not: `powershell -ExecutionPolicy Bypass -File scripts/charts/run.ps1`.

- [ ] **Step 2: For each PDF in `index.json`, dispatch a vision subagent.** Use the Agent tool, one agent per PDF (process in batches to bound concurrency). For each PDF build the prompt from `scripts/charts/analysis_prompt.md`, substituting `{{FOLDER}}/{{HOUSE}}/{{DATE}}/{{TITLE}}`, `{{PDFDATA_SUMMARY}}` (look the report's `summary` up in `data/pdfdata.json` by `report_key`; "" if absent), and `{{PAGE_LIST}}` (the PDF's `pages[].png` absolute paths). Pass the Task 3 JSON Schema as the agent `schema`. The agent reads each page PNG via Read and returns `{pages:[...]}`.

- [ ] **Step 3: Write each agent's validated response** to `scripts/.charts-work/<slug>/analysis.json` verbatim.

- [ ] **Step 4: Run Phase C.** `cd scripts/charts; uv run --python 3.12 --with pymupdf --with pillow python crop_assemble.py; cd ../..`
Expected: `assembled …` per PDF and a `TOTAL charts written: N` (N in the hundreds). `data/charts.json` is regenerated (overwrites the Task 7 seed); `.webp` crops populate `charts/<folder_slug>/`.

- [ ] **Step 5: Spot-check crops.** Open ~5 random `.webp` crops across folders with the Read tool. Confirm each crop tightly contains its exhibit (title + footnote included, neighbouring exhibits not bleeding in). If crops are systematically loose/tight, adjust the `pad` arg in `crop_assemble.py` `pad_bbox(c["bbox"], <pad>)` and re-run Phase C (no re-analysis needed).

- [ ] **Step 6: Commit data + images**

```bash
git add data/charts.json charts/
git commit -m "feat(charts): pilot extraction — charts.json + cropped exhibit images"
```

---

### Task 9: Verify in the live preview + finish

**Files:** none (verification + integration)

- [ ] **Step 1: Start preview.** Use `preview_start` (the project preview server "mam-hub" / static server, per CLAUDE.md). If a server is already running, reuse it.

- [ ] **Step 2: Reload and open the Charts tab.** `preview_eval: window.location.reload()`, then `preview_click` the Charts nav item.

- [ ] **Step 3: Check for errors.** `preview_console_logs` — expect no uncaught errors (a 404 for a missing image would show as a broken card, not a console throw). `preview_snapshot` — confirm cards render with images, titles, the source/company/sector/broker/date tag bar, and Analyst/Commentary lines.

- [ ] **Step 4: Exercise filters.** `preview_fill` the search box with a term (e.g. a sector) → `preview_snapshot` shows the grid narrowing. `preview_click` a chart-type chip (e.g. `table`) → grid filters to that type. `preview_click` the same chip again → resets.

- [ ] **Step 5: Check the leak gotcha.** `preview_click` another tab (e.g. Overview) → `preview_snapshot` confirms the gallery is gone (no leak). Switch back → it's still there.

- [ ] **Step 6: Capture proof.** `preview_screenshot` of the populated Charts tab and of a filtered/lightbox state for the user.

- [ ] **Step 7: Finish the branch.** Use the superpowers:finishing-a-development-branch skill to merge `charts-tab` → `main` and push (GitHub Pages auto-publishes). Per CLAUDE.md, the dashboard change must be pushed.

- [ ] **Step 8: Update memory.** Add/update a memory file for the Charts tab (data file, pipeline scripts, pilot scope, scaling caveats) and link it from `notebooklm-research-portal` / the project memories. Update repo `CLAUDE.md` with a "Charts tab" section (pipeline + data contract + the `[hidden]` gotcha + local-only scaling note).

---

### Task 10: Auto-ingest new reports — local incremental refresher (AFTER pilot sign-off)

**Gate:** Do this only after Task 9 and the user has approved the pilot's crops and
commentary tone (the analysis prompt in `analysis_prompt.md` may be tweaked first).

**Why local:** cloud CCR routines clone this repo read-only and cannot push
(documented in `CLAUDE.md`), and the pipeline needs the local PDFs. So this mirrors
`build-highs.ps1` / `build-positioning.ps1`: a step in `scripts/daily-refresh.ps1`
that stages results for the daily commit+push.

**Files:**
- Create: `scripts/charts/build-charts.ps1`
- Modify: `scripts/charts/lib.py` (the incremental scanner walks ALL folders, not just
  `PILOT_FOLDERS` — add an `ALL_FOLDERS` scan or a `folders=None → every dir` arg to
  the render entry point), `scripts/daily-refresh.ps1` (add the build-charts step).

- [ ] **Step 1: Make rendering scope-configurable.** Refactor `render_pages.py` to
  accept a folder list (default = every direct subdir of `REPORTS_ROOT` except
  `Sorting Folder`), and to **skip PDFs whose `report_key` is already in
  `data/charts.json`** (idempotent — only new reports render).

- [ ] **Step 2: Write `build-charts.ps1`** modeled on `build-positioning.ps1`:
  1. Run Phase A (incremental — new PDFs only) → if none new, exit 0 quietly.
  2. For each new PDF, invoke **headless Claude** (`claude -p …` like `build-strategy.ps1`)
     with `analysis_prompt.md` + the page PNG paths, capture the JSON to
     `.charts-work/<slug>/analysis.json`. Validate JSON; skip a PDF on failure (never abort).
  3. Run Phase C (`crop_assemble.py`) in **append mode** — load existing
     `charts.json`, add only the new rows, rewrite. (Add an append/merge path to
     `crop_assemble.py` keyed by `id` so existing rows/images are untouched.)
  4. Exit 0 always (so it never breaks the rest of the daily refresh).

- [ ] **Step 3: Wire into `daily-refresh.ps1`** — add a `build-charts.ps1` step
  before the stage+commit+push block, so new crops + the updated `charts.json` ride
  the daily push. Stage `data/charts.json` and `charts/`.

- [ ] **Step 4: Test the increment.** Temporarily drop one new test PDF into a
  folder, run `build-charts.ps1`, confirm only that report's exhibits are added to
  `charts.json` (existing rows unchanged) and its WebP crops appear. Remove the test
  PDF and re-run → confirm no duplicate rows (idempotent).

- [ ] **Step 5: Commit**

```bash
git add scripts/charts/build-charts.ps1 scripts/charts/render_pages.py scripts/charts/crop_assemble.py scripts/charts/lib.py scripts/daily-refresh.ps1
git commit -m "feat(charts): local incremental auto-ingest of new reports (daily-refresh step)"
```

---

## Notes for the executor

- **Re-running is cheap and safe:** Phase A re-renders idempotently; Phase B analyses are cached per-PDF on disk (skip PDFs that already have `analysis.json`); Phase C is a pure function of `index.json` + the analyses. Tune crop padding by editing one arg and re-running Phase C alone.
- **Image storage:** crops are committed as capped-width WebP (q80, ≤1100px) — ~5-10x smaller than PNG, which keeps even the full rollout under the GitHub Pages size budget. Do NOT use Git LFS: Pages serves the LFS pointer text, not the binary, so images would break.
- **Scaling beyond the pilot** (all 261 folders): change `PILOT_FOLDERS` in `lib.py`. WebP keeps the full set ~120-200 MB (fine for Pages). If bandwidth ever matters, serve `charts/` via jsDelivr (no account/keys). Remember any auto-refresh must run locally (cloud routines can't push this repo).
