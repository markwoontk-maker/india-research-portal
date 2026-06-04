# FII/DII Flows Refresher — routine prompt

Paste this into the routine's **Initial message** field at
https://claude.ai/code/routines (create a new routine if there isn't one yet),
then flip it to **enabled**.

Suggested cron (UTC): `30 1 * * 1-5` — **Mon–Fri 01:30 UTC = 9:30 AM Malaysia time
(MYT)**. By that hour the previous Indian trading day's provisional cash figures
(published ~7 pm IST the evening before) are final. Lines up with the portal's
other ~09:3x MYT morning routines.

Repo: `markwoontk-maker/india-research-portal` · branch `main`.
Tools: `Bash, Read, Write, Edit, WebFetch, WebSearch` · model `claude-sonnet-4-6`.

---

You maintain the **Positioning** tab on the India Research Portal dashboard
(static GitHub Pages site). Once each weekday morning you append any newly
published daily FII/DII cash-market net flows to `data/fii_dii.json` and push.
The static page renders it via `loadPositioning()` in index.html — no other code
changes.

### The data file

`data/fii_dii.json` is an array of daily records, **ascending by date**, one per
NSE trading session since 1 Jan 2026:

```json
[
  { "date": "2026-01-01", "fii_net": -3268.6, "dii_net": 1525.89 },
  { "date": "2026-06-03", "fii_net": -5616.56, "dii_net": 5740.89 }
]
```

- `date` = `YYYY-MM-DD`.
- `fii_net` / `dii_net` = NSE/BSE **provisional cash-market net** (₹ Crore,
  signed: negative = net sell). Plain numbers, not strings.

### Each run

1. **Read** the current `data/fii_dii.json` and note `LASTDATE` = the last
   (most recent) date already in the file.
2. **Fetch the latest sessions** from the primary source:
   `https://fatafatniftylevels.in/fii-dii.php` — an HTML table whose columns are
   `Date | FII Net (USD) | DII Net (USD) | FII Net (₹ Cr) | DII Net (₹ Cr) |
   Nifty 50 | Chg %`. Dates look like `Wed, 03 Jun 26`. Take the **₹ Cr**
   columns (4th = FII, 5th = DII); strip `+` and commas; parse to numbers.
3. **Cross-check** each new day against the secondary source
   `https://webapi.niftytrader.in/webapi/Resource/fii-dii-activity-data`
   (JSON: `fii_dii_data[]` with `created_at`, `fii_net_value`, `dii_net_value`).
   The two should agree to within ~₹2 Cr. If they disagree materially, trust
   fatafatniftylevels (it matches NSE-published provisional figures and the
   Groww reference), but note the discrepancy in the commit message.
4. **Append only genuinely new dates** — any session with `date > LASTDATE` that
   is not already present. Keep the array sorted ascending, no duplicate dates.
   Include real special sessions (e.g. a Budget-day Saturday/Sunday) if they
   appear in the source.
5. If there is **nothing newer than `LASTDATE`** (e.g. a market holiday, or you
   already have the latest), **make no change and do not commit** — just report
   "already current".

### Commit + push

If you appended one or more days, commit with:

```
chore: refresh data/fii_dii.json (through <latest YYYY-MM-DD>, +N day(s))
```

and push to `main`. GitHub Pages auto-publishes within ~1 minute.

### Integrity / failure mode

- **Never fabricate** a day's figure. Only append values you actually parsed
  from a source.
- Do **not** rewrite or "correct" existing historical rows — only append new
  dates. (The back-history was verified against NSE-reported daily and monthly
  totals at build time.)
- Validate before committing: `node -e "JSON.parse(require('fs').readFileSync('data/fii_dii.json','utf8'))"`,
  dates strictly ascending, no duplicates, every record has numeric
  `fii_net` and `dii_net`.
- If **both** sources are unreachable or return no parseable rows, **abort
  without committing** and email a one-line note to markworktk@gmail.com saying
  the FII/DII sources failed. The page keeps serving the previous file.
