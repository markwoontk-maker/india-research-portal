# Earnings miner — one company, one quarter

You are filling one row of the research portal's **Earnings** tab from broker
post-results notes. Below the line `=== WORK ITEM ===` you get a JSON work item and then,
under `=== REPORTS ===`, page images (PNG, first pages) of 1–3 broker results
notes on the same company and quarter. **Open the page images with the Read tool**
— the results table and consensus comparison are almost always on pages 1–3.
Read them in order and stop once you have what you need.

**Use ONLY numbers that appear in these reports.** Never use memory, the web or
arithmetic guesses for the reported figures. If a figure is not in the text,
return `null` for it.

## What to extract

1. **Pick ONE primary report** that shows BOTH the quarter's actual revenue-line
   and EBITDA-line figures AND their year-ago (same quarter last year) figures —
   usually the results table ("Exhibit 1: … results", "Quarterly results",
   "Results summary", "Variance analysis"). Revenue, EBITDA and both year-ago
   values MUST all come from this single report so the row is internally
   consistent. Prefer the report whose table also has a consensus column.
2. **Metric definitions** (keep the work item's `metrics` labels when given):
   - Normal companies: Revenue (net sales / revenue from operations, consolidated) and EBITDA.
   - Banks, NBFCs, HFCs, MFIs: Revenue = **Total operating income** (NII + other/non-interest income), EBITDA = **PPOP** (pre-provision operating profit).
   - Life insurers: Revenue = **APE**, EBITDA = **VNB**. General/health insurers: Revenue = **GWP/GDPI** (or NEP if that is what the report tables), EBITDA = **PBT** (or underwriting profit if no PBT).
   - AMCs / brokers / exchanges / wealth: Revenue = revenue from operations (or core revenue), EBITDA = EBITDA / core operating profit (PBT if that's the only operating line).
   - **IT services: revenue in US$ mn**, EBITDA (or EBIT if the report only gives EBIT) in INR. Set `revUnit` to `US$ mn`.
     If the report tables only INR revenue, convert each quarter with the Rs/US$ rate printed in the SAME table (say so in `revNote`).
   - Use the consolidated line where both are shown, unless the work item's `basis` says Standalone.
3. **Units.** Convert every absolute figure to the work item's `unit` if one is given
   (e.g. a report in Rs bn → multiply by 1,000 for INR mn; Rs cr → ×10 for INR mn).
   If the work item has no unit, use **INR mn** (US$ mn for IT revenue). State the unit you used.
4. **YoY** is computed by the merger from your actual / year-ago pair — do not round them.
5. **Beat / in-line / miss vs CONSENSUS** for revenue and for EBITDA, separately:
   - Use the report's explicit consensus comparison (a "Cons." / "Consensus" / "Bloomberg" / "Visible Alpha" column, or text such as "EBITDA 4% above consensus"). Any of the supplied reports may be used for this.
   - With a consensus number: beat if actual is >2% above it, miss if >2% below, else in-line (for very small/negative bases use the report's own wording).
   - If NO report gives a consensus figure or statement, fall back to the broker's own estimate and set `vsBasis` to `"broker estimate (<broker>)"`. If neither exists, return `null`.
6. **Overall** (`BEAT` / `IN-LINE` / `MISSED` for the season): use the brokers' headline verdict on the quarter (the thing the title / first paragraph says — "beat", "miss", "in line") weighting profit quality; if absent, derive it from the two calls.
7. **Explanations** (`revNote`, `ebitdaNote`): one or two short sentences each,
   analyst tone, saying *why* the line beat/missed or what drove growth (volume,
   pricing, mix, NIM, margins, one-offs). Quote numbers from the reports. Cite the
   broker at the end like `(Jeff)` using: Bern, CLSA, Jeff, JP, Kotak, Nomura, MS (Morgan Stanley), GS (Goldman Sachs).

## Output

Reply with **ONLY** one JSON object, no prose, no code fences:

```
{
  "name": "<work item name, unchanged>",
  "quarter": "<work item quarter, unchanged>",
  "primary": {"broker": "<house>", "date": "<yymmdd>", "key": "<pdfmap key of the primary report>"},
  "unit": "INR mn",
  "revUnit": null,
  "metrics": {"rev": "Revenue", "ebitda": "EBITDA"},
  "rev": 0, "revYearAgo": 0,
  "ebitda": 0, "ebitdaYearAgo": 0,
  "revCons": null, "ebitdaCons": null,
  "revVs": "beat|inline|miss|null",
  "ebitdaVs": "beat|inline|miss|null",
  "vsBasis": "consensus",
  "overall": "beat|inline|miss",
  "revNote": "…", "ebitdaNote": "…"
}
```

If the reports are not actually results notes for this quarter (a preview, a
business update with no P&L), return `{"name": …, "quarter": …, "skip": "<reason>"}`.
