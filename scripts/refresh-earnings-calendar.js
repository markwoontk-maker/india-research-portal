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
const DAYS_AHEAD = 35;          // enough to cover a full results season view
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
    const from = apiDate(today), to = apiDate(end);

    let rows = [], pageNumber = 1;
    while (pageNumber <= 20) {
      const page = await fetchPage(from, to, pageNumber);
      rows = rows.concat(page);
      if (page.length < PAGE_SIZE) break;
      pageNumber++;
    }

    // Keep results events only, normalise, dedupe by date+company.
    const seen = new Set(), items = [];
    for (const r of rows) {
      if (String(r.EVENTTYPE || "").toLowerCase() !== "result") continue;
      const date = parseEventDate(r.EVENTDATE);
      const name = String(r.LNAME || r.CO_NAME || "").trim();
      if (!date || !name) continue;
      const key = date + "|" + name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ date, name, short: String(r.CO_NAME || "").trim() || undefined });
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
    console.log(`earnings-calendar: wrote ${items.length} results across ${days} dates (${out.from} -> ${out.to})`);
  } catch (e) {
    console.log("earnings-calendar: refresh failed -- leaving existing file (" + (e && e.message ? e.message : e) + ")");
  }
})();
