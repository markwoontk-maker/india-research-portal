#!/usr/bin/env node
/*
 * refresh-wl-quotes.js — Watchlist price snapshot + Nifty 500 index history.
 *
 * The static Pages site can't call Yahoo from the browser (CORS-blocked; the public
 * proxies are dead), so the Watchlist LTP / 1D / 1W / 1M / YTD columns and the
 * "vs N500" column were blank. This fetches them server-side from Yahoo's spark
 * endpoint (20 symbols/request, 1y daily) and commits data/wl_quotes.json:
 *
 *   { asOf, updated, q:{ "<YAHOO_SYM>": {p,d1,w1,m1,ytd} }, idx:{ "YYYY-MM-DD": <Nifty 500 close> } }
 *
 * p = latest price (the live intraday price when run during NSE hours, else the last close);
 * d1/w1/m1/ytd = % change vs the previous close / close 7 days ago / 1 month ago / last
 * close of the prior year. idx = ~2 years of Nifty 500 (^CRSLDX) daily closes, so "vs N500"
 * works for any entry date (the committed wl_returns.json only goes back to 2026-07-14).
 *
 * Universe = every ticker in the WL_HOLD/WL_COV/WL_WATCH defaults (all pipe alternatives)
 * UNION the NIFTY500 list, parsed from index.html — the same superset refresh-wl-returns.js
 * keeps. Keeps the last good file on failure; never throws.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'wl_quotes.json');
const HTML = path.join(__dirname, '..', 'index.html');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const MIN_SYMBOLS = 50;   // sanity floor — never overwrite a good file with a near-empty one

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, (r) => {
      const ch = []; r.on('data', (c) => ch.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(ch).toString('utf8') }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => Math.round(x * 1e4) / 1e4;
const istDate = (ts) => new Date((ts + 19800) * 1000).toISOString().slice(0, 10);

function loadUniverse() {
  const html = fs.readFileSync(HTML, 'utf8');
  const syms = new Set();
  ['WL_HOLD', 'WL_COV', 'WL_WATCH'].forEach((name) => {
    const m = html.match(new RegExp('const ' + name + '=\\[([\\s\\S]*?)\\];'));
    if (!m) return;
    const re = /,\s*"([^"]+)"\s*\]/g; let mm;
    while ((mm = re.exec(m[1]))) mm[1].split('|').forEach((t) => { t = t.trim(); if (/\.(NS|BO)$/i.test(t)) syms.add(t.toUpperCase()); });
  });
  const n = html.match(/const NIFTY500=\(([\s\S]*?)\)\.split/);
  if (n) {
    const parts = []; const re = /"([^"]*)"/g; let mm;
    while ((mm = re.exec(n[1]))) parts.push(mm[1]);
    parts.join('').split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => syms.add(s.toUpperCase() + '.NS'));
  }
  return Array.from(syms);
}

// Close on or before `ymd` in an ascending [{d,c}] series.
function closeOnOrBefore(series, ymd) { let res = null; for (const x of series) { if (x.d <= ymd) res = x.c; else break; } return res; }
function shiftDays(ymd, days) { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); }
function shiftMonths(ymd, months) { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + months); return t.toISOString().slice(0, 10); }
const pct = (a, b) => (a != null && b != null && b > 0) ? round((a / b - 1) * 100) : null;

function metrics(v) {
  if (!v || !v.timestamp || !v.close) return null;
  const s = [];
  for (let i = 0; i < v.timestamp.length; i++) if (v.close[i] != null) s.push({ d: istDate(v.timestamp[i]), c: v.close[i] });
  if (s.length < 2) return null;
  const last = s[s.length - 1], prev = s[s.length - 2];
  const yearStart = last.d.slice(0, 4) + '-01-01';
  const prevYearClose = closeOnOrBefore(s, shiftDays(yearStart, -1));
  return {
    p: round(last.c),
    d1: pct(last.c, prev.c),
    w1: pct(last.c, closeOnOrBefore(s, shiftDays(last.d, -7))),
    m1: pct(last.c, closeOnOrBefore(s, shiftMonths(last.d, -1))),
    ytd: pct(last.c, prevYearClose),
    d: last.d,
  };
}

async function spark(symbols, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/spark?symbols=' + encodeURIComponent(symbols.join(',')) + '&range=' + range + '&interval=1d';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await get(url);
    if (r.status === 200) { try { return JSON.parse(r.body); } catch (e) { /* retry */ } }
    await sleep(1500);
  }
  return {};
}

async function main() {
  const uni = loadUniverse();
  const q = {};
  let asOf = '';
  for (let i = 0; i < uni.length; i += 20) {
    const chunk = uni.slice(i, i + 20);
    const j = await spark(chunk, '1y');
    chunk.forEach((sym) => {
      const m = metrics(j[sym]);
      if (!m) return;
      if (m.d > asOf) asOf = m.d;
      delete m.d;
      q[sym] = m;
    });
    await sleep(250);
  }
  // Nifty 500: 2y of daily closes for the "vs N500" benchmark, plus its own quote row.
  const ij = await spark(['^CRSLDX'], '2y');
  const iv = ij['^CRSLDX'];
  const idx = {};
  if (iv && iv.timestamp) for (let i = 0; i < iv.timestamp.length; i++) if (iv.close[i] != null) idx[istDate(iv.timestamp[i])] = round(iv.close[i]);
  const im = metrics(iv); if (im) { delete im.d; q['^CRSLDX'] = im; }

  const n = Object.keys(q).length;
  if (n < MIN_SYMBOLS || Object.keys(idx).length < 100) {
    console.log('refresh-wl-quotes: only ' + n + ' symbols / ' + Object.keys(idx).length + ' index days — keeping the last good file.');
    return;
  }
  const out = { asOf: asOf, updated: new Date().toISOString(), q: q, idx: idx };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('refresh-wl-quotes: wrote ' + n + ' of ' + uni.length + ' symbols, ' + Object.keys(idx).length + ' Nifty 500 days, asOf ' + asOf + ' (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
}

main().catch((e) => { console.error('refresh-wl-quotes non-fatal:', e && e.message); process.exit(0); });
