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

// CLSA-post-Jun-2024 codes (HLD/O-PF/U-PF + HC O-PF/HC U-PF) included.
const CALL_WORDS = "BUY|SELL|HOLD|NEUTRAL|OW|UW|EW|OVERWEIGHT|UNDERWEIGHT|EQUAL[- ]?WEIGHT|OUTPERFORM|UNDERPERFORM|MARKET[- ]?PERFORM|ADD|REDUCE|ACCUMULATE|HLD|O[- ]?PF|U[- ]?PF|HC\\s+O[- ]?PF|HC\\s+U[- ]?PF";
const NORM = {
  OVERWEIGHT:"OW", UNDERWEIGHT:"UW", "EQUAL-WEIGHT":"EW", "EQUAL WEIGHT":"EW",
  OUTPERFORM:"OP", UNDERPERFORM:"UP", "MARKET-PERFORM":"MP", "MARKET PERFORM":"MP",
  HLD:"HOLD", "O-PF":"OP", "OPF":"OP", "U-PF":"UP", "UPF":"UP",
  "HC O-PF":"OP", "HC OPF":"OP", "HC U-PF":"UP", "HC UPF":"UP"
};
const normCall = c => (NORM[c.toUpperCase()] || c.toUpperCase());

// "₹1,400" / "Rs 1400" / "INR 1,400.50" / "$60.00" / "US$1,200" / "USD 750"
// The trailing guard rejects revenue / TAM / market-size shorthand like
// "27.1bn", "1.3b", "5k", "300m". For "INR27.1bn" the engine first tries
// to match "27.1" then sees "b" and would happily backtrack to "27"
// (with "." next, which is not a letter) — so the guard has to ALSO
// reject "X" when "X.<digit>" follows, otherwise we'd silently capture
// the integer portion of a billion-rupee revenue figure as a TP.
//   ([\d,]+(?:\.\d+)?)         numeric core (commas + optional decimal)
//   (?!\d|\.\d|[A-Za-z])       next char isn't another digit, isn't a
//                              "." followed by a digit, isn't a letter
// Hit by Sun Pharma's Jefferies "NA" template (no TP) where the body
// flowed "INR27.1bn" right after the PRICE TARGET cell.
const NUM = "([\\d,]+(?:\\.\\d+)?)(?!\\d|\\.\\d|[A-Za-z])";
const RS = "(?:₹|Rs\\.?|INR|US\\$|USD|\\$)\\s*";

