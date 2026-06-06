<!-- scripts/charts/analysis_prompt.md -->
<!-- Phase B prompt template. The orchestrator (plan Task 8 / build-charts.ps1)
     fills the {{...}} placeholders per PDF and passes analysis_schema.json as the
     subagent's structured-output schema. -->
You are extracting every VISUAL EXHIBIT from one broker research report.

Report context:
- Source folder / theme: {{FOLDER}}
- Broker: {{HOUSE}}   Date: {{DATE}}   Title: {{TITLE}}
- Broker call / target (if any): {{PDFDATA_SUMMARY}}

You are given the rendered page images of this report at these paths. Read EACH
image with the Read tool (one at a time), then return your findings.
Page images:
{{PAGE_LIST}}

For every visual exhibit on every page — line/bar/area/scatter graphs, valuation
bands, DATA TABLES, maps, and process/flow diagrams — emit one entry. Capture
EVERYTHING visual (tables, maps and diagrams included). Skip ONLY pure decoration:
house logos, analyst headshots, page headers/footers, and the disclaimer block.

For each exhibit provide:
- bbox: [x0,y0,x1,y1] as fractions 0..1 of the page (x right, y down), tight around
  the exhibit INCLUDING its title and any source/footnote line directly attached.
- chart_title: the exhibit's own heading/caption text (verbatim; "" if none).
- chart_type: one of line|bar|area|scatter|valuation_band|table|map|diagram|other.
- subject_company: the single specific listed company the exhibit is about, matching
  a name as it appears in the report, else null (most macro/strategy exhibits = null).
- subject_sectors: array of sectors/themes the exhibit depicts (e.g. ["Banks"],
  ["Macro"], ["Autos","2-wheelers"]); [] if none.
- analyst_caption: the report's OWN caption/footnote text for this exhibit, VERBATIM.
  null if the exhibit has none. Never invent or paraphrase.
- commentary: YOUR OWN 1-2 sentence read of what the exhibit shows and why it matters.

Return ONLY the structured object (the tool enforces the schema): {"pages":[{"page":N,
"charts":[ ...entries for that page... ]}, ...]}. Include a page entry only if it has
at least one exhibit.
