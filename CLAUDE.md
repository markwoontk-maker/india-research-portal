# India Research Portal — project notes

## Hosting & deploy
- **Static GitHub Pages site.** Public repo `markwoontk-maker/india-research-portal`, branch `main`. Pushing to `main` auto-publishes — no build minutes, no credits, nothing to babysit.
- Live URL: https://markwoontk-maker.github.io/india-research-portal/ (project subpath `/india-research-portal/`).
- `.nojekyll` at repo root so files serve as-is.
- **Netlify path is deprecated/blocked** (free build-minute cap kept failing deploys). The `netlify/functions/*` + `netlify.toml` are kept only as optional server proxies; do not rely on them.
- Single self-contained `index.html` (inline CSS/JS); Chart.js + Google Fonts via CDN. No build step.
- **Always commit + push on any dashboard change** (the user expects the live site updated every time).

## Data sources (all free, no API keys, ever)
- Yahoo Finance `v8/finance/spark` & `chart` (20-symbol/request cap → chunked).
- Google News RSS (`news.google.com/rss/search?...&hl=en-IN&gl=IN&ceid=IN:en`, `when:Nd`).
- DBnomics (`api.db.nomics.world/v22/series/<id>`, CORS-ok; IMF/IFS monthly, BIS policy rate).
- BSE forthcoming-results API (earnings calendar).
- Because it is static, every feature has a **client-side public-proxy fallback** (`corsproxy.io` → `allorigins.win`); server functions are primary only when the Netlify path happens to be live.
- Never introduce a paid/keyed API. No secrets in code or chat (Netlify token/Site ID, if ever needed, live only in GitHub Actions secrets).

## Research Notes tab
- "Latest Research Notes" = digest of broker reports added to the local research library in the **last 2 days**, grouped by research house. The NotebookLM per-company list was removed from this tab (the `NOTEBOOKS` map still feeds the Screener tab).
- Source = PDF filenames under `C:\Users\admin\Desktop\India Related Reports\`, pattern `[YYMMDD] [House] Company - Thesis.pdf`. The post-dash thesis is shown verbatim as the one-liner (no PDF body text reproduced — avoids paid-content/copyright issues). "Past 2 days" is keyed off file modification time (= when the report was added).
- The coloured date chip is a **wording heuristic, not the broker's formal rating**: contrastive headlines ("soft … but guidance exceeded") resolve to the post-"but" takeaway; otherwise negatives win ties.

## Local dev / preview
- Node at `C:\Program Files\nodejs`. Optional `netlify dev` on 8899; `C:\Users\admin\.claude\static-server.cjs` preview proxy on 4178 (`launch.json`).
- Just opening `index.html` works (client fallbacks cover all data).

## NotebookLM (separate tooling, see user memory `notebooklm-research-portal`)
- `nlm` CLI at `C:\Users\admin\.local\bin\nlm.exe`, profile **`work`** = markworktk@gmail.com (NOT the markwoontk@gmail.com default — easy to confuse).
