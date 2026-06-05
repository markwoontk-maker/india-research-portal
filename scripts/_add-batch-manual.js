// One-shot: append a batch of hand-verified financial entries to
// data/financials-manual.json. Each company maps to ONE broker report;
// values transcribed from the report's front-page "FY (Mar)" table
// or its Income Statement exhibit. Sources are cross-checked against
// scripts/logs/batch-probe.txt before being added below.
//
// Run: node scripts/_add-batch-manual.js
//
// Values are in INR crore (mn ÷ 10). Banks have no Revenue/EBITDA
// convention — only Net Profit is provided.

const fs = require('fs');
const path = require('path');

const MANUAL = path.join(__dirname, '..', 'data', 'financials-manual.json');
const existing = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));

function fileUrl(p){
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

function buildEntry(broker, date, pdfPath, source, tagByFY, metrics){
  const url = fileUrl(pdfPath);
  const out = { currency: '₹ cr', metrics: {} };
  for (const [mk, fyMap] of Object.entries(metrics)){
    out.metrics[mk] = {};
    for (const [fy, val] of Object.entries(fyMap)){
      if (val == null) continue;
      const tag = tagByFY[fy] || 'E';
      out.metrics[mk][fy] = {
        tag, avg: val,
        brokers: [{ name: broker, date, url, value: val }]
      };
    }
  }
  if (source) out.notes = source;
  return out;
}

// Eicher Motors — Jefferies 260522, front-page FY table
// FY26A / FY27E / FY28E / FY29E
const eicherPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Eicher Motors\\[260522] [Jefferies] Eicher - Growing Well and Expanding Capacity.pdf";
existing['Eicher Motors'] = buildEntry('Jefferies', '260522', eicherPDF,
  'Front-page FY (Mar) 2026A-2029E table',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 23407.6, FY27: 27402.8, FY28: 31684.9, FY29: 36407.6 },
    ebitda:   { FY26: 5785.1,  FY27: 6809.1,  FY28: 8049.3,  FY29: 9341.5  },
    netProfit:{ FY26: 5556.8,  FY27: 6366.6,  FY28: 7398.1,  FY29: 8534.9  },
  });

// IndiGo / InterGlobe Aviation — Jefferies 260529, front-page FY table
// FY26A / FY27E / FY28E (net loss in FY26)
const indigoPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\IndiGo\\[260529] [Jefferies] IndiGo - Clouded near-term outlook.pdf";
const indigoMetrics = {
  revenue:  { FY26: 84961.9, FY27: 97520.6, FY28: 114076.9 },
  ebitda:   { FY26: 12720.0, FY27: 17746.6, FY28: 28310.7  },
  netProfit:{ FY26: -2502.5, FY27: 2038.6,  FY28: 7918.3   },
};
existing['IndiGo'] = buildEntry('Jefferies', '260529', indigoPDF,
  'Front-page FY (Mar) 2026A-2028E table',
  { FY26: 'A', FY27: 'E', FY28: 'E' }, indigoMetrics);
existing['InterGlobe Aviation'] = buildEntry('Jefferies', '260529', indigoPDF,
  'Front-page FY (Mar) 2026A-2028E table',
  { FY26: 'A', FY27: 'E', FY28: 'E' }, indigoMetrics);

// State Bank of India — Jefferies 260525, front-page FY table
// Banks: only Net Profit is meaningful (no Revenue/EBITDA convention).
const sbiPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\State Bank of India\\[260525] [Jefferies] State Bank of India - Roadshow Feedback, Balancing Growth & Profits, Investing in.pdf";
existing['State Bank of India'] = buildEntry('Jefferies', '260525', sbiPDF,
  'Front-page FY (Mar) 2026E-2029E table (banks: Net Profit only)',
  { FY26: 'E', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  {},
    ebitda:   {},
    netProfit:{ FY26: 80030, FY27: 79610, FY28: 90690, FY29: 102170 },
  });

// Adani Ports and SEZ — Jefferies 260602, front-page FY table
// Revenue only — front page didn't show EBITDA/PAT cleanly.
const adaniPortsPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Adani Ports and SEZ\\[260602] [Jefferies] Adani Ports and SEZ - Capacity Crunch to Drive Next Leg of Upside.pdf";
existing['Adani Ports and SEZ'] = buildEntry('Jefferies', '260602', adaniPortsPDF,
  'Front-page FY (Mar) 2026A-2028E table — Revenue only on front page',
  { FY26: 'A', FY27: 'E', FY28: 'E' },
  {
    revenue:  { FY26: 38735.8, FY27: 43915.0, FY28: 52222.9 },
    ebitda:   {},
    netProfit:{},
  });

// Apollo Hospitals — Jefferies 260521
// Front page gives Adj.PAT 14,459 / 19,561 / 25,188 (FY26A/FY27E/FY28E in ₹m)
// EPS 100.6 / 135.0 / 175.2 + EBITDA margin% 13.9 / 14.9 / 15.3.
// Estimates Revision section (pp4-8) gives EBITDA - new: 42,927 / 51,461 / 64,759
const apolloPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Apollo Hospitals\\[260521] [Jefferies] Apollo Hospitals - Strong Mar-Q and Robust Outlook, BUY.pdf";
existing['Apollo Hospitals'] = buildEntry('Jefferies', '260521', apolloPDF,
  'Front-page Adj.PAT (₹m) FY26A-FY28E + Estimates Revision EBITDA (₹m)',
  { FY26: 'A', FY27: 'E', FY28: 'E' },
  {
    revenue:  {},
    ebitda:   { FY26: 4292.7, FY27: 5146.1, FY28: 6475.9 },
    netProfit:{ FY26: 1445.9, FY27: 1956.1, FY28: 2518.8 },
  });

// Re-serialise.
const KEYS = Object.keys(existing).sort((a,b)=>{
  if (a.startsWith('_')) return -1;
  if (b.startsWith('_')) return 1;
  return a.localeCompare(b);
});
const json = '{\n' + KEYS.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(existing[k], null, 2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')).join(',\n') + '\n}\n';
fs.writeFileSync(MANUAL, json);
console.log('Manual entries:', KEYS.filter(k=>!k.startsWith('_')).length);
for (const k of KEYS.filter(k=>!k.startsWith('_'))){
  const e = existing[k];
  const summary = Object.keys(e.metrics).map(m => m+':'+Object.keys(e.metrics[m]).length+'fys').join(' ');
  console.log(`  ${k.padEnd(28)} ${summary}`);
}
