// Batch 3: hand-verify financials for A-B companies using each broker's
// front-page mini-table (Jefferies) / Key Metrics block (JPMorgan) /
// Income Statement (Nomura). Values transcribed from pdftotext output
// of the latest report on each name and converted ₹m → ₹cr.

const fs = require('fs');
const path = require('path');
const MANUAL = path.join(__dirname, '..', 'data', 'financials-manual.json');
const existing = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));

const REPORTS = "C:\\Users\\admin\\Desktop\\India Related Reports";
function fileUrl(p){
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

// Build a per-broker block. The same name + url tuple repeats inside
// each FY for the brokers array.
function brokerBlock(broker, date, pdfPath, source, tagByFY, metrics){
  const url = fileUrl(pdfPath);
  const out = { currency: '₹ cr', metrics: {} };
  for (const [mk, fyMap] of Object.entries(metrics)){
    out.metrics[mk] = {};
    for (const [fy, val] of Object.entries(fyMap)){
      if (val == null) continue;
      out.metrics[mk][fy] = {
        tag: tagByFY[fy] || 'E', avg: val,
        brokers: [{ name: broker, date, url, value: val }]
      };
    }
  }
  if (source) out.notes = source;
  return out;
}

// Merge multiple broker blocks for one company into a single entry.
function mergeBlocks(...blocks){
  const out = { currency: '₹ cr', metrics: {} };
  const allMetrics = new Set();
  for (const b of blocks) for (const k of Object.keys(b.metrics||{})) allMetrics.add(k);
  for (const mk of allMetrics){
    out.metrics[mk] = {};
    const allFY = new Set();
    for (const b of blocks) for (const fy of Object.keys((b.metrics||{})[mk]||{})) allFY.add(fy);
    for (const fy of allFY){
      const brokers = []; let tag = '';
      for (const b of blocks){
        const row = (b.metrics||{})[mk] && b.metrics[mk][fy];
        if (!row) continue;
        if (!tag) tag = row.tag;
        brokers.push(...row.brokers);
      }
      if (!brokers.length) continue;
      const avg = +(brokers.reduce((s,b)=>s+b.value, 0) / brokers.length).toFixed(1);
      out.metrics[mk][fy] = { tag: tag||'E', avg, brokers };
    }
  }
  out.notes = blocks.map(b=>b.notes).filter(Boolean).join(' · ');
  return out;
}

// --- Adani Power (Jefferies 18 May 26, page 1) ------------------------
// Rev + EBITDA from the FY (Mar) mini-table. Net Profit row uses
// Jefferies' "Adjusted PAT" line from the same page (₹mn) per the
// user's "Adj.PAT = Net Profit for our purposes" rule.
existing['Adani Power'] = brokerBlock('Jefferies', '260518',
  `${REPORTS}\\Adani Power\\[260518] [Jefferies] Adani Power - FCF to turn positive by FY30E.pdf`,
  'Front-page FY (Mar) mini-table + Adjusted PAT row (Net Profit proxy)',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 53782, FY27: 62124, FY28: 72858, FY29:  91077 },
    ebitda:   { FY26: 19539, FY27: 24013, FY28: 29697, FY29:  37350 },
    netProfit:{ FY26: 11073, FY27: 12388, FY28: 15181, FY29:  18344 },
  });

