#!/usr/bin/env node
/*
 * refresh-sectors.js — Sector Performance + Desk Snapshot data (server-side).
 *
 * The static Pages site can't call Yahoo from the browser (CORS-blocked; public
 * proxies are dead), so the Sector Performance bars, the per-sector detail
 * (chart + stock list) and the Desk Snapshot rows were slow/empty — the page
 * fell through to dead proxies before giving up. This fetches everything those
 * cards need server-side and commits data/sectors.json for an instant render.
 *
 * SECTOR RETURNS ARE EQUAL-WEIGHTED CONSTITUENT AVERAGES, not the cap-weighted
 * NSE index. Why: Yahoo has no usable history for most NSE sector-index symbols
 * (only NIFTY BANK / IT / PHARMA return a daily series; the rest give a single
 * current point or 404), so a per-index pull is unreliable. The constituents,
 * by contrast, all resolve. So each sector's return for a timeframe is the mean
 * of its members' returns, and the detail sparkline is a synthetic equal-weight
 * index (every member rebased to 100 at the window start, averaged per day). The
 * card is labelled "avg constituent return" so this is explicit.
 *
 * Contents of data/sectors.json:
 *   - desk:    {p,d1} for the 5 Desk-Snapshot indices (chart endpoint: last vs
 *              chartPreviousClose — reliable even without history).
 *   - dates:   shared trading-day axis (from ^NSEI) the series align to.
 *   - sectors: [{name, ret{d1,w1,m1,m6,ytd,y1}, series[], members[]}] — full
 *              official constituent lists from niftyindices.com sector CSVs.
 *   - q:       {n,p,d1,w1,m1,m6,ytd,y1} per member base-symbol (detail list).
 *
 * AUTH-FREE, no LLM. Keeps the last good file on failure; never throws.
 * Run:  node scripts/refresh-sectors.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'sectors.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const SECTORS = [
  ["Nifty Auto", "ind_niftyautolist.csv"],
  ["Nifty Bank", "ind_niftybanklist.csv"],
  ["Nifty Financial Services", "ind_niftyfinancelist.csv"],
  ["Nifty FMCG", "ind_niftyfmcglist.csv"],
  ["Nifty Healthcare", "ind_niftyhealthcarelist.csv"],
  ["Nifty IT", "ind_niftyitlist.csv"],
  ["Nifty Media", "ind_niftymedialist.csv"],
  ["Nifty Metal", "ind_niftymetallist.csv"],
  ["Nifty Pharma", "ind_niftypharmalist.csv"],
  ["Nifty Private Bank", "ind_nifty_privatebanklist.csv"],
  ["Nifty PSU Bank", "ind_niftypsubanklist.csv"],
  ["Nifty Realty", "ind_niftyrealtylist.csv"],
  ["Nifty Consumer Durables", "ind_niftyconsumerdurableslist.csv"],
  ["Nifty Oil & Gas", "ind_niftyoilgaslist.csv"],
];
const DESK = ["^CRSLDX", "^NSEI", "NIFTY_MIDCAP_100.NS", "^CNXSC", "INR=X"];

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return get(r.headers.location).then(resolve); }
      const ch = []; r.on('data', (c) => ch.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(ch).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const istDate = (ts) => new Date((ts + 19800) * 1000).toISOString().slice(0, 10);
const mean = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

function parseCsv(csv) {
  const out = [];
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return out;
  const rowOf = (line) => { const a = []; let c = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { a.push(c); c = ''; } else c += ch; } a.push(c); return a; };
  const hdr = rowOf(lines[0]).map((h) => h.trim().toLowerCase());
  const iN = hdr.indexOf('company name'), iS = hdr.indexOf('symbol');
  if (iN < 0 || iS < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const r = rowOf(lines[i]);
    const sym = (r[iS] || '').trim().toUpperCase();
    const name = (r[iN] || '').trim().replace(/\s+(Ltd\.?|Limited)$/i, '');
    if (sym) out.push({ sym, name: name || sym });
  }
  return out;
}

function closeOnOrBefore(s, ymd) { let res = null; for (const x of s) { if (x.d <= ymd) res = x.c; else break; } return res; }
function shiftDays(ymd, d) { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
function shiftMonths(ymd, m) { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + m); return t.toISOString().slice(0, 10); }
const pct = (a, b) => (a != null && b != null && b > 0) ? round((a / b - 1) * 100) : null;

function seriesOf(v) {
  if (!v || !v.timestamp || !v.close) return [];
  const s = [];
  for (let i = 0; i < v.timestamp.length; i++) if (v.close[i] != null) s.push({ d: istDate(v.timestamp[i]), c: v.close[i] });
  return s;
}
function metricsOf(s) {
  if (s.length < 2) return null;
  const last = s[s.length - 1], prev = s[s.length - 2];
  const yearStart = last.d.slice(0, 4) + '-01-01';
  return {
    p: round(last.c),
    d1: pct(last.c, prev.c),
    w1: pct(last.c, closeOnOrBefore(s, shiftDays(last.d, -7))),
    m1: pct(last.c, closeOnOrBefore(s, shiftMonths(last.d, -1))),
    m6: pct(last.c, closeOnOrBefore(s, shiftMonths(last.d, -6))),
    ytd: pct(last.c, closeOnOrBefore(s, shiftDays(yearStart, -1))),
    y1: pct(last.c, closeOnOrBefore(s, shiftDays(last.d, -365))),
    d: last.d,
  };
}

async function spark(symbols, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/spark?symbols=' + encodeURIComponent(symbols.join(',')) + '&range=' + range + '&interval=1d';
  for (let a = 0; a < 2; a++) { const r = await get(url); if (r.status === 200) { try { return JSON.parse(r.body); } catch (e) {} } await sleep(1500); }
  return {};
}
// Desk indices: last price + 1D via the chart endpoint (reliable without history).
async function deskQuote(sym) {
  const r = await get('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=5d&interval=1d');
  try {
    const res = JSON.parse(r.body).chart.result[0];
    const cl = (res.indicators.quote[0].close || []).filter((x) => x != null);
    const last = cl[cl.length - 1];
    const prev = cl.length >= 2 ? cl[cl.length - 2] : res.meta.chartPreviousClose;
    if (last == null) return null;
    return { p: round(last), d1: pct(last, prev) };
  } catch (e) { return null; }
}

function session() {
  const n = new Date(Date.now() + 5.5 * 3600 * 1000);
  const dow = n.getUTCDay(), mins = n.getUTCHours() * 60 + n.getUTCMinutes();
  if (dow < 1 || dow > 5) return { intraday: false, session: 'weekend' };
  if (mins < 9 * 60 + 15) return { intraday: false, session: 'pre-open' };
  if (mins <= 15 * 60 + 30) return { intraday: true, session: 'open' };
  return { intraday: false, session: 'closed' };
}

async function main() {
  // 1. Full official membership from the 14 sector CSVs.
  const members = {};
  for (const [name, csv] of SECTORS) {
    const r = await get('https://niftyindices.com/IndexConstituent/' + csv);
    members[name] = r.status === 200 ? parseCsv(r.body) : [];
    await sleep(150);
  }
  const memSyms = new Set();
  for (const name in members) for (const m of members[name]) memSyms.add(m.sym.toUpperCase() + '.NS');

  // 2. Spark 1y daily for every member -> series + metrics.
  const memSeries = {};   // base sym -> [{d,c}]
  const memMetric = {};   // base sym -> metrics
  let asOf = '';
  const uni = Array.from(memSyms);
  for (let i = 0; i < uni.length; i += 20) {
    const chunk = uni.slice(i, i + 20);
    const j = await spark(chunk, '1y');
    for (const ysym of chunk) {
      const base = ysym.replace(/\.NS$/, '');
      const s = seriesOf(j[ysym]);
      if (s.length) memSeries[base] = s;
      const m = metricsOf(s);
      if (m) { if (m.d > asOf) asOf = m.d; memMetric[base] = m; }
    }
    await sleep(250);
  }
  if (Object.keys(memMetric).length < 80 || !asOf) {
    console.log('refresh-sectors: only ' + Object.keys(memMetric).length + ' members resolved — keeping the last good file.');
    return;
  }

  // 3. Shared trading-day axis from ^NSEI (reliable), last ~252 sessions.
  const nsei = seriesOf((await spark(['^NSEI'], '1y'))['^NSEI']);
  const dates = (nsei.length >= 50 ? nsei : Object.values(memSeries).sort((a, b) => b.length - a.length)[0] || []).map((x) => x.d);

  // 4. Per-sector equal-weight return (mean of member metrics) + synthetic series.
  const TFS = ['d1', 'w1', 'm1', 'm6', 'ytd', 'y1'];
  const sectorsOut = SECTORS.map(([name]) => {
    const syms = members[name].map((m) => m.sym.toUpperCase());
    const ret = {};
    for (const tf of TFS) ret[tf] = mean(syms.map((s) => memMetric[s] && memMetric[s][tf]));
    // synthetic equal-weight index on the shared axis: each member rebased to 100
    // at the window start, averaged per day (members without a base close skipped).
    const base = dates[0];
    const normed = syms.map((s) => {
      const ser = memSeries[s]; if (!ser) return null;
      const b = closeOnOrBefore(ser, base); if (!b) return null;
      return { ser, b };
    }).filter(Boolean);
    const series = dates.map((d) => {
      const vals = normed.map((x) => { const c = closeOnOrBefore(x.ser, d); return c == null ? null : (c / x.b) * 100; });
      return mean(vals);
    });
    return { name, ret, series, members: syms };
  });

  // 5. Desk Snapshot indices.
  const desk = {};
  for (const sym of DESK) { const q = await deskQuote(sym); if (q) desk[sym] = q; await sleep(150); }

  // 6. Per-member quote rows for the detail list.
  const q = {};
  for (const name in members) for (const m of members[name]) {
    const base = m.sym.toUpperCase();
    if (q[base]) continue;
    const mm = memMetric[base];
    q[base] = mm ? { n: m.name, p: mm.p, d1: mm.d1, w1: mm.w1, m1: mm.m1, m6: mm.m6, ytd: mm.ytd, y1: mm.y1 } : { n: m.name };
  }

  const sess = session();
  const out = { asOf, updated: new Date().toISOString(), intraday: sess.intraday, session: sess.session, method: 'equal-weight constituent avg', dates, desk, sectors: sectorsOut, q };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log('refresh-sectors: wrote data/sectors.json (' + sess.session + ', ' + sectorsOut.length + ' sectors, ' + Object.keys(q).length + ' members, ' + Object.keys(desk).length + '/5 desk, asOf ' + asOf + ', ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB).');
}
main().catch((e) => { console.log('refresh-sectors: unexpected error — ' + e.message); process.exit(1); });
