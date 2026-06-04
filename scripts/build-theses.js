// Build data/theses.json — a bull/bear thesis per company, distilled
// from the broker reports we already have in this repo:
//   - Local PDF library: NOTES + notesPrior (parsed from index.html)
//   - Trendlyne /research-reports/all/ snapshot: notesExt (index.html)
//   - Trendlyne per-stock coverage: data/trendlyne-coverage.json
//   - PDF body summaries / TP / call extraction: data/pdfdata.json
//   - PDF file map for file:// links: data/pdfmap.json
//
// Output shape (data/theses.json):
//   {
//     "<Company>": {
//       "bull": [ { text, broker, date, url }, ... up to 3 ],
//       "bear": [ { text, broker, date, url }, ... up to 3 ],
//     },
//     ...
//   }
//
// Citations on the page are rendered as "(ABBREV, MM/YY)" and link to
// `url` — local PDF (file://) when present, Trendlyne post PDF cache
// when available, NotebookLM workspace fallback, Google search as last
// resort.
//
// Run: node scripts/build-theses.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'data', 'theses.json');

const PDFDATA  = readJson('data/pdfdata.json');
const PDFMAP   = readJson('data/pdfmap.json');
const TLCOV    = readJson('data/trendlyne-coverage.json');
const COMPANIES = readJson('data/companies.json');

function readJson(rel){
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return {}; }
}

// ---------- 1) parse the inline arrays from index.html ------------------
const html = fs.readFileSync(HTML, 'utf8');
function parseArray(varDecl){
  const re = new RegExp('(?:const|let|var)\\s+' + varDecl + '\\s*=\\s*\\[\\s*([\\s\\S]*?)\\s*\\];');
  const m = html.match(re);
  if (!m) return [];
  const body = m[1];
  // Each row: ["house","yymmdd","company","headline","url?"]
  // Use Function() to evaluate the safe array literal.
  try { return new Function('return [' + body + ']')(); }
  catch (e) { console.warn('parseArray failed for', varDecl, e.message); return []; }
}
const notes      = parseArray('notes');
const notesExt   = parseArray('notesExt');
const notesPrior = parseArray('notesPrior');

const nbRe = /\{name:\s*"([^"]+)",\s*url:\s*"([^"]*)"\}/g;
const NB = {};
{
  const m = html.match(/const NOTEBOOKS\s*=\s*\[([\s\S]*?)\];/);
  if (m){
    let x; while ((x = nbRe.exec(m[1])) !== null) NB[x[1]] = x[2];
  }
}
const SECTOR_NAMES = new Set();
{
  const m = html.match(/const SECTOR_NAMES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (m){
    const re = /'([^']+)'|"([^"]+)"/g; let x;
    while ((x = re.exec(m[1])) !== null) SECTOR_NAMES.add(x[1] || x[2]);
  }
}

