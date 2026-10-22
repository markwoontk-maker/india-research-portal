// Fill in `sym` (bare NSE symbol) on every data/earnings.json row so the page can
// look up the latest market cap in data/sectors.json (q[SYM].mc, full cap, INR cr).
//
// Run: node scripts/earnings/resolve-tickers.js
// Order: manual override -> companies.json ticker -> exact normalised name match
// against the Nifty 500 names in sectors.json -> prefix match. Rows that stay
// unresolved (non-Nifty-500 names) simply show "—" for market cap.
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'earnings.json');
const E = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sectors.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'companies.json'), 'utf8'));

const OVERRIDE = {
  'Mahindra & Mahindra': 'M&M', 'United Spirits': 'UNITDSPR', 'HDFC AMC': 'HDFCAMC', 'ICICI Prudential AMC': 'ICICIAMC',
  'ABSL AMC': 'ABSLAMC', 'Nippon AMC': 'NAM-INDIA', 'Nuvama': 'NUVAMA', 'CAMS': 'CAMS', 'KFin Technologies': 'KFINTECH',
  'Groww': 'GROWW', 'Sona BLW': 'SONACOMS', 'Can Fin Homes': 'CANFINHOME',
  'Bajaj Finserv': 'BAJAJFINSV', 'Go Digit General Insurance': 'GODIGIT', 'Niva Bupa Health Insurance': 'NIVABUPA',
  'Star Health': 'STARHEALTH', 'ICICI Prudential Life Insurance': 'ICICIPRULI', 'ICICI Lombard General Insurance': 'ICICIGI',
  'SBI Life Insurance': 'SBILIFE', 'HDFC Life': 'HDFCLIFE', 'Hexaware Technologies': 'HEXT', 'LTIMindtree': 'LTM',
  'Tata Consultancy Services': 'TCS', 'Allied Blenders & Distillers': 'ABDL', 'Vedant Fashions': 'MANYAVAR', 'Rallis India': 'RALLIS',
  'Blackbuck': 'BLACKBUCK', 'Sapphire Foods India': 'SAPPHIRE', 'Leela Palaces Hotels & Resorts': 'THELEELA', 'Just Dial': 'JUSTDIAL',
  'Bluestone Jewellery': 'BLUESTONE', 'Shadowfax': 'SHADOWFAX', 'Nexus Select Trust': 'NXST', 'WeWork India': 'WEWORK', 'HCL Technologies': 'HCLTECH', 'Tech Mahindra': 'TECHM', 'Container Corporation of India': 'CONCOR',
  'Interglobe Aviation': 'INDIGO', 'InterGlobe Aviation': 'INDIGO', 'Adani Ports and SEZ': 'ADANIPORTS', 'Adani Energy Solutions': 'ADANIENSOL',
  'Adani Green Energy': 'ADANIGREEN', 'Indian Energy Exchange': 'IEX', 'Bharat Heavy Electricals': 'BHEL', 'Bharat Electronics': 'BEL',
  'Bharat Petroleum': 'BPCL', 'Hindustan Petroleum': 'HINDPETRO', 'Indian Oil Corporation': 'IOC', 'GAIL India': 'GAIL',
  'Steel Authority of India': 'SAIL', 'Jindal Steel': 'JINDALSTEL', 'Hindustan Unilever': 'HINDUNILVR', 'Avenue Supermarts': 'DMART',
  'Colgate-Palmolive (India)': 'COLPAL', 'Tata Consumer Products': 'TATACONSUM', 'Varun Beverages': 'VBL', 'Vishal Mega Mart': 'VMM',
  'Indian Hotels Company': 'INDHOTEL', 'Sun Pharmaceutical Industries': 'SUNPHARMA', 'Torrent Pharmaceuticals': 'TORNTPHARM',
  "Dr Reddy's Laboratories": 'DRREDDY', "Divi's Laboratories": 'DIVISLAB', 'Mankind Pharma': 'MANKIND', 'Medplus Health Services': 'MEDPLUS',
  'Dr Lal PathLabs': 'LALPATHLAB', 'Global Health (Medanta)': 'MEDANTA', 'Narayana Hrudayalaya': 'NH', 'Larsen & Toubro': 'LT',
  'Central Depository Services (India)': 'CDSL', 'Bajaj Finance': 'BAJFINANCE', 'Cholamandalam': 'CHOLAFIN', 'Mahindra Finance': 'M&MFIN',
  'Muthoot Finance': 'MUTHOOTFIN', 'Shriram Finance': 'SHRIRAMFIN', 'L&T Finance': 'LTF', 'LIC Housing Finance': 'LICHSGFIN',
  'Aditya Birla Capital': 'ABCAPITAL', 'Punjab National Bank': 'PNB', 'Bank of Baroda': 'BANKBARODA', 'Bank of India': 'BANKINDIA',
  'Kotak Mahindra Bank': 'KOTAKBANK', 'IDFC First Bank': 'IDFCFIRSTB', 'AU Small Finance Bank': 'AUBANK', 'One 97 Communications': 'PAYTM',
  'Karur Vysya Bank': 'KARURVYSYA', 'City Union Bank': 'CUB', 'TVS Motor': 'TVSMOTOR', 'Maruti Suzuki': 'MARUTI', 'Bajaj Auto': 'BAJAJ-AUTO',
  'Eicher Motors': 'EICHERMOT', 'Hyundai Motor India': 'HYUNDAI', 'Exide Industries': 'EXIDEIND', 'Havells India': 'HAVELLS',
  'Polycab India': 'POLYCAB', 'V-Guard Industries': 'VGUARD', 'Ambuja Cements': 'AMBUJACEM', 'UltraTech Cement': 'ULTRACEMCO',
  'Shree Cement': 'SHREECEM', 'Kansai Nerolac Paints': 'KANSAINER', 'Tata Chemicals': 'TATACHEM', 'Coal India': 'COALINDIA',
  'Adani Enterprises': 'ADANIENT', 'IRB Infrastructure': 'IRB', 'Escorts Kubota': 'ESCORTS', 'Dixon Technologies': 'DIXON',
  'Syrma SGS Technology': 'SYRMA', 'Devyani International': 'DEVYANI', 'Westlife Foodworld': 'WESTLIFE', 'Hindustan Zinc': 'HINDZINC',
  'Indus Towers': 'INDUSTOWER', 'Tata Communications': 'TATACOMM', 'Kajaria Ceramics': 'KAJARIACER', 'Torrent Power': 'TORNTPOWER',
  'Tata Power': 'TATAPOWER', 'JSW Energy': 'JSWENERGY', 'Adani Power': 'ADANIPOWER', 'Reliance Industries': 'RELIANCE',
  'Mahanagar Gas': 'MGL', 'Waaree Energies': 'WAAREEENER', 'Apar Industries': 'APARINDS', 'Thermax': 'THERMAX', 'CG Power': 'CGPOWER',
  'Embassy Office Parks REIT': 'EMBASSY', 'Lodha Developers': 'LODHA', 'Prestige Estates Projects': 'PRESTIGE', 'Phoenix Mills': 'PHOENIXLTD',
  'Oberoi Realty': 'OBEROIRLTY', 'Sunteck Realty': 'SUNTECK', 'Supreme Industries': 'SUPREMEIND', 'Eternal': 'ETERNAL', 'Swiggy': 'SWIGGY',
  'Dabur India': 'DABUR', 'Nestle India': 'NESTLEIND', 'AWL Agri Business': 'AWL', 'Jindal Stainless': 'JSL', 'JSW Steel': 'JSWSTEEL',
  'Tata Steel': 'TATASTEEL', 'Shyam Metalics and Energy': 'SHYAMMETL', 'Vedanta Aluminium': 'VEDL', 'Granules India': 'GRANULES',
  'Laurus Labs': 'LAURUSLABS', 'Piramal Pharma': 'PPLPHARMA', 'Syngene International': 'SYNGENE', 'Concord Biotech': 'CONCORDBIO',
  'Blue Jet Healthcare': 'BLUEJET', 'Acutaas Chemicals': 'ACUTAAS', 'Asian Paints': 'ASIANPAINT', 'UTI AMC': 'UTIAMC', 'Neuland Labs': 'NEULANDLAB', 'Clean Science & Technology': 'CLEAN', 'SBFC': 'SBFC',
  'Brookfield India REIT': 'BIRET', 'Mindspace Business Parks REIT': 'MINDSPACE', 'Gujarat Gas': 'GUJGASLTD', 'Info Edge': 'NAUKRI', 'IndiaMART': 'INDIAMART',
};

