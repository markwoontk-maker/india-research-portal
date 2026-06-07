# scripts/charts/crop_assemble.py
"""Phase C: read per-PDF analyses, clip-crop each exhibit, write data/charts.json.

Crops are saved as capped-width WebP (q80) to keep the committed image set small
(~5-10x smaller than PNG). Run with: uv run --python 3.12 --with pymupdf --with pillow.
"""
import io
import json
import re
import sys
from datetime import date
from pathlib import Path
import fitz  # PyMuPDF
from PIL import Image
from lib import pad_bbox, norm_to_points, source_type, company_sector, fs_slug, norm_sectors

_SRC_RE = re.compile(r'^\s*source\s*[:\-]', re.I)

def _chart_cluster(page, top_limit, y1, W, H):
    """Bounding box of the chart graphic within (top_limit, y1) — from vector
    drawings AND raster images (broker charts are often embedded images), ignoring
    page-width rules and tiny icons. Returns (x0,y0,x1,y1) or None."""
    xs0, ys0, xs1, ys1 = [], [], [], []
    for d in page.get_drawings():
        r = d["rect"]
        if r.y0 < top_limit - 1 or r.y1 > y1 + 2 or r.width <= 0 or r.height <= 0:
            continue
        if r.height < 3 and r.width > 0.6 * W:   # horizontal rule
            continue
        if r.height > 0.85 * H:                   # page-spanning frame
            continue
        xs0.append(r.x0); ys0.append(r.y0); xs1.append(r.x1); ys1.append(r.y1)
    for im in page.get_image_info():
        r = im["bbox"]  # (x0, y0, x1, y1)
        if r[1] < top_limit - 1 or r[3] > y1 + 2:
            continue
        if (r[2] - r[0]) < 0.15 * W or (r[3] - r[1]) < 0.05 * H:  # skip small icons/logos
            continue
        xs0.append(r[0]); ys0.append(r[1]); xs1.append(r[2]); ys1.append(r[3])
    if not ys0:
        return None
    cb = (min(xs0), min(ys0), max(xs1), max(ys1))
    if cb[3] - cb[1] < 0.06 * H:                  # too thin to be a chart
        return None
    return cb

def refine_rect(page, seed, is_chart=False):
    """Snap the rough (vision) rect to the exhibit's true extent using the PDF's own
    geometry. Exhibits end at a 'Source:' line, so sources segment the page. For a
    table, the exhibit = text-block extent between the prior source/header and its
    source. For a chart, the top is anchored to the chart's caption (text just above
    the vector drawing) so a preceding body paragraph is excluded. Returns a tight
    fitz.Rect, or None to fall back to the seed.
    """
    H, W = page.rect.height, page.rect.width
    header_y, footer_y = 0.055 * H, 0.92 * H
    blocks = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], (b[4] or "").strip()
        if txt and y1 > header_y and y0 < footer_y:
            blocks.append((x0, y0, x1, y1, txt))
    sources = sorted([b for b in blocks if _SRC_RE.match(b[4])], key=lambda b: b[1])
    if not sources:
        return None
    # 'Source:' lines delimit exhibits; pick the band that overlaps the seed most
    # (robust to imprecise seeds + multi-figure pages, unlike "first source below").
    spans, prev = [], header_y
    for s in sources:
        spans.append((prev, s))   # (band_top, source_block)
        prev = s[3]
    top_limit, target = max(spans, key=lambda sp: min(sp[1][3], seed.y1) - max(sp[0], seed.y0))
    if min(target[3], seed.y1) - max(top_limit, seed.y0) <= 0:  # no overlap with any band
        return None
    band = [b for b in blocks if b[1] >= top_limit - 1 and b[3] <= target[3] + 2]
    if not band:
        return None
    y1 = target[3]
    cl = _chart_cluster(page, top_limit, y1, W, H) if is_chart else None
    if cl:
        cx0, ctop, cx1, _ = cl
        # Walk upward from the chart through the contiguous heading/caption lines
        # (each a SHORT block, regardless of width — a bold section heading is wide
        # but only one line tall), stopping at a tall body paragraph or a large gap.
        headers, cur = [], ctop
        for b in sorted((b for b in band if b[3] <= ctop + 4), key=lambda b: -b[3]):
            if cur - b[3] > 0.035 * H:        # gap too large -> separate content above
                break
            if (b[3] - b[1]) > 0.045 * H:     # tall block = body paragraph -> stop
                break
            headers.append(b); cur = b[1]
        inchart = [b for b in band if b[1] >= ctop - 2]
        y0 = min([ctop] + [b[1] for b in headers])
        x0 = min([cx0] + [b[0] for b in headers + inchart])
        x1 = max([cx1] + [b[2] for b in headers + inchart])
    else:
        y0 = min(b[1] for b in band)
        x0 = min(b[0] for b in band)
        x1 = max(b[2] for b in band)
    px, py = 0.006 * W, 0.006 * H
    r = fitz.Rect(max(0, x0 - px), max(0, y0 - py), min(W, x1 + px), min(H, y1 + py))
    if r.width < 0.15 * W or r.height < 0.04 * H:
        return None
    return r

