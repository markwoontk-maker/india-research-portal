// Fetch broker coverage from Trendlyne for every NOTEBOOKS company we
// have a ticker for, and dump it to data/trendlyne-coverage.json. Free,
// no API key, no login.
//
// Per-company URL (no auth required): https://trendlyne.com/research-reports/stock/<TICKER>/
//   → 301 redirect to https://trendlyne.com/research-reports/stock/<id>/<TICKER>/<slug>/
//   → 200 OK with up to ~20 broker calls embedded as JSON-LD "Review" blocks
//     followed by table-cell markup (date / broker / LTP / TP / rating).
//
// Output shape (data/trendlyne-coverage.json):
//   {
//     "<NOTEBOOKS company name>": [
//       { broker, date, headline, url, tp, rating },
//       ...
//     ],
//     ...
//   }
//
// The page reads this file client-side and merges entries into the
// Broker Coverage card on the Company tab so the table populates even
// for newly-added names (Aditya Birla Capital, Adani Enterprises, etc.)
// that aren't in the local PDF library.
//
// Run: node scripts/fetch-trendlyne-coverage.js

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'data', 'trendlyne-coverage.json');
const HTML = path.join(__dirname, '..', 'index.html');
const COMPANIES_JSON = path.join(__dirname, '..', 'data', 'companies.json');

// Houses already covered from the local PDF library — drop them so the
// Trendlyne pool stays focused on the *external* brokers and doesn't
// duplicate the local feed.
const LOCAL_HOUSES = new Set([
  'Bernstein', 'CLSA', 'Jefferies', 'JPMorgan', 'JP Morgan',
  'Kotak', 'Kotak Institutional', 'Kotak Securities', 'Nomura'
]);

// Headlines that are auto-generated Trendlyne placeholders rather than
// the broker's actual report title. We drop them — they're noise.
const PLACEHOLDER_RE = /^[A-Za-z &.]+ (increased|decreased|released|maintained|reiterated|initiated)/;

function fetchHtml(url, follow = true){
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, res => {
      if ((res.statusCode === 301 || res.statusCode === 302) && follow && res.headers.location){
        const next = new URL(res.headers.location, url).href;
        return resolve(fetchHtml(next, false));
      }
      if (res.statusCode !== 200){
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch (e) { return reject(e); }
        resolve(buf.toString('utf8'));
      });
    }).on('error', reject);
  });
}

// "May 5, 2026, midnight" → "260505"
function toYYMMDD(s){
  const M = {January:1,February:2,March:3,April:4,May:5,June:6,
             July:7,August:8,September:9,October:10,November:11,December:12,
             Jan:1,Feb:2,Mar:3,Apr:4,Jun:6,Jul:7,Aug:8,Sept:9,Sep:9,Oct:10,Nov:11,Dec:12};
  const m = String(s).match(/(\w+\.?)\s+(\d+),\s*(\d{4})/);
  if (!m) return null;
  const monKey = m[1].replace(/\.$/, '');
  const mm = M[monKey]; if (!mm) return null;
  const yy = String(m[3]).slice(-2);
  return yy + String(mm).padStart(2,'0') + String(m[2]).padStart(2,'0');
}