// --- AWL Agri Business (JPMorgan 26 May 26, page 2 Key Metrics) --------
existing['AWL Agri Business'] = brokerBlock('JPMorgan', '260526',
  `${REPORTS}\\AWL Agri Business\\[260526] [JPMorgan] AWL Agri Business - Investor Day, Building an integrated Foods platform, margin trajectory a key monitorable.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 74731, FY27: 86789, FY28: 91614, FY29: 96274 },
    ebitda:   { FY26: 2131,  FY27: 2291,  FY28: 2377,  FY29: 2433  },
    netProfit:{ FY26: 1071,  FY27: 1016,  FY28: 1075,  FY29: 1131  },
  });

// --- Aditya Birla Capital (Kotak page 4 standalone NBFC) --------------
// "Profit after tax" row (FY26 31,093 / FY27E 40,667 / FY28E 49,248 /
// FY29E 60,258, all ₹mn) per user-supplied values. Net Total Income
// (banks-proxy for Revenue) pending — user to provide; left blank.
const abcapKotak = brokerBlock('Kotak', '260521',
  `${REPORTS}\\Aditya Birla Capital\\[260521] [Kotak] Aditya Birla Capital - Full sector coverage on KINSITE.pdf`,
  'Page 4 standalone — Profit after tax (Net Profit proxy)',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  {},
    ebitda:   {},
    netProfit:{ FY26: 3109, FY27: 4067, FY28: 4925, FY29: 6026 },
  });
existing['Aditya Birla Capital'] = abcapKotak;

// --- Alkem Laboratories (JPMorgan 29 May 26, p2 Key Metrics) ----------
existing['Alkem Laboratories'] = brokerBlock('JPMorgan', '260529',
  `${REPORTS}\\Alkem Laboratories\\[260529] [JPMorgan] Alkem Laboratories - Steady core but margin visibility limited.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY25: 'A', FY26: 'E', FY27: 'E', FY28: 'E' },
  {
    revenue:  { FY25: 12965, FY26: 14712, FY27: 16391, FY28: 18098 },
    ebitda:   { FY25:  2512, FY26:  3005, FY27:  3449, FY28:  3876 },
    netProfit:{ FY25:  2166, FY26:  2433, FY27:  2430, FY28:  2668 },
  });

// --- Amara Raja Energy and Mobility (JPMorgan 26 May 26, p2 Key Metrics) -
existing['Amara Raja Energy and Mobility'] = brokerBlock('JPMorgan', '260526',
  `${REPORTS}\\Amara Raja Energy and Mobility\\[260526] [JPMorgan] Amara Raja - Post-4Q call, BESS focus seeing acceleration.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 13549, FY27: 14674, FY28: 15582, FY29: 16594 },
    ebitda:   { FY26:  1544, FY27:  1761, FY28:  1917, FY29:  2091 },
    netProfit:{ FY26:   711, FY27:   893, FY28:   950, FY29:  1020 },
  });

// --- Anthem Biosciences (JPMorgan 20 May 26, p2 Key Metrics) ----------
existing['Anthem Biosciences'] = brokerBlock('JPMorgan', '260520',
  `${REPORTS}\\Anthem Biosciences\\[260520] [JPMorgan] Anthem Biosciences - CRDMO pipeline depth, capabilities and capacity expansion underpin multi-year growth visibility.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY25: 'A', FY26: 'E', FY27: 'E', FY28: 'E' },
  {
    revenue:  { FY25: 1845, FY26: 2124, FY27: 2534, FY28: 3022 },
    ebitda:   { FY25:  671, FY26:  834, FY27:  993, FY28: 1206 },
    netProfit:{ FY25:  451, FY26:  592, FY27:  727, FY28:  862 },
  });

// --- Apar Industries (Nomura 28 May 26, p2 Income statement INRmn) ----
existing['Apar Industries'] = brokerBlock('Nomura', '260528',
  `${REPORTS}\\Apar Industries\\[260528] [Nomura] Apar Industries - Strong 4Q, outlook remains on firm footing Raise FY27F-FY28F EBITDA estimates by 7%-9%, estimate FY26-29F EBITDA CAGR of 19%, maintain Buy.pdf`,
  'Income statement (INRmn) — page 2',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 22902, FY27: 27097, FY28: 30613, FY29: 35930 },
    ebitda:   { FY26:  4811, FY27:  5693, FY28:  6431, FY29:  7548 },
    netProfit:{ FY26:  1715, FY27:  2049, FY28:  2328, FY29:  2869 },
  });

