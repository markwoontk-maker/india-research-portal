// Build data/financials.json — per-company Revenue / EBITDA / Net Profit
// figures pulled from each broker's most recent report on that company.
//
// Run: node scripts/build-financials.js
//
// What it does:
//   1. Walks PDFMAP, grouping reports by (company, broker) and keeping
//      only the most recent date per pair.
//   2. Runs pdftotext -layout on the latest PDF for each broker × company.
//   3. Scans the extracted text for an estimate block — a year header
//      row (e.g. "FY (Mar) 2026A 2027E 2028E 2029E") followed by metric
//      rows beginning with Rev/Revenue/Net sales/EBITDA/Net profit/PAT.
//   4. Normalises numbers to ₹ crore (handles ₹ mn, ₹ bn, ₹ cr, US$ mn).
//   5. Aggregates broker forecasts by fiscal year and stores a per-broker
//      breakdown so the UI can show averages on top and per-broker on click.
//
// Output shape:
//   {
//     "<Company>": {
//       "currency": "INR cr",
//       "metrics": {
//         "revenue":  { "FY26A": {avg, brokers:[{name,date,url,value}]}, "FY27E": {...}, ... },
//         "ebitda":   { ... },
//         "netProfit":{ ... }
//       }
//     }
//   }

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'financials.json');
const PDFMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pdfmap.json'), 'utf8'));
const COMPANIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'companies.json'), 'utf8'));

const TMP = path.join(ROOT, 'scripts', 'logs', 'fin-tmp.txt');
fs.mkdirSync(path.dirname(TMP), { recursive: true });

// PDFMAP key: "<broker>|<yymmdd>|<folder>|<title-alnum-lowercase>" → file path.
function indexLatestByBroker(){
  // company → { broker → {date, key, path} } (latest only)
  const idx = {};
  for (const [k, p] of Object.entries(PDFMAP)){
    const [house, date, folder] = k.split('|');
    if (!house || !date || !folder) continue;
    if (!COMPANIES[folder]) continue;          // skip sectors and unknown folders
    if (!idx[folder]) idx[folder] = {};
    const have = idx[folder][house];
    if (!have || have.date < date){
      idx[folder][house] = { date, key: k, path: p };
    }
  }
  return idx;
}

