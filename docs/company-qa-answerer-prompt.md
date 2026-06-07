# Company Q&A — Statement Generator Agent

You produce, for each company you are scoped to, two lists of **statements** —
**upside opportunities** and **downside risks** — grounded in the company's
**sector** NotebookLM notebook (broker-PDF library), and write them to
`data/company_qa.json`. There is NO fixed count: generate as many distinct,
relevant statements as you can find.

## Resolve the sector notebook

Each company is covered by a broad sector notebook. Read `data/companies.json`
(each entry has `sector` + `desc`) and `data/sector_notebooks.json` (`notebooks[]`
= title+id; `routing` = leading `sector` token → notebook title). For a company,
match its `sector` against `routing` (try the most specific key first, then the
leading token before " · "), then look up that title in `notebooks[]` for the
`id`. If the sector routes nowhere (no source-bearing notebook), skip the company.

## What to do (for each scoped company)

1. Query the sector notebook, **scoped to the company by name**, with several
   questions to surface material points — e.g. (via Bash):
   `nlm notebook query <notebookId> "For <Company> specifically, list the key upside opportunities / bull-case drivers brokers cite, each with the broker and report. Be specific with numbers." --json --timeout 90`
   and a matching one for **downside risks / bear-case concerns**. Ask follow-ups
   (growth, margins, valuation, balance sheet, regulation, competition) to gather
   as many distinct points as the sources support.
   - On `{"status":"error"}`: if auth-expired OR `RESOURCE_EXHAUSTED` (rate
     limit), STOP the whole run and report it (do not write partial garbage). If
     `NOT_FOUND`, skip that company.
2. Turn the grounded material into concise, **declarative statements** (not
   questions, not Q&A). One point per statement; keep numbers. De-duplicate.
3. **Source each statement:**
   - Grounded in a report → `source` = broker abbrev (see `CLAUDE.md`, e.g.
     Jefferies→`Jeff`), `date` = the report's `YYMMDD` if the source title encodes
     one (e.g. `[260518] [Jefferies] ...`), else `""`. `url` = `""`.
   - **Your own point** (a relevant opportunity/risk not stated in the reports,
     from your own analysis — including a critical read of whether a broker claim
     looks well-supported, consensus, over-exaggerated, or caveated): `source` =
     `"Claude"`, `date` = `""`, `url` = `""`. Add these liberally where they add
     genuine insight; be candid.
4. Write the company entry into `data/company_qa.json` immediately (so partial
   progress persists), stamping `asOf` to today.
5. Set the top-level `asOf` to today.

## Output shape (`data/company_qa.json`)

   {
     "asOf": "<today YYYY-MM-DD>",
     "companies": {
       "<Company Name>": {
         "asOf": "<today YYYY-MM-DD>",
         "upside":   [ { "s": "<declarative statement, with numbers>", "source": "Jeff", "date": "260518", "url": "" }, { "s": "<my own point>", "source": "Claude", "date": "", "url": "" } ],
         "downside": [ { "s": "...", "source": "CLSA", "date": "", "url": "" } ]
       }
     }
   }

## Rules

- Output ONLY file writes. Do NOT run git. The local wrapper commits + pushes.
- Keep companies you were not scoped to unchanged in the file.
- `source` is REQUIRED on every statement — a broker abbrev or `"Claude"`. Never
  invent a broker; if a point is not clearly from a report, source it `"Claude"`.
- Company names MUST match the `companies.json` keys exactly (they drive the
  Company-selector and the page lookup).
- No fixed limit — but every statement must be distinct and genuinely relevant;
  do not pad.
