// Company tab: broker FY26-FY29 revenue, EBITDA and EPS estimates -> data/estimates.json.
//
//   node scripts/estimates/build-estimates.js              daily: new notes, budget EST_BUDGET (default 1200 s)
//   node scripts/estimates/build-estimates.js --backfill   same work list, no default budget (see backfill.ps1)
//   node scripts/estimates/build-estimates.js --count      prints what is left to read, mines nothing
//   node scripts/estimates/build-estimates.js --aggregate  recomputes averages and growth from stored records
//   node scripts/estimates/build-estimates.js --prices     writes the day's prices for the P/E columns (data/estimate_prices.json)
//   node scripts/estimates/build-estimates.js --snapshot   adds today's average estimates to data/estimates_hist.json
//   node scripts/estimates/build-estimates.js --seed-events  one-off: rating changes from past notes (titles + pdfdata hints)
//   EST_ONLY="Maruti Suzuki;HDFC Bank"                     limits a run to those companies
//
// One company-broker pair = the newest note from that broker on that company within the last
// EST_MAX_AGE_DAYS (185). pdftotext finds the pages that look like a forecast table, pymupdf
// renders them, and headless claude reads the images per docs/estimates-miner-prompt.md. A
// note with no table falls back to that broker's next-newest note (up to 3). A broker's newer
// note replaces its older figures. Every finished pair is written at once, so a run can stop
// anywhere and resume. Exit code 3 = stopped by a claude limit or auth failure, for backfill.ps1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const L = require('./lib');
const { FOLDER_ALIAS, NON_COMPANY_RE, norm } = require('../earnings/build-earnings.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'estimates.json');
const PRICES = path.join(ROOT, 'data', 'estimate_prices.json');
const HIST = path.join(ROOT, 'data', 'estimates_hist.json');
const RC_PROMPT = path.join(ROOT, 'docs', 'rating-change-prompt.md');
const WORK = path.join(ROOT, 'scripts', '.estimates-work');
const STATE = path.join(WORK, 'state.json');
// The run writes to this git-ignored copy after every note and publishes to data/estimates.json
// only when it ends. Every other local pusher runs `git pull --rebase --autostash`; a tracked file
// rewritten every few seconds could change under that stash, the pop would fail, and any other
// uncommitted work in the checkout would be left stranded in the stash.
const LIVE = path.join(WORK, 'estimates.live.json');
const AUDIT = path.join(WORK, 'audit.jsonl');
const PROMPT = path.join(ROOT, 'docs', 'estimates-miner-prompt.md');
const CLAUDE = process.env.CLAUDE_EXE || 'C:\\Users\\admin\\.local\\bin\\claude.exe';
const UV = process.env.UV_EXE || 'C:\\Users\\admin\\.local\\bin\\uv.exe';
const PDFTOTEXT = process.env.PDFTOTEXT_EXE || ['C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe', 'C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe'].find(p => fs.existsSync(p)) || 'pdftotext';
const MODEL = process.env.EST_MODEL || 'sonnet';
const CHECK_MODEL = process.env.EST_CHECK_MODEL || 'opus';
const CALL_TIMEOUT_S = 360;
const MAX_AGE_DAYS = +(process.env.EST_MAX_AGE_DAYS || 185);
const MAX_PAGES = 3, MAX_TRIES = 3;
// Run claude outside the repo so each of ~1,500 calls doesn't load the project's long CLAUDE.md, and
// keep each call to a single message: the images go inline, with no tools and a short system prompt.
// Measured on one note: same figures, 8 s not 18 s, about a third less usage than reading images
// with the Read tool, which re-sends the conversation on every turn. The first full run hit the
// subscription's session limit after 185 notes.
const SYSTEM_PROMPT = 'You read broker research notes and return one JSON object only, exactly as the user message specifies.';
const CALL_CWD = path.join(os.tmpdir(), 'irp-estimates');
const FATAL_RE = /OAuth|Failed to authenticate|Not logged in|session limit|hit your|usage limit|rate limit/i;

const log = (...a) => console.log('[build-estimates]', ...a);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const audit = o => { try { fs.appendFileSync(AUDIT, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); } catch (e) {} };
const yymmdd = d => d.toISOString().slice(2, 10).replace(/-/g, '');
const floorDate = () => yymmdd(new Date(Date.now() - MAX_AGE_DAYS * 864e5));
const pairId = (name, broker) => name + '|' + broker;

// ---------- universe ----------
function loadRows() {
  const E = readJSON(path.join(ROOT, 'data', 'earnings.json'), null);
  if (!E || !Array.isArray(E.companies)) return null;
  const S = readJSON(path.join(ROOT, 'data', 'sectors.json'), {}) || {};
  const q = S.q || {};
  const rows = {};
  for (const c of E.companies) rows[c.name] = Object.assign(c, { _mc: (c.sym && q[c.sym] && q[c.sym].mc) || c.mcap || 0, _px: (c.sym && q[c.sym] && q[c.sym].p) || c.price || 0, _pxCur: (c.sym && q[c.sym] && q[c.sym].p) ? 'INR' : (c.priceCur || 'INR') });
  return rows;
}
function makeFolderToRow(rows) {
  const byNorm = {};
  for (const c of Object.values(rows)) for (const n of [c.name, c.sheetName, c.formerName]) if (n) byNorm[norm(n)] = c.name;
  return f => {
    if (FOLDER_ALIAS[f] && rows[FOLDER_ALIAS[f]]) return FOLDER_ALIAS[f];
    if (rows[f]) return f;
    if (NON_COMPANY_RE.test(f)) return null;
    return byNorm[norm(f)] || null;
  };
}
function notesByPair(rows) {
  const PDFMAP = readJSON(path.join(ROOT, 'data', 'pdfmap.json'), {});
  const folderToRow = makeFolderToRow(rows);
  const floor = floorDate(), pairs = {};
  for (const [key, p] of Object.entries(PDFMAP)) {
    const [broker, date, folder, title] = key.split('|');
    if (!broker || !date || !folder || broker === 'Unknown' || date < floor) continue;
    const name = folderToRow(folder);
    if (!name) continue;
    const b = L.canonBroker(broker);
    ((pairs[name] = pairs[name] || {})[b] = pairs[name][b] || []).push({ key, path: p, date, title: title || '' });
  }
  for (const co of Object.values(pairs)) for (const list of Object.values(co)) list.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return pairs;
}

// ---------- output ----------
function loadOut() {
  const o = readJSON(fs.existsSync(LIVE) ? LIVE : OUT, null);
  return o && o.companies ? o : { updated: null, companies: {} };
}
function refreshCompany(out, name, row, notes, state) {
  const prev = out.companies[name] || {};
  const brokers = prev.brokers || {};
  const floor = floorDate();
  for (const [b, rec] of Object.entries(brokers)) if (rec.date < floor) delete brokers[b];   // too old to average in
  const pending = [], noTable = [];
  for (const [b, list] of Object.entries(notes || {})) {
    const next = L.nextNote(list, state.tried[pairId(name, b)], brokers[b], MAX_TRIES);
    if (brokers[b]) continue;
    if (next) pending.push(b); else noTable.push(b);
  }
  const agg = L.aggregate(brokers, row);
  const tps = prev.tps || {};
  for (const [b, t] of Object.entries(tps)) if (t.date < floor) delete tps[b];
  const ta = L.aggregateTp(tps);
  const ev = (prev.ev || []).slice().sort((a, b) => a.d.localeCompare(b.d) || a.b.localeCompare(b.b));
  out.companies[name] = { ev, tps, tpAvg: ta.avg, tpN: ta.n, tpCur: ta.cur, unit: agg.unit, avg: agg.avg, n: agg.n, growth: agg.growth, nm: agg.nm, used: agg.used, excluded: agg.excluded, brokers, pending: pending.sort(), noTable: noTable.sort() };
}
function writeOut(out, rows, pairs, state) {
  const names = Object.keys(rows).sort();
  let withEst = 0, read = 0, left = 0;
  for (const name of names) {
    refreshCompany(out, name, rows[name], pairs[name], state);
    const c = out.companies[name];
    if (Object.keys(c.brokers).length) withEst++;
    read += Object.keys(c.brokers).length + c.noTable.length;
    left += c.pending.length;
  }
  out.updated = new Date().toISOString().slice(0, 10);
  out.from = floorDate();
  out.progress = { companies: names.length, withEstimates: withEst, pairsRead: read, pairsLeft: left };
  const head = ['updated', 'from', 'progress'].map(k => `${JSON.stringify(k)}:${JSON.stringify(out[k])}`).join(',');
  const lines = names.map(n => JSON.stringify(n) + ':' + JSON.stringify(out.companies[n]));
  const tmp = LIVE + '.tmp';
  fs.writeFileSync(tmp, `{${head},"companies":{\n${lines.join(',\n')}\n}}\n`);
  fs.renameSync(tmp, LIVE);
  fs.writeFileSync(STATE, JSON.stringify(state));
}
function publish() {
  const tmp = OUT + '.tmp';
  fs.copyFileSync(LIVE, tmp);
  fs.renameSync(tmp, OUT);
}

// ---------- reading one note ----------
// Text per PDF page. Asked for one page at a time because splitting a whole-document dump on
// form feeds gives wrong page numbers: CLSA notes carry extra form feeds inside their pages, so
// the miner was shown the page after the forecast table. The form-feed count is only an upper
// bound on the page count: this pdftotext returns empty text past the last page, not an error.
const MAX_SCAN_PAGES = 150;
function pdfPages(p) {
  const run = args => execFileSync(PDFTOTEXT, ['-layout', ...args, p, '-'], { maxBuffer: 1 << 28, timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  try {
    const bound = Math.min(run([]).split('\f').length - 1, MAX_SCAN_PAGES);
    const pages = [];
    for (let i = 1; i <= bound; i++) pages.push(run(['-f', String(i), '-l', String(i)]));
    return pages;
  } catch (e) { return null; }
}
function renderPages(note, dir, pages) {
  return execFileSync(UV, ['run', '--quiet', '--python', '3.12', '--with', 'pymupdf', 'python', '-I', path.join(__dirname, 'render_note.py'), dir, note.path, ...pages.map(String)],
    { timeout: 120000, maxBuffer: 8 << 20 }).toString().split(/\r?\n/).filter(Boolean);
}
function runClaude(message, model) {
  return new Promise(resolve => {
    fs.mkdirSync(CALL_CWD, { recursive: true });
    const p = spawn(CLAUDE, ['-p', '--model', model, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--system-prompt', SYSTEM_PROMPT,
      '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'], { cwd: CALL_CWD, windowsHide: true });
    let raw = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch (e) {} }, CALL_TIMEOUT_S * 1000);
    p.stdout.on('data', d => raw += d); p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); resolve({ out: '', err: String(e) }); });
    p.on('close', () => {
      clearTimeout(timer);
      // The reply is the "result" line of the stream; a usage limit arrives there as an error result.
      let res = null;
      for (const line of raw.split(/\r?\n/).reverse()) { try { const j = JSON.parse(line); if (j.type === 'result') { res = j; break; } } catch (e) {} }
      if (!res) return resolve({ out: '', err: (err + ' ' + raw.slice(-400)).trim() });
      resolve(res.is_error ? { out: '', err: String(res.result || 'error result') } : { out: String(res.result || ''), err });
    });
    p.stdin.end(message);
  });
}
function parseResult(txt) {
  if (!txt) return null;
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(txt.slice(s, e + 1)); } catch (err) { return null; }
}
const issuesOf = (r, row) => (r ? L.checkResult(r, row) : []);

