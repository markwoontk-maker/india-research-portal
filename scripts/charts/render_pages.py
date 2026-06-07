# scripts/charts/render_pages.py
"""Phase A: render PDF pages to PNGs and emit scripts/.charts-work/index.json.

Default: render the PILOT_FOLDERS (full pilot).
`--incremental`: scan ALL report folders, skip any report already represented in
data/charts.json (by report_key), render only the new ones, and also write
scripts/.charts-work/_new.json (the orchestrator drives Phase B over that list).
"""
import json
import sys
from pathlib import Path
import fitz  # PyMuPDF
from lib import PILOT_FOLDERS, REPORTS_ROOT, parse_report_filename, fs_slug

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "scripts" / ".charts-work"
CHARTS_JSON = ROOT / "data" / "charts.json"
DPI = 180
SKIP_DIRS = {"Sorting Folder"}

def _key(folder, meta, slug):
    return f'{meta["house"]}|{meta["yymmdd"]}|{folder}|{slug}'

def render_one(folder, pdf, meta):
    """Render one PDF's pages to PNGs; return its index record (or None on failure)."""
    slug = fs_slug(meta["house"], meta["yymmdd"], meta["title"])
    outdir = WORK / slug
    outdir.mkdir(parents=True, exist_ok=True)
    try:
        doc = fitz.open(pdf)
    except Exception as e:
        print("SKIP (open failed):", pdf.name, e)
        return None
    pages = []
    try:
        for i, page in enumerate(doc, start=1):
            try:
                png = outdir / f"p{i:02d}.png"
                pix = page.get_pixmap(dpi=DPI)
                pix.save(png)
                del pix
                pages.append({"page": i, "png": str(png),
                              "w_pt": page.rect.width, "h_pt": page.rect.height})
            except Exception as e:
                print(f"  SKIP page {i} of {pdf.name}: {e}")
    finally:
        doc.close()
    print(f"rendered {slug}: {len(pages)} pages")
    return {"key": _key(folder, meta, slug), "slug": slug, "folder": folder,
            "house": meta["house"], "date": meta["date"],
            "report_title": meta["title"], "path": str(pdf), "pages": pages}

def existing_keys():
    if not CHARTS_JSON.exists():
        return set()
    try:
        data = json.loads(CHARTS_JSON.read_text(encoding="utf-8-sig"))
        return {c["report_key"] for c in data.get("charts", [])}
    except Exception:
        return set()

def all_folders():
    return [d.name for d in sorted(REPORTS_ROOT.iterdir())
            if d.is_dir() and d.name not in SKIP_DIRS]

def run(folders, skip_keys, limit=None):
    WORK.mkdir(parents=True, exist_ok=True)
    pdfs = []
    for folder in folders:
        d = REPORTS_ROOT / folder
        if not d.is_dir():
            print("MISSING FOLDER:", folder)
            continue
        for pdf in sorted(d.glob("*.pdf")):
            if limit is not None and len(pdfs) >= limit:
                break
            meta = parse_report_filename(pdf.name)
            if not meta:
                print("SKIP (unparseable):", pdf.name)
                continue
            slug = fs_slug(meta["house"], meta["yymmdd"], meta["title"])
            if _key(folder, meta, slug) in skip_keys:
                continue
            rec = render_one(folder, pdf, meta)
            if rec:
                pdfs.append(rec)
        if limit is not None and len(pdfs) >= limit:
            break
    (WORK / "index.json").write_text(json.dumps({"pdfs": pdfs}, indent=2), encoding="utf-8")
    print(f"TOTAL PDFs: {len(pdfs)}, pages: {sum(len(p['pages']) for p in pdfs)}")
    return pdfs

def _arg_limit():
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            try:
                return int(sys.argv[i + 1])
            except ValueError:
                return None
    return None

def main():
    if "--incremental" in sys.argv:
        pdfs = run(all_folders(), existing_keys(), limit=_arg_limit())
        newlist = [{"slug": p["slug"], "folder": p["folder"], "house": p["house"],
                    "date": p["date"], "report_title": p["report_title"],
                    "pages": len(p["pages"])} for p in pdfs]
        (WORK / "_new.json").write_text(json.dumps({"new": newlist}, indent=2), encoding="utf-8")
        print(f"NEW PDFs: {len(newlist)}")
    else:
        run(PILOT_FOLDERS, set())

if __name__ == "__main__":
    main()
