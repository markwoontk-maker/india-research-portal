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
    if (eq.status !== 200) { console.log(key + ': no bhavcopy (status ' + eq.status + ') — holiday/weekend, skip'); continue; }
    const eqp = parseEquities(eq.body);
    if (!Object.keys(eqp.r).length) { console.log(key + ': empty bhavcopy, skip'); continue; }

    const idxRes = await get('https://nsearchives.nseindia.com/content/indices/ind_close_all_' + ddmmyyyy(d) + '.csv');
    const index = idxRes.status === 200 ? parseIndex(idxRes.body) : null;

    data.dates[key] = { index: index, r: eqp.r, c: eqp.c };
    added++;
    console.log(key + ': added ' + Object.keys(eqp.r).length + ' stocks, Nifty 500 = ' + (index == null ? 'n/a' : index + '%'));
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
