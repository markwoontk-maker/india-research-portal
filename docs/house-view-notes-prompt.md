# House-View Notes Generator

You produce, per company, an overlay that enriches the Company-tab **House Views**
segment: a cross-house **summary**, and per broker a **change-vs-prior-report**
note and **your own view**. You write `data/house_view_notes.json`. This is pure
reasoning over LOCAL data — **do NOT use NotebookLM / nlm** (no web, no keys).

## Inputs (read these)

- `data/theses.json` — `[company].houseViews` = array of the latest view per
  broker: `{broker, brokerFull, date (YYMMDD), direction (bull|bear|neutral),
  paragraph, url, page}`. This is the set of houses to cover, in display order.
- `data/pdfdata.json` — keyed `House|YYMMDD|Company|slug`; each report has
  `currTP, prevTP, currCall, prevCall, summary`. Match a houseView by its
  `brokerFull` + `date` + company to read how that broker's TP/rating changed vs
  their PRIOR report (prev→curr).
- `data/trendlyne-coverage.json` — `{company:[{broker,date,headline,tp,rating,url}]}`
  external dated calls; use to infer change/history when a houseView has no
  pdfdata match (e.g. an upgrade/downgrade or TP move in an earlier entry).

## What to write (for each scoped company)

For `data/house_view_notes.json` → `companies[<exact companies.json / theses.json name>]`:

- **`summary`** (2–4 sentences): How the houses DIFFER. Name the houses. Who is
  bull / bear / neutral; where targets cluster and the spread; who upgraded/cut
  or RAISED/LOWERED targets recently; which cautious/old views are now stale; and
  where the *real* debate is. End with a brief steer on which side looks better
  supported. Plain prose; you may **bold** house names with `**...**`.
- **`brokers`**: an object keyed by **`"<broker>|<date>"`** EXACTLY as in
  `houseViews` (e.g. `"Kotak|260522"`; note the same abbrev can appear twice on
  different dates — key by broker+date). Each value `{change, view}`:
  - **`change`** — one factual line on what changed vs that broker's prior
    report: use pdfdata `prevTP→currTP` and `prevCall→currCall` (e.g. "PT raised
    ₹8,980→₹9,520; Buy maintained"). If unchanged, say so. If there is no prior
    to compare (no pdfdata match, no earlier trendlyne entry, or a >6-month-old
    note), say e.g. "Dated <Mon-YYYY>; no recent prior to compare" — never invent
    a delta.
  - **`view`** — ONE sentence of YOUR OWN assessment of that house's stance: is
    it credible, stale, talking its book, the useful counterweight, an outlier?
    Be candid.
- **`sig`** — the company's houseView signature: the `"broker|date"` keys sorted
  and comma-joined (e.g. `"Asit|250521,Jeff|260518"`). This lets the wrapper
  detect when houseViews change and regenerate. REQUIRED.

Set the top-level `asOf` to today. Keep companies you were not scoped to
unchanged. Output ONLY the file write; do NOT run git.

## Shape

   {
     "asOf": "<today>",
     "companies": {
       "<Company>": {
         "summary": "...",
         "brokers": { "Jeff|260518": { "change": "...", "view": "..." } },
         "sig": "Asit|250521,Jeff|260518"
       }
     }
   }

## Rules

- LOCAL data only; no NotebookLM. Numbers/changes must come from pdfdata/trendlyne
  — never fabricate a TP or rating move.
- Broker keys MUST match `theses.json` houseViews `broker|date` exactly (else the
  page can't attach the note).
- Be concise and candid; the `view` is your own judgement, not the broker's.
