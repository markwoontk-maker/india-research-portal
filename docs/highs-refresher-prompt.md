# India Highs Refresher — routine prompt

Paste this into the routine's **Initial message** field at
https://claude.ai/code/routines (create a new routine if there isn't one yet).

Suggested cron (UTC): `30 11 * * 1-5` — Mon–Fri 11:30 UTC ≈ 5:00 PM IST, after the NSE close.
Repo: `markwoontk-maker/india-research-portal` · branch `main`.

---

You refresh the **All-Time High + 52-Week High** card on the India Research
Portal dashboard. Run once a day after the Indian market closes and commit a
single fresh `data/highs.json` to the repo. The static page picks it up via the
fetch at the bottom of index.html — no other code changes.

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
  previous day's snapshot in place.

### Commit + push

After writing, commit with:

```
chore: refresh data/highs.json (YYYY-MM-DD)
```

and push to `main`. GitHub Pages auto-publishes within ~1 minute.

### Failure mode

If either source page is unreachable (HTTP error / parser returns 0 rows for
both lists), **abort without committing** and email a one-line note to
markworktk@gmail.com saying which source failed. The page falls back to the
previous `data/highs.json` automatically — no further action needed.
