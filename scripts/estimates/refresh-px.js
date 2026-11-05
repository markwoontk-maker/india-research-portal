#!/usr/bin/env node
// Company tab stock chart: price history, committed because the browser can't reach Yahoo
// (CORS-blocked from Pages, the public proxies are dead).
//
//   node scripts/estimates/refresh-px.js             daily: recent closes + a few history files
//   node scripts/estimates/refresh-px.js --history   (re)builds every history file
//
//   data/px/<YAHOO_SYM>.json  {s, cur, asOf, t:[day numbers], c:[closes]}  10 years: daily for the
//                             last 400 days, weekly before that. Split-adjusted, not dividend-adjusted.
//   data/px_recent.json       {asOf, updated, days:[day numbers], c:{<YAHOO_SYM>:[closes, null if none]}}
//                             the last 45 trading days for every company; the page appends these.
//
// A day number is days since 1970-01-01. History files are refreshed about monthly, oldest first,
// or at once when the recent closes disagree with the file (a split or bonus issue rescales the
// whole series). So a daily run rewrites one small file, not 450, and the repo stays small.
// Keeps the last good files on failure; never throws.
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'data', 'px');
const RECENT = path.join(ROOT, 'data', 'px_recent.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const DAILY_DAYS = 400, RECENT_DAYS = 45, MAX_AGE_DAYS = 30, MIN_RECENT = 50;
const MAX_HISTORY_PER_RUN = +(process.env.PX_MAX_HISTORY || 40);
const log = (...a) => console.log('[refresh-px]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const today = () => Math.floor(Date.now() / 864e5);
// Market date: 05:30 ahead of UTC puts an NSE or a US session on its own calendar date.
const dayOf = ts => Math.floor((ts + 19800) / 86400);
const fileOf = s => path.join(DIR, s + '.json');
const writeAtomic = (p, s) => { fs.writeFileSync(p + '.tmp', s); fs.renameSync(p + '.tmp', p); };

function get(url) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, r => {
      const ch = []; r.on('data', c => ch.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(ch).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(30000, () => req.destroy());
  });
}
async function getJSON(url) {
  for (let i = 0; i < 2; i++) {
    const r = await get(url);
    if (r.status === 200) { try { return JSON.parse(r.body); } catch (e) {} }
    if (r.status === 404) return null;
    await sleep(1500);
  }
  return null;
}

function universe() {
  const E = readJSON(path.join(ROOT, 'data', 'earnings.json'), null);
  if (!E || !Array.isArray(E.companies)) return [];
  return [...new Set(E.companies.map(c => c.yf || (c.sym ? c.sym + '.NS' : null)).filter(Boolean))].sort();
}

// Keep every point from the last DAILY_DAYS, and the last point of each week before that.
function thin(days, closes) {
  const cut = today() - DAILY_DAYS, t = [], c = [];
  for (let i = 0; i < days.length; i++) {
    const old = days[i] < cut;
    const nextSameWeek = old && i + 1 < days.length && days[i + 1] < cut && Math.floor((days[i + 1] + 3) / 7) === Math.floor((days[i] + 3) / 7);
    if (!nextSameWeek) { t.push(days[i]); c.push(closes[i]); }
  }
  return { t, c };
}
async function buildHistory(sym) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d`);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  const ts = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!ts || !q || !q.close) return false;
  const days = [], closes = [];
  ts.forEach((x, i) => { if (typeof q.close[i] === 'number') { days.push(dayOf(x)); closes.push(+q.close[i].toFixed(2)); } });
  if (days.length < 5) return false;
  const { t, c } = thin(days, closes);
  const cur = r.meta && r.meta.currency === 'USD' ? 'US$' : 'INR';
  writeAtomic(fileOf(sym), JSON.stringify({ s: sym, cur, asOf: today(), t, c }));
  return true;
}

async function fetchRecent(syms) {
  const series = {};
  for (let i = 0; i < syms.length; i += 20) {
    const chunk = syms.slice(i, i + 20);
    const j = await getJSON('https://query1.finance.yahoo.com/v8/finance/spark?symbols=' + encodeURIComponent(chunk.join(',')) + '&range=3mo&interval=1d');
    for (const s of chunk) {
      const x = j && j[s];
      if (!x || !x.timestamp || !x.close) continue;
      const m = {};
      x.timestamp.forEach((ts, k) => { if (typeof x.close[k] === 'number') m[dayOf(ts)] = +x.close[k].toFixed(2); });
      if (Object.keys(m).length) series[s] = m;
    }
    await sleep(120);
  }
  return series;
}
function writeRecent(series) {
  const n = Object.keys(series).length;
  if (n < MIN_RECENT) { log(`only ${n} symbols came back - keeping the last good ${path.basename(RECENT)}.`); return false; }
  const all = new Set();
  for (const m of Object.values(series)) for (const d of Object.keys(m)) all.add(+d);
  const days = [...all].sort((a, b) => a - b).slice(-RECENT_DAYS);
  const c = {};
  for (const s of Object.keys(series).sort()) c[s] = days.map(d => (series[s][d] == null ? null : series[s][d]));
  const asOf = new Date(days[days.length - 1] * 864e5).toISOString().slice(0, 10);
  writeAtomic(RECENT, JSON.stringify({ asOf, updated: new Date().toISOString(), days, c }));
  log(`recent closes for ${n} symbols, ${days.length} days, as of ${asOf}.`);
  return true;
}
// True when a history file's closes no longer line up with the recent ones (split or bonus issue).
function rescaled(sym, recent) {
  const h = readJSON(fileOf(sym), null);
  if (!h || !recent) return false;
  for (let i = h.t.length - 1; i >= 0 && h.t[i] > today() - 90; i--) {
    const v = recent[h.t[i]];
    if (v != null) return Math.abs(v / h.c[i] - 1) > 0.015;
  }
  return false;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const syms = universe();
  if (!syms.length) { log('no companies found - skipping.'); return; }
  const full = process.argv[2] === '--history';
  const series = full ? {} : await fetchRecent(syms);
  if (!full) writeRecent(series);

  const need = [];
  for (const s of syms) {
    const h = readJSON(fileOf(s), null);
    if (full || !h || today() - h.asOf > MAX_AGE_DAYS || rescaled(s, series[s])) need.push({ s, asOf: h ? h.asOf : 0, urgent: !h || rescaled(s, series[s]) });
  }
  need.sort((a, b) => b.urgent - a.urgent || a.asOf - b.asOf);
  const todo = full ? need : need.slice(0, MAX_HISTORY_PER_RUN);
  let ok = 0, cursor = 0; const miss = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < todo.length) {
      const { s } = todo[cursor++];
      if (await buildHistory(s)) ok++; else miss.push(s);
      await sleep(150);
    }
  }));
  log(`history: ${ok}/${todo.length} rebuilt, ${need.length - todo.length} waiting for a later run${miss.length ? '; no data for ' + miss.join(', ') : ''}.`);
})().catch(e => log('error: ' + (e && e.stack || e)));
