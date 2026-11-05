"""Render chosen pages of one broker PDF to PNG for the estimates miner.

  uv run --python 3.12 --with pymupdf python -I scripts/estimates/render_note.py <out_dir> <pdf> <page> [<page> ...]

Writes <out_dir>/p<page>.png (1-based page numbers) and prints one path per image.
Forecast tables are read from images because pdftotext shifts their row labels away
from the numbers on several houses' layouts.
"""
import os
import sys

import pymupdf as fitz

DPI = 130


def main():
    out_dir, pdf, pages = sys.argv[1], sys.argv[2], [int(p) for p in sys.argv[3:]]
    os.makedirs(out_dir, exist_ok=True)
    doc = fitz.open(pdf)
    for p in pages:
        if 1 <= p <= doc.page_count:
            path = os.path.join(out_dir, f'p{p}.png')
            doc[p - 1].get_pixmap(dpi=DPI).save(path)
            print(path)


if __name__ == '__main__':
    main()