function extractText(pdfPath, pages = 4){
  try {
    execSync(`pdftotext -layout -f 1 -l ${pages} "${pdfPath}" "${TMP}"`,
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return fs.readFileSync(TMP, 'utf8');
  } catch (e) {
    return '';
  }
}

// Parse a number string like "1,234.5" / "(1,234)" / "—" → numeric value.
function num(s){
  s = String(s).trim().replace(/[,]/g, '');
  if (!s || s === '-' || s === '—' || s === 'NA' || s === 'na') return null;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  const v = parseFloat(s);
  if (!isFinite(v)) return null;
  return neg ? -v : v;
}

// Convert ↑units to ₹ crore. Most Indian broker reports use ₹ mn or ₹ bn.
// Jefferies often uses MM (= million). 1 cr = 10 mn = 0.01 bn.
function toCr(v, unit){
  if (v == null) return null;
  switch ((unit || '').toLowerCase()){
    case 'cr': case 'crore': case 'crores': return v;
    case 'mn': case 'm': case 'mm': case 'million': return v / 10;
    case 'bn': case 'b': case 'billion': return v * 100;
    case 'tn': case 't': case 'trillion': return v * 100000;
    default: return v;        // unknown → assume same unit (best effort)
  }
}

// Look for the FY header row near the front of the document.
// Returns { yearLabels: [{text, fy:"FY26", actualOrEst:"A"/"E"}], unit:"mn|bn|cr|null" }
function findHeader(text){
  const lines = text.split(/\r?\n/);
  // Search for a line that contains 3+ "20XX[AE]" tokens.
  const yrRe = /\b(20[2-3]\d)\s*([AE])?\b/g;
  for (let i = 0; i < lines.length; i++){
    const l = lines[i];
    const matches = [...l.matchAll(yrRe)];
    if (matches.length >= 3){
      const years = matches.map(m => {
        const yyyy = +m[1];
        const fy = 'FY' + String(yyyy).slice(-2);
        const tag = (m[2] || '').toUpperCase();      // A=actual, E=estimate, ''=unknown
        return { fy, tag, col: m.index };
      });
      // Look in the surrounding context for a unit marker (mn / bn / cr).
      const ctx = lines.slice(Math.max(0, i - 4), i + 8).join(' ');
      let unit = null;
      const um = ctx.match(/\b(?:Rs|INR|₹|US\$)?\s*(MM|M|mn|bn|cr|million|billion|crore)\b/i)
              || ctx.match(/\(\s*(MM|mn|bn|cr|INR mn|INR bn|Rs mn|Rs bn|US\$ mn|US\$ m)\s*\)/i);
      if (um) unit = um[1].toLowerCase().replace(/^inr\s+/, '').replace(/^rs\s+/, '').replace(/^us\$\s*/, '');
      return { yearLabels: years, unit, lineIdx: i };
    }
  }
  return null;
}

// Metric label → canonical key. We try broad matches because brokers use
// many synonyms (Rev. / Revenue / Net sales / Net rev / Total income).
const METRIC = [
  { key: 'revenue',  re: /^\s*(?:Rev(?:enue|\.)?(?:\s*\(.*?\))?|Net\s+(?:Sales|Rev(?:enue)?)|Total\s+(?:income|revenue)|Sales\s*\(.*?\)|Net\s+rev|Net\s+revenues?)\b/i },
  { key: 'ebitda',   re: /^\s*EBITDA(?:\s*\(.*?\))?\s*(?:Margin)?\b/i },
  { key: 'netProfit',re: /^\s*(?:Net\s+profit|PAT|Net\s+income|Adj\.?\s+PAT|Recurring\s+PAT|Reported\s+PAT|Net\s+earnings)(?:\s*\(.*?\))?\b/i },
];

// Pluck the numeric values from a metric row, aligned by column position
// to the year header. Returns { value-per-year }.
function alignToYears(row, yearCols){
  // Strip the leading metric label so we don't pick it up.
  const valuesRe = /(\(?\d[\d,]*\.?\d*\)?|—|NA|na|-)/g;
  const out = {};
  const tokens = [];
  let m;
  while ((m = valuesRe.exec(row)) !== null) tokens.push({ text: m[1], col: m.index });
  if (!tokens.length) return out;
  // For each year column, pick the nearest token to the right of (or at) that column.
  for (const y of yearCols){
    let best = null, bestDist = 1e9;
    for (const t of tokens){
      const d = Math.abs(t.col - y.col);
      if (d < bestDist){ bestDist = d; best = t; }
    }
    if (best && bestDist < 25){
      out[y.fy] = { value: num(best.text), tag: y.tag };
    }
  }
  return out;
}

function extractFromText(text){
  const header = findHeader(text);
  if (!header) return null;
  const lines = text.split(/\r?\n/);
  const out = { unit: header.unit, years: header.yearLabels.map(y => y.fy), data: {} };
  // Scan the 60 lines after the header for metric rows.
  for (let i = header.lineIdx + 1; i < Math.min(lines.length, header.lineIdx + 60); i++){
    const l = lines[i];
    if (!l.trim()) continue;
    for (const m of METRIC){
      if (out.data[m.key]) continue;            // first hit wins
      if (m.re.test(l)){
        const vals = alignToYears(l, header.yearLabels);
        if (Object.keys(vals).length){
          out.data[m.key] = vals;
        }
        break;
      }
    }
    if (Object.keys(out.data).length === METRIC.length) break;
  }
  return Object.keys(out.data).length ? out : null;
}

function fileUrl(p){
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

function main(){
  const latest = indexLatestByBroker();
  const companies = Object.keys(latest).sort();
  const out = {};
  let ok = 0, miss = 0, skipped = 0;

  for (let i = 0; i < companies.length; i++){
    const co = companies[i];
    const brokers = latest[co];
    const names = Object.keys(brokers);
    process.stdout.write(`[${i+1}/${companies.length}] ${co.padEnd(40)} ${names.length} brokers `);
    const perBroker = {};
    let extractedCount = 0;
    for (const h of names){
      const { date, path: pdfPath } = brokers[h];
      if (!fs.existsSync(pdfPath)){ continue; }
      const text = extractText(pdfPath, 5);
      if (!text){ continue; }
      const x = extractFromText(text);
      if (!x){ continue; }
      // Normalise numbers to ₹ crore (best effort).
      const norm = { unit: x.unit, data: {} };
      for (const k of Object.keys(x.data)){
        norm.data[k] = {};
        for (const [fy, info] of Object.entries(x.data[k])){
          norm.data[k][fy] = { value: toCr(info.value, x.unit), tag: info.tag };
        }
      }
      perBroker[h] = { date, url: fileUrl(pdfPath), unit: x.unit, ...norm.data };
      extractedCount++;
    }
    if (!extractedCount){ console.log('— no parseable tables'); miss++; continue; }
    // Aggregate by metric and FY: { metric: { fy: { avg, brokers:[{name,date,url,value,tag}] } } }
    const metrics = { revenue: {}, ebitda: {}, netProfit: {} };
    for (const [h, info] of Object.entries(perBroker)){
      for (const mk of Object.keys(metrics)){
        const m = info[mk]; if (!m) continue;
        for (const [fy, v] of Object.entries(m)){
          if (v.value == null) continue;
          if (!metrics[mk][fy]) metrics[mk][fy] = { tag: v.tag, brokers: [] };
          metrics[mk][fy].brokers.push({ name: h, date: info.date, url: info.url, value: v.value });
        }
      }
    }
    // Strict sanity filter — column-alignment in pdftotext is fragile,
    // and a wrong column easily produces a ratio, % growth, or a value
    // from a different table. We keep only values that:
    //   1. fall in a plausible ₹ crore range (10..1,000,000)
    //   2. are positive for revenue/EBITDA (net profit may be negative)
    //   3. agree with the cross-broker median within 2x both ways
    //      (when there are 2+ brokers per FY).
    function median(arr){ const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
    function plausible(v, mk){
      if (v == null || !isFinite(v)) return false;
      const abs = Math.abs(v);
      if (abs < 10 || abs > 1000000) return false;
      if (mk !== 'netProfit' && v <= 0) return false;
      return true;
    }
    for (const mk of Object.keys(metrics)){
      for (const fy of Object.keys(metrics[mk])){
        metrics[mk][fy].brokers = metrics[mk][fy].brokers.filter(b => plausible(b.value, mk));
        if (metrics[mk][fy].brokers.length === 0){ delete metrics[mk][fy]; continue; }
        if (metrics[mk][fy].brokers.length >= 2){
          const med = median(metrics[mk][fy].brokers.map(b => Math.abs(b.value)));
          metrics[mk][fy].brokers = metrics[mk][fy].brokers.filter(b => {
            const r = Math.abs(b.value) / Math.max(1e-9, med);
            return r >= 0.5 && r <= 2.0;
          });
          if (metrics[mk][fy].brokers.length === 0){ delete metrics[mk][fy]; continue; }
        }
      }
    }
    // Compute averages on surviving brokers.
    for (const mk of Object.keys(metrics)){
      for (const fy of Object.keys(metrics[mk])){
        const arr = metrics[mk][fy].brokers;
        const avg = arr.reduce((s, b) => s + b.value, 0) / arr.length;
        metrics[mk][fy].avg = +avg.toFixed(1);
      }
    }
    // Only commit metric rows that have at least one parseable FY.
    const hasAny = Object.values(metrics).some(m => Object.keys(m).length);
    if (!hasAny){ miss++; console.log('— no metrics'); continue; }
    out[co] = { currency: '₹ cr', metrics };
    ok++;
    const summary = Object.keys(metrics).map(k => `${k[0].toUpperCase()}:${Object.keys(metrics[k]).length}`).join(' ');
    console.log(`✓ ${extractedCount}/${names.length} brokers · ${summary}`);
  }

  console.log(`\nOK: ${ok}   no data: ${miss}   skipped: ${skipped}`);

  const keys = Object.keys(out).sort();
  const lines = keys.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k]));
  fs.writeFileSync(OUT, '{\n' + lines.join(',\n') + '\n}\n');
  console.log('Wrote', OUT, '(' + keys.length + ' companies)');
}

main();