// Parse a per-company page: for every JSON-LD Review block, also pluck
// the TP cell and rating chip from the surrounding ~6KB table window.
function parsePage(html){
  const out = [];
  const SCRIPT_RE = /<script\s+type\s*=\s*"application\/ld\+json"\s*>\s*([\s\S]*?)\s*<\/script>/g;
  let m;
  while ((m = SCRIPT_RE.exec(html)) !== null){
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    if (!data || data['@type'] !== 'Review') continue;
    const broker = data.author && data.author.name && String(data.author.name).trim();
    if (!broker) continue;
    if (LOCAL_HOUSES.has(broker)) continue;
    const date = toYYMMDD(data.datePublished);
    if (!date) continue;
    const headline = String(data.description || '').trim();
    if (!headline || PLACEHOLDER_RE.test(headline)) continue;
    const url = String(data.url || '').trim();
    // PDF cache URL (Trendlyne's get-document endpoint) — works for
    // posts /<id>/... URLs even when the post page requires login.
    let pdfUrl = url;
    const idM = url.match(/\/posts\/(\d+)\//);
    if (idM) pdfUrl = 'https://trendlyne.com/get-document/post/pdf/' + idM[1] + '/';

    // Look in the next ~7KB for the TP cell and the rating chip.
    const slice = html.slice(m.index, m.index + 7000);
    // Pair of "rightAlgn invisible-details-control" cells = (LTP, TP).
    // We want the SECOND number.
    const dual = slice.match(/<td class="rightAlgn invisible-details-control">\s*([\d,.]+)\s*<\/td>\s*<td class="rightAlgn invisible-details-control">\s*([\d,.]+)\s*<\/td>/);
    let tp = null;
    if (dual) tp = dual[2].replace(/\.00$/,'');
    // Rating chip: <span class="dot ..."></span><span class="fs085rem">RATING</span>
    let rating = null;
    const rM = slice.match(/<span class="dot[^"]*"><\/span>\s*<span class="fs085rem">\s*([A-Za-z][A-Za-z\s]*?)\s*<\/span>/);
    if (rM) rating = rM[1].trim();

    out.push({ broker, date, headline, url: pdfUrl, tp, rating });
  }
  // Dedupe by (broker,date,headline) — Trendlyne occasionally lists the
  // same post twice in different sections.
  const seen = new Set(); const dedup = [];
  for (const r of out){
    const k = r.broker + '|' + r.date + '|' + r.headline.toLowerCase();
    if (seen.has(k)) continue; seen.add(k); dedup.push(r);
  }
  return dedup;
}

// Build the NOTEBOOKS name → Trendlyne ticker map from index.html
// (COMPANY_TICKERS) + data/companies.json (full Yahoo symbols).
function loadTickerMap(){
  const html = fs.readFileSync(HTML, 'utf8');
  const map = {};
  // 1. COMPANY_TICKERS in index.html
  const ctM = html.match(/const COMPANY_TICKERS=\{([\s\S]*?)\};/);
  if (ctM){
    const re = /'([^']+)'\s*:\s*'([^']+)'/g; let m;
    while ((m = re.exec(ctM[1])) !== null){
      const t = m[2];
      if (t === 'MMYT' || t === 'RNW') continue;            // NASDAQ
      if (t.startsWith('^')) continue;                       // index
      map[m[1]] = t;                                         // store NSE symbol
    }
  }
  // 2. companies.json (.NS suffix → strip)
  const cj = JSON.parse(fs.readFileSync(COMPANIES_JSON, 'utf8'));
  for (const [name, e] of Object.entries(cj)){
    if (map[name]) continue;
    if (!e || !e.ticker) continue;
    const t = e.ticker;
    if (t === 'MMYT' || t === 'RNW') continue;
    if (t.startsWith('^')) continue;
    // Strip the exchange suffix (".NS", ".BO" etc.) so the Trendlyne URL
    // sees just the bare NSE symbol.
    map[name] = t.replace(/\.[A-Z]+$/, '');
  }
  return map;
}

function persist(out){
  const lines = Object.keys(out).sort().map(k =>
    '  ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k]));
  fs.writeFileSync(OUT, '{\n' + lines.join(',\n') + '\n}\n');
}

async function main(){
  const tickerMap = loadTickerMap();
  const names = Object.keys(tickerMap).sort();

  // Resume support: load existing coverage and skip names we already have.
  let out = {};
  try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const force = process.argv.includes('--force');
  const have = force ? new Set() : new Set(Object.keys(out));

  const todo = names.filter(n => !have.has(n));
  console.log(`Total tickers: ${names.length}  ·  already covered: ${have.size}  ·  to fetch: ${todo.length}`);
  if (!todo.length) { console.log('Nothing to do.'); return; }

  // Trendlyne starts returning 405 once a session burst goes past ~100 hits.
  // Use a longer base delay and back off aggressively on 405.
  const BASE_DELAY = 600;       // ms between requests
  const BACKOFF_MAX = 60000;    // cap: 1 min wait on repeat-405

  let ok = 0, fail = 0, blocked = 0;
  for (let i = 0; i < todo.length; i++){
    const name = todo[i];
    const ticker = tickerMap[name];
    const url = 'https://trendlyne.com/research-reports/stock/' + encodeURIComponent(ticker) + '/';
    process.stdout.write(`[${i+1}/${todo.length}] ${name.padEnd(40)} ${ticker.padEnd(14)} `);
    let attempt = 0, success = false;
    while (attempt < 3 && !success){
      attempt++;
      try {
        const html = await fetchHtml(url);
        const rows = parsePage(html);
        if (rows.length) out[name] = rows;
        console.log(rows.length + ' calls');
        ok++; success = true;
        // Persist after each company so a crash doesn't lose work.
        persist(out);
      } catch (e){
        const is405 = /HTTP 405/.test(e.message);
        if (is405){
          blocked++;
          // Wait ~10s × attempt (10, 20, 30) and retry.
          const wait = Math.min(BACKOFF_MAX, 10000 * attempt);
          process.stdout.write(`405 (backoff ${wait/1000}s) `);
          await new Promise(r => setTimeout(r, wait));
          if (attempt === 3) { console.log('GIVE UP'); fail++; }
        } else {
          console.log('ERR ' + e.message);
          fail++; break;
        }
      }
    }
    await new Promise(r => setTimeout(r, BASE_DELAY));
  }
  console.log(`\nOK: ${ok}  ·  failed: ${fail}  ·  405-backoffs: ${blocked}  ·  companies with coverage: ${Object.keys(out).length}`);
  const total = Object.values(out).reduce((s,a)=>s+a.length, 0);
  console.log(`Total broker calls captured: ${total}`);
  persist(out);
  console.log('Wrote', OUT);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
