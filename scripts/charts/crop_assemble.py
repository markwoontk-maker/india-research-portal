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

_SRC_RE = re.compile(r'source\s*[:\-]', re.I)        # "Source:" anywhere (often inside a "Note: … Source: …" block)
_FIG_RE = re.compile(r'^\s*(fig|figure|exhibit|chart)\.?\s*\d+', re.I)  # a figure-title label

def _chart_rects(page, top_limit, ybot, W, H):
    """Vector-drawing + raster-image rects within (top_limit, ybot), minus page-wide
    rules and tiny icons — the raw pieces a chart graphic is made of."""
    rs = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.y0 < top_limit - 1 or r.y1 > ybot + 2 or r.width <= 0 or r.height <= 0:
            continue
        if r.height < 3:                          # thin horizontal line: rule / gridline / border
            continue
        if r.width < 3 and r.height > 0.6 * H:    # page-tall vertical rule
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

def refine_rect(page, seed, siblings=(), is_chart=True):
    """Snap the rough (vision) rect to the exhibit's true extent using the PDF's own
    geometry. 'Source:' lines delimit exhibits vertically (rows). Within a row, if
    another chart sits side-by-side (a sibling seed with a disjoint x-range), this is
    a multi-up grid and the COLUMN is taken from the seed's reliable x-half; otherwise
    the chart graphic's own extent is used (so a single chart with a too-narrow seed
    still crops full-width). Top anchors to the chart's caption/heading; bottom to the
    chart + its row source. Returns a tight fitz.Rect, or None to fall back to the seed.
    """
    H, W = page.rect.height, page.rect.width
    header_y, footer_y = 0.055 * H, 0.92 * H
    blocks = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], (b[4] or "").strip()
        if txt and y1 > header_y and y0 < footer_y:
            blocks.append((x0, y0, x1, y1, txt))
    sources = sorted([b for b in blocks if _SRC_RE.search(b[4])], key=lambda b: b[1])
    if not sources:
        return None
    spans, prev = [], header_y
    for s in sources:
        spans.append((prev, s)); prev = s[3]
    top_limit, target = max(spans, key=lambda sp: min(sp[1][3], seed.y1) - max(sp[0], seed.y0))
    if min(target[3], seed.y1) - max(top_limit, seed.y0) <= 0:
        return None
    by0, by1 = top_limit, target[3]
    band = [b for b in blocks if b[1] >= by0 - 1 and b[3] <= by1 + 2]
    if not band:
        return None
    px, py = 0.006 * W, 0.006 * H

    if is_chart:
        rects = _chart_rects(page, by0, by1, W, H)
        # is there a side-by-side sibling chart in this same row-band?
        sibs = [s for s in siblings if s is not seed and by0 - 2 <= (s.y0 + s.y1) / 2 <= by1 + 2]
        multicol = any(min(s.x1, seed.x1) - max(s.x0, seed.x0) <= 0.02 * W for s in sibs)
        if multicol:
            colx0, colx1 = seed.x0, seed.x1            # trust the vision column for grids
        elif rects:
            colx0, colx1 = min(r[0] for r in rects), max(r[2] for r in rects)  # full chart
        else:
            colx0, colx1 = seed.x0, seed.x1
        # chart graphic pieces that live in this column -> precise top/bottom + x
        prects = [r for r in rects if min(r[2], colx1) - max(r[0], colx0) > 0.3 * (r[2] - r[0])]
        if prects:
            ctop, cbot = min(r[1] for r in prects), max(r[3] for r in prects)
            colx0, colx1 = max(colx0, min(r[0] for r in prects)), min(colx1, max(r[2] for r in prects))
        else:
            ctop, cbot = max(by0, seed.y0), min(by1, seed.y1)
        cw = max(1.0, colx1 - colx0)
        col = lambda b: (min(b[2], colx1) - max(b[0], colx0)) > 0.3 * min(b[2] - b[0], cw)
        # walk up through contiguous short heading/caption lines in this column,
        # stopping AT a "Fig N / Exhibit N" label (don't pull in body text above it)
        headers, cur = [], ctop
        for b in sorted((b for b in band if b[3] <= ctop + 4 and col(b)), key=lambda b: -b[3]):
            if cur - b[3] > 0.035 * H or (b[3] - b[1]) > 0.045 * H:
                break
            headers.append(b); cur = b[1]
            if _FIG_RE.match(b[4]):
                break
        y0 = min([ctop] + [b[1] for b in headers])
        # bottom = chart + this column's own source line (handles per-column footers)
        col_srcs = [s for s in sources if min(s[2], colx1) - max(s[0], colx0) > 0
                    and by0 - 2 <= s[1] <= by1 + 0.02 * H]
        y1 = max([cbot] + [s[3] for s in col_srcs])
        # x stays within the column (do NOT widen to a full-width source/heading)
        r = fitz.Rect(max(0, colx0 - px), max(0, y0 - py), min(W, colx1 + px), min(H, y1 + py))
        if r.width >= 0.12 * W and r.height >= 0.04 * H:
            return r
        # else fall through to text-extent

    y0 = min(b[1] for b in band)
    x0 = min(b[0] for b in band)
    x1 = max(b[2] for b in band)
    r = fitz.Rect(max(0, x0 - px), max(0, y0 - py), min(W, x1 + px), min(H, by1 + py))
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
EXCLUDE_FILE = Path(__file__).resolve().parent / "_exclude_keys.txt"
CHART_TYPES = {"line", "bar", "area", "scatter", "valuation_band", "map", "diagram"}  # charts + maps/diagrams; tables excluded

def excluded_keys():
    if not EXCLUDE_FILE.exists():
        return set()
    return {l.strip() for l in EXCLUDE_FILE.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.lstrip().startswith("#")}
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
    excluded = excluded_keys()
    out = []
    for pdf in index["pdfs"]:
        if pdf["key"] in excluded:
            continue  # excluded report (duplicates / not wanted in gallery)
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
                kept = [c for c in charts if c.get("chart_type") in CHART_TYPES]  # charts/maps/diagrams; no tables
                sib_seeds = [fitz.Rect(*norm_to_points(c["bbox"], w_pt, h_pt)) for c in kept]
                n = 0
                for c, seed in zip(kept, sib_seeds):
                    n += 1
                    rect = refine_rect(page, seed, sib_seeds, True) or \
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
                        "report_path": pdf["path"],   # local source PDF (for the title link)
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
