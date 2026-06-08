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
EXCLUDE_FILE = Path(__file__).resolve().parent / "_exclude_keys.txt"
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

def excluded_keys():
    """report_keys to never chart (e.g. duplicate re-uploads). One per line; # comments ok."""
    if not EXCLUDE_FILE.exists():
        return set()
    return {l.strip() for l in EXCLUDE_FILE.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.lstrip().startswith("#")}

import re as _re
# sector / thematic decks (vs single-company folders) — charted first in the backfill.
# Thematic decks use a geography prefix ("India X" / "Indian X" / "Asia X" / "Global X");
# company folders are proper nouns (e.g. "Asian Paints", "Adani Power"). A few explicit
# multi-company themes have no geo prefix. (Mis-bucketing a company is harmless — it just
# gets charted a little earlier.)
_SECTOR_RE = _re.compile(
    r'^(india|indian|asia|asean|global)\s|'
    r'^(automobiles & components|capital markets|strategy|economics)\b', _re.I)

def _sector_first(folders):
    """Order sector/thematic folders before single-company folders (harmless if a
    company is mis-bucketed — it just gets charted a little earlier)."""
    return sorted(folders, key=lambda f: (0 if _SECTOR_RE.search(f) else 1, f))

def all_folders():
    return _sector_first([d.name for d in REPORTS_ROOT.iterdir()
                          if d.is_dir() and d.name not in SKIP_DIRS])

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
        pdfs = run(all_folders(), existing_keys() | excluded_keys(), limit=_arg_limit())
        newlist = [{"slug": p["slug"], "folder": p["folder"], "house": p["house"],
                    "date": p["date"], "report_title": p["report_title"],
                    "pages": len(p["pages"])} for p in pdfs]
        (WORK / "_new.json").write_text(json.dumps({"new": newlist}, indent=2), encoding="utf-8")
        print(f"NEW PDFs: {len(newlist)}")
    else:
        run(PILOT_FOLDERS, set())

if __name__ == "__main__":
    main()
