# News refresher routine — prompt & setup

Pre-builds `data/news.json` so the **"News You Need to Know"** card on the
dashboard paints **instantly** (no proxy round-trip on first load). The page
reads `data/news.json` client-side, paints the matching segment immediately,
then refreshes live via the free proxy in the background (see `loadNews()` in
`index.html`). Everything is keyless — no secrets anywhere.

## Why this exists

On a static site the News card fetches Google-News RSS through free CORS
proxies (rss2json / allorigins), which are slow (~1–3 s each) and rate-limited.
Even with the in-page fast lane, first paint depends on those proxies. A daily
routine that bakes the digest into `data/news.json` removes that dependency —
the card shows yesterday-to-now's curated headlines the moment the tab opens,
and the live fetch only tops it up.

## JSON contract (what the dashboard reads)

`data/news.json` — one curated, deduped, capped-at-20 list per segment:

```json
{
  "updated": "2026-06-04T02:00:00Z",
  "segments": {
    "ALL":  [ {"title":"…","link":"https://…","pubDate":"Wed, 04 Jun 2026 06:30:00 GMT","source":"Reuters","cat":"ECON"} ],
    "POL":  [ … ],
    "EARN": [ … ],
    "CORP": [ … ]
  }
}
```

- `cat` is one of `POL` | `ECON` | `WIRE` | `EARN` | `CORP` (drives the colour tag
  and the tiered ordering: POL → ECON/WIRE → EARN/CORP).
- `pubDate` must be an RFC-822 / parseable date string (Google News RSS format is fine).
- Items should already be **filtered, deduped and ordered** exactly as the page
  would — the page paints the array as-is. Cap each segment at 20.

## One-time setup (analyst)

1. **Create a routine** at https://claude.ai/code/routines (model
   `claude-sonnet-4-6`; tools `Bash, Read, Write, Edit, WebSearch, WebFetch`;
   Gmail connector optional). No secret needed — this routine is keyless.
2. **Cron (UTC):** `0 1,7,13 * * *` — ~06:30, 12:30, 18:30 IST (a few refreshes a
   day; safe to run more or less often, it just overwrites).
3. **Paste the prompt below** into "Initial message", then enable.

---

```
ROLE
You maintain data/news.json, which pre-builds the "News You Need to Know" card on the India Research Portal (static GitHub Pages site, repo markwoontk-maker/india-research-portal, branch main). Each run you fetch recent India macro / markets / corporate headlines, filter them to clear present-tense FACTS, dedupe, order, cap at 20 per segment, and write data/news.json. Everything is keyless — never add an API key.

STEP 1 — DATE
- `date -u` for current UTC. The freshness window is the last 48 hours.

STEP 2 — FETCH (Google News RSS, keyless)
For each bucket below, fetch the Google News RSS search feed:
  https://news.google.com/rss/search?q=<URL-ENCODED-QUERY>&hl=en-IN&gl=IN&ceid=IN:en
Parse the <item> entries (title, link, pubDate, and the source name from <source> or the trailing publisher in the title/description). Use these queries (when:2d):
- POL  : India (cabinet OR PMO OR ministry OR "fuel price" OR "excise duty" OR "windfall tax" OR budget OR GST OR tariff OR reform OR disinvestment OR "trade deal" OR policy OR election OR parliament) when:2d
- ECON : India (inflation OR CPI OR WPI OR repo OR "interest rate" OR "rate cut" OR "rate hike" OR RBI OR "monetary policy" OR GDP OR IIP OR "industrial production" OR "fiscal deficit" OR "current account" OR FII OR FDI OR rupee OR "USD-INR" OR "bond yield") when:2d
- EARN : India (Q4 results OR Q1 results OR quarterly results OR earnings OR "net profit" OR PAT OR revenue OR EBITDA) when:2d
- CORP : India (merger OR acquisition OR "stake sale" OR demerger OR "open offer" OR buyback OR "board approves" OR resigns OR "steps down" OR "appointed as" OR "new CEO" OR "new MD" OR "joint venture" OR QIP OR "fund raise" OR "order win") when:2d
- WIRE : (site:reuters.com OR site:bloomberg.com OR site:apnews.com) India (economy OR markets OR stocks OR rupee OR RBI OR Sensex OR Nifty OR inflation OR GDP OR earnings OR trade OR tariff) when:2d

STEP 3 — FILTER (fact-only)
Drop a headline if ANY of these match (mirror the page's filters):
- Structural noise: live updates / "what to expect" / "stocks to watch" / "in focus" / "N things|reasons|stocks" listicles / "key takeaways" / "all you need to know" / "here's why|how|what" / preview / explained / explainer / breakdown / outlook / forecast / projected / "likely to" / "expected to" / "aims to" / "to reach|boost|hit|cross" / "report:" / "seen at".
- Named-pundit opinion: "<Proper Name> says|warns|flags|expects|predicts|believes|…" (but KEEP institutions: RBI, SEBI, Govt, Cabinet, Ministry, Court, IMF, etc.).
- Question-form headlines (start with will/why/how/what/should/can/could/are/is/does/did).
For EARN keep only genuine results/earnings items; for CORP keep only genuine corporate-action items; for POL/ECON/WIRE keep market-relevant items.

STEP 4 — BUILD SEGMENTS
- ALL  = POL + ECON + EARN + CORP + WIRE combined.
- POL  = POL bucket only. EARN = EARN only. CORP = CORP only.
For each segment: sort by pubDate desc; dedupe by company (ticker if identifiable, else lead-company name, else normalised title); cap at 20. For ALL, order by tier POL(0) → ECON/WIRE(1) → EARN/CORP(2), newest first within a tier.

STEP 5 — WRITE JSON
Produce exactly:
{
  "updated": "<ISO8601 UTC>",
  "segments": { "ALL":[…], "POL":[…], "EARN":[…], "CORP":[…] }
}
Each item: {"title","link","pubDate","source","cat"} where cat ∈ POL|ECON|WIRE|EARN|CORP.
Validate it parses: node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' < the-json

STEP 6 — DELIVER
If you have push access: clone/pull markwoontk-maker/india-research-portal, write data/news.json, commit ("chore: refresh news.json — <DD Mon YYYY>"), push to main (auto-publishes via GitHub Pages). Otherwise draft a Gmail (do NOT send) to markworktk@gmail.com with the JSON in a fenced ```json block. Always also print the JSON to session output.

STEP 7 — INTEGRITY
- Keyless only. No fabricated headlines, links, or dates — every item traces to a real RSS entry. Touch only data/news.json.

Begin now.
```