// Returns {res:'ok'|'none'|'failed'|'fatal', rec?, why?}
async function mineNote(name, row, broker, note, slot, needTp) {
  if (!fs.existsSync(note.path)) return { res: 'none', why: 'file missing' };
  const texts = pdfPages(note.path);
  if (!texts) return { res: 'failed', why: 'pdftotext failed' };
  const fc = L.pickPages(texts, MAX_PAGES);
  if (!fc.length && !needTp) return { res: 'none', why: 'no forecast table in the text' };
  // Page 1 always goes in: that's where the target price and rating are printed.
  const pages = [...new Set([1, ...fc])].sort((a, b) => a - b);
  const dir = path.join(WORK, 'w' + slot);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  let imgs = [];
  try { imgs = renderPages(note, dir, pages); } catch (e) { return { res: 'failed', why: 'render: ' + String(e.message).slice(0, 100) }; }
  if (!imgs.length) return { res: 'failed', why: 'render gave no images' };
  const item = { company: name, sector: row.sector || null, broker, date: note.date, metrics: row.metrics || null, unit: row.unit || null, revUnit: row.revUnit || null, basis: row.basis || null, priceCurrency: row._pxCur === 'US$' ? 'US$' : undefined };
  const pageNos = imgs.map(p => path.basename(p).replace(/\D/g, ''));
  const pf = JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'text', text: [fs.readFileSync(PROMPT, 'utf8'), '\n=== WORK ITEM ===\n', JSON.stringify(item, null, 1), '\n\n=== PAGES ===\nThe attached images are PDF pages ', pageNos.join(', '), ', in that order.\n'].join('') },
    ...imgs.map(p => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(p).toString('base64') } })),
  ] } }) + '\n';
  const first = await runClaude(pf, MODEL);
  let r = parseResult(first.out), model = MODEL, issues = issuesOf(r, row);
  if (!r && FATAL_RE.test(first.out.slice(0, 400) + first.err.slice(0, 400))) return { res: 'fatal', why: (first.out + first.err).trim().slice(0, 160) };
  if (!r || issues.length) {                                // second opinion on a stronger model
    const second = await runClaude(pf, CHECK_MODEL);
    const r2 = parseResult(second.out);
    if (r2) {
      const issues2 = issuesOf(r2, row);
      if (!r || issues2.length <= issues.length) { r = r2; issues = issues2; model = CHECK_MODEL; }
    }
  }
  if (!r) return { res: 'failed', why: 'no JSON back' };
  const tp = L.tpOf(r, note);
  const tpIssue = issues.filter(i => /target price/.test(i));
  issues = issues.filter(i => !/target price/.test(i));
  if (tp) { tp.page = 1; if (tpIssue.length) tp.check = tpIssue.join('; ').slice(0, 160); }
  if (r.found === false || !L.hasNumbers(r)) return { res: 'none', tp, why: String(r.reason || 'no usable table').slice(0, 160) };
  const extra = { model, mined: new Date().toISOString().slice(0, 10) };
  if (issues.length) extra.check = issues.join('; ').slice(0, 240);
  if (r.calcNote) extra.calcNote = String(r.calcNote).slice(0, 160);
  return { res: 'ok', rec: L.toRecord(r, note, extra), tp };
}
const lineCount = rec => (rec.rev ? 1 : 0) + (rec.ebitda ? 1 : 0) + (rec.eps ? 1 : 0);

