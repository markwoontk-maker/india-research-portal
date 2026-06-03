# Macro refresher routine — prompt & setup

Pushes fresh **official** MoSPI prints (IIP, CPI) into the India Macro Snapshot
card on the dashboard, via `data/macro.json`. The data.gov.in API key lives only
in the routine's secret — it is **never** in `index.html` and never pasted into
chat. The dashboard reads `data/macro.json` client-side and overlays the figure
onto the matching broker row by `id` (see `applyMacroOverlay()` in `index.html`).

## Why this exists

The keyless DBnomics rows already on the dashboard (FX reserves, CPI, policy
rate, tagged `IMF/BIS · live`) lag ~12 months. data.gov.in / MoSPI is the
authoritative, near-current source for IIP and CPI but needs a free API key, so
it can only be fetched server-side by a routine — not from the static bundle.

## One-time manual setup (analyst — do these yourself)

1. **Register for a data.gov.in API key** at https://data.gov.in (Sign Up →
   account page shows "My API Key"). Free, instant. **Do not paste the key here
   or into `index.html`.**
2. **Create a new routine** at https://claude.ai/code/routines (model
   `claude-sonnet-4-6`; tools `Bash, Read, Write, Edit, WebSearch, WebFetch`;
   Gmail connector on).
3. **Store the key as a routine secret** named `DATA_GOV_KEY` (routine Settings →
   Secrets). The prompt reads it via `$DATA_GOV_KEY`.
4. **Cron (UTC):** `0 2 13-16 * *` — mid-month 07:30 IST, catching the monthly
   IIP/CPI release (~12th). Re-running across a few days is safe (idempotent —
   each run just overwrites with the latest print).
5. **Paste the prompt below** into the routine's "Initial message" field, then
   flip the routine to **enabled**.

## JSON contract (what the dashboard reads)

`data/macro.json` — overlay keyed by the row `id` in `MACRO_REPORTS`:

```json
{
  "updated": "2026-06-14T02:00:00Z",
  "indicators": {
    "iip": { "value": "+4.2%", "period": "Apr 2026", "src": "MoSPI · 12 Jun 26", "tone": "pos" },
    "cpi": { "value": "5.1%",  "period": "May 2026", "src": "MoSPI · 12 Jun 26", "tone": "neg" }
  }
}
```

- Only keys present are overlaid; absent keys leave the broker row untouched.
- `tone`: `"pos"` (green) | `"neg"` (red) | `""` (neutral).
- Overlaying `cpi` replaces the JPM forecast row with the official actual print
  (clearly re-sourced to MoSPI + the actual month). `iip` overlays the IIP
  actual onto its broker row.

---

```
ROLE
You maintain data/macro.json, which feeds the "India Macro Snapshot" card on the India Research Portal (static GitHub Pages site, repo markwoontk-maker/india-research-portal, branch main). Each run you fetch the latest official MoSPI prints for Index of Industrial Production (IIP) and Consumer Price Index (CPI) inflation from the data.gov.in API, build the JSON below, and deliver it. The data.gov.in API key is in the env var DATA_GOV_KEY — NEVER print it, echo it, or include it in any output, Gmail, commit, or file.

STEP 1 — DATE
- `date -u` for the current UTC date; convert to IST for human-readable source dates (format "DD Mon YY", e.g. "12 Jun 26").

STEP 2 — FETCH IIP (Index of Industrial Production, YoY growth)
- Find the current data.gov.in resource for MoSPI "Index of Industrial Production" (general index, monthly, with YoY growth). Locate the resource id via the catalog: WebSearch `site:data.gov.in Index of Industrial Production resource` and/or query the catalog API. Resource ids on data.gov.in change over time — confirm the one you use actually returns recent monthly rows.
- Call: `https://api.data.gov.in/resource/<RESOURCE_ID>?api-key=$DATA_GOV_KEY&format=json&limit=24&sort[<date-field>]=desc` (use curl via Bash; never log the URL with the key — redact it in any output).
- Take the most recent month's General Index YoY growth %. If the resource gives index levels only, compute YoY = (latest / same-month-prior-year − 1) × 100.
- value: signed percent, 1 dp, e.g. "+4.2%" or "−1.3%". period: "<Mon YYYY>" of the print. tone: "pos" if YoY ≥ 0 else "neg".

STEP 3 — FETCH CPI (Consumer Price Index, combined, YoY inflation)
- Find the current data.gov.in resource for MoSPI "Consumer Price Index" (Combined / All-India, monthly, with inflation rate). Confirm it returns recent rows.
- Call the same way with the key in $DATA_GOV_KEY.
- Take the most recent month's All-India Combined CPI inflation (YoY) %. If only the index is given, compute YoY as above.
- value: percent, 1 dp, e.g. "5.1%". period: "<Mon YYYY>". tone: "neg" if inflation > 6.0 (above RBI upper band), else "".

STEP 4 — FALLBACK IF API FAILS
- If a data.gov.in resource 404s, is empty, or the key is rejected for a series, do NOT fabricate. Fall back to WebSearch for the official MoSPI press-release figure for that month (mospi.gov.in, pib.gov.in, or a reputable wire reporting the official MoSPI number). Cite the source date. If you cannot verify a figure, OMIT that indicator key entirely (leave the broker row to stand).

STEP 5 — BUILD JSON
Produce exactly this shape (omit any indicator you could not verify):
{
  "updated": "<ISO8601 UTC timestamp>",
  "indicators": {
    "iip": { "value": "<signed %>", "period": "<Mon YYYY>", "src": "MoSPI · <DD Mon YY>", "tone": "pos|neg" },
    "cpi": { "value": "<%>",        "period": "<Mon YYYY>", "src": "MoSPI · <DD Mon YY>", "tone": "neg|" }
  }
}
Validate it parses: `node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' < the-json`.

STEP 6 — DELIVER
Two paths — do whichever your environment supports, preferring (A):
(A) If you have push access to the repo: clone/pull markwoontk-maker/india-research-portal, write the JSON to data/macro.json, commit ("chore: refresh macro.json — IIP/CPI <Mon YYYY>") and push to main. It auto-publishes via GitHub Pages. NEVER commit the key or the .env.
(B) Otherwise: draft a Gmail (do NOT send) to markworktk@gmail.com:
    Subject: `Macro Refresher | <DD Mon YYYY> | IIP <Mon> · CPI <Mon>`
    Body L1: which months you got and from where (API vs press release).
    Body L2: "Paste the JSON below into the repo at data/macro.json (overwrite). Auto-publishes via GitHub Pages."
    Then a fenced ```json block with the validated JSON.
ALWAYS also print the full JSON to session output as a fallback.

STEP 7 — INTEGRITY
- NEVER print, log, email, or commit DATA_GOV_KEY or any URL containing it. Redact as `api-key=***`.
- No fabricated figures. Every number traces to the data.gov.in API or a cited official source.
- If both API and press-release verification fail for an indicator, omit it — never guess.
- Touch only data/macro.json. Do not edit index.html or any other file.

Begin now.
```
