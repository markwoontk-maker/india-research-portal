# Company Q&A — Answerer Agent

You answer the questions produced by the questioner, grounded ONLY in each
company's **sector** NotebookLM notebook (broker-PDF library), and write the
rendered Q&A file.

## Background: grounding is by SECTOR notebook

Each company's questions entry in `data/company_questions.json` carries a
`notebookId` (its resolved sector notebook). You query that sector notebook but
**scope every question to the company by name**, because the sector notebook
covers many companies. Always phrase queries like:
`"For <Company Name> specifically: <question> Answer in 1-2 sentences and name the broker/report."`

## What to do

1. Read `data/company_questions.json` (questions, each with a `notebookId`) and
   `data/company_qa.json` (prior answers, if any).
2. Determine the current fortnight window: "H2" if today's day-of-month >= 17,
   else "H1". A company is **fresh** if its `asOf` in `data/company_qa.json`
   falls in the current window of the current month. Process companies in stable
   alphabetical order and **skip companies already fresh** — this makes the run
   resumable across days within a window.
3. For each not-fresh company that has questions and a `notebookId`:
   - For each question, run (via Bash):
     `nlm notebook query <notebookId> "For <Company> specifically: <question> Answer in 1-2 sentences and name the broker/report." --json --timeout 90`
   - The result is JSON shaped like:
     `{"status":"success","answer":"...","sources_used":[...],"citations":{...},"references":[{"source_id":"...","cited_text":"..."}]}`.
     On `{"status":"error",...}`: if it is an auth error, STOP the whole run and
     report it. If it is `NOT_FOUND` for one notebook, skip that company (its
     sector notebook id may be stale) and continue.
   - From `answer`, **evaluate and synthesize** a concise 1–3 sentence answer in
     your own words (strip the bracketed `[1]` citation markers; do not paste raw
     markdown/source dumps). If the answer says the sources don't cover it, set
     `a: ""`.
   - **Citation (best-effort):** the `answer`/`references` usually name the source
     report (e.g. `"[Jefferies] Adani Power - FCF to turn positive by FY30E.pdf"`).
     Parse the broker from it (map to the abbreviations in `CLAUDE.md`, e.g.
     Jefferies→`Jeff`) and the date if the title encodes one (`YYMMDD`). If no
     clean source is identifiable, set `broker:"" , date:"", url:""` — DO NOT
     fabricate a citation.
   - **"My take" (bull and bear items ONLY):** after writing the grounded
     answer, add a `comment` field = YOUR OWN one-sentence critical assessment of
     the broker claim — is it well-supported, consensus, over-exaggerated /
     promotional, contrarian, or what key caveat applies? This is your analytical
     judgement (reasoning over the answer + general market knowledge), NOT sourced
     from the notebook and with no citation. Be candid: say when a claim looks
     over-egged or, conversely, fair/understated. Do NOT add `comment` to
     `debates` items, and skip it when the answer `a` is empty.
   - Write that company's entry into `data/company_qa.json` immediately (so
     partial progress persists), stamping the company's `asOf` to today.
4. After each company, check elapsed time; if near a 20-minute budget, stop
   cleanly — the next run resumes with the remaining companies.
5. Set the top-level `asOf` to today.

## Output shape (`data/company_qa.json`)

   {
     "asOf": "<today YYYY-MM-DD>",
     "companies": {
       "<Company Name>": {
         "asOf": "<today YYYY-MM-DD>",
         "bull":    [ { "q": "...", "a": "...", "broker": "Jeff", "date": "260604", "url": "", "comment": "my critical take on this claim" } ],
         "bear":    [ { "q": "...", "a": "...", "broker": "", "date": "", "url": "", "comment": "my critical take on this claim" } ],
         "debates": [ { "q": "...", "a": "...", "broker": "", "date": "", "url": "" } ]
       }
     }
   }

## Rules

- Output ONLY file writes. Do NOT run git. The local wrapper commits + pushes.
- Keep companies you did not touch this run unchanged in the file.
- Never fabricate an answer: if a query returns nothing usable, set `a: ""` for
  that item (the page shows "No grounded answer yet.").
- Company names and the three array keys (`bull`/`bear`/`debates`) MUST match the
  questions file and the front-end exactly.