const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ')
  .replace(/\b(ltd|limited|the|india|co|company|corporation|corp|industries|inds|of)\b/g, ' ').replace(/[^a-z0-9]/g, '');

const byName = {};
for (const [sym, q] of Object.entries(S.q || {})) { const k = norm(q.n); if (k) byName[k] = sym; }

// NSE equity master (all listed EQ/BE names, not just the Nifty 500), so smaller
// companies get a symbol too; their caps then come from the Yahoo fallback below.
async function nseMaster() {
  for (const u of ['https://archives.nseindia.com/content/equities/EQUITY_L.csv', 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv']) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0 Safari/537.36', Accept: 'text/csv,*/*', Referer: 'https://www.nseindia.com/' } });
      if (!r.ok) continue;
      const lines = (await r.text()).split(/\r?\n/), map = {};
      for (const line of lines.slice(1)) {
        const [sym, name, series] = line.split(',').map(x => (x || '').trim());
        if (sym && name && (!series || series === 'EQ' || series === 'BE')) { const k = norm(name); if (k && !map[k]) map[k] = sym; }
      }
      if (Object.keys(map).length > 500) return map;
    } catch (e) {}
  }
  return {};
}
const nameLookup = (map, k) => {
  if (map[k]) return map[k];
  if (k.length > 4) { const c = Object.keys(map).filter(n => n.startsWith(k) || k.startsWith(n)); if (c.length === 1) return map[c[0]]; }
  return null;
};