// ---------- estimate history (Company tab chart overlay) ----------
// One snapshot a day of each company's average FY27-FY29 revenue, EBITDA and EPS, kept as change
// points only ([day, value] when the average moves), so the file grows with revisions, not days.
// Day = days since 1970-01-01, as in data/px. Starts 2026-11-13: there is no earlier history.
function writeSnapshot() {
  const E = readJSON(OUT, null);
  if (!E || !E.companies) { log('no estimates to snapshot.'); return; }
  const H = readJSON(HIST, null) || { start: new Date().toISOString().slice(0, 10), c: {} };
  const day = Math.floor(Date.now() / 864e5);
  let moved = 0;
  for (const [name, e] of Object.entries(E.companies)) {
    for (const m of ['rev', 'ebitda', 'eps']) {
      const avg = e.avg && e.avg[m]; if (!avg) continue;
      for (const fy of L.SHOW_FYS) {
        const v = avg[fy]; if (v == null) continue;
        const c = H.c[name] = H.c[name] || {}, s = c[m] = c[m] || {};
        if (s.u && s.u !== e.unit[m]) { for (const k of Object.keys(s)) delete s[k]; }   // unit switched: restart the line
        s.u = e.unit[m];
        const pts = s[fy] = s[fy] || [], last = pts[pts.length - 1];
        if (last && last[0] === day) { if (last[1] !== v) { last[1] = v; moved++; } }
        else if (!last || last[1] !== v) { pts.push([day, v]); moved++; }
      }
    }
  }
  H.updated = new Date().toISOString();
  const names = Object.keys(H.c).sort();
  const tmp = HIST + '.tmp';
  fs.writeFileSync(tmp, `{"start":${JSON.stringify(H.start)},"updated":${JSON.stringify(H.updated)},"c":{\n${names.map(n => JSON.stringify(n) + ':' + JSON.stringify(H.c[n])).join(',\n')}\n}}\n`);
  fs.renameSync(tmp, HIST);
  log(`estimate snapshot: ${moved} value(s) new or changed, ${names.length} companies.`);
}

