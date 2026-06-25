// Refresh the notesExt array in index.html with the latest broker calls
// from trendlyne.com/research-reports/all/. Free, no API key, no login.
//
// What it does:
//   1. Fetches the public research-reports listing page (HTML).
//   2. Parses each broker-report row using the embedded JSON-LD blocks
//      (author / company / date / headline) plus a light regex over the
//      surrounding <td>s to pick up the Target Price and rating.
//   3. Keeps reports dated within the last 3 days (today and 2 prior).
//   4. Parks the existing notesExt rows into notesPrior so Prev TP /
//      Prev Call lookups still work on older calls.
//   5. Writes the new notesExt + extended notesPrior back into
//      index.html.
//
// Run: node scripts/refresh-trendlyne.js
//
// Trendlyne's deeper pagination (page 2+) requires a login modal, so
// only the first batch of ~20-30 reports is reachable anonymously. The
// scheduled daily-refresh.ps1 task runs this each weekday morning to
// keep the list current.

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");

const URL = "https://trendlyne.com/research-reports/all/";
const HTML = path.join(__dirname, "..", "index.html");

// Houses we already cover from the local PDF library — skip Trendlyne
// duplicates so the notesExt list stays focused on EXTERNAL brokers.
const LOCAL_HOUSES = new Set([
  "Bernstein", "CLSA", "Jefferies", "JPMorgan", "JP Morgan", "Kotak",
  "Kotak Institutional", "Kotak Securities", "Nomura"
]);

// Section / market-wide reports we drop (no per-stock TP).
const SKIP_COMPANIES = /^(Nifty|Bank Nifty|Market Movement|Sensex)\b/i;

function fetchHtml(url){
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }, res => {
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers["content-encoding"] || "").toLowerCase();
        try {
          if (enc.includes("br"))      buf = zlib.brotliDecompressSync(buf);
          else if (enc.includes("gzip")) buf = zlib.gunzipSync(buf);
          else if (enc.includes("deflate")) buf = zlib.inflateSync(buf);
        } catch (e) { return reject(e); }
        resolve(buf.toString("utf8"));
      });
    }).on("error", reject);
  });
}

// "June 2, 2026, midnight" -> "260602"
function toYYMMDD(s){
  const M = {January:1,February:2,March:3,April:4,May:5,June:6,
             July:7,August:8,September:9,October:10,November:11,December:12};
  const m = String(s).match(/(\w+)\s+(\d+),\s*(\d{4})/);
  if (!m) return null;
  const mm = M[m[1]]; if (!mm) return null;
  const yy = String(m[3]).slice(-2);
  return yy + String(mm).padStart(2,"0") + String(m[2]).padStart(2,"0");
}

// Trim trailing " Ltd." / " Ltd" / " Limited" so the folder name lines
// up with how the rest of the codebase refers to companies.
function shortName(s){
  return String(s)
    .replace(/\s+Ltd\.?$/,"")
    .replace(/\s+Limited$/,"")
    .replace(/\s+Inc\.?$/,"")
    .replace(/\s+&\s+/," & ")
    .trim();
}

// Slice the HTML into per-report regions using the JSON-LD block as
// the anchor. Each broker row has its own <script type="application/ld+json">
// of type "Review" — find them, then look ahead ~6KB for the TP cell
// and rating cell.
function parseReports(html){
  const out = [];
  const SCRIPT_RE = /<script\s+type\s*=\s*"application\/ld\+json"\s*>\s*([\s\S]*?)\s*<\/script>/g;
  let m;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    if (!data || data["@type"] !== "Review") continue;
    if (!data.author || !data.author.name) continue;
    if (!data.itemReviewed || !data.itemReviewed.name) continue;

    const broker = String(data.author.name).trim();
    const company = shortName(data.itemReviewed.name);
    const date = toYYMMDD(data.datePublished);
    const headline = String(data.description || "").trim();
    const url = String(data.url || "").trim();
    if (!date) continue;
    if (LOCAL_HOUSES.has(broker)) continue;
    if (SKIP_COMPANIES.test(company)) continue;

    // Trendlyne renders the row right after the JSON-LD script. Slice a
    // generous window and pluck the Target + Type cells.
    const slice = html.slice(m.index, m.index + 8000);

    // Target cell pattern. The two columns shown are LTP then Target, both
    // in plain <td class="rightAlgn invisible-details-control"> wrappers.
    // The Target column always sits immediately before "Price at reco".
    let tp = null;
    const tpM = slice.match(/<td class="rightAlgn invisible-details-control">\s*([\d,.]+)\s*<\/td>\s*<td class="rightAlgn negative invisible-details-control"/)
              || slice.match(/<td class="rightAlgn invisible-details-control">\s*([\d,.]+)\s*<\/td>\s*<td class="rightAlgn positive invisible-details-control"/);
    if (tpM) {
      tp = tpM[1].replace(/\.00$/,"");
      // The first cell of the pair is LTP, the second is TP — but the
      // regex above keys on the "Price at reco" cell which sits AFTER
      // both. Trendlyne emits LTP then Target. Re-match to grab the
      // second of the two:
      const dualM = slice.match(/<td class="rightAlgn invisible-details-control">\s*([\d,.]+)\s*<\/td>\s*<td class="rightAlgn invisible-details-control">\s*([\d,.]+)\s*<\/td>/);
      if (dualM) tp = dualM[2].replace(/\.00$/,"");
    }
    // Build the lenient PDF cache URL (Trendlyne's get-document endpoint).
    // From the post URL "https://trendlyne.com/posts/NNN/..." → PDF id NNN.
    let pdfUrl = url;
    const idM = url.match(/\/posts\/(\d+)\//);
    if (idM) pdfUrl = "https://trendlyne.com/get-document/post/pdf/" + idM[1] + "/";

    // Rating: the row's "Type" cell renders <span class="dot ..."> then
    // <span class="fs085rem">RATING</span>. The dot class is positive /
    // negative / blank (Neutral / Hold / Accumulate / Reduce all get a
    // blank dot class) — match any leading dot span.
    let rating = null;
    const rM = slice.match(/<span class="dot[^"]*"><\/span>\s*<span class="fs085rem">\s*([A-Za-z][A-Za-z\s]*?)\s*<\/span>/);
    if (rM) rating = rM[1].trim();

    // Filter out non-call entries (Daily Note, IPO Subscribe, Strategy
    // Note, etc.) — they pollute the digest with no actionable TP.
    if (!rating) continue;
    const NON_CALLS = /^(Daily|Strategy|Sector|IPO|Top|Forecast|Note|Report|Update)/i;
    if (NON_CALLS.test(rating)) continue;

    out.push({ broker, company, date, headline, url: pdfUrl, tp, rating });
  }
  return out;
}