function extractCurrTP(text) {
  // RS is the currency prefix (₹/Rs/INR/$/US$/USD + space). Wrap as
  // (?:RS)? when the prefix is optional — appending "?" alone only
  // makes the trailing \s* non-greedy, NOT the whole prefix optional.
  const RS_OPT = "(?:" + RS + ")?";
  // Order matters — most specific labels first. The "target price"
  // patterns require an RS prefix on the number; otherwise they greedily
  // match noise like "Target price 4QFY26" and capture "4".
  const patterns = [
    // Jefferies: "PRICE TARGET | % TO PT  INR340 (INR325) | +15%"
    // Case-sensitive: Jefferies uses ALL CAPS in this header. The
    // case-insensitive variant kept poaching Bernstein's "Price Target"
    // table on page 2+ and capturing the close price by mistake.
    new RegExp("PRICE\\s*TARGET[\\s\\S]{0,80}?(?:INR|Rs\\.?|₹|\\$|US\\$|USD)\\s*" + NUM),
    // Bernstein: "Price Target [ticker] 5,000.00 INR" / "8.00 USD"
    // — currency comes AFTER the number, not before. Run before JPM
    // so the prefix-currency variant doesn't grab the wrong number.
    new RegExp("Price\\s+Target[\\s\\S]{0,80}?\\b" + NUM + "\\s*(?:INR|Rs\\.?|₹|USD|US\\$)\\b", "i"),
    // JPMorgan: "Price Target (Mar-27):$60.00" / "Price Target (INR)  306.00"
    new RegExp("price\\s+target\\s*(?:\\([^)]*\\))?\\s*[:\\s]*" + RS + NUM, "i"),
    // Nomura two-column header layout. In some reports body text
    // wedges between the rating word and "Remains" (the rating sits
    // in the right column while the headline prose flows down on the
    // left). Allow up to ~200 chars between them.
    new RegExp("\\bRating\\s+\\w+[\\s\\S]{0,200}?(?:Remains|Unchanged|Maintain(?:ed)?|Reiterate(?:d)?|Down\\s+from\\s+\\w+|Up\\s+from\\s+\\w+|Cut\\s+from\\s+\\w+|Raised\\s+from\\s+\\w+|Reduced\\s+from\\s+\\w+)[\\s\\S]{0,30}?(?:INR|Rs\\.?|₹|\\$|US\\$|USD)\\s*" + NUM, "i"),
    // Prose "TP of INR1,494" / "with a TP of INR1,722" — Nomura
    // anchor-report initiations and Uno Minda's quarter notes.
    new RegExp("\\bTP\\s+of\\s+(?:INR|Rs\\.?|₹|\\$|US\\$|USD)\\s*" + NUM, "i"),
    // Kotak: "Fair Value(): 8,150" — no Rs prefix on the number here,
    // so RS is genuinely optional (the "Fair Value" label is specific
    // enough to be safe).
    new RegExp("(?:fair\\s+value|FV)\\s*(?:\\(\\))?[:\\s]*(?:of\\s*)?" + RS_OPT + NUM, "i"),
    // Kotak compact: "CMP(Rs)/FV(Rs)/Rating  7,154/8,150/BUY"
    /CMP\([^)]*\)\s*\/\s*FV\([^)]*\)\s*\/\s*Rating\s+[\d,]+\s*\/\s*([\d,]+)\s*\//i,
    // CLSA "Recommendation history" table — latest row gives current TP.
    /Recommendation\s+history[\s\S]{0,400}?\d{1,2}\s+\w{3,9}\s+\d{4}\s+(?:BUY|SELL|HOLD|HLD|O[- ]?PF|U[- ]?PF|HC\s+O[- ]?PF|HC\s+U[- ]?PF)\s+([\d,]+(?:\.\d+)?)/i,
    // Generic: "12M price target Rs324.00" / "Target Price Rs 1400"
    // (?![A-Za-z]) guards against "USD1b" / "Rs5k" being mis-captured as 1/5.
    new RegExp("(?:12M\\s+price\\s+target|target\\s+price)\\s*(?:of\\s*)?(?::)?\\s*" + RS + NUM + "(?![A-Za-z])", "i"),
    // JPMorgan prose: "raising PT to Rs5050" / "PT down to $60"
    new RegExp("\\bPT\\b\\s+(?:raised|cut|revised|up|down)?\\s*(?:to|at)\\s*" + RS + NUM + "(?![A-Za-z])", "i"),
    // Standalone "Target: Rs1400" — same trailing-letter guard to avoid
    // matching "Target: USD1b run rate" (a forward-looking $1b revenue
    // goal that has nothing to do with the broker's TP).
    new RegExp("\\btarget\\b\\s*:?\\s*" + RS + NUM + "(?![A-Za-z])", "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return cleanNum(m[1]);
  }
  return null;
}

