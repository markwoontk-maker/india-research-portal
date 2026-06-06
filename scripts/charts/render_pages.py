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