function dedupe(rows){
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = r.broker + "|" + r.date + "|" + r.company + "|" + r.headline.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// Headline format: "Buy · TP ₹1,175 — Capital strength and NIM expansion..."
function fmtHeadline(r){
  const cap = r.rating.charAt(0).toUpperCase() + r.rating.slice(1).toLowerCase();
  const tpPart = r.tp ? " · TP ₹" + r.tp : "";
  const sep = r.headline ? " — " : "";
  return cap + tpPart + sep + r.headline;
}

function rowJs(r){
  const headline = fmtHeadline(r);
  const vals = [r.broker, r.date, r.company, headline, r.url];
  return "  [" + vals.map(s => JSON.stringify(s)).join(",") + "],";
}

(async () => {
  console.log("Fetching", URL, "...");
  const html = await fetchHtml(URL);
  console.log("Got", html.length, "bytes");

  const rows = dedupe(parseReports(html));
  console.log("Parsed", rows.length, "broker reports");

  // Today's YYMMDD (local TZ); keep reports from today back 3 days.
  const today = (() => {
    const d = new Date();
    return String(d.getFullYear()).slice(-2) +
           String(d.getMonth()+1).padStart(2,"0") +
           String(d.getDate()).padStart(2,"0");
  })();
  const cutoff = (() => {
    const d = new Date(); d.setDate(d.getDate() - 2);
    return String(d.getFullYear()).slice(-2) +
           String(d.getMonth()+1).padStart(2,"0") +
           String(d.getDate()).padStart(2,"0");
  })();

  const fresh = rows.filter(r => r.date >= cutoff && r.date <= today);
  console.log("Last-2-day window (" + cutoff + ".." + today + "):", fresh.length);

  if (fresh.length === 0) {
    console.log("No reports in window — leaving notesExt untouched.");
    return;
  }

  fresh.sort((a, b) =>
    a.broker.localeCompare(b.broker)
      || (b.date < a.date ? -1 : b.date > a.date ? 1 : 0)
      || a.company.localeCompare(b.company));

  // As of the 2026-06-23 outage, the inline notesExt array in index.html
  // is a permanent empty stub. The canonical source is data/research.json
  // (overlay fetch at the bottom of the page). Write the fresh batch
  // there via the safe atomic writer; existing `prior` rows are preserved
  // and stale Trendlyne externals get parked into them (deduped) so the
  // Prev TP / Prev Call lookup still works.
  const { readJson, patchResearchJson } = require("./safe-write-json");
  const existing = readJson(path.join(__dirname, "..", "data", "research.json")) || {};
  const oldExt   = Array.isArray(existing.ext)   ? existing.ext   : [];
  const oldPrior = Array.isArray(existing.prior) ? existing.prior : [];

  // Build the new ext array.
  const newExt = fresh.map(r => [r.broker, r.date, r.company, fmtHeadline(r), r.url]);

  // Park yesterday's externals into prior, deduped by (house,date,co,title).
  const priorKey = a => a[0] + "|" + a[1] + "|" + a[2] + "|" + String(a[3]).toLowerCase();
  const priorSeen = new Set(oldPrior.map(priorKey));
  const parked = [];
  for (const row of oldExt) {
    const k = priorKey(row);
    if (priorSeen.has(k)) continue;
    priorSeen.add(k);
    parked.push(row);
  }
  const newPrior = oldPrior.concat(parked);

  patchResearchJson(path.join(__dirname, ".."), { ext: newExt, prior: newPrior });
  console.log("data/research.json updated (atomic):");
  console.log("  ext:    " + newExt.length + " rows");
  console.log("  prior:  +" + parked.length + " parked from previous ext (" + newPrior.length + " total)");
})();