// --- Ashok Leyland (JPMorgan 28 May 26, p2 Key Metrics) ---------------
existing['Ashok Leyland'] = brokerBlock('JPMorgan', '260528',
  `${REPORTS}\\Ashok Leyland\\[260528] [JPMorgan] Ashok Leyland - Pricing discipline likely to continue amid volatile demand trends.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 44007, FY27: 47611, FY28: 51573, FY29: 54031 },
    ebitda:   { FY26:  5732, FY27:  5971, FY28:  7227, FY29:  7652 },
    netProfit:{ FY26:  3914, FY27:  4073, FY28:  5013, FY29:  5331 },
  });

// --- Asian Paints (JPMorgan 02 Jun 26, p2 Key Metrics) ----------------
existing['Asian Paints'] = brokerBlock('JPMorgan', '260602',
  `${REPORTS}\\Asian Paints\\[260602] [JPMorgan] Asian Paints - Analyst meet takeaways, Disciplined growth playbook.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 35516, FY27: 40414, FY28: 43186, FY29: 46561 },
    ebitda:   { FY26:  7334, FY27:  7796, FY28:  8860, FY29:  9695 },
    netProfit:{ FY26:  4552, FY27:  4935, FY28:  5746, FY29:  6428 },
  });

// --- Bharat Electronics (JPMorgan 20 May 26, p2 Key Metrics) ----------
existing['Bharat Electronics'] = brokerBlock('JPMorgan', '260520',
  `${REPORTS}\\Bharat Electronics\\[260520] [JPMorgan] Bharat Electronics - Growth momentum remains intact, preferred defense play in India.pdf`,
  'Key Metrics (FYE Mar) — page 2',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 27610, FY27: 31752, FY28: 36514, FY29: 41992 },
    ebitda:   { FY26:  8049, FY27:  8880, FY28: 10212, FY29: 11743 },
    netProfit:{ FY26:  6062, FY27:  6703, FY28:  7674, FY29:  8785 },
  });

// --- Bharat Petroleum (Jefferies 20 May 26 + Kotak 20 May 26) ----------
// Jefferies front-page FY (Mar) shows EBITDA (B) and Net Profit (B).
// Jefferies sees FY27E +ve; Kotak's Forecasts/Valuations table sees FY27E
// negative (deep losses on retail-fuel marketing margins). Both views
// are surfaced so the disagreement shows.
const bpclJeff = brokerBlock('Jefferies', '260520',
  `${REPORTS}\\Bharat Petroleum\\[260520] [Jefferies] Bharat Petroleum - Mar-26 Review, EBITDA beat, Valuation Favourable.pdf`,
  'Front-page FY (Mar) 2025A-2028E mini-table',
  { FY25: 'A', FY26: 'A', FY27: 'E', FY28: 'E' },
  {
    revenue:  {},
    ebitda:   { FY25: 25470, FY26: 41180, FY27: 10450, FY28: 32280 },
    netProfit:{ FY25: 13280, FY26: 23300,             FY28: 18730 },
  });
// Kotak Forecasts/Valuations: EPS (Rs) 56.6 / -36.3 / 29.8 × ~217 cr
// shares = ₹ cr (signed). FY27E loss aligns with Kotak's SELL view.
const bpclKotak = brokerBlock('Kotak', '260520',
  `${REPORTS}\\Bharat Petroleum\\[260520] [Kotak] Bharat Petroleum - 4Q outperformance, 1HFY27 set for deep losses.pdf`,
  'Forecasts/Valuations (page 1) — EPS-derived PAT, ₹217cr shares',
  { FY26: 'A', FY27: 'E', FY28: 'E' },
  {
    revenue:  {},
    ebitda:   {},
    netProfit:{ FY26: 12282, FY27: -7877, FY28: 6467 },
  });
existing['Bharat Petroleum'] = mergeBlocks(bpclJeff, bpclKotak);

// Re-serialise.
const KEYS = Object.keys(existing).sort((a,b)=>{
  if (a.startsWith('_')) return -1;
  if (b.startsWith('_')) return 1;
  return a.localeCompare(b);
});
const json = '{\n' + KEYS.map(k =>
  '  ' + JSON.stringify(k) + ': ' + JSON.stringify(existing[k], null, 2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')
).join(',\n') + '\n}\n';
fs.writeFileSync(MANUAL, json);
console.log('Manual entries now:', KEYS.filter(k=>!k.startsWith('_')).length);
for (const k of KEYS.filter(k=>!k.startsWith('_'))){
  const e = existing[k];
  const s = Object.keys(e.metrics).map(m => m+':'+Object.keys(e.metrics[m]).length+'fy').join(' ');
  console.log(`  ${k.padEnd(34)} ${s}`);
}