// ---------- one-off: rating changes in past notes ----------
// Candidates: notes whose title flags a rating move, or whose regex-read ratings (pdfdata.json)
// change. Each is checked on its first page by claude, since titles also say "earnings upgrade".
const RC_TITLE = /upgrad|downgrad|ratingchange|moveto|to(buy|overweight|outperform|neutral|hold|sell|underweight|reduce|add|ow|uw|ew)(from|$)/;
async function seedEvents(rows, out, pairs, state) {
  const PDFMAP = readJSON(path.join(ROOT, 'data', 'pdfmap.json'), {}), PD = readJSON(path.join(ROOT, 'data', 'pdfdata.json'), {});
  const folderToRow = makeFolderToRow(rows), cand = new Map(), seq = {};
  for (const [key, p] of Object.entries(PDFMAP)) {
    const [broker, date, folder, title] = key.split('|');
    if (!broker || broker === 'Unknown' || !date || date < '260101') continue;
    const name = folderToRow(folder); if (!name) continue;
    const item = { key, path: p, date, title: title || '', name, broker: L.canonBroker(broker) };
    const x = PD[key];
    if (RC_TITLE.test(item.title)) cand.set(key, item);
    if (x && L.ratingRank(x.currCall) != null && L.ratingRank(x.prevCall) != null && L.ratingRank(x.currCall) !== L.ratingRank(x.prevCall)) cand.set(key, item);
    if (x && L.ratingRank(x.currCall) != null) (seq[name + '|' + item.broker] = seq[name + '|' + item.broker] || []).push([date, L.ratingRank(x.currCall), item]);
  }
  for (const s of Object.values(seq)) { s.sort((a, b) => a[0].localeCompare(b[0])); for (let i = 1; i < s.length; i++) if (s[i][1] !== s[i - 1][1]) cand.set(s[i][2].key, s[i][2]); }
  state.evSeen = state.evSeen || {};
  const todo = [...cand.values()].filter(c => !state.evSeen[c.key]).sort((a, b) => a.date.localeCompare(b.date));
  log(`${cand.size} candidate note(s), ${todo.length} still to check.`);
  const LOCK = path.join(WORK, 'run.lock');
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: new Date().toISOString(), mode: '--seed-events' }));
  let cursor = 0, found = 0, stop = false;
  const prompt = fs.readFileSync(RC_PROMPT, 'utf8');
  async function one(c, slot) {
    const dir = path.join(WORK, 'r' + slot);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    let imgs = [];
    try { imgs = renderPages(c, dir, [1]); } catch (e) { return; }
    if (!imgs.length) { state.evSeen[c.key] = 1; return; }
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'text', text: prompt + '\n=== NOTE ===\n' + JSON.stringify({ company: c.name, broker: c.broker, date: c.date, title: c.title }) },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(imgs[0]).toString('base64') } } ] } }) + '\n';
    const r = await runClaude(msg, MODEL);
    const j = parseResult(r.out);
    if (!j) { if (FATAL_RE.test(r.err)) { log('claude unavailable: ' + r.err.slice(0, 120)); stop = true; } return; }
    state.evSeen[c.key] = 1;
    if (j.changed !== true) return;
    let evt = L.ratingEvent(j.previousRating, j.rating, c, c.broker);
    if (!evt && !j.previousRating && L.ratingRank(j.rating) != null && /upgrad|downgrad/.test(c.title))   // title gives the direction
      evt = { d: c.date, b: c.broker, from: null, to: j.rating, dir: /upgrad/.test(c.title) ? 'up' : 'down', key: c.key };
    if (!evt) return;
    const co = out.companies[c.name] = out.companies[c.name] || { brokers: {} };
    co.ev = co.ev || [];
    if (!co.ev.some(x => x.key === evt.key && x.b === evt.b)) { co.ev.push(evt); found++; log(`${c.name} / ${c.broker} ${c.date}: ${evt.dir}grade ${evt.from || '?'} -> ${evt.to}`); }
  }
  await Promise.all([0, 1].map(async slot => { while (!stop && cursor < todo.length) { const c = todo[cursor++]; try { await one(c, slot); } catch (e) { log(c.key + ': ' + e.message); } } }));
  writeOut(out, rows, pairs, state); publish();
  try { fs.unlinkSync(LOCK); } catch (e) {}
  log(`seed: ${found} rating change(s) added; ${todo.length - cursor} candidate(s) left for a later run.`);
  if (stop) process.exitCode = 3;
}

