// Refresh data/movers.json — the Top 20 gainers / Bottom 20 detractors card
// and the Market Breadth KPI, across the FULL current Nifty 500.
//
// AUTH-FREE, NO LLM, NO browser-CORS dependency. The page itself can no longer
// compute this: Yahoo's spark endpoint is CORS-blocked from the GitHub Pages
// origin and the free CORS proxies (allorigins/codetabs/corsproxy) are dead, so
// the old client path fell back to a tiny broken sample (~13 "gainers" out of a
// handful that loaded) instead of the real full-index count. This computes it
// server-side from chartink's public screener JSON and commits the result.
//
// INTRADAY: chartink's per_chg is the live intraday % move during NSE hours
// (09:15-15:30 IST) and the official close-vs-prev after the close. Run this on
// a repeating schedule through market hours (see refresh-movers-intraday.ps1)
// for near-live gainers/detractors; the daily pipeline runs it once more post-
// close for the settled EOD snapshot.
//
// Source: chartink.com/screener/process ( {cash} scan → every stock + per_chg )
//         niftyindices.com ind_nifty500list.csv ( Nifty 500 filter + clean names )
//
// Output: data/movers.json
//   { asOf, updated, intraday, session, tf:"1D", count, adv, dec,
//     top:[{s,n,p,ch}], bottom:[{s,n,p,ch}] }
//
// Run:  node scripts/refresh-movers.js
// Exit: 0 on success or soft failure (file left intact); non-zero only on crash.

const fs = require("fs");
const path = require("path");
const https = require("https");

const FILE = path.join(__dirname, "..", "data", "movers.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const CSV_URL = "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv";
// Every cash-market instrument; we filter to Nifty 500 in code. per_chg = today's move.
const SCAN_ALL = "( {cash} ( latest close > 0 ) )";
const MIN_ROWS = 300;   // sanity floor: a real Nifty 500 scan resolves ~490+; bail if far short.

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA, ...headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return get(res.headers.location, headers).then(resolve, reject);
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on("error", reject);
  });
}
function post(url, form, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(form).toString();
    const req = https.request(new URL(url), {
      method: "POST", headers: {
        "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data), "X-Requested-With": "XMLHttpRequest", ...headers
      }
    }, res => { let b = ""; res.on("data", c => b += c); res.on("end", () => resolve({ status: res.statusCode, body: b })); });
    req.on("error", reject); req.write(data); req.end();
  });
}

// Symbol -> clean company name, from the Nifty 500 constituents CSV.
function parseConstituents(csv) {
  const map = new Map();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return map;
  const rowOf = line => {
    const out = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const header = rowOf(lines[0]).map(h => h.trim().toLowerCase());
  const iName = header.indexOf("company name"), iSym = header.indexOf("symbol");
  if (iName < 0 || iSym < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const r = rowOf(lines[i]);
    const sym = (r[iSym] || "").trim().toUpperCase();
    const name = (r[iName] || "").trim().replace(/\s+(Ltd\.?|Limited)$/i, "");
    if (sym) map.set(sym, name || sym);
  }
  return map;
}

// NSE regular session: Mon-Fri 09:15-15:30 IST. Returns {intraday, session}.
function nseSession() {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000); // shift to IST wall clock (UTC methods below)
  const dow = nowIst.getUTCDay();                          // 0 Sun .. 6 Sat
  const mins = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
  const weekday = dow >= 1 && dow <= 5;
  const open = mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
  if (!weekday) return { intraday: false, session: "weekend" };
  if (mins < 9 * 60 + 15) return { intraday: false, session: "pre-open" };
  if (open) return { intraday: true, session: "open" };
  return { intraday: false, session: "closed" };
}
function istDate() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

(async () => {
  // 1. chartink CSRF handshake.
  const g = await get("https://chartink.com/screener/all-time-high-1");
  const cookie = (g.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
  const token = (g.body.match(/name="csrf-token"\s+content="([^"]+)"/i) || [])[1];
  if (!token || !cookie) { console.log("refresh-movers: chartink handshake failed — leaving file unchanged."); return; }

  // 2. Nifty 500 constituents (filter + clean names).
  let n500 = new Map();
  try { const c = await get(CSV_URL); if (c.status === 200) n500 = parseConstituents(c.body); } catch (e) {}
  if (!n500.size) { console.log("refresh-movers: constituents CSV failed — leaving file unchanged."); return; }

  // 3. Full cash-market scan → per_chg for every instrument.
  const r = await post("https://chartink.com/screener/process", { scan_clause: SCAN_ALL },
    { "Cookie": cookie, "X-CSRF-TOKEN": token, "Referer": "https://chartink.com/screener/all-time-high-1" });
  let raw; try { raw = (JSON.parse(r.body).data) || []; } catch (e) { raw = []; }

  // 4. Keep Nifty 500 stocks only (drop indices: null bsecode). Map to movers rows.
  const seen = new Set();
  const rows = raw
    .filter(x => x && x.bsecode && n500.has((x.nsecode || "").toUpperCase()))
    .map(x => {
      const sym = x.nsecode.toUpperCase();
      const p = Number(x.close), ch = Number(x.per_chg);
      if (!Number.isFinite(p) || !Number.isFinite(ch)) return null;
      return { s: sym, n: n500.get(sym) || x.name, p, ch };
    })
    .filter(x => x && !seen.has(x.s) && seen.add(x.s));

  if (rows.length < MIN_ROWS) {
    console.log(`refresh-movers: only ${rows.length} Nifty 500 rows resolved (< ${MIN_ROWS}) — leaving previous snapshot in place.`);
    return;
  }

  rows.sort((a, b) => b.ch - a.ch);
  const sess = nseSession();
  const out = {
    asOf: istDate(),
    updated: new Date().toISOString(),
    intraday: sess.intraday,
    session: sess.session,
    tf: "1D",
    count: rows.length,
    adv: rows.filter(x => x.ch > 0).length,
    dec: rows.filter(x => x.ch < 0).length,
    unch: rows.filter(x => x.ch === 0).length,
    top: rows.slice(0, 20),
    bottom: rows.slice(-20).reverse(),
  };
  fs.writeFileSync(FILE, JSON.stringify(out) + "\n");
  console.log(`refresh-movers: wrote data/movers.json (${out.session}, count=${out.count}, adv=${out.adv}, dec=${out.dec}, top=${out.top[0].s} ${out.top[0].ch}%, bottom=${out.bottom[0].s} ${out.bottom[0].ch}%).`);
})().catch(e => { console.log("refresh-movers: unexpected error — " + e.message); process.exit(1); });
