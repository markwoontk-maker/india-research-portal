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
            # outdir is not cleaned between runs; stale PNGs are harmless because
            # Phase C is driven by index.json, not by globbing the dir.
            pages = []
            try:
                for i, page in enumerate(doc, start=1):
                    try:
                        png = outdir / f"p{i:02d}.png"
                        pix = page.get_pixmap(dpi=DPI)
                        pix.save(png)
                        del pix  # free native pixmap memory promptly across 1000s of pages
                        pages.append({"page": i, "png": str(png),
                                      "w_pt": page.rect.width, "h_pt": page.rect.height})
                    except Exception as e:
                        print(f"  SKIP page {i} of {pdf.name}: {e}")
            finally:
                doc.close()  # always release the file handle, even mid-loop
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
