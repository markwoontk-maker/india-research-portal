"""Render the first pages of broker PDFs to PNG for the earnings miner.

  uv run --python 3.12 --with pymupdf python -I scripts/earnings/render_pages.py <out_dir> <pages> <pdf> [<pdf> ...]

Writes <out_dir>/r<n>_p<k>.png (report n = argument order, page k) and prints
one line per image. Results tables survive as images where pdftotext's
column layout scrambles them; the Claude Read tool views the PNGs.
"""
import os
import sys

import fitz  # pymupdf


def main():
    out_dir, pages, pdfs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
    os.makedirs(out_dir, exist_ok=True)
    for n, pdf in enumerate(pdfs, 1):
        try:
            doc = fitz.open(pdf)
        except Exception as e:  # unreadable PDF: skip, the miner uses the others
            print(f'ERR r{n} {e}', file=sys.stderr)
            continue
        for k in range(min(pages, doc.page_count)):
            path = os.path.join(out_dir, f'r{n}_p{k + 1}.png')
            doc[k].get_pixmap(dpi=110).save(path)
            print(path)


if __name__ == '__main__':
    main()
