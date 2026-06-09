You are running UNATTENDED as a scheduled job. Do NOT ask questions. Make
reasonable decisions and proceed. Keep output terse. Use the Bash tool
(git-bash) for shell/curl; use Read/Write/WebFetch for content.

# TASK
Refresh the **All-Time High + 52-Week High** card on the India Research Portal
dashboard by overwriting `data/highs.json` with today's snapshot. The repo is
your cwd: `C:\Users\admin\India-Research-Portal`. Do NOT commit or push — the
calling wrapper handles git after validating the file you write.

# OUTPUT — write this file exactly
`data/highs.json`, this shape, no other fields, no comments, no trailing commas:

```json
{
  "asOf": "YYYY-MM-DD",
  "ath": [
    {"name": "Company Name", "cmp": 1234.56, "ath": 1234.56}
  ],
  "w52": [
    {"name": "Company Name", "cmp": 1234.56, "w52h": 1234.56}
  ]
}
```

Rules:
- `asOf` = today's IST date. Compute via `bash -lc 'TZ=Asia/Kolkata date +%F'`.
- `cmp` / `ath` / `w52h` = plain JSON numbers (no currency symbol, no string).
- Each list **sorted descending** by the high price; **cap at 30 rows** each.
- Skip any row where you cannot extract a clean numeric CMP and a clean
  numeric high.

# SOURCES — try in this order, stop when you have enough rows

For both lists you need: Nifty 500 names currently at or very near their
all-time high (ATH list) or their 52-week high (W52 list), with their CMP
and the high price.

### Primary (SPA pages — may be JS-rendered)
1. `https://dhan.co/stocks/market/all-time-high-stocks/` — ATH list across NSE.
2. `https://groww.in/markets/52-week-high?index=GIDXNIFTY500` — 52WH list,
   already filtered to Nifty 500.

Try `WebFetch` on each. If the response contains real ticker rows with prices,
use it. If it returns mostly empty scaffolding (SPA shell), move to fallbacks.

### Fallbacks (use any combination that works)
3. NSE direct API — `WebFetch` or `curl -A 'Mozilla/5.0' \
   'https://www.nseindia.com/api/live-analysis-52Week?index=NIFTY%20500&type=H'`
   may return JSON with `data[]` of names hitting 52WH. NSE may require a
   cookie warmup; if a single fetch returns JSON with rows, use it; if it
   401/403s, skip.
4. BSE direct — `https://api.bseindia.com/BseIndiaAPI/api/HighLow/w?...` (look
   at the BSE 52-week high page network requests if needed).
5. Trendlyne — `https://trendlyne.com/equity/52WeekHigh/NIFTY500/` (HTML table,
   usually parseable).
6. moneycontrol — `https://www.moneycontrol.com/stocks/marketstats/nsehigh/index.php`
   or the 52-week high section.

For ATH names specifically — these are rare. Try Dhan first; if that fails,
try `https://www.5paisa.com/share-market-today/all-time-high-stocks` or
`https://chartink.com/screener/all-time-high-1` (the latter often returns a
clean HTML table).

### Nifty 500 filter for the ATH list
Dhan's ATH list covers all of NSE. To restrict to Nifty 500 only, cross-check
against the constituents CSV:
`curl -A 'Mozilla/5.0' -sSL 'https://niftyindices.com/IndexConstituent/ind_nifty500list.csv' -o /tmp/n500.csv`
Then drop any ATH row whose Symbol / Company isn't in that list. (The W52 list
from Groww is already Nifty-500 filtered — no extra step.)

# FAILURE MODE
If after trying the sources above you have **fewer than 3 rows in each list**,
write nothing and exit. The wrapper validates the file and reverts on empty
results, so the dashboard keeps showing the previous snapshot. Do not invent
prices or use stale data.

# WHEN YOU FINISH
After writing `data/highs.json`, exit. Do not run git. Do not summarize for me.
The wrapper script reads the file, validates it, and handles the commit.
