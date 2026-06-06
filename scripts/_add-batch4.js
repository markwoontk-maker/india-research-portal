// Batch 4 — next-batch A-C additions. Only HIGH-confidence transcriptions
// (clean Jefferies front-page mini-tables / income statements verified by
// internal arithmetic). Dense Kotak 10-year appendix tables are intentionally
// excluded here — their pdftotext PAT rows misalign (unsafe to transcribe).
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname,'..','data','financials-manual.json');
const m = JSON.parse(fs.readFileSync(P,'utf8'));

// Build a metrics block from {revenue|ebitda|netProfit: {FYxx:[tag,value]}}.
function block(currency, basis, broker, date, url, source, spec){
  const metrics = {};
  for (const [mk, fyMap] of Object.entries(spec)){
    metrics[mk] = {};
    for (const [fy, pair] of Object.entries(fyMap)){
      if (pair == null) continue;
      const [tag, value] = pair;
      metrics[mk][fy] = { tag, avg: value, brokers: [{ name: broker, date, url, value }] };
    }
  }
  const e = { currency, basis, metrics };
  if (source) e.notes = source;
  return e;
}

// ── Colgate-Palmolive (India) — Jefferies 22 May 26 ───────────────────────
// Revenue = Net Sales; EBITDA = Op. EBITDA; Net Profit = Pre-ex PAT.
// FY26 is Actual (front-page "2026A"). Net Sales & EBITDA cross-checked by
// arithmetic (Net Sales − Material = Gross profit at 69-70% margin; EBITDA
// margin row matches); Net Profit confirmed by the front-page FY(Mar) table
// (EBITDA 18,696.6 / Net Profit 13,461.3 for FY26 == Op.EBITDA / Pre-ex PAT).
m['Colgate-Palmolive (India)'] = block(
  '₹ mn', 'Standalone', 'Jefferies', '260522',
  'file:///C%3A/Users/admin/Desktop/India%20Related%20Reports/Colgate-Palmolive%20%28India%29/%5B260522%5D%20%5BJefferies%5D%20Colgate%20-%20Low%20Base%20Should%20Help%20Ahead.pdf',
  'Exhibit 12 Income Statement + front-page FY(Mar) mini-table',
  {
    revenue:   { FY25:['A',59992], FY26:['A',59836], FY27:['E',65861], FY28:['E',71732], FY29:['E',77808] },
    ebitda:    { FY25:['A',19581], FY26:['A',18697], FY27:['E',20383], FY28:['E',22690], FY29:['E',24935] },
    netProfit: { FY25:['A',13929], FY26:['A',13461], FY27:['E',14663], FY28:['E',16356], FY29:['E',18027] },
  });

fs.writeFileSync(P, JSON.stringify(m, null, 2) + '\n');
console.log('Batch 4 written. Colgate basis:', m['Colgate-Palmolive (India)'].basis);
