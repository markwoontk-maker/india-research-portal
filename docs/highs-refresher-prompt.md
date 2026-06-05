# India Highs Refresher — prompt

Invoked by `scripts/build-highs.ps1` (a step in the local `scripts/daily-refresh.ps1`
pipeline that runs at **9:30 AM MYT Mon–Fri**, i.e. ~7:00 AM IST — before market
open, picking up yesterday's NSE post-close ATH / 52-week-high lists).

The wrapper calls `claude -p` with this prompt body, then validates the
resulting `data/highs.json` structure and reverts on failure. **Do NOT commit
or push from inside this prompt** — `daily-refresh.ps1` stages `data/highs.json`
with the rest of the day's changes and pushes once at the end.

Repo: `markwoontk-maker/india-research-portal` · branch `main`.

---

You refresh the **All-Time High + 52-Week High** card on the India Research
Portal dashboard by writing a single fresh `data/highs.json`. The static page
picks it up via the fetch at the bottom of index.html — no other code changes.

### Inputs (free, no API key)

1. **All-Time High list** — scrape
   `https://dhan.co/stocks/market/all-time-high-stocks/`
   Each row gives: company name, current price (CMP), market-cap (Cr), ATH price.
2. **52-Week High list (Nifty 500)** — scrape
   `https://groww.in/markets/52-week-high?index=GIDXNIFTY500`
   Groww's `?index=GIDXNIFTY500` already filters to Nifty 500. Each row gives:
   company name, CMP, 52-week-high price.
3. **Nifty 500 constituents** — to filter Dhan's all-of-NSE ATH list down to
   Nifty 500 names only, use the constituents CSV from
   `https://niftyindices.com/IndexConstituent/ind_nifty500list.csv`.

### Output

Write `data/highs.json` with **exactly** this shape (no other fields, no
comments, no trailing commas):

```json
{
  "asOf": "YYYY-MM-DD",
  "ath": [
    {"name": "Hitachi Energy", "cmp": 35335.00, "ath": 35095.00}
  ],
  "w52": [
    {"name": "Hitachi Energy India", "cmp": 35355.00, "w52h": 35355.00}
  ]
}
```

Rules:
- `asOf` = the IST date you ran (`YYYY-MM-DD`).
- `cmp` / `ath` / `w52h` = plain numbers (no currency symbol, no string).
- `ath` array — Dhan's full ATH list **filtered to Nifty 500 only** via the
  constituents CSV cross-check. Sort by market-cap descending; cap at 30 rows.
- `w52` array — every row from Groww's `?index=GIDXNIFTY500` page, no further
  filtering. Sort by 52w-high descending; cap at 30 rows.
- Skip rows where you can't extract a clean numeric `cmp` or high.
- If both lists come back empty, **do not overwrite** the file — leave the
  previous day's snapshot in place. The wrapper script also detects an
  empty-both result and reverts.

### Failure mode

If either source page is unreachable (HTTP error / parser returns 0 rows for
both lists), **leave `data/highs.json` unchanged** and exit. The wrapper
validates the result and reverts on any structural / empty failure, so the
dashboard keeps showing the previous day's snapshot. No email needed — the
daily-refresh log captures the failure.
