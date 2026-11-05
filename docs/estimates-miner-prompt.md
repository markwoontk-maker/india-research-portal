# Estimates miner: one broker note on one company

You are reading one broker note for the research portal's **Company** tab. Below the line
`=== WORK ITEM ===` you get a JSON work item, then under `=== PAGES ===` a list of page
images (PNG) from that note. **Open each page image with the Read tool** and stop once you
have the numbers. The pages were picked because they look like they hold the forecast table.

**Accuracy matters more than speed.** Use ONLY numbers printed in these pages. Never use
memory, the web or guesses. If a figure is not printed, return `null`. Never calculate a
figure, except where rule 6 below says so.

## What to extract

This broker's annual figures for **FY26, FY27, FY28 and FY29** on three lines: the two named
in the work item (`metrics.rev` and `metrics.ebitda`), and **EPS**.

1. **Find the table.** Use the income statement or the financial summary table showing annual
   figures for the whole company. Prefer the fullest income statement over a smaller summary
   box. Do not use peer or comparison tables, sum-of-the-parts tables, or segment tables.
2. **Pick the right column for each year.** Column headers differ by house, and all of these
   mean the same year: `FY27E`, `FY27F`, `F27e`, `2027E`, `2027CL`, `Mar-27E`, `03/27e`, `3/27`.
3. **Take the broker's current estimate, not any other column.** Many tables also print other
   columns next to it:
   - `Old` / `Prior` / `Previous` next to `New` / `Current` / `Revised`: take **New**.
   - `Consensus` / `Street` / `Cons`: never take these.
   - `% change`, `% YoY`, `% diff`: never take these.
4. **Read along the row carefully.** Check that each number sits under the year you think it
   does, then re-read the row once before writing it. Quarterly columns are not annual figures.
5. **Pick the right row.**
   - `metrics.rev`: the company's total for that line. For `Revenue` this is net sales, net
     revenue or revenue from operations. Do not use gross sales or a single segment.
   - `metrics.ebitda`: as named. Prefer the adjusted or recurring figure if the table has only
     that one, and otherwise the main reported line. `EV/EBITDA` and margin rows are not EBITDA.
   - If `metrics` is null, use these by company type:
     - Most companies: `Revenue` and `EBITDA`.
     - Lenders: `Total op. income` and `PPOP`.
     - Life insurers: `APE` and `VNB`.
     - General insurers: `GWP` (or `NEP`) and `PBT`.
     - AMCs and exchanges: `Revenue` and `Operating PBT`, or `EBITDA` if printed.
6. **Lender equivalents.** `Total op. income` may be printed as `Total income`, `Net total
   income`, `Total revenue` or `Net revenue`. If the table prints only `Net interest income`
   and `Non-interest income` (or `Other income`), add those two and say so in `calcNote`.
   `PPOP` may be printed as `Operating profit`, `Pre-provision profit` or `Pre-provision
   operating profit`.
7. **Basis.** Use consolidated figures when the table is consolidated. Banks are often
   standalone, which is fine. Say which in `basis`. If the work item's `basis` names one and
   the note prints both, use the one it names.
8. **Units.** Report the unit of each series exactly, using one of: `INR mn`, `INR bn`, `INR cr`,
   `INR lakh`, `INR tn`, `US$ mn`, `US$ bn`. Find it from the table's caption or header such as
   `(Rs mn)`, `(Rsm)`, `INR bn`, `Rs crore`. Return numbers as printed: do not convert them.
9. **IT companies and others that print revenue in two currencies.** Put the US$ series in `rev`
   when `revUnit` in the work item is `US$ mn`, and the rupee series in `revAlt`. If only one
   currency is printed, use `rev` for it and leave `revAlt` null.
10. **Year-end.** Set `fye` to the month the company's year ends (`Mar`, `Dec`, `Sep`...). For a
    December year-end, the year ending December 2027 goes under `FY27`.
11. **Actuals count.** FY26 is usually an actual (`2026A`, `FY26`). Take it from the same table.

12. **EPS.** Rupees per share, as printed.
    - Prefer adjusted, normalised, recurring or core diluted EPS when printed (the one the broker
      values the stock on), otherwise reported diluted EPS. Write the printed label in `epsLabel`.
    - EPS may be in a different table or on a different page from revenue. Take it from any of the
      pages supplied, so long as it is this broker's current estimate.
    - Don't take `Consensus EPS`, `Prior EPS` or `Old` columns, EPS growth rows, or EVPS/DPS/BVPS.
    - If EPS is only printed per ADR or in US$, set `epsUnit` to `US$`. Otherwise `epsUnit` is `INR`.
    - If no EPS is printed, leave `eps` null. This does not make the result `found: false`.

## If there is no usable forecast table

Set `found` to `false` and give a one-line `reason`. This is a normal outcome (first-cut
notes, event notes and meeting notes often have no table). Don't force an answer from text
in a paragraph. If only one of revenue and EBITDA is printed, set `found` to `true`, fill that one
and leave the other `null`. If only EPS is printed, with neither revenue nor EBITDA, set `found`
to `false`.

## Output

Return one JSON object and nothing else, with no markdown fences:

{
  "found": true,
  "reason": null,
  "page": 3,
  "revLabel": "Net sales",
  "ebitdaLabel": "EBITDA",
  "basis": "consolidated",
  "fye": "Mar",
  "revUnit": "INR mn",
  "rev": { "FY26": 1832661, "FY27": 2165976, "FY28": 2443187, "FY29": 2677734 },
  "ebitdaUnit": "INR mn",
  "ebitda": { "FY26": 214502, "FY27": 205503, "FY28": 281025, "FY29": 321076 },
  "revAlt": null,
  "revAltUnit": null,
  "epsLabel": "Adj. EPS",
  "epsUnit": "INR",
  "eps": { "FY26": 466.9, "FY27": 433.48, "FY28": 555.1, "FY29": 640.25 },
  "calcNote": null
}

`page` is the PDF page number of the table you used, as listed in `=== PAGES ===`. Negative
numbers stay negative (a bracketed `(331)` is `-331`). Remove thousands separators. Keep `basis`
to one or two words (`consolidated`, `standalone`). `calcNote` stays `null` unless you added
two lines together under rule 6.
