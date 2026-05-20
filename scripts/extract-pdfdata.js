// Extract Curr TP / Prev TP / Curr Call / Prev Call from each broker PDF
// in the local library by running `pdftotext` over page 1 and regex-matching
// common Indian-broker layouts (Jefferies, Kotak, CLSA, JPMorgan, Nomura,
// Bernstein, etc.). Outputs data/pdfdata.json keyed by
// `house|date|folder|alphanum-only-title` (same scheme as pdfmap.json).
//
// Run: node scripts/extract-pdfdata.js
//
// Requires pdftotext on PATH (ships with Git for Windows under mingw64).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPORTS = "C:\\Users\\admin\\Desktop\\India Related Reports";
const OUT = path.join(__dirname, "..", "data", "pdfdata.json");
const PDFTOTEXT = "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe";

// ---- Patterns ---------------------------------------------------------

const CALL_WORDS = "BUY|SELL|HOLD|NEUTRAL|OW|UW|EW|OVERWEIGHT|UNDERWEIGHT|EQUAL[- ]?WEIGHT|OUTPERFORM|UNDERPERFORM|MARKET[- ]?PERFORM|ADD|REDUCE|ACCUMULATE";
const NORM = { OVERWEIGHT:"OW", UNDERWEIGHT:"UW", "EQUAL-WEIGHT":"EW", "EQUAL WEIGHT":"EW", OUTPERFORM:"OP", UNDERPERFORM:"UP", "MARKET-PERFORM":"MP", "MARKET PERFORM":"MP" };
const normCall = c => (NORM[c.toUpperCase()] || c.toUpperCase());

// "₹1,400" / "Rs 1400" / "INR 1,400.50" / "Rs. 290" / bare "1,400"
const NUM = "([\\d,]+(?:\\.\\d+)?)";
const RS = "(?:₹|Rs\\.?|INR)\\s*";