def trim_white(img, thresh=244, pad=6):
    """Crop away near-white borders so the exhibit fills the frame. Keeps a small pad."""
    gray = img.convert("L")
    mask = gray.point(lambda p: 255 if p < thresh else 0)  # content = darker than near-white
    box = mask.getbbox()
    if not box:
        return img
    l, t, r, b = box
    return img.crop((max(0, l - pad), max(0, t - pad),
                     min(img.width, r + pad), min(img.height, b + pad)))

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "scripts" / ".charts-work"
CHARTS_DIR = ROOT / "charts"
COMPANIES = str(ROOT / "data" / "companies.json")
OUT = ROOT / "data" / "charts.json"
CROP_DPI = 200      # render the clip at 200 dpi, then downscale to MAX_W for storage
MAX_W = 1100        # cap stored image width (px); charts stay crisp, files stay small
WEBP_Q = 80         # WebP quality

def main():
    append = "--append" in sys.argv
    existing, existing_keys = [], set()
    if append and OUT.exists():
        ex = json.loads(OUT.read_text(encoding="utf-8-sig"))
        existing = ex.get("charts", [])
        existing_keys = {c["report_key"] for c in existing}
    index = json.loads((WORK / "index.json").read_text(encoding="utf-8"))
    out = []
    for pdf in index["pdfs"]:
        if append and pdf["key"] in existing_keys:
            continue  # already charted — leave its rows/images untouched
        ana_path = WORK / pdf["slug"] / "analysis.json"
        if not ana_path.exists():
            print("no analysis yet:", pdf["slug"])
            continue
        ana = json.loads(ana_path.read_text(encoding="utf-8-sig"))  # tolerate a BOM
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
                    seed = fitz.Rect(*norm_to_points(c["bbox"], w_pt, h_pt))
                    is_chart = c.get("chart_type") in (
                        "line", "bar", "area", "scatter", "valuation_band")
                    rect = refine_rect(page, seed, is_chart) or \
                        fitz.Rect(*norm_to_points(pad_bbox(c["bbox"]), w_pt, h_pt))
                    img_name = f'{pdf["slug"]}_p{pageno:02d}_{n}.webp'
                    (CHARTS_DIR / folder_seg).mkdir(parents=True, exist_ok=True)
                    pix = page.get_pixmap(clip=rect, dpi=CROP_DPI)
                    raw = pix.tobytes("png")
                    del pix  # free native pixmap before Pillow decodes
                    # convert strips alpha; broker PDFs are white-bg so this is safe.
                    # trim_white removes residual blank margins so the chart fills the frame.
                    img = trim_white(Image.open(io.BytesIO(raw)).convert("RGB"))
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
    final = existing + out if append else out
    final.sort(key=lambda r: (r["date"], r["source"], r["page"]))
    OUT.write_text(json.dumps({"updated": date.today().isoformat(), "charts": final},
                              indent=2, ensure_ascii=False), encoding="utf-8")
    if append:
        print(f"appended {len(out)} new charts; total now {len(final)}")
    else:
        print("TOTAL charts written:", len(final))

if __name__ == "__main__":
    main()
