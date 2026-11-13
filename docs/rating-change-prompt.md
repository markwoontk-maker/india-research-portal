# Rating change check: one broker note

Below `=== NOTE ===` is a work item (company, broker, note date, file title). The attached image
is the note's first page. Use only what that page prints. Never use memory or guesses.

Return one JSON object and nothing else, with no markdown fences:

{"rating": "Buy", "previousRating": "Hold", "changed": true}

- `rating`: the broker's current rating on the work item's company, written out: `Buy`, `Add`,
  `Hold`, `Reduce`, `Sell`, `Overweight`, `Equal-weight`, `Underweight`, `Outperform`,
  `Market-perform`, `Neutral`, `Underperform`. CLSA's `O-PF` is `Outperform` and `U-PF` is
  `Underperform`. `null` if the page doesn't rate that company.
- `previousRating`: the rating before this note, only if the page prints it, for example
  "Upgrade to Buy from Hold", "(from Neutral)", a "Previous rating" field or a "Rating change"
  box. Otherwise `null`. Never infer it.
- `changed`: `true` only if the page says this note changes the stock's rating, as an upgrade or
  a downgrade. An earnings upgrade, a guidance upgrade, an estimate change or a target price
  change is not a rating change, so `changed` is `false` for those.
- If the note covers several companies, answer for the work item's company only.
