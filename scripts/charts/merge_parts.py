# scripts/charts/merge_parts.py
"""Merge split-agent part files into a single analysis.json per slug.

Long reports (>~24 pages) exceed one vision agent's image budget, so they are
analysed by several agents over page ranges, each writing analysis.part*.json.
This merges those parts (concatenate 'pages', sort by page number) into the
canonical analysis.json. If part files exist they WIN (a stale full analysis.json
is overwritten). Slugs with no part files are left untouched.
"""
import json
from pathlib import Path

WORK = Path(__file__).resolve().parents[2] / "scripts" / ".charts-work"

def main():
    merged = 0
    for d in sorted(WORK.iterdir()):
        if not d.is_dir():
            continue
        parts = sorted(d.glob("analysis.part*.json"))
        if not parts:
            continue
        pages = []
        for p in parts:
            try:
                pages += json.loads(p.read_text(encoding="utf-8")).get("pages", [])
            except Exception as e:
                print("BAD PART", p.name, e)
        pages.sort(key=lambda pg: pg.get("page", 0))
        (d / "analysis.json").write_text(
            json.dumps({"pages": pages}, ensure_ascii=False), encoding="utf-8")
        merged += 1
        print(f"merged {d.name}: {len(parts)} parts -> {len(pages)} pages")
    print("slugs merged:", merged)

if __name__ == "__main__":
    main()
