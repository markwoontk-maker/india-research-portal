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
from lib import pad_bbox, norm_to_points, source_type, company_sector, fs_slug, norm_sectors

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
        try:
            for pageno, charts in sorted(page_charts.items()):
                if pageno not in page_dims:  # analysis referenced a page Phase A didn't render
                    print(f"  WARN {pdf['slug']}: page {pageno} not in index; skipping")
                    continue
                w_pt, h_pt = page_dims[pageno]
                page = doc[pageno - 1]
                for n, c in enumerate(charts, start=1):
                    rect = fitz.Rect(*norm_to_points(pad_bbox(c["bbox"]), w_pt, h_pt))
                    img_name = f'{pdf["slug"]}_p{pageno:02d}_{n}.webp'
                    (CHARTS_DIR / folder_seg).mkdir(parents=True, exist_ok=True)
                    pix = page.get_pixmap(clip=rect, dpi=CROP_DPI)
                    raw = pix.tobytes("png")
                    del pix  # free native pixmap before Pillow decodes
                    # convert strips alpha; broker PDFs are white-bg so this is safe
                    img = Image.open(io.BytesIO(raw)).convert("RGB")
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
                        "subject_sectors": norm_sectors(c.get("subject_sectors")),
                        "sector": company_sector(subj, COMPANIES),
                        "analyst_caption": c.get("analyst_caption"),
                        "commentary": c.get("commentary") or "",
                    })
        finally:
            doc.close()  # always release the file handle, even mid-PDF
        print("assembled", pdf["slug"], sum(len(v) for v in page_charts.values()), "exhibits")
    out.sort(key=lambda r: (r["date"], r["source"], r["page"]))
    OUT.write_text(json.dumps({"updated": date.today().isoformat(), "charts": out},
                              indent=2, ensure_ascii=False), encoding="utf-8")
    print("TOTAL charts written:", len(out))

if __name__ == "__main__":
    main()
