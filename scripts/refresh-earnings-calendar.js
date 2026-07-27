// Rebuild data/earnings_calendar.json — the forward results calendar that
// feeds the "Earnings Calendar" card on the News/Markets tab.
//
// Runs as a step in daily-refresh.ps1 (local Windows Task Scheduler), which
// then commits + pushes. It CANNOT run client-side: the source endpoint is a
// POST whose CORS header is pinned to `https://www.icicidirect.com`, so a
// browser on GitHub Pages is blocked, and the free public proxies the page
// uses elsewhere (codetabs / allorigins) only forward GET. Fetching here,
// server-side, sidesteps both. (Same reason FII/DII is refreshed locally.)
//
// Source: ICICI Direct's results-calendar API, the one behind
// https://www.icicidirect.com/share-market-today/company-results
//   POST https://www.icicidirect.com/marketapi/market
//   Method=Get_EquityCompanyEvents
//   param[0]=P_FROM_DATE (yyyy-Mon-dd), param[1]=P_TO_DATE,
//   param[2]=p_pagenumber, param[3]=p_pagesize
// Response: { IsSuccess, Data:{ Table:[{EVENTTYPE,EVENTDATE,CO_NAME,LNAME,
//            CO_CODE,RESULT_NOTE}] } }   (EVENTDATE is "Jul 31, 2026")
//
// GOTCHA: a wide P_FROM_DATE..P_TO_DATE query is CAPPED server-side and
// silently drops companies (a busy day comes back partial). So we set
// P_FROM_DATE == P_TO_DATE and loop day-by-day — a single-day query returns
// that day in full — then aggregate. Do NOT "optimise" this back into one
// range call.
//
// Rewrites the whole file each run (the forward window moves daily), but only
// when the fetch returned a usable set — a failed/empty fetch leaves the last
// good file in place. Never throws non-zero: it must not abort the refresh.
//
// Run: node scripts/refresh-earnings-calendar.js

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "earnings_calendar.json");
const API = "https://www.icicidirect.com/marketapi/market";
const PAGE = "https://www.icicidirect.com/share-market-today/company-results";
const DAYS_AHEAD = 42;          // covers the 30 business-day (Mon-Sat) grid + margin
const PAGE_SIZE = 500;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const apiDate = d => `${d.getFullYear()}-${MON[d.getMonth()]}-${String(d.getDate()).padStart(2,"0")}`;
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

// "Jul 31, 2026" -> "2026-07-31"
function parseEventDate(s){
  const m = String(s||"").match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const mi = MON.indexOf(m[1]);
  if (mi < 0) return null;
  return `${m[3]}-${String(mi+1).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
}

// Normalised company key — MUST mirror ecKey() in index.html so the same name
// resolves the same way on both sides.
function nkey(s){
  return String(s||"").toLowerCase().replace(/&/g,"and")
    .replace(/[^a-z0-9]+/g,"").replace(/(limited|ltd)$/,"");
}

// NSE equity master (SYMBOL <-> company name) so each result gets a Yahoo
// symbol the page can price for YTD. ~74% of the calendar matches; the rest
// are BSE-only microcaps with no NSE line (they just render without a YTD).
// Best-effort: on any failure the calendar still ships, just without symbols.
async function fetchNseSymbolMap(){
  const urls = [
    "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
    "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
  ];
  for (const u of urls){
    try{
      const r = await fetch(u, { headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
        "Accept": "text/csv,*/*", "Referer": "https://www.nseindia.com/" } });
      if (!r.ok) continue;
      const csv = await r.text();
      if (csv.length < 1000) continue;
      const lines = csv.split(/\r?\n/);
      const map = {};
      for (let i = 1; i < lines.length; i++){
        const c = lines[i].split(",");
        const sym = (c[0]||"").trim(), name = (c[1]||"").trim(), series = (c[2]||"").trim();
        if (!sym || !name) continue;
        if (series && series !== "EQ" && series !== "BE") continue;   // tradeable equity series
        const k = nkey(name);
        if (k && !map[k]) map[k] = sym;
      }
      if (Object.keys(map).length > 500) return map;
    }catch(e){ /* try next url */ }
  }
  return null;
}

async function fetchPage(from, to, pageNumber){
  const body = new URLSearchParams();
  body.set("Method", "Get_EquityCompanyEvents");
  [["P_FROM_DATE",from],["P_TO_DATE",to],
   ["p_pagenumber",String(pageNumber)],["p_pagesize",String(PAGE_SIZE)]]
    .forEach((kv,i)=>{ body.set(`param[${i}][key]`,kv[0]); body.set(`param[${i}][value]`,kv[1]); });

  const r = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Referer": PAGE,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    },
    body: body.toString()
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j || j.IsSuccess === false) throw new Error("IsSuccess=false");
  return (j.Data && j.Data.Table) || [];
}

(async () => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date(today); end.setDate(end.getDate() + DAYS_AHEAD);

    // IMPORTANT: a wide P_FROM_DATE..P_TO_DATE query silently truncates — the
    // API caps the total it returns and drops companies (e.g. Syrma SGS on a
    // busy day). A single-day query returns that day in full, so we fetch
    // day-by-day and aggregate. Sundays are skipped (no board meetings). A
    // single day's failure is tolerated so one hiccup can't blank the file.
    let rows = [], dayErrors = 0;
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      if (d.getDay() === 0) continue;             // skip Sundays
      const ds = apiDate(d);
      try {
        let pageNumber = 1;
        while (pageNumber <= 10) {
          const page = await fetchPage(ds, ds, pageNumber);
          rows = rows.concat(page);
          if (page.length < PAGE_SIZE) break;     // full day captured
          pageNumber++;
        }
      } catch (e) { dayErrors++; }
    }
    if (dayErrors) console.log(`earnings-calendar: ${dayErrors} day(s) failed to fetch`);

    // NSE symbol lookup (best-effort; null if the master can't be fetched).
    const nseMap = await fetchNseSymbolMap();

    // Keep results events only, normalise, dedupe by date+company.
    const seen = new Set(), items = [];
    let symHits = 0;
    for (const r of rows) {
      if (String(r.EVENTTYPE || "").toLowerCase() !== "result") continue;
      const date = parseEventDate(r.EVENTDATE);
      const name = String(r.LNAME || r.CO_NAME || "").trim();
      if (!date || !name) continue;
      const key = date + "|" + name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const short = String(r.CO_NAME || "").trim() || undefined;
      // Match on full name first, then the short name.
      const nse = nseMap && (nseMap[nkey(name)] || (short && nseMap[nkey(short)]));
      if (nse) symHits++;
      items.push({ date, name, short, sym: nse ? nse + ".NS" : undefined });
    }

    if (!items.length) {
      console.log("earnings-calendar: source returned no result events -- leaving existing file");
      return;
    }

    items.sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    const out = {
      asOf: isoDate(new Date()),
      source: "ICICI Direct",
      sourceUrl: PAGE,
      from: isoDate(today),
      to: isoDate(end),
      items
    };
    fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
    const days = new Set(items.map(i => i.date)).size;
    console.log(`earnings-calendar: wrote ${items.length} results across ${days} dates (${out.from} -> ${out.to}); NSE symbols on ${symHits}/${items.length}`);
  } catch (e) {
    console.log("earnings-calendar: refresh failed -- leaving existing file (" + (e && e.message ? e.message : e) + ")");
  }
})();