// The P/E columns divide these prices by the average EPS. Written once a day (daily-refresh.ps1,
// after the earnings miner) so P/Es hold still between runs, whatever the intraday price feeds do.
// Needs no lock: it only reads the estimates file and replaces its own file in one step.
function writePrices(rows) {
  const S = readJSON(path.join(ROOT, 'data', 'sectors.json'), {}) || {};
  const px = {}, cur = {};
  for (const name of Object.keys(rows).sort()) if (rows[name]._px > 0) { px[name] = rows[name]._px; if (rows[name]._pxCur !== 'INR') cur[name] = rows[name]._pxCur; }
  const fx = (S.desk && S.desk['INR=X'] && S.desk['INR=X'].p) || null;
  const tmp = PRICES + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ asOf: S.asOf || new Date().toISOString().slice(0, 10), updated: new Date().toISOString(), fx, cur, px }));
  fs.renameSync(tmp, PRICES);
  log(`prices for ${Object.keys(px).length}/${Object.keys(rows).length} companies, as of ${S.asOf || 'today'}.`);
}

// ---------- main ----------
(async function main() {
  const mode = process.argv[2] || '';
  const rows = loadRows();
  if (!rows) { log('data/earnings.json missing or invalid - skipping.'); return; }
  if (mode === '--prices') { writePrices(rows); return; }
  if (mode === '--snapshot') { writeSnapshot(); return; }
  fs.mkdirSync(WORK, { recursive: true });
  const state = Object.assign({ tried: {} }, readJSON(STATE, {}));
  const out = loadOut();
  const pairs = notesByPair(rows);
  const only = process.env.EST_ONLY ? new Set(process.env.EST_ONLY.split(';')) : null;

  // Biggest companies first, so the names you look at most fill in earliest.
  const queue = [];
  for (const name of Object.keys(pairs).sort((a, b) => rows[b]._mc - rows[a]._mc || a.localeCompare(b))) {
    if (only && !only.has(name)) continue;
    for (const broker of Object.keys(pairs[name]).sort()) {
      const have = ((out.companies[name] || {}).brokers || {})[broker];
      if (L.nextNote(pairs[name][broker], state.tried[pairId(name, broker)], have, MAX_TRIES)) queue.push({ name, broker });
    }
  }
  if (mode === '--count') { log(`${queue.length} company-broker pair(s) left to read; first: ${queue.slice(0, 5).map(q => q.name + '/' + q.broker).join(', ')}`); console.log('LEFT=' + queue.length); return; }

  const LOCK = path.join(WORK, 'run.lock');
  const held = readJSON(LOCK, null);
  let alive = false;
  if (held && held.pid && held.pid !== process.pid) { try { process.kill(held.pid, 0); alive = true; } catch (e) {} }
  if (alive) { log(`another estimates run (pid ${held.pid}, since ${held.t}) is in progress - skipping.`); return; }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: new Date().toISOString(), mode }));
  process.on('exit', () => { try { if ((readJSON(LOCK, {}) || {}).pid === process.pid) fs.unlinkSync(LOCK); } catch (e) {} });

  if (mode === '--seed-events') { await seedEvents(rows, out, pairs, state); return; }
  if (mode === '--aggregate') { writeOut(out, rows, pairs, state); publish(); log('recomputed.', JSON.stringify(out.progress)); return; }
  if (!fs.existsSync(CLAUDE)) { log('claude CLI not found - skipping.'); return; }

  const budgetS = +(process.env.EST_BUDGET || (mode === '--backfill' ? 0 : 1200));
  const deadline = budgetS ? Date.now() + budgetS * 1000 : Infinity;
  const workers = +(process.env.EST_WORKERS || 2);   // leaves room in the subscription for the user's own sessions
  log(`${queue.length} pair(s) to read, ${workers} workers, budget ${budgetS || 'none'}.`);
  let cursor = 0, done = 0, failsInRow = 0, stop = false, fatal = false;

  async function onePair(job, slot) {
    const { name, broker } = job, row = rows[name], list = pairs[name][broker], id = pairId(name, broker);
    const co = out.companies[name] = out.companies[name] || { brokers: {} };
    co.brokers = co.brokers || {};
    co.tps = co.tps || {};
    for (;;) {
      if (stop || Date.now() >= deadline) return;
      const tried = state.tried[id] = state.tried[id] || [];
      const note = L.nextNote(list, tried, co.brokers[broker], MAX_TRIES);
      if (!note) return;
      const t0 = Date.now();
      // The TP comes from the newest note that prints one, which may be newer than the newest forecast table.
      const needTp = !co.tps[broker] || note.date > co.tps[broker].date;
      const m = await mineNote(name, row, broker, note, slot, needTp);
      const secs = Math.round((Date.now() - t0) / 1000);
      if (m.res === 'fatal') { log('claude unavailable: ' + m.why); stop = true; fatal = true; return; }
      if (m.res === 'failed') {
        audit({ type: 'failed', name, broker, key: note.key, why: m.why });
        log(`${name} / ${broker} ${note.date}: FAILED ${m.why} (${secs}s)`);
        if (++failsInRow >= 6) { log('6 failures in a row - stopping.'); stop = true; }
        return;                                            // not marked tried: the next run retries it
      }
      failsInRow = 0;
      tried.push(note.key);
      // A rating change: the note's own "from" rating, else the rating this broker had on our last read.
      if (m.tp && m.tp.rating && needTp) {
        const before = co.tps[broker], from = m.tp.prev || (before && before.date < note.date ? before.rating : null);
        const evt = L.ratingEvent(from, m.tp.rating, note, broker);
        co.ev = co.ev || [];
        if (evt && !co.ev.some(x => x.key === evt.key && x.b === broker)) { co.ev.push(evt); log(`${name} / ${broker} ${note.date}: rating ${evt.dir}grade ${from} -> ${m.tp.rating}`); }
      }
      if (m.tp && needTp) co.tps[broker] = m.tp;
      const tpLog = m.tp ? ` [TP ${m.tp.tp} ${m.tp.rating || ''}${m.tp.check ? ' CHECK ' + m.tp.check : ''}]` : '';
      if (m.res === 'none') {
        log(`${name} / ${broker} ${note.date}: no table (${m.why})${tpLog} (${secs}s)`);
        audit({ type: 'none', name, broker, key: note.key, why: m.why });
        writeOut(out, rows, pairs, state);
        continue;                                          // try this broker's next-newest note
      }
      const had = co.brokers[broker];
      if (!had || lineCount(m.rec) >= lineCount(had)) co.brokers[broker] = m.rec;
      done++;
      log(`${name} / ${broker} ${note.date}: ok p${m.rec.page}${tpLog}${m.rec.model !== MODEL ? ' [' + m.rec.model + ']' : ''}${m.rec.check ? ' CHECK ' + m.rec.check : ''} (${secs}s)`);
      if (m.rec.check) audit({ type: 'check', name, broker, key: note.key, check: m.rec.check });
      writeOut(out, rows, pairs, state);
      return;
    }
  }
  async function worker(slot) {
    while (!stop && cursor < queue.length && Date.now() < deadline) {
      const job = queue[cursor++];
      try { await onePair(job, slot); } catch (e) { log(`${job.name} / ${job.broker}: error ${e && e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
  writeOut(out, rows, pairs, state);
  publish();
  log(`read ${done} pair(s) this run; ${out.progress.withEstimates}/${out.progress.companies} companies have estimates; ${out.progress.pairsLeft} pair(s) left.`);
  for (let i = 0; i < workers; i++) try { fs.rmSync(path.join(WORK, 'w' + i), { recursive: true, force: true }); } catch (e) {}
  if (fatal) process.exitCode = 3;
})().catch(e => { log('error: ' + (e && e.stack || e)); });
