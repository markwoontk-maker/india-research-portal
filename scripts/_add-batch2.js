// Batch 2: hand-verify financials for additional Holdings + Coverage
// names using the specific exhibit pages flagged by the user.
//
//   - Torrent Pharmaceuticals : Jefferies 22 May 26, Exhibit 1 (Key Metrics)
//   - Reliance Industries     : JPMorgan 02 Jun 26, p2 (Key Metrics)
//   - Avenue Supermarts       : Bernstein 20 May 26, p1 (Financials)
//   - Lloyds Metals & Energy  : Nomura   26 May 26, p2 (Income statement)
//   - L&T / Larsen & Toubro   : Kotak    22 May 26, p10 + CLSA 01 Jun 26, p2
//   - Amber Enterprises       : JPMorgan 18 May 26, p2
//   - GE Vernova T&D India    : JPMorgan 20 May 26, p2
//
// Skipped per user: Sun Pharma (Jefferies FIRST VIEW — no FY table),
// Tata Motors (no FY table), Kotak Mahindra Bank (no FY table).
//
// All values transcribed from the source PDFs (or user-supplied
// screenshots) and converted ₹m → ₹ cr (÷ 10).

const fs = require('fs');
const path = require('path');
const MANUAL = path.join(__dirname, '..', 'data', 'financials-manual.json');
const existing = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));

function fileUrl(p){
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

// Build a metrics block for ONE broker. Pass multi-broker data by
// merging the outputs of multiple calls (see L&T below).
function brokerBlock(broker, date, pdfPath, source, tagByFY, metrics){
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

// Merge two broker blocks into one entry, averaging values per (metric,
// FY) and collecting both brokers' contributions.
function mergeBlocks(a, b){
  const out = { currency: '₹ cr', metrics: {} };
  const allMetrics = new Set([...Object.keys(a.metrics||{}), ...Object.keys(b.metrics||{})]);
  for (const mk of allMetrics){
    out.metrics[mk] = {};
    const am = (a.metrics||{})[mk] || {};
    const bm = (b.metrics||{})[mk] || {};
    const allFY = new Set([...Object.keys(am), ...Object.keys(bm)]);
    for (const fy of allFY){
      const brokers = [];
      let tag = '';
      if (am[fy]){ brokers.push(...am[fy].brokers); tag = am[fy].tag; }
      if (bm[fy]){ brokers.push(...bm[fy].brokers); if (!tag) tag = bm[fy].tag; }
      const vals = brokers.map(b => b.value).filter(v => v != null);
      const avg = vals.length ? +(vals.reduce((s,v)=>s+v, 0) / vals.length).toFixed(1) : null;
      out.metrics[mk][fy] = { tag: tag||'E', avg, brokers };
    }
  }
  out.notes = [a.notes, b.notes].filter(Boolean).join(' · ');
  return out;
}

// --- Torrent Pharmaceuticals — Jefferies Exhibit 1 (Key Metrics) -------
// FY25A | FY26A | FY27E | FY28E | FY29E (all ₹m)
// Net Sales 115,160 / 139,830 / 196,144 / 217,772 / 241,876
// EBITDA    37,210  /  45,620 /  65,120 /  74,478 /  83,931
// Adj.PAT   19,282  /  22,323 /  27,441 /  35,507 /  43,168
const torrentPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Torrent Pharmaceuticals\\[260522] [Jefferies] Torrent Pharmaceuticals - In-line Mar-Q, JB integration progressing well, BUY.pdf";
existing['Torrent Pharmaceuticals'] = brokerBlock('Jefferies', '260522', torrentPDF,
  'Exhibit 1 — Torrent Pharma Key Metrics (page 1)',
  { FY25:'A', FY26:'A', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY25: 11516,  FY26: 13983,  FY27: 19614,  FY28: 21777,  FY29: 24188 },
    ebitda:   { FY25:  3721,  FY26:  4562,  FY27:  6512,  FY28:  7448,  FY29:  8393 },
    netProfit:{ FY25:  1928,  FY26:  2232,  FY27:  2744,  FY28:  3551,  FY29:  4317 },
  });

// --- Reliance Industries — JPMorgan p2 (Key Metrics FYE Mar) -----------
// FY26A | FY27E | FY28E | FY29E  (₹m)
// Revenue        10,572,190 / 12,237,628 / 12,276,344 / 13,624,743
// Adj. EBITDA     1,789,490 /  1,966,512 /  2,145,285 /  2,293,961
// Adj. net inc.     807,750 /    786,904 /    840,618 /    920,761
const rilPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Reliance Industries\\[260602] [JPMorgan] Reliance Industries - Stronger commodity margins, New Energy - likely FY27 stock drivers.pdf";
existing['Reliance Industries'] = brokerBlock('JPMorgan', '260602', rilPDF,
  'Key Metrics (FYE Mar) — page 2',
  { FY26:'A', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY26: 1057219, FY27: 1223763, FY28: 1227634, FY29: 1362474 },
    ebitda:   { FY26:  178949, FY27:  196651, FY28:  214529, FY29:  229396 },
    netProfit:{ FY26:   80775, FY27:   78690, FY28:   84062, FY29:   92076 },
  });

