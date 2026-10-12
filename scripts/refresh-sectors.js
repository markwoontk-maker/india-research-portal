#!/usr/bin/env node
/*
 * refresh-sectors.js — Sector Performance + Desk Snapshot data (server-side).
 *
 * The static Pages site can't call Yahoo from the browser (CORS-blocked; public
 * proxies are dead), so the Sector Performance bars, the per-sector detail
 * (chart + stock list) and the Desk Snapshot rows were slow/empty. This fetches
 * everything those cards need server-side and commits data/sectors.json for an
 * instant render.
 *
 * SECTORS = NSE's OWN INDUSTRY CLASSIFICATION OF THE FULL NIFTY 500. Every
 * constituent in niftyindices.com's ind_nifty500list.csv carries an "Industry"
 * (~20 macro-industries: Financial Services, Capital Goods, Healthcare, ...), so
 * grouping by it buckets all ~500 stocks, each exactly once. (The previous
 * version grouped by the 14 named Nifty sector indices, whose combined
 * membership is only ~166 names — whole industries like Capital Goods,
 * Chemicals, Power, Telecom and Cement had no index at all.)
 *
 * SECTOR RETURNS ARE EQUAL-WEIGHTED CONSTITUENT AVERAGES. There is no
 * cap-weighted index for an NSE industry bucket (and Yahoo has no usable history
 * for most NSE sector indices anyway), so each sector's return for a timeframe
 * is the mean of its members' returns, and the detail sparkline is a synthetic
 * equal-weight index (every member rebased to 100 at the window start, averaged
 * per day). The card is labelled "avg constituent return" so this is explicit.
 *
 * Contents of data/sectors.json:
 *   - desk:    {p,d1} for the 5 Desk-Snapshot indices (chart endpoint: last vs
 *              chartPreviousClose — reliable even without history).
 *   - dates:   shared trading-day axis (from ^NSEI) the series align to.
 *   - sectors: [{name, industry, ret{d1,w1,m1,m6,ytd,y1}, series[], members[]}]
 *              name = short display label, industry = NSE's full name.
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
const CSV_URL = 'https://niftyindices.com/IndexConstituent/ind_nifty500list.csv';
const DESK = ["^CRSLDX", "^NSEI", "NIFTY_MIDCAP_100.NS", "^CNXSC", "INR=X"];
const MIN_MEMBERS = 300;  // a real Nifty 500 run resolves ~490; never publish far below that

// Shorter bar labels for NSE's longest industry names (others are used as-is).
const SHORT = {
  "Automobile and Auto Components": "Auto & Auto Components",
  "Fast Moving Consumer Goods": "FMCG",
  "Information Technology": "IT",
  "Oil Gas & Consumable Fuels": "Oil, Gas & Fuels",
  "Media Entertainment & Publication": "Media & Entertainment",
  "Telecommunication": "Telecom",
};

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

// Nifty 500 CSV -> [{sym, name, industry}] (quoted-field aware).
function parseCsv(csv) {
  const out = [];
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return out;
  const rowOf = (line) => { const a = []; let c = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { a.push(c); c = ''; } else c += ch; } a.push(c); return a; };
  const hdr = rowOf(lines[0]).map((h) => h.trim().toLowerCase());
  const iN = hdr.indexOf('company name'), iS = hdr.indexOf('symbol'), iI = hdr.indexOf('industry');
  if (iN < 0 || iS < 0 || iI < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const r = rowOf(lines[i]);
    const sym = (r[iS] || '').trim().toUpperCase();
    const name = (r[iN] || '').trim().replace(/\s+(Ltd\.?|Limited)$/i, '');
    const industry = (r[iI] || '').trim() || 'Other';
    // NSE keeps placeholder rows (e.g. DUMMYHEG after a demerger) — not real stocks.
    if (sym && !/^DUMMY/.test(sym)) out.push({ sym, name: name || sym, industry });
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
  // 1. Full Nifty 500 with NSE industry classification.
  const csv = await get(CSV_URL);
  const rows = csv.status === 200 ? parseCsv(csv.body) : [];
  if (rows.length < 400) { console.log('refresh-sectors: Nifty 500 CSV returned ' + rows.length + ' rows — keeping the last good file.'); return; }
  const byIndustry = new Map();             // industry -> [{sym,name}]
  for (const r of rows) {
    if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
    byIndustry.get(r.industry).push(r);
  }

  // 2. Spark 1y daily for every constituent -> series + metrics.
  const memSeries = {}, memMetric = {};
  let asOf = '';
  const uni = rows.map((r) => r.sym + '.NS');
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
  const resolved = Object.keys(memMetric).length;
  if (resolved < MIN_MEMBERS || !asOf) {
    console.log('refresh-sectors: only ' + resolved + ' of ' + rows.length + ' constituents resolved — keeping the last good file.');
    return;
  }

  // 3. Shared trading-day axis from ^NSEI (reliable), last ~252 sessions.
  const nsei = seriesOf((await spark(['^NSEI'], '1y'))['^NSEI']);
  const dates = (nsei.length >= 50 ? nsei : Object.values(memSeries).sort((a, b) => b.length - a.length)[0] || []).map((x) => x.d);

  // 4. Per-industry equal-weight return + synthetic series. Largest industries first.
  const TFS = ['d1', 'w1', 'm1', 'm6', 'ytd', 'y1'];
  const sectorsOut = [...byIndustry.entries()].sort((a, b) => b[1].length - a[1].length).map(([industry, mems]) => {
    const syms = mems.map((m) => m.sym);
    const ret = {};
    for (const tf of TFS) ret[tf] = mean(syms.map((s) => memMetric[s] && memMetric[s][tf]));
    const base = dates[0];
    const normed = syms.map((s) => {
      const ser = memSeries[s]; if (!ser) return null;
      const b = closeOnOrBefore(ser, base); if (!b) return null;
      return { ser, b };
    }).filter(Boolean);
    const series = dates.map((d) => mean(normed.map((x) => { const c = closeOnOrBefore(x.ser, d); return c == null ? null : (c / x.b) * 100; })));
    return { name: SHORT[industry] || industry, industry, ret, series, members: syms };
  });

  // 5. Desk Snapshot indices.
  const desk = {};
  for (const sym of DESK) { const q = await deskQuote(sym); if (q) desk[sym] = q; await sleep(150); }

  // 6. Per-member quote rows for the detail list.
  const q = {};
  for (const r of rows) {
    const mm = memMetric[r.sym];
    q[r.sym] = mm ? { n: r.name, p: mm.p, d1: mm.d1, w1: mm.w1, m1: mm.m1, m6: mm.m6, ytd: mm.ytd, y1: mm.y1 } : { n: r.name };
  }

  const sess = session();
  const out = { asOf, updated: new Date().toISOString(), intraday: sess.intraday, session: sess.session,
    method: 'NSE industry classification of the Nifty 500; equal-weight constituent avg', dates, desk, sectors: sectorsOut, q };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log('refresh-sectors: wrote data/sectors.json (' + sess.session + ', ' + sectorsOut.length + ' industries, ' +
    resolved + '/' + rows.length + ' constituents priced, ' + Object.keys(desk).length + '/5 desk, asOf ' + asOf + ', ' +
    (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB).');
}
main().catch((e) => { console.log('refresh-sectors: unexpected error — ' + e.message); process.exit(1); });
