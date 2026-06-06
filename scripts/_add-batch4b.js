// Batch 4b — dense-Kotak standalone tables, Rev+EBITDA only (Net Profit
// pending per user). Both companies' Revenue+EBITDA were cross-checked:
//   Amara Raja — EBITDA verified against the table's own EBITDA-margin row.
//   CEAT       — Revenue anchored to known figures; FY25 EBITDA (Rs1,486cr,
//                11.3%) is an exact match to CEAT's reported FY25.
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname,'..','data','financials-manual.json');
const m = JSON.parse(fs.readFileSync(P,'utf8'));

function metricsFrom(broker, date, url, spec){
  const metrics = { revenue:{}, ebitda:{}, netProfit:{} };
  for (const [mk, fyMap] of Object.entries(spec)){
    for (const [fy, pair] of Object.entries(fyMap)){
      if (pair == null) continue;
      const [tag, value] = pair;
      metrics[mk][fy] = { tag, avg: value, brokers: [{ name: broker, date, url, value }] };
    }
  }
  return metrics;
}

// ── Amara Raja — Kotak Ex9 STANDALONE primary; existing JPMorgan CONSOLIDATED
//    demoted to the alternate-basis table. (the both-basis showcase) ─────────
{
  const co = 'Amara Raja Energy and Mobility';
  const prev = m[co];                     // existing JPMorgan consolidated entry
  const kUrl = 'file:///C%3A/Users/admin/Desktop/India%20Related%20Reports/Amara%20Raja%20Energy%20and%20Mobility/%5B260527%5D%20%5BKotak%5D%20Amara%20Raja%20Energy%20%26%20Mobility%20-%20Mixed%20bag%2C%20cell%20ambitions%20lose%20key%20anchor.pdf';
  m[co] = {
    currency: '₹ mn',
    basis: 'Standalone',
    metrics: metricsFrom('Kotak','260527',kUrl,{
      revenue: { FY24:['A',112603], FY25:['A',124049], FY26:['A',135489], FY27:['E',149556], FY28:['E',161428], FY29:['E',174806] },
      ebitda:  { FY24:['A', 16214], FY25:['A', 16291], FY26:['A', 15442], FY27:['E', 17434], FY28:['E', 19756], FY29:['E', 21707] },
      // netProfit: pending — Kotak appendix PAT row misaligns in pdftotext.
    }),
    alt: {
      basis: 'Consolidated',
      source: (prev && prev.notes) ? ('JPMorgan — ' + prev.notes) : 'JPMorgan consolidated',
      metrics: prev ? prev.metrics : {},
    },
    notes: 'Kotak Exhibit 9 standalone financial summary (Rev+EBITDA; Net Profit pending). Consolidated table = JPMorgan.',
  };
}

// ── CEAT — Kotak Ex12 STANDALONE financial summary (new company) ────────────
{
  const co = 'CEAT';
  const kUrl = 'file:///C%3A/Users/admin/Desktop/India%20Related%20Reports/CEAT/%5B260527%5D%20%5BKotak%5D%20CEAT%20-%20Takeaways%20from%20investor%20meet.pdf';
  m[co] = {
    currency: '₹ mn',
    basis: 'Standalone',
    metrics: metricsFrom('Kotak','260527',kUrl,{
      revenue: { FY24:['A',118926], FY25:['A',131717], FY26:['A',152149], FY27:['E',173401], FY28:['E',180688], FY29:['E',190388] },
      ebitda:  { FY24:['A', 16557], FY25:['A', 14862], FY26:['A', 20424], FY27:['E', 19941], FY28:['E', 22826], FY29:['E', 24829] },
      // netProfit: pending.
    }),
    notes: 'Kotak Exhibit 12 standalone financial summary (Rev+EBITDA; Net Profit pending).',
  };
}

fs.writeFileSync(P, JSON.stringify(m, null, 2) + '\n');
console.log('Batch 4b written. Amara Raja basis:', m['Amara Raja Energy and Mobility'].basis,
  '| alt:', m['Amara Raja Energy and Mobility'].alt.basis, '| CEAT:', m['CEAT'].basis);
