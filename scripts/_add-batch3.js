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
//
// NOTE: every numeric value in the metrics object below this function is
// historically in ₹ cr — we store/serve in ₹ mn, so the wrapper scales
// inputs by ×10. Exception: the Adani Power / Adani Ports / Belrise /
// Concor / Cummins entries are already in ₹ mn (raw from Jefferies
// Exhibit 1) — those skip the scaler by setting _alreadyMn=true.
function brokerBlock(broker, date, pdfPath, source, tagByFY, metrics, opts){
  const url = fileUrl(pdfPath);
  const scale = (opts && opts._alreadyMn) ? 1 : 10;
  const out = { currency: '₹ mn', metrics: {} };
  for (const [mk, fyMap] of Object.entries(metrics)){
    out.metrics[mk] = {};
    for (const [fy, val] of Object.entries(fyMap)){
      if (val == null) continue;
      const scaled = +(val * scale).toFixed(1);
      out.metrics[mk][fy] = {
        tag: tagByFY[fy] || 'E', avg: scaled,
        brokers: [{ name: broker, date, url, value: scaled }]
      };
    }
  }
  if (source) out.notes = source;
  return out;
}

// Merge multiple broker blocks for one company into a single entry.
function mergeBlocks(...blocks){
  const out = { currency: '₹ mn', metrics: {} };
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

// --- Adani Power (Jefferies 18 May 26 — Exhibit 1: APL Financial Summary) -
// Source: per-user screenshot of Exhibit 1. Net Sales = Revenue,
// Adjusted PAT = Net Profit. Raw ₹ mn from the screenshot.
existing['Adani Power'] = brokerBlock('Jefferies', '260518',
  `${REPORTS}\\Adani Power\\[260518] [Jefferies] Adani Power - FCF to turn positive by FY30E.pdf`,
  'Exhibit 1 — APL Financial Summary',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 537815, FY27: 624588, FY28: 824293, FY29: 1015142 },
    ebitda:   { FY26: 195391, FY27: 210689, FY28: 290584, FY29:  362622 },
    netProfit:{ FY26: 110730, FY27: 123876, FY28: 151807, FY29:  183439 },
  }, {_alreadyMn:true});

// --- Adani Ports and SEZ — Jefferies Exhibit 1 (raw ₹mn) -------------
existing['Adani Ports and SEZ'] = brokerBlock('Jefferies', '260604',
  `${REPORTS}\\Adani Ports and SEZ\\[260604] [Jefferies] Adani Ports and SEZ - Management Meet Takeaways.pdf`,
  'Exhibit 1 — ADSEZ Financial Summary',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 387358, FY27: 439150, FY28: 522229, FY29: 608287 },
    ebitda:   { FY26: 228514, FY27: 253779, FY28: 302981, FY29: 351449 },
    netProfit:{ FY26: 136912, FY27: 151514, FY28: 189431, FY29: 229273 },
  }, {_alreadyMn:true});

// --- Belrise Industries — Jefferies front-page mini-table (raw ₹mn) --
existing['Belrise Industries'] = brokerBlock('Jefferies', '260525',
  `${REPORTS}\\Belrise Industries\\[260525] [Jefferies] Belrise Industries - Expanding Footprint.pdf`,
  'Front-page FY (Mar) mini-table — Rev/EBITDA/Net Profit',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 95091, FY27: 108591, FY28: 134852, FY29: 150405 },
    ebitda:   { FY26: 11538, FY27:  13024, FY28:  18177, FY29:  20340 },
    netProfit:{ FY26:  5020, FY27:   6422, FY28:   8909, FY29:  10219 },
  }, {_alreadyMn:true});

// --- Container Corporation of India — Jefferies Exhibit 1 (raw ₹mn) --
existing['Container Corporation of India'] = brokerBlock('Jefferies', '260526',
  `${REPORTS}\\Container Corporation of India\\[260526] [Jefferies] Concor - Catalyst ahead but execution key.pdf`,
  'Exhibit 1 — Concor Financial Summary',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 90595, FY27: 94670, FY28: 111910, FY29: 126327 },
    ebitda:   { FY26: 19215, FY27: 20980, FY28:  26637, FY29:  30746 },
    netProfit:{ FY26: 12218, FY27: 13141, FY28:  17402, FY29:  20991 },
  }, {_alreadyMn:true});

// --- Cummins India — Jefferies Exhibit 1 (raw ₹mn) -------------------
existing['Cummins India'] = brokerBlock('Jefferies', '260529',
  `${REPORTS}\\Cummins India\\[260529] [Jefferies] Cummins India Limited - Margin tailwinds ahead.pdf`,
  'Exhibit 1 — Cummins Financial Summary',
  { FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY26: 121432, FY27: 144428, FY28: 167750, FY29: 195934 },
    ebitda:   { FY26:  23781, FY27:  29180, FY28:  35784, FY29:  43290 },
    netProfit:{ FY26:  25949, FY27:  31880, FY28:  39331, FY29:  47778 },
  }, {_alreadyMn:true});

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
// Net Total Income → Revenue proxy. Profit after tax → Net Profit
// proxy. All from the same standalone table the user pointed at, raw ₹mn.
existing['Aditya Birla Capital'] = brokerBlock('Kotak', '260521',
  `${REPORTS}\\Aditya Birla Capital\\[260521] [Kotak] Aditya Birla Capital - Full sector coverage on KINSITE.pdf`,
  'Page 4 standalone — Net Total Income + Profit after tax',
  { FY25: 'A', FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY25: 75717, FY26: 84731, FY27: 111139, FY28: 139412, FY29: 170073 },
    ebitda:   {},
    netProfit:{ FY25: 29572, FY26: 31093, FY27:  40667, FY28:  49248, FY29:  60258 },
  }, {_alreadyMn:true});

// --- Bajaj Finserv (Jefferies 18 May 26 — Exhibit 25: BFS Summary income
// statement). Total Income → Revenue proxy; Profit After Tax → Net
// Profit proxy. Raw ₹mn.
existing['Bajaj Finserv'] = brokerBlock('Jefferies', '260518',
  `${REPORTS}\\Bajaj Finserv\\[260518] [Jefferies] Bajaj Finserv - Roadshow Feedback, Core Growing Well, New Ventures Near Breakeven.pdf`,
  'Exhibit 25 — BFS Summary income statement',
  { FY25: 'A', FY26: 'A', FY27: 'E', FY28: 'E', FY29: 'E' },
  {
    revenue:  { FY25: 1329443, FY26: 1505304, FY27: 1778975, FY28: 2127551, FY29: 2542312 },
    ebitda:   {},
    netProfit:{ FY25:  175576, FY26:  196695, FY27:  253787, FY28:  315562, FY29:  384045 },
  }, {_alreadyMn:true});

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
