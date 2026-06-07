# scripts/charts/lib.py
"""Pure helpers for the Charts pipeline. No PDF I/O here (keep testable)."""
import json
import os
import re
import unicodedata
from pathlib import Path

PILOT_FOLDERS = ["India Macro", "India Strategy", "Indian Financials",
                 "Indian Autos", "Indian Consumer"]
# Env-overridable so the pipeline is portable; defaults to this machine's library.
REPORTS_ROOT = Path(os.environ.get(
    "INDIA_REPORTS_ROOT", r"C:\Users\admin\Desktop\India Related Reports"))

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
    s = re.sub(r'[^A-Za-z0-9]+', '_', s)
    return s[:120].strip('_')  # strip after truncation so no trailing '_'

def pad_bbox(b, pad=0.02):
    """Expand a normalized bbox by `pad`, clamped to [0,1]."""
    x0, y0, x1, y1 = b
    return [max(0.0, x0 - pad), max(0.0, y0 - pad),
            min(1.0, x1 + pad), min(1.0, y1 + pad)]

def norm_to_points(b, w_pt, h_pt):
    """Normalized bbox -> PDF-point coords for a page of size (w_pt,h_pt)."""
    x0, y0, x1, y1 = b
    return [float(x0 * w_pt), float(y0 * h_pt), float(x1 * w_pt), float(y1 * h_pt)]

def source_type(folder):
    """Map a pilot folder to its category: 'theme' (India …), 'sector' (Indian …), else 'company'."""
    if folder.startswith("India "):
        return "theme"
    if folder.startswith("Indian "):
        return "sector"
    return "company"

# Sector labels are free-text from the vision pass, so casing varies
# ("Quick commerce" vs "Quick Commerce"). Canonicalize so each sector is one
# filter chip. All-caps acronyms and small connector words are preserved.
_SECTOR_ACRONYMS = {"FMCG", "QSR", "UPI", "MCC", "EV", "EVS", "GST", "SUV",
                    "IT", "NBFC", "BPC", "PSU", "OEM", "API", "BFSI"}
_SECTOR_SMALL = {"&", "and", "of", "the", "to", "vs"}

def norm_sector(s):
    """Canonical-case a sector label; '' stays ''. Preserves acronyms/connectors."""
    s = (s or "").strip()
    if not s:
        return ""
    out = []
    for w in s.split():
        if w.upper() in _SECTOR_ACRONYMS:
            out.append(w.upper())
        elif w.lower() in _SECTOR_SMALL:
            out.append(w.lower())
        else:
            out.append(w[0].upper() + w[1:].lower())
    return " ".join(out)

def norm_sectors(seq):
    """Normalize a list of sector labels, dropping blanks and dupes (order kept)."""
    seen, out = set(), []
    for s in seq or []:
        n = norm_sector(s)
        if n and n not in seen:
            seen.add(n); out.append(n)
    return out

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
