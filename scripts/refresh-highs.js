// Refresh data/highs.json — the All-Time-High + 52-Week-High card.
//
// AUTH-FREE, NO LLM. Replaces the old Claude-headless-miner approach, whose
// OAuth token silently expired every ~6 weeks (Jun 19, Aug 4, Aug 27...) and
// stalled the whole card. This uses chartink's public screener endpoint, which
// returns clean JSON for a scan clause after a CSRF handshake — no login, no
// key, works unattended forever.
//
// Sources (all free, keyless):
//   - chartink.com/screener/process  (POST scan_clause; ATH + 52WH scans)
//   - niftyindices.com ind_nifty500list.csv  (Nifty 500 filter + clean names)
//
// Both lists are filtered to Nifty 500 constituents. chartink returns `close`
// (not the intraday high), and these names are AT their high today, so we use
// close for both cmp and the high field (keeps the cmp <= high invariant).
//
// Run:  node scripts/refresh-highs.js
// Exit: 0 on success (file written) OR on a soft failure (file left intact);
//       non-zero only on an unexpected crash. The wrapper validates the file.

const fs = require("fs");
const path = require("path");
const https = require("https");

const FILE = path.join(__dirname, "..", "data", "highs.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const CSV_URL = "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv";

// ~5000 sessions ≈ 20y ≈ all-time; 260 sessions ≈ 52 weeks.
const SCAN_ATH = "( {cash} ( latest high >= latest max( 5000 , latest high ) ) )";
const SCAN_W52 = "( {cash} ( latest high >= latest max( 260 , latest high ) ) )";

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA, ...headers } }, res => {
      // follow one redirect (niftyindices sometimes 301s)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve, reject);
      }
      let body = ""; res.on("data", c => body += c);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

function post(url, form, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(form).toString();
    const req = https.request(new URL(url), {
      method: "POST",
      headers: {
        "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data), "X-Requested-With": "XMLHttpRequest", ...headers
      }
    }, res => { let body = ""; res.on("data", c => body += c); res.on("end", () => resolve({ status: res.statusCode, body })); });
    req.on("error", reject); req.write(data); req.end();
  });
}

// Symbol -> clean company name, from the Nifty 500 constituents CSV.
// CSV columns: "Company Name","Industry","Symbol","Series","ISIN Code".
function parseConstituents(csv) {
  const map = new Map();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return map;
  // naive CSV split is unsafe (names contain commas), so parse quoted fields.
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
  const iName = header.indexOf("company name");
  const iSym = header.indexOf("symbol");
  if (iName < 0 || iSym < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const r = rowOf(lines[i]);
    const sym = (r[iSym] || "").trim().toUpperCase();
    let name = (r[iName] || "").trim().replace(/\s+(Ltd\.?|Limited)$/i, "");
    if (sym) map.set(sym, name || sym);
  }
  return map;
}

async function chartinkScan(cookie, token, clause) {
  const r = await post("https://chartink.com/screener/process", { scan_clause: clause },
    { "Cookie": cookie, "X-CSRF-TOKEN": token, "Referer": "https://chartink.com/screener/all-time-high-1" });
  let j; try { j = JSON.parse(r.body); } catch (e) { return []; }
  return Array.isArray(j.data) ? j.data : [];
}

// Keep real Nifty-500 stocks only (drop indices: null bsecode / zero volume /
// nsecode not in the constituents set). Map to {name, cmp, high} using close.
function toRows(raw, n500, highKey) {
  const seen = new Set();
  return raw
    .filter(x => x && x.bsecode && Number(x.volume) > 0 && n500.has((x.nsecode || "").toUpperCase()))
    .map(x => {
      const sym = x.nsecode.toUpperCase();
      const px = Number(x.close);
      if (!Number.isFinite(px) || px <= 0) return null;
      return { name: n500.get(sym) || x.name, cmp: px, [highKey]: px };
    })
    .filter(x => x && !seen.has(x.name) && seen.add(x.name))
    .sort((a, b) => b[highKey] - a[highKey])
    .slice(0, 30);
}

function istDate() {
  // Asia/Kolkata = UTC+5:30
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

(async () => {
  // 1. CSRF handshake with chartink.
  const g = await get("https://chartink.com/screener/all-time-high-1");
  const cookie = (g.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
  const token = (g.body.match(/name="csrf-token"\s+content="([^"]+)"/i) || [])[1];
  if (!token || !cookie) { console.log("refresh-highs: chartink handshake failed — leaving file unchanged."); return; }

  // 2. Nifty 500 constituents (filter + clean names).
  let n500 = new Map();
  try {
    const c = await get(CSV_URL);
    if (c.status === 200) n500 = parseConstituents(c.body);
  } catch (e) {}
  if (!n500.size) { console.log("refresh-highs: constituents CSV failed — leaving file unchanged."); return; }

  // 3. Run both scans.
  const [athRaw, w52Raw] = await Promise.all([
    chartinkScan(cookie, token, SCAN_ATH),
    chartinkScan(cookie, token, SCAN_W52),
  ]);
  const ath = toRows(athRaw, n500, "ath");
  const w52 = toRows(w52Raw, n500, "w52h");

  // 4. Bail (no overwrite) only if BOTH lists are empty — a bad scrape day.
  //    ATH legitimately can be 0-3 names, so an empty ATH alone is not failure
  //    as long as W52 has data.
  if (!ath.length && !w52.length) {
    console.log("refresh-highs: both lists empty — leaving previous snapshot in place.");
    return;
  }

  const out = { asOf: istDate(), ath, w52 };
  fs.writeFileSync(FILE, JSON.stringify(out) + "\n");
  console.log(`refresh-highs: wrote data/highs.json (asOf ${out.asOf}, ath=${ath.length}, w52=${w52.length}).`);
})().catch(e => { console.log("refresh-highs: unexpected error — " + e.message); process.exit(1); });
