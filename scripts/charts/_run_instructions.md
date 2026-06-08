# Charts pilot — vision extraction instructions (shared)

You extract every VISUAL EXHIBIT from ONE broker research report so it can appear in a charts gallery. Your dispatch message gives you: the source folder/theme, broker, date, title, the absolute folder holding the rendered page PNGs, and the page count. Pages are named `p01.png, p02.png, …`.

## Steps
1. Read EACH page image with the Read tool, one at a time (absolute folder path + `pNN.png`). Read every page; never guess the content of a page you have not read.
2. Emit one entry for every **CHART** (plotted data graph: line, bar, area, scatter,
   valuation band), **MAP**, or **process/flow DIAGRAM**. **DO NOT** include data
   tables, org charts, logos, headshots, photos, headers/footers, or the disclaimer
   block — **no tables**.
   Also **SKIP the broker's automated rating / target-price history chart** — a
   closing-price line annotated with "Target Price Change" / "Recommendation
   Change(s)" markers (triangles/dots), usually titled just the company name and
   sitting next to a Date / Rating / Target price / Closing price table, near the
   disclosures. Treat it like a table (do not emit). Real analytical charts (valuation
   bands, P/E history, fundamentals) ARE still captured.
3. WRITE the result with the Write tool to the exact analysis.json path given in your dispatch. Then report: pages-with-exhibits count, total exhibit count, and one example commentary string.

## Each exhibit object (ALL keys required)
- `bbox`: `[x0,y0,x1,y1]` as fractions 0..1 of the page (x→right, y→down). Bound it
  **TIGHTLY** around THIS ONE exhibit — its own heading/"Exhibit N:" title at the top
  down to its Source/footnote line at the bottom. **EXCLUDE**: the broker header band
  / logo / page number at the very top of the page, page footers, AND any neighbouring
  exhibit or section heading above/below this one. If a page has two exhibits, give two
  bboxes that do NOT overlap each other or include the other's title. Do not default to
  near-full-page boxes — crop to just the exhibit so it fills the frame with minimal
  blank space.
- `chart_title`: the exhibit's own heading/caption text, verbatim (`""` if none).
- `chart_type`: one of `line bar area scatter valuation_band table map diagram other`.
- `subject_company`: the single specific listed company the exhibit is about (a real company name as printed), else `null`. Most macro/strategy/sector exhibits are `null`; set it only when an exhibit is about ONE company (e.g. a single-stock valuation band or price chart).
- `subject_sectors`: array of sectors/themes the exhibit depicts, e.g. `["Banks"]`, `["Macro"]`, `["Autos","2-wheelers"]` (`[]` if none).
- `analyst_caption`: the report's OWN caption/source/footnote text for this exhibit, VERBATIM. `null` if it has none. NEVER invent or paraphrase.
- `commentary`: YOUR OWN commentary — a CONCISE ANALYST READ: 1-2 sentences in a neutral buy-side voice stating what the exhibit shows AND the so-what (the implication for the stock/sector/market). Factual, no hype.

## Output file shape (valid JSON, UTF-8, no trailing commas)
```
{"pages":[{"page":1,"charts":[ {…entry…}, … ]}, {"page":3,"charts":[ … ]}, …]}
```
Include a page entry ONLY for pages that have at least one exhibit; omit empty pages.
Return Status DONE after writing, or BLOCKED if you cannot proceed.
