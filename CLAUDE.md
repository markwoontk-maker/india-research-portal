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
- "Latest Research Notes" = single-row digest grouped by research house: **date | company | clickable headline | colour-coded call chip**. The NotebookLM per-company list was removed from this tab (the `NOTEBOOKS` map still feeds the Screener tab).
- Two data sources: (1) **local PDF library** under `C:\Users\admin\Desktop\India Related Reports\` — parsed by filename pattern `[YYMMDD] [House] Folder - Thesis.pdf`, parent folder name matches NOTEBOOKS entries; (2) **external broker calls** (Motilal Oswal, ICICI Securities, Morgan Stanley, Citi, UBS, Nuvama, Axis, HDFC Securities, etc.) refreshed by the routine below into `data/research.json`.
- Title is clickable → opens the company's NotebookLM workspace (local reports) or the source article (external calls) in a new tab; `authuser=markworktk@gmail.com` appended so the right Google account is selected.
- Call chip: extracts the broker's explicit rating (Buy/Sell/Hold/OW/UW/EW/Neutral/Add/Reduce/OP/UP) from the headline when stated, otherwise falls back to a sentiment-derived label (Positive/Negative/Neutral). Date is plain, only the call is colour-coded.

## Research refresher routine
- **Trigger:** `trig_018gy39x8QiAfrp9UxSPzPyA` — "India Research Notes Refresher"
- **URL:** https://claude.ai/code/routines/trig_018gy39x8QiAfrp9UxSPzPyA
- **Cron (UTC):** `0 1 * * 1-5` (Mon–Fri 1:00 UTC = 6:30 AM IST, just after the daily-email routine fires).
- **Status:** stub created via API; **prompt has to be pasted into the routines UI** (the create/update API for this trigger family doesn't expose the prompt field in the schema this session can hit — `event_type` / `messages` / `prompt` all rejected). Once the prompt is in, flip `enabled` to true in the UI.
- **What it does each run:** WebSearches Indian broker research calls from the previous 2 days (Motilal Oswal, ICICI Securities, Morgan Stanley, Citi, UBS, Nuvama, HDFC Securities, Axis Capital, Emkay, JM Financial, Sharekhan, etc. — explicitly NOT the six houses in the local library), builds an `ext` array, drafts a Gmail to markworktk@gmail.com containing the JSON to paste into `data/research.json`. Page picks it up via the fetch at the bottom of index.html.
- **Prompt:** stored in `docs/research-refresher-prompt.md` — copy-paste into the routine UI under "Initial message".

## Local dev / preview
- Node at `C:\Program Files\nodejs`. Optional `netlify dev` on 8899; `C:\Users\admin\.claude\static-server.cjs` preview proxy on 4178 (`launch.json`).
- Just opening `index.html` works (client fallbacks cover all data).

## NotebookLM (separate tooling, see user memory `notebooklm-research-portal`)
- `nlm` CLI at `C:\Users\admin\.local\bin\nlm.exe`, profile **`work`** = markworktk@gmail.com (NOT the markwoontk@gmail.com default — easy to confuse).