function extractCurrTP(text) {
  // Try the most-explicit patterns first.
  const patterns = [
    // Jefferies: "PRICE TARGET | % TO PT  INR340 (INR325) | +15%"
    new RegExp("PRICE\\s*TARGET[^A-Z\\d]*?(?:INR|Rs\\.?|₹)\\s*" + NUM, "i"),
    // JPMorgan: "Price Target (Mar-27):Rs9.00" / "Price Target (INR)  306.00"
    new RegExp("price\\s+target\\s*(?:\\([^)]*\\))?\\s*[:\\s]*" + RS + "?" + NUM, "i"),
    // Generic: "12M price target Rs324.00" / "Target Price Rs 1400"
    new RegExp("(?:12M\\s+price\\s+target|target\\s+price)\\s*(?:of\\s*)?(?::)?\\s*" + RS + NUM, "i"),
    // Nomura layout: "Target price Remains INR 220"
    new RegExp("target\\s+price[^A-Z]{0,20}(?:remains|unchanged)?[^\\d]{0,12}" + RS + NUM, "i"),
    // Kotak: "Fair Value(): 295" / "FV of Rs295"
    new RegExp("(?:fair\\s+value|FV)\\s*(?:\\(\\))?[:\\s]*(?:of\\s*)?" + RS + "?" + NUM, "i"),
    // JPMorgan prose: "raising PT to Rs5050"
    new RegExp("\\bPT\\b\\s+(?:raised|cut|revised)?\\s*(?:to|at)\\s*" + RS + NUM, "i"),
    // Standalone "Target: Rs1400"
    new RegExp("\\btarget\\b\\s*:?\\s*" + RS + NUM, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return cleanNum(m[1]);
  }
  return null;
}

function extractPrevTP(text, currTP) {
  // Jefferies "INR340 (INR325)" — number followed by parens with another number
  let m = text.match(new RegExp(RS + NUM + "\\s*\\(\\s*(?:INR|Rs\\.?|₹)\\s*" + NUM + "\\s*\\)", "i"));
  if (m && m[1] !== m[2]) return cleanNum(m[2]);
  // "(earlier Rs1300)" / "(prev Rs 1300)" / "(old TP: Rs1300)" / "(was Rs1300)"
  m = text.match(new RegExp("\\(\\s*(?:earlier|prev(?:ious)?|old|was)\\b[^)]*?" + RS + NUM + "\\s*\\)", "i"));
  if (m) return cleanNum(m[1]);
  // "TP revised from Rs1300 to Rs1400" / "raise TP from 1300 to 1400"
  m = text.match(new RegExp("(?:TP|target|PT)\\s*(?:raised|cut|revised)?\\s*from\\s*" + RS + NUM, "i"));
  if (m) return cleanNum(m[1]);
  // "earlier TP of Rs1300" / "previous TP Rs1300"
  m = text.match(new RegExp("(?:earlier|previous|old)\\s+(?:TP|target|PT|FV|fair\\s+value)[^A-Za-z0-9]+" + RS + NUM, "i"));
  if (m) return cleanNum(m[1]);
  // "Remains/Unchanged/Maintained" near TP → prev TP equals current TP
  // (broker explicitly reiterating their prior target).
  if (currTP) {
    const reiterate = /\b(remains?|unchanged|maintain(?:ed|s)?|reiterate(?:s|d)?)\b[^A-Z]{0,40}?(?:target|TP|PT|FV|fair\s+value|price\s+target)/i;
    const reiterate2 = /(?:target|TP|PT|FV|fair\s+value|price\s+target)[^A-Z]{0,30}\b(remains?|unchanged|maintain(?:ed|s)?|reiterate(?:s|d)?)\b/i;
    if (reiterate.test(text) || reiterate2.test(text)) return currTP;
  }
  return null;
}

function extractCurrCall(text) {
  // Search the first ~600 chars (top of page 1) for a clear rating word.
  const head = text.slice(0, 800);
  // Explicit "Rating: X" / "Recommendation: X"
  let m = head.match(new RegExp("(?:rating|recommendation)\\s*[:\\-]\\s*(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // "stay/maintain/reiterate/upgrade to/downgrade to X"
  m = head.match(new RegExp("(?:stay|maintain|reiterate|upgrade\\s*to|downgrade\\s*to|initiate\\s*(?:with)?)\\s+(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // Standalone ALL-CAPS word that looks like a rating.
  m = head.match(new RegExp("\\b(" + CALL_WORDS.replace(/\(\?[!=][^)]*\)/g,"") + ")\\b", ""));
  if (m) return normCall(m[1]);
  return null;
}

function extractPrevCall(text, currCall) {
  // "downgrade to HOLD from BUY" / "upgrade from HOLD to BUY"
  let m = text.match(new RegExp("(?:upgrade|downgrade|change)\\s+to\\s+(?:" + CALL_WORDS + ")\\s+from\\s+(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  m = text.match(new RegExp("(?:upgrade|downgrade)\\s+from\\s+(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // "(prev: BUY)" / "(earlier: HOLD)"
  m = text.match(new RegExp("\\(\\s*(?:prev|previous|earlier|old|was)\\b[^)]*?\\b(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // "rating: SELL (earlier BUY)"
  m = text.match(new RegExp("\\b(?:earlier|previous|old|was)\\b[\\s:]*\\b(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // "Maintain/Reiterate/Remains BUY" / "stay BUY" → prev call == current call
  if (currCall) {
    const reiterate = new RegExp("\\b(?:maintain(?:ed|s)?|reiterate(?:s|d)?|remains?|stay(?:s|ing)?)\\b[^A-Z]{0,40}\\b(" + CALL_WORDS + ")\\b", "i");
    const m2 = text.match(reiterate);
    if (m2 && normCall(m2[1]) === currCall) return currCall;
  }
  return null;
}

function cleanNum(s) {
  // "1,400.00" → "1,400" ; "5050" → "5,050"
  let n = String(s).replace(/[,\s]/g, "");
  if (n.endsWith(".00")) n = n.slice(0, -3);
  const num = Number(n);
  if (!isFinite(num)) return null;
  return num.toLocaleString("en-IN");
}

// ---- Walk + extract --------------------------------------------------

function listPdfs() {
  const out = [];
  for (const folder of fs.readdirSync(REPORTS)) {
    const dir = path.join(REPORTS, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(".pdf")) continue;
      const m = f.match(/^\[(\d{6})\]\s*\[([^\]]+)\]\s*(.+?)\s*-\s*(.+)\.pdf$/i);
      if (!m) continue;
      const [, date, house, , titleRaw] = m;
      if (date < cutoff) continue;
      const titleNoSuffix = titleRaw.replace(/\s*\(\d+\)\s*$/, "").trim();
      const titleNorm = titleNoSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "");
      out.push({
        key: `${house.trim()}|${date}|${folder}|${titleNorm}`,
        path: path.join(dir, f),
        title: titleNoSuffix,
        house: house.trim(),
        date,
      });
    }
  }
  return out;
}

const cutoff = ((d) => {
  d.setDate(d.getDate() - 2);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return yy + mm + dd;
})(new Date());

function extractPage1(p) {
  try {
    const buf = execFileSync(PDFTOTEXT, ["-layout", "-f", "1", "-l", "3", "--", p, "-"], { maxBuffer: 8 * 1024 * 1024 });
    return buf.toString("utf8");
  } catch (e) {
    return "";
  }
}

const pdfs = listPdfs();
console.log("PDFs in window (>=" + cutoff + "):", pdfs.length);

const out = {};
let done = 0, withCurrTP = 0, withPrevTP = 0, withCurrCall = 0, withPrevCall = 0;
const seen = new Set();
for (const p of pdfs) {
  if (seen.has(p.key)) continue;
  seen.add(p.key);
  const text = extractPage1(p.path);
  if (!text) { done++; continue; }
  const flat = text.replace(/\s+/g, " ");
  const currTP = extractCurrTP(flat);
  const currCall = extractCurrCall(flat);
  const entry = {
    currTP,
    prevTP: extractPrevTP(flat, currTP),
    currCall,
    prevCall: extractPrevCall(flat, currCall),
  };
  if (entry.currTP) withCurrTP++;
  if (entry.prevTP) withPrevTP++;
  if (entry.currCall) withCurrCall++;
  if (entry.prevCall) withPrevCall++;
  out[p.key] = entry;
  done++;
  if (done % 25 === 0) console.log("  ...", done, "/", pdfs.length);
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log("\nDone. Wrote", Object.keys(out).length, "entries to", OUT);
console.log("Coverage:  currTP", withCurrTP, "| prevTP", withPrevTP, "| currCall", withCurrCall, "| prevCall", withPrevCall);