// ---------- 2) broker abbreviation lookup ------------------------------
// Hand-curated from CLAUDE.md plus the external brokers we see in
// notesExt / Trendlyne. Anything not in here falls back to the broker
// name with whitespace removed.
const ABBR = {
  'Bernstein': 'Bern',
  'CLSA': 'CLSA',
  'Jefferies': 'Jeff',
  'JPMorgan': 'JP', 'JP Morgan': 'JP',
  'Kotak': 'Kotak', 'Kotak Institutional': 'Kotak', 'Kotak Securities': 'Kotak', 'Kotak Mahindra': 'Kotak',
  'Nomura': 'Nomura',
  'Anand Rathi': 'AR',
  'Axis': 'Axis', 'Axis Direct': 'Axis', 'Axis Capital': 'Axis', 'Axis Securities': 'Axis',
  'Deven Choksey': 'DC', 'DChoksey': 'DC', 'DRChoksey': 'DC',
  'Geojit': 'Geojit', 'Geojit BNP Paribas': 'Geojit',
  'ICICI Direct': 'ICICI', 'ICICI Securities': 'ICICI', 'ICICI Securities Limited': 'ICICI',
  'IDBI Capital': 'IDBI', 'IDBI': 'IDBI',
  'Khambatta Securities': 'KS',
  'Prabhudas Lilladhar': 'PL',
  'Motilal Oswal': 'MO',
  'HDFC Securities': 'HDFC',
  'Emkay': 'Emkay',
  'Sharekhan': 'Sharekhan',
  'Nuvama': 'Nuvama',
  'Nuvama Wealth': 'Nuvama',
  'Morgan Stanley': 'MS',
  'Citi': 'Citi', 'Citigroup': 'Citi',
  'UBS': 'UBS',
  'JM Financial': 'JMF',
  'BOB Capital Markets': 'BOB',
  'BP Wealth': 'BPW',
  'Choice Broking': 'Choice',
  'Religare': 'Religare', 'Religare Broking': 'Religare',
  'Sundaram': 'Sundaram',
  'Antique': 'Antique',
  'Centrum': 'Centrum',
  'Edelweiss': 'Edel',
  'IIFL': 'IIFL', 'IIFL Securities': 'IIFL',
  'ITI Capital': 'ITI', 'ITI Securities': 'ITI',
  'KR Choksey': 'KRC',
  'Mehta Equities': 'Mehta',
  'Reliance Securities': 'RSL',
  'HDFC': 'HDFC', 'HDFC Bank': 'HDFC',
  'Yes Securities': 'Yes',
  'SBI Securities': 'SBI',
  'Mirae Asset': 'Mirae',
  'Investec': 'Investec',
  'BNP Paribas': 'BNP',
  'Bank of America': 'BofA', 'BofA': 'BofA',
  'Macquarie': 'Macq',
  'CITIC': 'CITIC',
  'CGS-CIMB': 'CGS',
};
function abbrevOf(name){
  if (!name) return '';
  if (ABBR[name]) return ABBR[name];
  const cleaned = name.replace(/\s+Limited$/i, '').replace(/\s+Ltd\.?$/i, '').replace(/\s+Inc\.?$/i, '').trim();
  if (ABBR[cleaned]) return ABBR[cleaned];
  // Fallback: first word (or two words ≤ 6 chars total).
  const words = cleaned.split(/\s+/);
  return words[0].slice(0, 10);
}