// --- Avenue Supermarts — Bernstein p1 (Financials block) ---------------
// F26A | F27E | F28E (₹m). No PAT row in the block — Rev/EBITDA only.
// Revenues 688,207 / 820,927 / 971,565
// EBITDA    51,866 /  64,102 /  77,514
const dmartPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Avenue Supermarts\\[260520] [Bernstein] Avenue Supermarts - DMart, The LFL vs inflation equation, how much does it really matter.pdf";
existing['Avenue Supermarts'] = brokerBlock('Bernstein', '260520', dmartPDF,
  'Financials block (page 1) — Rev / EBITDA only',
  { FY26:'A', FY27:'E', FY28:'E' },
  {
    revenue: { FY26: 68821, FY27: 82093, FY28: 97157 },
    ebitda:  { FY26:  5187, FY27:  6410, FY28:  7751 },
    netProfit:{},
  });

// --- Lloyds Metals and Energy — Nomura p2 (Income statement INRmn) -----
// FY25A | FY26A | FY27F | FY28F | FY29F
// Revenue          67,214 /  171,127 / 310,902 / 387,437 / 483,968
// EBITDA           19,529 /   61,402 / 127,919 / 152,650 / 187,667
// Normalised NPAT  14,499 /   36,809 /  65,891 /  70,194 /  83,798
const lloydsPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Lloyds Metals and Energy\\[260526] [Nomura] Lloyds Metals and Energy - Beyond the first rerating.pdf";
existing['Lloyds Metals and Energy'] = brokerBlock('Nomura', '260526', lloydsPDF,
  'Income statement (INRmn) — page 2',
  { FY25:'A', FY26:'A', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY25:  6721, FY26: 17113, FY27: 31090, FY28: 38744, FY29: 48397 },
    ebitda:   { FY25:  1953, FY26:  6140, FY27: 12792, FY28: 15265, FY29: 18767 },
    netProfit:{ FY25:  1450, FY26:  3681, FY27:  6589, FY28:  7019, FY29:  8380 },
  });

// --- L&T — Kotak p10 Exhibit 14 (Consolidated financials, ₹m) ---------
// FY25A | FY26E | FY27E | FY28E | FY29E  (Kotak marks FY26 as E)
// Revenues     2,557,350 / 2,858,740 / 3,107,972 / 3,674,807 / 4,247,741
// EBITDA         264,353 /   291,508 /   308,426 /   371,197 /   424,779
// Rec. PAT       145,629 /   178,061 /   215,678 /   264,318 /   301,281
const ltKotakPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\L&T\\[260522] [Kotak] L&T - AR2026, Margin test ahead.pdf";
const ltKotakBlock = brokerBlock('Kotak', '260522', ltKotakPDF,
  'Exhibit 14 Consolidated financials (page 10)',
  { FY25:'A', FY26:'E', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY25: 255735, FY26: 285874, FY27: 310797, FY28: 367481, FY29: 424774 },
    ebitda:   { FY25:  26435, FY26:  29151, FY27:  30843, FY28:  37120, FY29:  42478 },
    netProfit:{ FY25:  14563, FY26:  17806, FY27:  21568, FY28:  26432, FY29:  30128 },
  });

