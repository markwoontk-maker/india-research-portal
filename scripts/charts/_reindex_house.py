# Helper: rebuild scripts/.charts-work/index.json containing only one broker's
# pilot reports (page dims + existing PNG paths), so its charts can be re-cropped
# with the current crop_assemble refinement WITHOUT re-rendering or re-vision.
# Existing analysis.json files are left untouched.
#   usage: uv run --python 3.12 --with pymupdf python _reindex_house.py "CLSA"
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fitz
from lib import PILOT_FOLDERS, REPORTS_ROOT, parse_report_filename, fs_slug

house = sys.argv[1]
WORK = Path(__file__).resolve().parents[2] / "scripts" / ".charts-work"
pdfs = []
for folder in PILOT_FOLDERS:
    d = REPORTS_ROOT / folder
    if not d.is_dir():
        continue
    for pdf in sorted(d.glob("*.pdf")):
        meta = parse_report_filename(pdf.name)
        if not meta or meta["house"] != house:
            continue
        slug = fs_slug(meta["house"], meta["yymmdd"], meta["title"])
        sdir = WORK / slug
        if not (sdir / "analysis.json").exists():
            print("  no analysis, skipping:", slug); continue
        try:
            doc = fitz.open(pdf)
            pages = [{"page": i, "png": str(sdir / f"p{i:02d}.png"),
                      "w_pt": p.rect.width, "h_pt": p.rect.height}
                     for i, p in enumerate(doc, start=1)]
            doc.close()
        except Exception as e:
            print("  open failed:", pdf.name, e); continue
        pdfs.append({"key": f'{meta["house"]}|{meta["yymmdd"]}|{folder}|{slug}',
                     "slug": slug, "folder": folder, "house": meta["house"],
                     "date": meta["date"], "report_title": meta["title"],
                     "path": str(pdf), "pages": pages})
(WORK / "index.json").write_text(json.dumps({"pdfs": pdfs}, indent=2), encoding="utf-8")
print(f"{house} reports indexed:", len(pdfs))
