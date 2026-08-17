#!/usr/bin/env node
/*
 * refresh-wl-returns.js — Watchlist Daily Return data source.
 *
 * The dashboard is a static GitHub Pages site and cannot fetch NSE directly
 * (no CORS; the public corsproxy/allorigins fallbacks are dead). So we fetch
 * the official NSE daily bhavcopy + index close here (server-side, from the
 * local pipeline) and commit the exact close-to-close returns for every NSE
 * stock into data/wl_returns.json. The page reads that file to compute the
 * weighted portfolio return and the per-stock hover contributions.
 *
 * Source (exact, official, covers every stock incl. the Yahoo "gap" names):
 *   equities: nsearchives.nseindia.com/products/content/sec_bhavdata_full_<DDMMYYYY>.csv
 *   index   : nsearchives.nseindia.com/content/indices/ind_close_all_<DDMMYYYY>.csv
 *
 * Return per stock = CLOSE_PRICE / PREV_CLOSE - 1  (NSE's PREV_CLOSE is the
 * corporate-action-adjusted prior close, so it equals a clean close-to-close
 * return without needing the previous file).
 *
 * Idempotent + append-only: only fetches dates missing from the JSON. A 404 =
 * weekend/holiday (no bhavcopy) and is skipped. Never throws; exits 0.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'wl_returns.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const LOOKBACK_DAYS = 14;            // how many calendar days back to try to backfill
const START_FLOOR = '2026-07-14';    // never record dates before this — the chart does not backdate

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.nseindia.com/' } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

function iso(d) { return d.toISOString().slice(0, 10); }
function ddmmyyyy(d) {
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + p(d.getUTCMonth() + 1) + d.getUTCFullYear();
}
function round(x) { return Math.round(x * 1e4) / 1e4; }

// Yahoo fallback: when NSE blocks this IP (403 Access Denied), fetch the holdings
// universe + Nifty 500 index from Yahoo so the daily chart keeps updating. Entries
// are tagged src:'yahoo-fallback' and re-fetched from NSE later (see the skip below).
function loadUniverse() {
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const syms = new Set();
    ['WL_HOLD', 'WL_COV', 'WL_WATCH'].forEach((name) => {
      const m = html.match(new RegExp('const ' + name + '=\\[([\\s\\S]*?)\\];'));
      if (!m) return;
      const re = /,\s*"([^"]+)"\s*\]/g; let mm;
      while ((mm = re.exec(m[1]))) { const tk = mm[1].split('|')[0].trim(); if (tk && /\.(NS|BO)$/i.test(tk)) syms.add(tk); }
    });
    return Array.from(syms);
  } catch (e) { return []; }
}
function yahooDaily(sym) {
  return new Promise((resolve) => {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1mo&interval=1d';
    https.get(url, { headers: { 'User-Agent': UA } }, (r) => {
      const ch = []; r.on('data', (c) => ch.push(c));
      r.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(ch).toString('utf8'));
          const res = j && j.chart && j.chart.result && j.chart.result[0];
          if (!res || !res.timestamp) return resolve({});
          const ts = res.timestamp, cl = res.indicators.quote[0].close, out = {};
          for (let i = 0; i < ts.length; i++) { if (cl[i] != null) { const dt = new Date((ts[i] + 19800) * 1000); out[dt.toISOString().slice(0, 10)] = cl[i]; } }
          resolve(out);
        } catch (e) { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

function parseEquities(csv) {
  const r = {}, c = {};
  csv.split(/\r?\n/).forEach((line) => {
    const cols = line.split(',').map((s) => s.trim());
    if (cols.length < 9) return;
    const series = cols[1];
    if (series !== 'EQ' && series !== 'BE') return;
    const sym = cols[0], prev = +cols[3], close = +cols[8];
    if (!sym || !isFinite(prev) || !isFinite(close) || prev <= 0) return;
    r[sym] = round((close / prev - 1) * 100);   // close-to-close % return
    c[sym] = round(close);                       // absolute close (for market-value weights)
  });
  return { r: r, c: c };
}

function parseIndex(csv) {
  // Columns: Index Name, Date, Open, High, Low, Close, Points Change, Change(%), ...
  let out = null;
  csv.split(/\r?\n/).forEach((line) => {
    if (!/^\s*Nifty 500\s*,/i.test(line)) return;
    const c = line.split(',').map((s) => s.trim());
    const pchg = parseFloat(c[7]);
    if (isFinite(pchg)) out = round(pchg);
  });
  return out;
}

async function main() {
  let data = { updated: '', dates: {} };
  try {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (j && j.dates) data = j;
  } catch (_) { /* first run */ }

  const today = new Date();
  let added = 0;
  const needYahoo = [];
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;      // weekend
    const key = iso(d);
    if (key < START_FLOOR) continue;           // do not backdate before the floor
    // Already have it — but re-fetch dates that were filled from the Yahoo fallback
    // (partial: holdings only) so the full official NSE bhavcopy replaces them once
    // NSE is reachable again.
    if (data.dates[key] && data.dates[key].src !== 'yahoo-fallback') continue;

    const eq = await get('https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_' + ddmmyyyy(d) + '.csv');
    if (eq.status === 404) { console.log(key + ': no bhavcopy (404) — holiday/weekend, skip'); continue; }
    if (eq.status !== 200) { console.log(key + ': NSE unreachable (status ' + eq.status + ') — queueing Yahoo fallback'); needYahoo.push(key); continue; }
    const eqp = parseEquities(eq.body);
    if (!Object.keys(eqp.r).length) { console.log(key + ': empty bhavcopy, skip'); continue; }

    const idxRes = await get('https://nsearchives.nseindia.com/content/indices/ind_close_all_' + ddmmyyyy(d) + '.csv');
    const index = idxRes.status === 200 ? parseIndex(idxRes.body) : null;

    data.dates[key] = { index: index, r: eqp.r, c: eqp.c };
    added++;
    console.log(key + ': added ' + Object.keys(eqp.r).length + ' stocks, Nifty 500 = ' + (index == null ? 'n/a' : index + '%'));
  }

  if (needYahoo.length) {
    const uni = loadUniverse();
    console.log('NSE blocked for ' + needYahoo.length + ' date(s); Yahoo fallback over ' + uni.length + ' symbols: ' + needYahoo.join(', '));
    const series = {};
    for (const sym of uni) { series[sym] = await yahooDaily(sym); }
    const idxSeries = await yahooDaily('^CRSLDX');
    const idxDates = Object.keys(idxSeries).sort();
    const nseSym = (x) => x.split('|')[0].replace(/\.(NS|BO)$/i, '');
    for (const key of needYahoo) {
      if (idxSeries[key] == null) { console.log('  ' + key + ': not a Yahoo trading day — skip (likely holiday)'); continue; }
      const iPrev = idxDates.filter((x) => x < key).pop();
      const index = (iPrev && idxSeries[iPrev]) ? round((idxSeries[key] / idxSeries[iPrev] - 1) * 100) : null;
      const r = {}, c = {};
      uni.forEach((sym) => {
        const ser = series[sym]; if (!ser || ser[key] == null) return;
        const dts = Object.keys(ser).sort(); const prev = dts.filter((x) => x < key).pop();
        const nse = nseSym(sym);
        c[nse] = round(ser[key]);
        if (prev && ser[prev]) r[nse] = round((ser[key] / ser[prev] - 1) * 100);
      });
      if (!Object.keys(c).length) { console.log('  ' + key + ': no Yahoo closes — skip'); continue; }
      data.dates[key] = { index: index, r: r, c: c, src: 'yahoo-fallback' };
      added++;
      console.log('  ' + key + ': Yahoo fallback — ' + Object.keys(c).length + ' holdings, Nifty 500 = ' + (index == null ? 'n/a' : index + '%'));
    }
  }

  if (added) {
    data.updated = iso(new Date());
    // stable key order (ascending dates) for clean diffs
    const ordered = {};
    Object.keys(data.dates).sort().forEach((k) => { ordered[k] = data.dates[k]; });
    data.dates = ordered;
    fs.writeFileSync(OUT, JSON.stringify(data));
    console.log('Wrote ' + OUT + ' (' + added + ' new date(s), ' + Object.keys(data.dates).length + ' total)');
  } else {
    console.log('No new trading days to add.');
  }
}

main().catch((e) => { console.error('non-fatal:', e && e.message); process.exit(0); });