// ---------- 3) URL resolution -------------------------------------------
function fileUrl(p){
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}
function pdKey(h, d, co, ti){
  const n = String(ti).replace(/\s*\(\d+\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${h}|${d}|${co}|${n}`;
}
function urlFor(folder, house, headline, date, explicit){
  if (explicit) return explicit;
  if (PDFMAP){
    const tk = String(headline).replace(/\s*\(\d+\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const p = PDFMAP[`${house}|${date}|${folder}|${tk}`];
    if (p) return fileUrl(p);
  }
  if (NB[folder]){
    const u = NB[folder];
    return u + (u.includes('?') ? '&' : '?') + 'authuser=markworktk%40gmail.com';
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(`${house} ${folder} ${headline}`);
}

// ---------- 4) bull/bear sentence-text shaping --------------------------
function stripRatingPrefix(headline){
  // "Buy · TP ₹520 — Sharp margin recovery drives earnings beat"
  //   → "Sharp margin recovery drives earnings beat"
  const idx = headline.indexOf(' — ');
  if (idx === -1) return headline.trim();
  return headline.slice(idx + 3).trim();
}

// Boilerplate / metadata patterns that show up in PDF-text extractions
// and shouldn't surface as a thesis sentence.
const BAD_OPENS = /^(?:refer to|please refer|downloaded by|page \d|source:|see disclosure|disclosure|exhibit \d|figure \d|table \d|fig\. \d|tab\. \d|chart \d|exhibit:|appendix|copyright|all rights reserved|©|target price|price target|fair value|cmp[\s:(]|reco[\s:(]|rating[\s:(]|bloomberg|reuters|nse|bse|isin|shares outstanding|market cap[\s:]|52[- ]week|prior \(|q[1-4]fy|fy2|consensus est|kie:|our est|net revenues?\s|ebitda grew|ebit grew|preferential issue)/i;
const ALMOST_ONLY_NUMBERS = /^[\s\d,.()%/+\-:$₹Rs\w]{0,15}$/;        // very short and numeric-dominated
function isBadSentence(t){
  if (!t || t.length < 30) return true;
  // Must start with a capital letter, digit, or open quote — sentences
  // that start lowercase or with ")" / "," are clipped mid-sentence.
  if (!/^[A-Z“"'(\[]/.test(t)) return true;
  if (BAD_OPENS.test(t)) return true;
  if (ALMOST_ONLY_NUMBERS.test(t)) return true;
  // Unbalanced parentheses → likely clipped.
  const opens = (t.match(/\(/g) || []).length;
  const closes = (t.match(/\)/g) || []).length;
  if (Math.abs(opens - closes) > 1) return true;
  // Too many garbled replacement chars / boxes.
  const garbled = (t.match(/[�■□]/g) || []).length;
  if (garbled > 1 || garbled / t.length > 0.02) return true;
  // Too many digits relative to letters (probably a metrics block).
  const digits = (t.match(/\d/g) || []).length;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters > 0 && digits / (digits + letters) > 0.28) return true;
  // Ends mid-acronym ("J.P." / "Mr." / "Dr." / "Inc.") — common clipping.
  if (/\b(?:J|P|U|S|N|U\.S|U\.K|Mr|Mrs|Ms|Dr|Inc|Ltd|Corp|Co|Pvt|Pte|Q[1-4]|H[12]|FY|CY|H[12]E|FY\d+|CY\d+)\.$/.test(t)) return true;
  return false;
}

function cleanText(t){
  return String(t)
    .replace(/[��]/g, '')                       // strip replacement chars
    .replace(/\s+/g, ' ')
    .replace(/[‐–—]/g, '—')                          // unify dashes
    .replace(/\s*\(\d+\)\s*$/, '')                   // drop trailing " (2)"
    .trim();
}

// Split a long PDF summary into candidate sentences. Keep only the
// ones that pass the quality filter, return the first 1-2 joined.
function distillSummary(summary){
  const t = cleanText(summary);
  if (!t) return '';
  // Sentence split on .!? followed by space + capital / digit / quote.
  const sents = t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).map(s => s.trim()).filter(Boolean);
  for (const s of sents){
    if (!isBadSentence(s)){
      // Strip trailing brokerage disclaimers if any slipped in.
      return s.length > 240 ? s.slice(0, 240).replace(/[\s,;:]+\S*$/, '') + '…' : s;
    }
  }
  return '';
}

function pickText(report, pd){
  // 1. PDF body summary, distilled to its first usable sentence.
  let t = (pd && pd.summary) ? distillSummary(pd.summary) : '';
  // 2. Fall back to the headline (cleaned and prefix-stripped).
  if (!t){
    t = cleanText(stripRatingPrefix(String(report.headline || '')));
    if (isBadSentence(t)) return '';
  }
  if (!/[.!?…]$/.test(t)) t += '.';
  return t;
}

// ---------- 5) bull/bear classification ---------------------------------
const POS = /\b(beat|beats|beating|upgrade|outperform|strong|robust|relief|blockbuster|exemplary|positive|improving|improved|improvement|accelerate|accelerating|tailwind|momentum|exceeded|retained|inflection|re-rating|attractive|compelling|raise|raising|hike|hiking|hiked|growth|expand|expansion|gain|gaining|sweetspot|sweet spot|leadership|leader|premium|tailwinds?|rally|rebound|recovery|recovering|robust|resilien)/i;
const NEG = /\b(miss|misses|missed|weak|weakening|headwinds?|lacklustre|lackluster|soft(?:er)?|concerns?|pressure|hazy|delays?|cautious|defensive|impacted|pares|downgrade|cut|cutting|risk|risks|risky|challenging|challenges|deteriorat|stretched|expensive|overvalued|near peak|peaked|slowdown|slower|weaken|disappoint|painful|drag|stress|stressed|stressful|concerns|worry|worries|worried|worrying|fragile)\b|not out of the woods|may not last/i;
const CALL_RE = /\b(?:stay(?:s|ing)?|upgrade(?:s|d)? to|downgrade(?:s|d)? to|reiterate(?:s|d)?|maintain(?:s|ed)?|initiate(?:s|d)?(?:\s+with)?)\s+(BUY|SELL|HOLD|OW|UW|EW|NEUTRAL|OVERWEIGHT|UNDERWEIGHT|EQUAL[- ]?WEIGHT|OUTPERFORM|UNDERPERFORM|ADD|REDUCE|ACCUMULATE)\b/i;
const BARE_RE = /\b(OW|UW|EW|BUY|SELL|HOLD|NEUTRAL|OUTPERFORM|UNDERPERFORM|ADD|REDUCE|ACCUMULATE|OVERWEIGHT|UNDERWEIGHT)\b/i;
const CALL_NORM = c => ({OVERWEIGHT:'OW',UNDERWEIGHT:'UW','EQUAL-WEIGHT':'EW','EQUAL WEIGHT':'EW',OUTPERFORM:'OP',UNDERPERFORM:'UP'})[c] || c;
const CALL_DIR = {BUY:'bull', OP:'bull', OW:'bull', ADD:'bull', ACCUMULATE:'bull',
                  SELL:'bear', UP:'bear', UW:'bear', REDUCE:'bear',
                  HOLD:'neutral', NEUTRAL:'neutral', EW:'neutral'};
function direction(headline, pd){
  // PDF body call wins.
  if (pd && pd.currCall){
    const d = CALL_DIR[pd.currCall.toUpperCase()];
    if (d) return d;
  }
  let m = String(headline||'').match(CALL_RE) || String(headline||'').match(BARE_RE);
  if (m){
    const c = CALL_NORM((m[1]||m[0]).toUpperCase());
    if (CALL_DIR[c]) return CALL_DIR[c];
  }
  // Fall back to headline sentiment.
  if (NEG.test(headline)) return 'bear';
  if (POS.test(headline)) return 'bull';
  return 'neutral';
}

// ---------- 6) pool reports per company --------------------------------
// 2-year freshness window: drop anything older than (today - 730 days).
// Bull/bear theses surface "what the brokers are saying", which gets
// misleading fast — a 3-year-old "Buy at ₹X" is rarely still operative.
const today = new Date();
const cutoffDate = new Date(today.getTime() - 730 * 86400000);
const CUTOFF_YYMMDD = String(cutoffDate.getFullYear()).slice(-2) +
  String(cutoffDate.getMonth() + 1).padStart(2, '0') +
  String(cutoffDate.getDate()).padStart(2, '0');

function poolFor(company){
  const out = [];
  // Local + Trendlyne snapshot (notesExt) + historical (notesPrior).
  const pump = (rows, fromExt) => {
    rows.forEach(r => {
      if (!r || r.length < 4) return;
      const [house, date, co, headline] = r;
      if (String(co) !== company) return;
      if (String(date) < CUTOFF_YYMMDD) return;     // > 2 years old → drop
      const explicit = r[4] || null;
      const pd = (PDFDATA||{})[pdKey(house, date, co, headline)] || null;
      out.push({ house, date, headline, explicit, pd, source: fromExt ? 'ext' : 'local' });
    });
  };
  pump(notes,      false);
  pump(notesExt,   true);
  pump(notesPrior, true);
  // Trendlyne per-stock coverage.
  const tl = (TLCOV||{})[company] || [];
  tl.forEach(r => {
    if (!r || !r.broker || !r.date) return;
    if (String(r.date) < CUTOFF_YYMMDD) return;     // > 2 years old → drop
    // Format the same way fetch-trendlyne-coverage.js does:
    //   "Rating · TP ₹X — Headline"
    const cap = r.rating ? (r.rating.charAt(0).toUpperCase() + r.rating.slice(1).toLowerCase()) : '';
    const tpPart = r.tp ? ' · TP ₹' + r.tp : '';
    const sep = r.headline ? ' — ' : '';
    const headline = cap ? cap + tpPart + sep + (r.headline || '') : (r.headline || '');
    out.push({ house: r.broker, date: r.date, headline, explicit: r.url || null, pd: null, source: 'trendlyne' });
  });
  // De-dupe by (house|date|normalised-headline).
  const seen = new Set(); const dedup = [];
  for (const r of out){
    const k = r.house + '|' + r.date + '|' +
      String(r.headline).replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); dedup.push(r);
  }
  // Newest first.
  dedup.sort((a, b) => b.date.localeCompare(a.date));
  return dedup;
}

// ---------- 7) build per-company thesis ---------------------------------
function thesisItem(r){
  const folder = r._folder;
  const url = urlFor(folder, r.house, r.headline, r.date, r.explicit);
  return {
    text: pickText(r, r.pd),
    broker: abbrevOf(r.house),
    date: r.date,
    url,
  };
}
function buildFor(company){
  const pool = poolFor(company);
  if (!pool.length) return null;
  pool.forEach(r => { r._folder = company; r._dir = direction(r.headline, r.pd); });
  // Bull = bull-tagged reports (rating- or sentiment-bull) ordered newest-first.
  // Bear = bear-tagged reports + reports whose contrast clause leans negative.
  const bulls = pool.filter(r => r._dir === 'bull');
  let bears  = pool.filter(r => r._dir === 'bear');
  // Augment bears with neutrals that contain NEG keywords (most "Hold"
  // calls cite the bear case — we want that surfaced).
  if (bears.length < 3){
    pool.filter(r => r._dir === 'neutral' && NEG.test(String(r.headline)))
      .forEach(r => bears.push(r));
  }
  // De-dupe bears.
  const seenB = new Set(); bears = bears.filter(r => {
    const k = r.house + '|' + r.date;
    if (seenB.has(k)) return false; seenB.add(k); return true;
  });
  function topN(list, n){
    const out = []; const seenText = new Set();
    for (const r of list){
      const it = thesisItem(r);
      if (!it.text) continue;
      const tk = it.text.toLowerCase().slice(0, 80);
      if (seenText.has(tk)) continue;
      seenText.add(tk);
      out.push(it);
      if (out.length >= (n||3)) break;
    }
    return out;
  }
  const bullItems = topN(bulls, 3);
  const bearItems = topN(bears, 3);
  // Drivers: surface sentences in the PDF summaries that explicitly name
  // a lever that moves the stock — anything matching DRIVER_RE
  // ("driven by", "key driver", "catalyst", "headwind", "tailwind",
  // "supports", "weighs on", "fuels", "boosts", "drags", etc.).
  const driverItems = extractDrivers(pool, 6);
  if (!bullItems.length && !bearItems.length && !driverItems.length) return null;
  return { bull: bullItems, bear: bearItems, drivers: driverItems };
}

// ---- driver extraction --------------------------------------------------
// A "driver" sentence is one that names a lever moving the stock —
// volume growth, margin expansion, a regulatory tailwind, a commodity
// headwind, a capex cycle, a launch, an M&A trigger, etc.
const DRIVER_RE = /\b(drives?|drove|driven\s+by|key\s+driver|main\s+driver|catalyst|catalysts|trigger|triggers|tailwinds?|headwinds?|support(?:s|ed|ing)?\s+(?:the|its|growth|earnings|margins?|revenue|EPS|ROE|outlook)|weighs?\s+on|underpins?|propel(?:s|led)?|fuel(?:s|led)?\b|boost(?:s|ed|ing)?\b|drag(?:s|ged|ging)?\b|hurt(?:s|ing)?\b|hamper(?:s|ed)?|enable(?:s|d)?|aid(?:s|ed|ing)?\s+(?:growth|margins?|earnings|revenue)|lift(?:s|ed|ing)?\s+(?:growth|margins?|earnings|revenue|guidance)|positive\s+for|negative\s+for|risk(?:s)?\s+to)\b/i;

function distillToSentences(text){
  if (!text) return [];
  const t = String(text).replace(/[��]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).map(s => s.trim()).filter(Boolean);
}
function isGoodDriverSentence(s){
  if (!s || s.length < 40 || s.length > 280) return false;
  if (!/^[A-Z“"'(\[]/.test(s)) return false;
  // Re-use the bull/bear quality filter to reject boilerplate.
  if (/^(?:refer to|please refer|downloaded by|page \d|source:|see disclosure|target price|price target|fair value|cmp[\s:(]|reco[\s:(]|rating[\s:(]|bloomberg|reuters|isin|prior \()/i.test(s)) return false;
  const garbled = (s.match(/[�■□]/g) || []).length;
  if (garbled > 1) return true === false;
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters > 0 && digits / (digits + letters) > 0.30) return false;
  return DRIVER_RE.test(s);
}
function extractDrivers(pool, maxN){
  // Walk reports newest-first; for each, scan its PDF summary for driver
  // sentences. Dedupe across reports by the first ~70 chars (broker
  // overlap is common — same idea, slightly different wording).
  const out = []; const seen = new Set();
  for (const r of pool){
    const text = r.pd && r.pd.summary;
    if (!text) continue;
    const sents = distillToSentences(text);
    for (const s of sents){
      if (!isGoodDriverSentence(s)) continue;
      const key = s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 70);
      if (seen.has(key)) continue;
      seen.add(key);
      const url = urlFor(company_for_pool(r), r.house, r.headline, r.date, r.explicit);
      out.push({
        text: s.length > 240 ? s.slice(0, 240).replace(/[\s,;:]+\S*$/, '') + '…' : s,
        broker: abbrevOf(r.house),
        date: r.date,
        url,
      });
      if (out.length >= maxN) return out;
    }
  }
  return out;
}
// Tiny helper — buildFor() sets r._folder; reuse it here.
function company_for_pool(r){ return r._folder; }

// ---------- 8) iterate companies and write -----------------------------
const out = {};
let withBoth = 0, withBullOnly = 0, withBearOnly = 0, withDrivers = 0, empty = 0;
for (const name of Object.keys(COMPANIES).sort()){
  if (SECTOR_NAMES.has(name)) continue;
  const t = buildFor(name);
  if (!t){ empty++; continue; }
  out[name] = t;
  if (t.bull.length && t.bear.length) withBoth++;
  else if (t.bull.length) withBullOnly++;
  else if (t.bear.length) withBearOnly++;
  if (t.drivers && t.drivers.length) withDrivers++;
}
console.log(`Total companies in companies.json: ${Object.keys(COMPANIES).length}`);
console.log(`Freshness window: reports newer than ${CUTOFF_YYMMDD} (last 2 years)`);
console.log(`With bull + bear: ${withBoth}`);
console.log(`Bull only:        ${withBullOnly}`);
console.log(`Bear only:        ${withBearOnly}`);
console.log(`With drivers:     ${withDrivers}`);
console.log(`No data found:    ${empty}`);

// Stable key order, one company per line for readable diffs.
const keys = Object.keys(out).sort();
const lines = keys.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k]));
fs.writeFileSync(OUT, '{\n' + lines.join(',\n') + '\n}\n');
console.log('Wrote', OUT, '(' + keys.length + ' companies)');