// Was the TP changed in this report? Any explicit raise/cut/revise/
// upgrade/downgrade/(from X)/(previously X) signal counts. Used to
// decide whether "no prev stated" means "no change" (default prev=curr)
// or genuinely missing data.
function tpChangeSignaled(text){
  // Must be a tight phrasing — verb adjacent to the TP keyword (≤20
  // chars, not 80, otherwise unrelated mentions like "cutting LPG
  // consumption ... estimate ..." trip the check).
  const verb = "raise|raised|raises|raising|cut|cuts|cutting|revis(?:e|ed|ing)|lower(?:ed|ing)?|hike(?:d)?|increase(?:d|s)?|decrease(?:d|s)?|chang(?:e|ed|ing)";
  const tp = "TP|PT|target\\s+price|target|FV|fair\\s+value|price\\s+target";
  // verb → TP within 20 chars  (e.g. "raise our TP", "cut TP to 200")
  if (new RegExp("\\b(?:" + verb + ")\\b[^A-Z\\d]{0,20}(?:our\\s+)?(?:" + tp + ")\\b", "i").test(text)) return true;
  // TP → verb within 20 chars  (e.g. "TP raised to 1500", "FV revised")
  if (new RegExp("\\b(?:" + tp + ")\\b[^A-Z\\d]{0,20}(?:" + verb + ")\\b", "i").test(text)) return true;
  // Explicit parenthetical change tags — must include either an Rs
  // prefix or a marker word that ties it to a price ("previously RsX"
  // / "(from $110)" / "(Rs1400 earlier)"). Bare "(from XYZ)" doesn't count.
  if (/\(\s*previously\s+(?:Rs\.?|INR|₹|\$|US\$|USD)\s*\d/i.test(text)) return true;
  if (/\(\s*from\s+(?:Rs\.?|INR|₹|\$|US\$|USD)\s*\d/i.test(text)) return true;
  if (/\(\s*(?:Rs\.?|INR|₹|\$|US\$|USD)\s*[\d,]+\s+(?:earlier|prev(?:ious(?:ly)?)?|old)\s*\)/i.test(text)) return true;
  // Explicit "old/previous TP" labels
  if (/\b(?:old|previous|earlier|prior)\s+(?:TP|PT|target|target\s+price|FV|fair\s+value|price\s+target)\b/i.test(text)) return true;
  // Rating-change wording near an actual rating word
  if (new RegExp("\\b(?:upgrade(?:d)?|downgrade(?:d)?)\\s+(?:to|from)\\s+(?:" + CALL_WORDS + ")\\b", "i").test(text)) return true;
  return false;
}
function callChangeSignaled(text){
  return /\b(?:upgrade(?:d|s|\s+to)|downgrade(?:d|s|\s+to)|change(?:d|s)?\s+(?:our\s+)?(?:rating|recommendation|stance|call)\s+(?:to|from)|move\s+to|moved?\s+to)\b/i.test(text);
}

function extractPrevTP(text, currTP) {
  // Parenthetical "(previously Rs125)" — very common in JPMorgan etc.
  let m = text.match(new RegExp("\\(\\s*previously\\s+" + RS + NUM + "\\s*\\)", "i"));
  if (m) return cleanNum(m[1]);
  // JPMorgan: "Prior (Dec-26):$110.00" line directly under Price Target
  m = text.match(new RegExp("\\bPrior\\s*\\([^)]*\\)\\s*:?\\s*" + RS + NUM, "i"));
  if (m) return cleanNum(m[1]);
  // Nomura: "Target price Reduced from INR ... 845" / "Reduced from INR 1,513"
  // The previous value sits 0-50 chars after "Reduced/Raised/Cut from",
  // possibly with a "+X%" upside number in between. Require 3+ digits
  // so we don't capture "8" from "+8.1%".
  m = text.match(/(?:Reduced|Raised|Cut|Up|Down|Changed)\s+from(?:\s+(?:INR|Rs\.?|₹|\$|US\$|USD))?[\s\S]{0,50}?\b([\d,]{3,}(?:\.\d+)?)\b(?!\s*\.\d|\s*%)/i);
  if (m) return cleanNum(m[1]);
  // Inline "(INR1,513 previously)" / "(Rs1,300 prev)" / "(old Rs1,300)"
  m = text.match(new RegExp("\\((?:INR|Rs\\.?|₹|\\$|US\\$|USD)\\s*" + NUM + "\\s+(?:previously|prev(?:ious)?|earlier|old)\\s*\\)", "i"));
  if (m) return cleanNum(m[1]);
  // Parenthetical "(from Rs4,300)" / "(from INR325)" — Jefferies/JPMorgan
  m = text.match(new RegExp("\\(\\s*from\\s+" + RS + NUM + "\\s*\\)", "i"));
  if (m) return cleanNum(m[1]);
  // Jefferies "INR340 (INR325)" — number followed by parens with another number
  m = text.match(new RegExp(RS + NUM + "\\s*\\(\\s*(?:INR|Rs\\.?|₹)\\s*" + NUM + "\\s*\\)", "i"));
  if (m && m[1] !== m[2]) return cleanNum(m[2]);
  // "(earlier Rs1300)" / "(prev Rs 1300)" / "(old TP: Rs1300)" / "(was Rs1300)"
  m = text.match(new RegExp("\\(\\s*(?:earlier|prev(?:ious)?|old|was)\\b[^)]*?" + RS + NUM + "\\s*\\)", "i"));
  if (m) return cleanNum(m[1]);
  // "TP revised from Rs1300 to Rs1400" / "raise TP from 1300 to 1400"
  m = text.match(new RegExp("(?:TP|target|PT)\\s*(?:raised|cut|revised|moved|moved\\s+up|moved\\s+down)?\\s*from\\s*" + RS + NUM, "i"));
  if (m) return cleanNum(m[1]);
  // "raise/raising/raised our TP to Rs1500 (Rs1400 earlier)" / "(Rs1400 prev)"
  m = text.match(new RegExp("\\(\\s*" + RS + NUM + "\\s+(?:earlier|prev(?:ious(?:ly)?)?|old)\\s*\\)", "i"));
  if (m) return cleanNum(m[1]);
  // "earlier TP of Rs1300" / "previous TP Rs1300"
  m = text.match(new RegExp("(?:earlier|previous|old)\\s+(?:TP|target|PT|FV|fair\\s+value)[^A-Za-z0-9]+" + RS + NUM, "i"));
  if (m) return cleanNum(m[1]);
  // "Old TP Rs1300 New TP Rs1400" / "Old PT 1300 | New PT 1400"
  m = text.match(new RegExp("(?:Old|Prev(?:ious)?)\\s*(?:TP|PT|target|FV|fair\\s+value)\\s*:?\\s*" + RS + NUM, "i"));
  if (m) return cleanNum(m[1]);
  // "Remains/Unchanged/Maintained" near TP → prev TP equals current TP
  // (broker explicitly reiterating their prior target).
  if (currTP) {
    const reiterate = /\b(remains?|unchanged|maintain(?:ed|s)?|reiterate(?:s|d)?)\b[^A-Z]{0,40}?(?:target|TP|PT|FV|fair\s+value|price\s+target)/i;
    const reiterate2 = /(?:target|TP|PT|FV|fair\s+value|price\s+target)[^A-Z]{0,30}\b(remains?|unchanged|maintain(?:ed|s)?|reiterate(?:s|d)?)\b/i;
    if (reiterate.test(text) || reiterate2.test(text)) return currTP;
  }
  // Final fallback: if curr TP is known and the report shows no
  // explicit change signal (raise/cut/revise/upgrade/(from X)/etc.),
  // assume the broker is reiterating and default prev TP = curr TP.
  // This covers ordinary quarter-result updates that don't restate the
  // prior TP in prose.
  if (currTP && !tpChangeSignaled(text)) return currTP;
  return null;
}

function extractCurrCall(text) {
  // Search the top of the report (page 1-2 worth) for a clear rating.
  const head = text.slice(0, 2400);
  // Explicit "Rating: X" / "Recommendation: X"
  let m = head.match(new RegExp("(?:rating|recommendation)\\s*[:\\-]\\s*(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // "stay/maintain/reiterate/upgrade to/downgrade to X"
  m = head.match(new RegExp("(?:stay|maintain|reiterate|upgrade\\s*to|downgrade\\s*to|initiate\\s*(?:with)?)\\s+(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // CLSA inline: "Bharat Petro (BPCL IB - RS286.50 - HOLD)" / "(... - O-PF)"
  m = head.match(new RegExp("-\\s*(" + CALL_WORDS + ")\\s*\\)", "i"));
  if (m) return normCall(m[1]);
  // CLSA Recommendation history table — latest row's rating column
  m = text.match(/Recommendation\s+history[\s\S]{0,400}?\d{1,2}\s+\w{3,9}\s+\d{4}\s+(BUY|SELL|HOLD|HLD|O[- ]?PF|U[- ]?PF|HC\s+O[- ]?PF|HC\s+U[- ]?PF)\b/i);
  if (m) return normCall(m[1]);
  // Standalone rating word in the head (case-insensitive — "Overweight"
  // / "Underweight" / "Buy" / "Hold" all match).
  m = head.match(new RegExp("\\b(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  return null;
}

function extractPrevCall(text, currCall) {
  // "downgrade to HOLD from BUY" / "upgrade from HOLD to BUY"
  let m = text.match(new RegExp("(?:upgrade|downgrade|change)\\s+to\\s+(?:" + CALL_WORDS + ")\\s+from\\s+(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  m = text.match(new RegExp("(?:upgrade|downgrade)\\s+from\\s+(" + CALL_WORDS + ")\\b", "i"));
  if (m) return normCall(m[1]);
  // Nomura layout: "Down from Buy" / "Up from Hold" — the prior rating
  // sits after the "Down/Up/Cut/Raised from" marker.
  m = text.match(new RegExp("\\b(?:Down|Up|Cut|Raised|Reduced|Changed)\\s+from\\s+(" + CALL_WORDS + ")\\b", "i"));
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
  // Final fallback: if curr call is known and no rating-change signal
  // appears in the report, assume the broker is reiterating and default
  // prev call = curr call.
  if (currCall && !callChangeSignaled(text)) return currCall;
  return null;
}

// First ~400 chars of body prose for the hover tooltip. Skips header
// (broker name, ticker, contact info) by finding the first long prose
// chunk after position ~200.
function extractSummary(flat, headlineHint) {
  let t = String(flat).replace(//g, ' ').replace(/\s+/g, ' ').trim();
  // If the headline (title from filename) appears in the text, jump
  // just past its first occurrence — body usually starts there.
  let start = 200;
  if (headlineHint) {
    const idx = t.toLowerCase().indexOf(String(headlineHint).slice(0, 30).toLowerCase());
    if (idx > 50) start = Math.max(start, idx + 30);
  }
  // Scan forward for the start of a sensible prose sentence.
  for (let i = start; i < Math.min(t.length, start + 600); i++) {
    if (/[A-Z]/.test(t[i]) && (i === 0 || /[\s.]/.test(t[i - 1]))) {
      const probe = t.slice(i, i + 300);
      if ((probe.match(/[a-z]/g) || []).length > 100) { start = i; break; }
    }
  }
  let body = t.slice(start, start + 520);
  // Trim to last full sentence before ~450 chars.
  const cut = body.lastIndexOf('. ', 450);
  if (cut > 180) body = body.slice(0, cut + 1);
  return body.trim();
}

function cleanNum(s) {
  // "1,400.00" → "1,400" ; "5050" → "5,050"
  let n = String(s).replace(/[,\s]/g, "");
  if (n.endsWith(".00")) n = n.slice(0, -3);
  const num = Number(n);
  if (!isFinite(num) || num <= 0) return null;
  // No lower bound — every TP regex now requires a strong label (Price
  // Target / TP of / Fair Value / Recommendation history / Rating ...
  // Remains / Reduced from), so garbage like "4QFY26 → 4" no longer
  // leaks in. Single-digit targets ($8 / Rs9 for VI etc.) are valid.
  return num.toLocaleString("en-IN");
}

// ---- Walk + extract --------------------------------------------------
// Folder-alias map — keep in sync with scripts/rebuild-pdfmap.js. Folds
// duplicate notebook names onto the canonical so the rest of the
// pipeline only sees one identity per stock.
const FOLDER_ALIAS = {
  "L&T":                          "Larsen & Toubro",
  "Oil and Natural Gas":          "ONGC",
  "IndiGo":                       "InterGlobe Aviation",
  "Rainbow Children's Medicare":  "Rainbow Children's Hospitals",
};

function listPdfs() {
  const out = [];
  for (const rawFolder of fs.readdirSync(REPORTS)) {
    const dir = path.join(REPORTS, rawFolder);
    if (!fs.statSync(dir).isDirectory()) continue;
    const folder = FOLDER_ALIAS[rawFolder] || rawFolder;
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(".pdf")) continue;
      // Filename: "[YYMMDD] [House] Folder - Title.pdf". Separator MUST
      // be " - " (space-dash-space) so embedded hyphens in folder names
      // ("India Autos, May-2026 volumes") aren't taken as the split.
      const m = f.match(/^\[(\d{6})\]\s+\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)\.pdf$/i);
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

// Scan back ~45 days. Prior-report PDFs older than the 2-day digest
// window need pdfdata too so the render can fall back to their curr TP
// when the current report doesn't explicitly state a prev TP.
const cutoff = ((d) => {
  d.setDate(d.getDate() - 45);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return yy + mm + dd;
})(new Date());

function extractPage1(p) {
  try {
    // Pages 1–10 — TP/call usually on p1, Estimate-Revision tables on
    // p2–p4, CLSA's "Recommendation history" table on p6+. 10 pages
    // covers all common layouts without dragging in back-matter noise.
    const buf = execFileSync(PDFTOTEXT, ["-layout", "-f", "1", "-l", "10", "--", p, "-"], { maxBuffer: 12 * 1024 * 1024 });
    return buf.toString("utf8");
  } catch (e) {
    return "";
  }
}
// Non-layout pass for the hover-summary: pdftotext without -layout
// gives natural prose flow (no column interleaving), which makes the
// "first paragraph of body" much cleaner.
function extractFlow(p) {
  try {
    const buf = execFileSync(PDFTOTEXT, ["-f", "1", "-l", "2", "--", p, "-"], { maxBuffer: 8 * 1024 * 1024 });
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
  // Second pass without -layout for summary — gives natural prose
  // flow instead of column interleaving.
  const flowText = extractFlow(p.path).replace(/\s+/g, " ").trim();
  const entry = {
    currTP,
    prevTP: extractPrevTP(flat, currTP),
    currCall,
    prevCall: extractPrevCall(flat, currCall),
    summary: extractSummary(flowText || flat, p.title),
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