// --- L&T / Larsen & Toubro — CLSA p2 Financials block (₹m) ------------
// 25A | 26A | 27CL | 28CL | 29CL  (Net profit + Revenue; no EBITDA in block)
// Revenue:       2,557,345 / 2,858,744 / 3,246,999 / 3,905,618 / 4,546,851
// Net profit:      145,626 /   173,758 /   203,517 /   250,288 /   296,259
const ltCLSAPath = "C:\\Users\\admin\\Desktop\\India Related Reports\\Larsen & Toubro\\[260601] [CLSA] Larsen & Toubro - (no title).pdf";
const ltCLSABlock = brokerBlock('CLSA', '260601', ltCLSAPath,
  'Financials block (page 2) — Revenue + Net profit',
  { FY25:'A', FY26:'A', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY25: 255735, FY26: 285874, FY27: 324700, FY28: 390562, FY29: 454685 },
    ebitda:   {},
    netProfit:{ FY25:  14563, FY26:  17376, FY27:  20352, FY28:  25029, FY29:  29626 },
  });

// Both NOTEBOOKS folders ("L&T" and "Larsen & Toubro") map to LT.NS;
// register the merged Kotak+CLSA block under both names so either
// dropdown entry surfaces the same data.
const ltMerged = mergeBlocks(ltKotakBlock, ltCLSABlock);
existing['L&T'] = ltMerged;
existing['Larsen & Toubro'] = ltMerged;

// --- Amber Enterprises — JPMorgan p2 Key Metrics (FYE Mar, ₹m) --------
// FY26A | FY27E | FY28E | FY29E
// Revenue        121,865 / 146,700 / 179,776 / 208,388
// Adj. EBITDA      9,523 /  10,819 /  16,159 /  19,438
// Adj. net inc.    2,050 /   3,353 /   6,956 /   7,983
const amberPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\Amber Enterprises\\[260518] [JPMorgan] Amber Enterprises - Margin pressure and PCB execution delays.pdf";
existing['Amber Enterprises'] = brokerBlock('JPMorgan', '260518', amberPDF,
  'Key Metrics (FYE Mar) — page 2',
  { FY26:'A', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY26: 12187, FY27: 14670, FY28: 17978, FY29: 20839 },
    ebitda:   { FY26:   952, FY27:  1082, FY28:  1616, FY29:  1944 },
    netProfit:{ FY26:   205, FY27:   335, FY28:   696, FY29:   798 },
  });

// --- GE Vernova T&D India — JPMorgan p2 Key Metrics (FYE Mar, ₹m) -----
// FY26A | FY27E | FY28E | FY29E
// Revenue       62,063 /  79,738 /  99,919 / 128,218
// Adj. EBITDA   16,836 /  20,648 /  27,465 /  34,660
// Adj. net inc. 12,333 /  15,562 /  20,572 /  25,896
const gevtPDF = "C:\\Users\\admin\\Desktop\\India Related Reports\\GE Vernova T&D India\\[260520] [JPMorgan] GE Vernova T&D India - Emerge incrementally positive on the LT story, raising PT to Rs5050, stay OW.pdf";
existing['GE Vernova T&D India'] = brokerBlock('JPMorgan', '260520', gevtPDF,
  'Key Metrics (FYE Mar) — page 2',
  { FY26:'A', FY27:'E', FY28:'E', FY29:'E' },
  {
    revenue:  { FY26: 6206, FY27: 7974, FY28:  9992, FY29: 12822 },
    ebitda:   { FY26: 1684, FY27: 2065, FY28:  2747, FY29:  3466 },
    netProfit:{ FY26: 1233, FY27: 1556, FY28:  2057, FY29:  2590 },
  });

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
console.log('Manual entries:', KEYS.filter(k=>!k.startsWith('_')).length);
for (const k of KEYS.filter(k=>!k.startsWith('_'))){
  const e = existing[k];
  const s = Object.keys(e.metrics).map(m => m+':'+Object.keys(e.metrics[m]).length+'fy').join(' ');
  console.log(`  ${k.padEnd(28)} ${s}`);
}
