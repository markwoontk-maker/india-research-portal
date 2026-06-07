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

def _chart_rects(page, top_limit, ybot, W, H):
    """Vector-drawing + raster-image rects within (top_limit, ybot), minus page-wide
    rules and tiny icons — the raw pieces a chart graphic is made of."""
    rs = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.y0 < top_limit - 1 or r.y1 > ybot + 2 or r.width <= 0 or r.height <= 0:
            continue
        if r.height < 3 and r.width > 0.6 * W:   # horizontal rule
            continue
        if r.width < 3 and r.height > 0.6 * H:   # page-tall vertical rule
            continue
        if r.height > 0.85 * H:                   # page-spanning frame
            continue
        rs.append([r.x0, r.y0, r.x1, r.y1])
    for im in page.get_image_info():
        r = im["bbox"]
        if r[1] < top_limit - 1 or r[3] > ybot + 2:
            continue
        if (r[2] - r[0]) < 0.06 * W or (r[3] - r[1]) < 0.04 * H:  # skip icons/logos
            continue
        rs.append([r[0], r[1], r[2], r[3]])
    return rs

def _clusters(rs, W, H, gx=0.02, gy=0.05):
    """Merge nearby rects into clusters (one per chart panel). A clean column gutter
    or row gap separates side-by-side / stacked panels."""
    gx, gy = gx * W, gy * H
    cl = [r[:] for r in rs]
    changed = True
    while changed:
        changed, out = False, []
        while cl:
            a = cl.pop()
            i = 0
            while i < len(cl):
                b = cl[i]
                if not (a[0] > b[2] + gx or b[0] > a[2] + gx or a[1] > b[3] + gy or b[1] > a[3] + gy):
                    a = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    cl.pop(i); changed = True
                else:
                    i += 1
            out.append(a)
        cl = out
    return [c for c in cl if (c[3] - c[1]) > 0.06 * H and (c[2] - c[0]) > 0.06 * W]

def refine_rect(page, seed, is_chart=False):
    """Snap the rough (vision) rect to the exhibit's true extent using the PDF's own
    geometry. 'Source:' lines delimit exhibits vertically; chart graphics cluster into
    panels horizontally/vertically. For a chart we pick the panel matching the seed's
    column (so side-by-side figures don't merge), anchor the top to its caption/heading
    and the bottom to its source line. Tables use the band's text extent. Returns a
    tight fitz.Rect, or None to fall back to the seed.
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
    spans, prev = [], header_y
    for s in sources:
        spans.append((prev, s)); prev = s[3]
    top_limit, target = max(spans, key=lambda sp: min(sp[1][3], seed.y1) - max(sp[0], seed.y0))
    if min(target[3], seed.y1) - max(top_limit, seed.y0) <= 0:
        return None
    ybot = target[3]
    band = [b for b in blocks if b[1] >= top_limit - 1 and b[3] <= ybot + 2]
    if not band:
        return None
    px, py = 0.006 * W, 0.006 * H

    if is_chart:
        clusters = _clusters(_chart_rects(page, top_limit, ybot, W, H), W, H)
        if clusters:
            # pick the panel overlapping the seed's x-span most (else nearest centre)
            chosen = max(clusters, key=lambda c: min(c[2], seed.x1) - max(c[0], seed.x0))
            if min(chosen[2], seed.x1) - max(chosen[0], seed.x0) <= 0:
                sc = (seed.x0 + seed.x1) / 2
                chosen = min(clusters, key=lambda c: abs((c[0] + c[2]) / 2 - sc))
            cx0, ctop, cx1, cbot = chosen
            col = lambda b: not (b[2] < cx0 - 2 or b[0] > cx1 + 2)  # block overlaps this column
            # walk up through contiguous short heading/caption lines in this column
            headers, cur = [], ctop
            for b in sorted((b for b in band if b[3] <= ctop + 4 and col(b)), key=lambda b: -b[3]):
                if cur - b[3] > 0.035 * H or (b[3] - b[1]) > 0.045 * H:
                    break
                headers.append(b); cur = b[1]
            incol = [b for b in band if b[1] >= ctop - 2 and col(b)]
            colsrc = [s for s in sources if col(s) and top_limit - 1 <= s[1] <= ybot + 0.02 * H]
            y0 = min([ctop] + [b[1] for b in headers])
            y1 = max([cbot] + [s[3] for s in colsrc] + [b[3] for b in incol])
            x0 = min([cx0] + [b[0] for b in headers + incol])
            x1 = max([cx1] + [b[2] for b in headers + incol])
            r = fitz.Rect(max(0, x0 - px), max(0, y0 - py), min(W, x1 + px), min(H, y1 + py))
            return r if r.width >= 0.15 * W and r.height >= 0.04 * H else None
        # no chart cluster found -> fall through to text-extent

    y0 = min(b[1] for b in band)
    x0 = min(b[0] for b in band)
    x1 = max(b[2] for b in band)
    r = fitz.Rect(max(0, x0 - px), max(0, y0 - py), min(W, x1 + px), min(H, ybot + py))
    return r if r.width >= 0.15 * W and r.height >= 0.04 * H else None

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
CHART_TYPES = {"line", "bar", "area", "scatter", "valuation_band"}  # gallery = charts only
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
                n = 0
                for c in charts:
                    if c.get("chart_type") not in CHART_TYPES:
                        continue  # charts only — skip tables/maps/diagrams/other
                    n += 1
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
