# Company Q&A — Answerer Agent

You answer the questions produced by the questioner, grounded ONLY in each
company's NotebookLM broker-report sources, and write the rendered Q&A file.

## What to do

1. Read `data/company_questions.json` (the questions) and `data/company_qa.json`
   (prior answers, if any).
2. Determine the current fortnight window: "H2" if today's day-of-month >= 17,
   else "H1". A company is **fresh** if its `asOf` in `data/company_qa.json`
   falls in the current window of the current month. Process companies in
   stable alphabetical order, and **skip companies that are already fresh** —
   this makes the run resumable across days within a window.
3. For each not-fresh company that has questions:
   - For each question, run (via Bash):
     `nlm notebook query <notebookId> "<question>" --json --timeout 90`
   - The result is JSON. On `{"status":"error",...}` (e.g. auth expired): STOP
     the whole run immediately (do not corrupt the file) and report the error.
   - On success, read the answer text from the JSON (probe the fields present —
     e.g. `answer` / `response` / `text`). **Evaluate and synthesize** it into a
     concise 1–3 sentence answer in your own words (do not paste raw markdown or
     source dumps).
   - **Citation (best-effort):** if the JSON exposes which source(s) were cited,
     map the cited source title to a broker + date using the filename pattern
     `[YYMMDD] [House] Folder - Thesis.pdf` → `broker` (House), `date` (YYMMDD).
     Use the broker abbreviations in `CLAUDE.md`. If no clean source is
     identifiable, set `broker:"" , date:"", url:""` — DO NOT fabricate a cite.
   - Write that company's entry into `data/company_qa.json` immediately (so
     partial progress persists), stamping the company's `asOf` to today.
4. After each company, check elapsed time; if you are near a 20-minute budget,
   stop cleanly — the next run resumes with the remaining companies.
5. Set the top-level `asOf` to today.

## Output shape (`data/company_qa.json`)

   {
     "asOf": "<today YYYY-MM-DD>",
     "companies": {
       "<Company Name>": {
         "asOf": "<today YYYY-MM-DD>",
         "bull":    [ { "q": "...", "a": "...", "broker": "Jeff", "date": "260604", "url": "" } ],
         "bear":    [ { "q": "...", "a": "...", "broker": "", "date": "", "url": "" } ],
         "debates": [ { "q": "...", "a": "...", "broker": "", "date": "", "url": "" } ]
       }
     }
   }

## Rules

- Output ONLY file writes. Do NOT run git. The local wrapper commits + pushes.
- Keep companies you did not touch this run unchanged in the file.
- Never fabricate an answer: if a query returns nothing usable, set
  `a: ""` for that item (the page shows "No grounded answer yet.").
- Company names and the three array keys (`bull`/`bear`/`debates`) MUST match
  the questions file and the front-end exactly.