(async () => {
let hit = 0; const miss = [];
const NSE = await nseMaster();
for (const c of E.companies) {
  let sym = OVERRIDE[c.name] || OVERRIDE[c.sheetName] || '';
  if (!sym && C[c.name] && C[c.name].ticker) sym = C[c.name].ticker.replace(/\.(NS|BO)$/, '');
  if (!sym || !(S.q || {})[sym]) {
    const k = norm(c.name);
    const m = nameLookup(byName, k) || (!sym && nameLookup(NSE, k));
    if (m) sym = m;
  }
  c.sym = sym || '';
  if (sym && S.q[sym] && S.q[sym].mc) hit++; else miss.push(`${c.name}${sym ? ' [' + sym + ']' : ''}`);
}
// Names outside the Nifty 500 have no cap in sectors.json: fetch them from Yahoo
// (same keyless cookie+crumb route refresh-sectors.js uses) and store on the row.
const need = E.companies.filter(c => c.sym && !(S.q[c.sym] && S.q[c.sym].mc)).map(c => c.sym);
const caps = need.length ? await marketCaps([...new Set(need)]) : {};
for (const c of E.companies) {
  if (caps[c.sym]) { c.mcap = caps[c.sym]; c.mcapAsOf = new Date().toISOString().slice(0, 10); hit++; }
}
fs.writeFileSync(OUT, JSON.stringify(E, null, 1));
console.log(`market cap for ${hit}/${E.companies.length} rows (${Object.keys(caps).length} via Yahoo fallback); none: ${miss.filter(m => !Object.keys(caps).some(k => m.includes('[' + k + ']'))).join('; ')}`);
})();

function getRaw(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (r) => {
      const ch = []; r.on('data', (c) => ch.push(c));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(ch).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
  });
}
// Full market caps (INR cr) keyed by bare NSE symbol; {} on any failure.
async function marketCaps(syms) {
  const out = {};
  const c = await getRaw('https://fc.yahoo.com/');
  const cookie = ((c.headers && c.headers['set-cookie']) || []).map((x) => x.split(';')[0]).join('; ');
  if (!cookie) return out;
  const cr = await getRaw('https://query1.finance.yahoo.com/v1/test/getcrumb', { Cookie: cookie });
  const crumb = (cr.body || '').trim();
  if (cr.status !== 200 || !crumb || crumb.length > 40 || /[<s]/.test(crumb)) return out;
  for (let i = 0; i < syms.length; i += 50) {
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' +
      encodeURIComponent(syms.slice(i, i + 50).map((x) => x + '.NS').join(',')) + '&fields=marketCap&crumb=' + encodeURIComponent(crumb);
    const r = await getRaw(url, { Cookie: cookie });
    try { for (const x of JSON.parse(r.body).quoteResponse.result) if (x.marketCap > 0) out[x.symbol.replace(/.NS$/, '')] = Math.round(x.marketCap / 1e7); } catch (e) {}
  }
  return out;
}
