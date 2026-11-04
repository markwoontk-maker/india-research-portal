#!/usr/bin/env node
/*
 * refresh-wl-live.js — real-time Watchlist prices for the static site.
 *
 * The browser can't call Yahoo (CORS), and pushing to `main` more than ~2x/hour would hit
 * GitHub Pages' build limit. So this long-running process polls Yahoo through NSE hours and
 * force-pushes a single-commit `live-quotes` branch holding live.json:
 *
 *   { updated:"<ISO>", d:"YYYY-MM-DD", q:{ "<YAHOO_SYM>":[price, prevClose] } }
 *
 * The page reads it through the GitHub contents API (60s cache, CORS-ok). A side branch
 * triggers no Pages build or Actions run, and because every push replaces the one commit the
 * history never grows. It works from a throwaway bare repo in the temp folder, so it never
 * touches the main repo's working tree, index or object store. Prices only — no positions.
 *
 * Runs until 15:40 IST, then exits (task "India Research Portal Live Quotes", weekdays).
 * Pass --once for a single publish. Never throws; a failed pass just waits for the next one
 * (the page falls back to TradingView when this feed goes stale).
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const HTML = path.join(REPO, 'index.html');
const BARE = path.join(os.tmpdir(), 'irp-live-quotes.git');
const BRANCH = 'live-quotes';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const INTERVAL_MS = 120000;
const END_IST_MIN = 15 * 60 + 40;   // 15:40 IST
const MIN_SYMBOLS = 50;

const logDir = path.join(__dirname, 'logs');
const logFile = path.join(logDir, 'live-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.log');
function log(m) {
  const l = '[' + new Date().toTimeString().slice(0, 8) + '] ' + m;
  console.log(l);
  try { fs.mkdirSync(logDir, { recursive: true }); fs.appendFileSync(logFile, l + '\n'); } catch (e) { /* logging must never kill the loop */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => Math.round(x * 100) / 100;
function istNow() { return new Date(Date.now() + 19800000); }   // read with getUTC*
const istMinutes = () => { const t = istNow(); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const git = (args, opts) => execFileSync('git', args, Object.assign({ encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }, opts)).trim();

// Same universe as refresh-wl-quotes.js: watchlist defaults (all pipe alternatives) + NIFTY500.
function loadUniverse() {
  const html = fs.readFileSync(HTML, 'utf8');
  const syms = new Set(['^CRSLDX']);
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

function spark(symbols) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/spark?symbols=' + encodeURIComponent(symbols.join(',')) + '&range=1d&interval=1d';
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeout: 15000 }, (r) => {
      const ch = []; r.on('data', (c) => ch.push(c));
      r.on('end', () => { try { resolve(r.statusCode === 200 ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}); } catch (e) { resolve({}); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({}));
  });
}

async function fetchQuotes(uni) {
  const q = {}; let lastTs = 0;
  for (let i = 0; i < uni.length; i += 20) {
    const chunk = uni.slice(i, i + 20);
    const j = await spark(chunk);
    chunk.forEach((sym) => {
      const v = j[sym]; if (!v || !v.close || !v.timestamp) return;
      const p = v.close[v.close.length - 1], ts = v.timestamp[v.timestamp.length - 1], pc = v.chartPreviousClose;
      if (p == null || pc == null || !(pc > 0)) return;
      q[sym] = [round(p), round(pc)];
      if (ts > lastTs) lastTs = ts;
    });
    await sleep(120);
  }
  return { q, lastTs };
}

function ensureBare(remote) {
  if (!fs.existsSync(path.join(BARE, 'HEAD'))) git(['init', '--bare', '-q', BARE]);
  git(['--git-dir', BARE, 'config', 'gc.auto', '0']);
  return remote;
}

function publish(remote, json, stamp) {
  const gd = ['--git-dir', BARE];
  const blob = git([...gd, 'hash-object', '-w', '--stdin'], { input: json });
  const tree = git([...gd, 'mktree'], { input: '100644 blob ' + blob + '\tlive.json\n' });
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'IRP live quotes', GIT_AUTHOR_EMAIL: 'irp-live@users.noreply.github.com', GIT_COMMITTER_NAME: 'IRP live quotes', GIT_COMMITTER_EMAIL: 'irp-live@users.noreply.github.com' });
  const commit = git([...gd, 'commit-tree', tree, '-m', 'live quotes ' + stamp], { env });
  git([...gd, 'push', '--force', '-q', remote, commit + ':refs/heads/' + BRANCH]);
}

async function pass(uni, remote, state) {
  const { q, lastTs } = await fetchQuotes(uni);
  const n = Object.keys(q).length;
  if (n < MIN_SYMBOLS || !lastTs) { log('only ' + n + ' symbols - skipping this pass'); return; }
  // The session date comes from Yahoo's own timestamp, so a holiday can't pose as today.
  const d = new Date((lastTs + 19800) * 1000).toISOString().slice(0, 10);
  const key = JSON.stringify(q) + d;
  if (key === state.last) { log('prices unchanged - not pushing'); return; }
  const updated = new Date().toISOString();
  publish(remote, JSON.stringify({ updated, d, q }), updated);
  state.last = key;
  log('published ' + n + ' symbols for ' + d);
}

async function main() {
  const once = process.argv.includes('--once');
  const remote = git(['-C', REPO, 'remote', 'get-url', 'origin']);
  ensureBare(remote);
  const uni = loadUniverse();
  log('start: ' + uni.length + ' symbols' + (once ? ' (once)' : ', until 15:40 IST'));
  const state = { last: null };
  for (;;) {
    const t0 = Date.now();
    try { await pass(uni, remote, state); } catch (e) { log('pass failed: ' + String(e && e.message).split('\n')[0]); }
    if (once || istMinutes() >= END_IST_MIN) break;
    await sleep(Math.max(5000, INTERVAL_MS - (Date.now() - t0)));
  }
  log('done');
}

main().catch((e) => { log('fatal (non-throwing exit): ' + (e && e.message)); process.exit(0); });
