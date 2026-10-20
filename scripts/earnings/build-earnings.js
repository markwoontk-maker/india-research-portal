// Earnings tab refresher: fill data/earnings.json from broker post-results notes.
//
//   node scripts/earnings/build-earnings.js             daily: current + previous season, budgeted
//   node scripts/earnings/build-earnings.js --backfill  every season in the library, no budget, parallel
//   node scripts/earnings/build-earnings.js --list      only write work items to scripts/.earnings-work/
//   node scripts/earnings/build-earnings.js --merge     only merge scripts/.earnings-work/*.result.json
//
// Daily mode is step 8e2 of scripts/daily-refresh.ps1, i.e. AFTER the daily-return step
// (refresh-wl-returns) and serial; that script commits data/earnings.json.
//
// Work item = (company, season) with >=1 post-results note in data/pdfmap.json. Mined
// when the quarter has no PDF-sourced figures yet (workbook-seeded quarters are
// re-derived from the PDFs: the user asked for broker-attributed comments and does not
// trust the workbook's colour coding), or when new notes arrived (max MAX_RUNS passes).
// Companies not yet in the tab are added. Each item: pages rendered to PNG (pymupdf),
// headless claude reads them per docs/earnings-miner-prompt.md and returns ONE primary
// report's actual / year-ago / prior-quarter revenue + EBITDA (consistency), the
// consensus call, explanations and - for the company's latest season - the Outlook.
// Accuracy guard: the computed YoY must agree with the YoY the report itself states;
// a mismatch is re-run on a stronger model and flagged if it persists.
// Never throws; always exits 0.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'earnings.json');
const WORK = path.join(ROOT, 'scripts', '.earnings-work');
const AUDIT = path.join(WORK, 'audit.jsonl');
const PROMPT = path.join(ROOT, 'docs', 'earnings-miner-prompt.md');
const CLAUDE = process.env.CLAUDE_EXE || 'C:\\Users\\admin\\.local\\bin\\claude.exe';
const UV = process.env.UV_EXE || 'C:\\Users\\admin\\.local\\bin\\uv.exe';
const MODEL = process.env.EARN_MODEL || 'sonnet';
const CHECK_MODEL = process.env.EARN_CHECK_MODEL || 'opus';
const CALL_TIMEOUT_S = 480;
const MAX_FILES = 3, PAGES = 5, MAX_RUNS = 2;

const log = (...a) => console.log('[build-earnings]', ...a);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const audit = o => { try { fs.appendFileSync(AUDIT, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); } catch (e) {} };

// ---------- quarter helpers (Indian FY: 1Q = Apr-Jun) ----------
// Results for a quarter land ~2-10 weeks after it ends.
function quarterForReport(yymmdd) {
  const yy = +yymmdd.slice(0, 2), m = +yymmdd.slice(2, 4), d = +yymmdd.slice(4, 6);
  const md = m * 100 + d;
  if (md >= 710 && md <= 915) return `1Q${yy + 1}`;
  if (md >= 1007 && md <= 1215) return `2Q${yy + 1}`;
  if (md >= 107 && md <= 315) return `3Q${yy}`;
  if (md >= 410 && md <= 615) return `4Q${yy}`;
  return null;
}
const qOrder = q => +q.slice(2) * 4 + +q[0];   // linear quarter index
const qFrom = i => { const y = Math.floor((i - 1) / 4), n = i - y * 4; return `${n}Q${String(y).padStart(2, '0')}`; };
const yearAgo = q => qFrom(qOrder(q) - 4);
const prevQ = q => qFrom(qOrder(q) - 1);

const RESULTS_RE = /result|qtr|quarter|[1-4]q|q[1-4]|firstcut|firsttake|first(cut|take)|beat|miss|inline|review|print|earnings|ebitda|ppop|\bnii|vnb|\bape|(jun|sep|dec|mar)q|strongquarter|weakquarter|decentquarter|goodquarter|softquarter|steadyquarter/;
const NOT_RESULTS_RE = /preview|businessupdate|operationalupdate|tradingupdate|preqtr|preq|quarterlyupdate|tradingstatement|monthly|investorday|analystmeet|ceomeeting|productionupdate|volumeupdate|presalesupdate/;

// Titles miss many results notes ("Good show in tough times"), so a note whose title
// doesn't match is checked on its text: pages 1-2 must name the season's quarter AND talk
// about results. Verdicts are cached by pdfmap key (scripts/.earnings-work/classify.json).
const CLASSIFY = path.join(WORK, 'classify.json');
const Q_TEXT = {
  1: n => new RegExp(`\\b(1Q ?F?Y?${n}|Q1 ?F?Y?${n}|1QF${n}|Jun[-' ]?(${n - 1}|20${n - 1})\\b|June[- ]quarter|Jun[- ]?(Q|qtr|quarter)\\b)`, 'i'),
  2: n => new RegExp(`\\b(2Q ?F?Y?${n}|Q2 ?F?Y?${n}|2QF${n}|Sep[-' ]?(${n - 1}|20${n - 1})\\b|Sept?(ember)?[- ]quarter|Sep[- ]?(Q|qtr|quarter)\\b)`, 'i'),
  3: n => new RegExp(`\\b(3Q ?F?Y?${n}|Q3 ?F?Y?${n}|3QF${n}|Dec[-' ]?(${n - 1}|20${n - 1})\\b|Dec(ember)?[- ]quarter|Dec[- ]?(Q|qtr|quarter)\\b)`, 'i'),
  4: n => new RegExp(`\\b(4Q ?F?Y?${n}|Q4 ?F?Y?${n}|4QF${n}|Mar[-' ]?(${n}|20${n})\\b|March[- ]quarter|Mar[- ]?(Q|qtr|quarter)\\b)`, 'i'),
};
const RESULT_WORDS = /\b(results?|reported|revenues?|EBITDA|PPOP|NII|PAT|net profit|beat|miss(ed)?|in[- ]line|above (our|consensus)|below (our|consensus))\b/i;
let classifyCache = null;
function textLooksLikeResults(key, pdfPath, quarter) {
  if (!classifyCache) classifyCache = readJSON(CLASSIFY, {});
  const ck = key + '#' + quarter;
  if (ck in classifyCache) return classifyCache[ck];
  let ok = false;
  try {
    const t = execFileSync('pdftotext', ['-l', '2', pdfPath, '-'], { maxBuffer: 16 << 20, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const hits = (t.match(new RegExp(RESULT_WORDS.source, 'gi')) || []).length;
    ok = Q_TEXT[+quarter[0]](+quarter.slice(2)).test(t) && hits >= 3;
  } catch (e) { ok = false; }
  classifyCache[ck] = ok;
  return ok;
}
function saveClassify() { if (classifyCache) try { fs.writeFileSync(CLASSIFY, JSON.stringify(classifyCache)); } catch (e) {} }

const norm = s => String(s || '').toLowerCase().replace(/\[.*?\]|\(.*?\)/g, ' ')
  .replace(/\b(ltd|limited|the|india|co|company|corporation|corp|industries|of)\b/g, ' ').replace(/[^a-z0-9]/g, '');
// Library folders that hold the same company under another name.
const FOLDER_ALIAS = {
  'HDFC Asset Management': 'HDFC AMC', 'ICICI Prudential Asset Management': 'ICICI Prudential AMC',
  'ICICI Prudential Asset Management Company Limited': 'ICICI Prudential AMC', 'ICICI Prudential Life Insurance': 'ICICI Prudential Life',
  'ICICI Life Insurance': 'ICICI Prudential Life', 'Groww': "Billionbrains Garage Ventures ('Groww')", 'Canfin': 'Can Fin Homes',
  'Sterlite Tech [SOTL IN]': 'Sterlite Tech', 'Tata Comm': 'Tata Communications', 'GRAVITA': 'Gravita India', 'TCS': 'Tata Consultancy Services',
};

// ---------- work list ----------
function buildWorkList(E, { allSeasons }) {
  const PDFMAP = readJSON(path.join(ROOT, 'data', 'pdfmap.json'), {});
  const COMPANIES = readJSON(path.join(ROOT, 'data', 'companies.json'), {});
  const rows = Object.fromEntries(E.companies.map(c => [c.name, c]));
  const byNorm = {};
  for (const c of E.companies) for (const n of [c.name, c.sheetName]) if (n) byNorm[norm(n)] = c.name;
  const folderToRow = folder => {
    if (FOLDER_ALIAS[folder]) return FOLDER_ALIAS[folder];
    if (rows[folder]) return folder;
    const k = norm(folder);
    if (byNorm[k]) return byNorm[k];
    if (COMPANIES[folder] && !/^India\b/.test(folder)) return folder;   // covered company not yet in the tab -> new row
    return null;
  };

  const groups = {};                                 // "name|quarter" -> [{key,path,broker,date,title}]
  for (const [key, p] of Object.entries(PDFMAP)) {
    const [broker, date, folder, title] = key.split('|');
    if (!broker || !date || !folder || !title) continue;
    const q = quarterForReport(date);
    if (!q) continue;
    if (NOT_RESULTS_RE.test(title)) continue;
    const name = folderToRow(folder);
    if (!name) continue;
    if (!RESULTS_RE.test(title) && !textLooksLikeResults(key, p, q)) continue;
    (groups[`${name}|${q}`] = groups[`${name}|${q}`] || []).push({ key, path: p, broker, date, title });
  }
  const latestSeason = Object.keys(groups).map(k => k.split('|')[1]).sort((a, b) => qOrder(b) - qOrder(a))[0];
  const latestOf = {};                               // company -> its newest season with notes
  for (const gk of Object.keys(groups)) { const [n, q] = gk.split('|'); if (!latestOf[n] || qOrder(q) > qOrder(latestOf[n])) latestOf[n] = q; }

  const sectors = [...new Set(E.companies.map(c => c.sector).filter(Boolean))].sort();
  const items = [];
  for (const [gk, files] of Object.entries(groups)) {
    const [name, quarter] = gk.split('|');
    if (!allSeasons && latestSeason && qOrder(latestSeason) - qOrder(quarter) > 1) continue;
    const row = rows[name];
    const have = row && row.q && row.q[quarter];
    const keys = files.map(f => f.key).sort();
    const isPdf = have && have.src && have.src.kind === 'pdf';
    const wantOutlook = latestOf[name] === quarter && !(row && row.outlook && row.outlook.quarter === quarter && isPdf);
    if (isPdf && !wantOutlook) {
      const fresh = keys.filter(k => !(have.src.considered || []).includes(k));
      if (!fresh.length || (have.src.runs || 1) >= MAX_RUNS) continue;
    }
    const rank = f => (/consensus|cons|beat|miss|inline|firstcut|firsttake/.test(f.title) ? 2 : 0) + (/firstcut|firsttake/.test(f.title) ? -1 : 0);
    const pick = files.slice().sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date)).slice(0, MAX_FILES);
    const co = COMPANIES[name] || {};
    items.push({
      name, quarter, yearAgoQuarter: yearAgo(quarter), prevQuarter: prevQ(quarter), keys, wantOutlook,
      sector: row ? row.sector : '', companySector: co.sector || '', sectorChoices: row ? null : sectors,
      metrics: row && row.metrics, unit: row && row.unit, revUnit: row && row.revUnit, basis: row && row.basis,
      priorQuarters: row ? Object.fromEntries(Object.entries(row.q || {}).filter(([, v]) => v.rev != null || v.ebitda != null)
        .map(([k, v]) => [k, { rev: v.rev, ebitda: v.ebitda }])) : {},
      workbook: have && have.src && have.src.kind === 'sheet'
        ? { revYoY: have.revYoY, ebitdaYoY: have.ebitdaYoY, revNote: have.revNote, ebitdaNote: have.ebitdaNote } : null,
      files: pick,
    });
  }
  saveClassify();
  // Newest season first so the live quarter fills before history.
  items.sort((a, b) => qOrder(b.quarter) - qOrder(a.quarter) || a.name.localeCompare(b.name));
  return items;
}

const slug = it => (it.name + '_' + it.quarter).replace(/[^A-Za-z0-9]+/g, '_');

// Page images: claude's Read tool can't rasterise PDFs on this machine (no poppler), so
// render with pymupdf and list the PNGs in the prompt.
function writeItem(it) {
  const files = it.files.filter(f => fs.existsSync(f.path));
  if (!files.length) return null;
  const imgDir = path.join(WORK, slug(it));
  let imgs = [];
  try {
    imgs = execFileSync(UV, ['run', '--quiet', '--python', '3.12', '--with', 'pymupdf', 'python', '-I',
      path.join(__dirname, 'render_pages.py'), imgDir, String(PAGES), ...files.map(f => f.path)],
      { timeout: 180000, maxBuffer: 8 << 20 }).toString().split(/\r?\n/).filter(Boolean);
  } catch (e) { log(`render failed for ${it.name}: ${String(e.message).slice(0, 120)}`); }
  if (!imgs.length) return null;
  const parts = [fs.readFileSync(PROMPT, 'utf8'), '\n=== WORK ITEM ===\n',
    JSON.stringify({ name: it.name, quarter: it.quarter, yearAgoQuarter: it.yearAgoQuarter, prevQuarter: it.prevQuarter,
      sector: it.sector || null, companyDescription: it.companySector || null, sectorChoices: it.sectorChoices || undefined,
      wantOutlook: it.wantOutlook, metrics: it.metrics || null, unit: it.unit || null, revUnit: it.revUnit || null,
      basis: it.basis || null, priorQuarters: it.priorQuarters }, null, 1), '\n\n=== REPORTS ===\n'];
  files.forEach((f, i) => {
    const mine = imgs.filter(p => path.basename(p).startsWith(`r${i + 1}_`));
    if (mine.length) parts.push(`REPORT ${i + 1}: ${f.broker} ${f.date} — pdfmap key: ${f.key}\n` + mine.map(p => `  page image: ${p}\n`).join(''));
  });
  const file = path.join(WORK, slug(it) + '.prompt.txt');
  fs.writeFileSync(file, parts.join(''));
  fs.writeFileSync(path.join(WORK, slug(it) + '.item.json'), JSON.stringify(it, null, 1));
  return file;
}
function cleanItem(it) {
  for (const ext of ['.item.json', '.prompt.txt']) try { fs.unlinkSync(path.join(WORK, slug(it) + ext)); } catch (e) {}
  try { fs.rmSync(path.join(WORK, slug(it)), { recursive: true, force: true }); } catch (e) {}
}

// ---------- claude ----------
function runClaude(promptFile, model) {
  return new Promise(resolve => {
    const p = spawn(CLAUDE, ['-p', '--model', model, '--output-format', 'text', '--permission-mode', 'bypassPermissions', '--allowedTools', 'Read'],
      { cwd: ROOT, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch (e) {} }, CALL_TIMEOUT_S * 1000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); resolve({ out: '', err: String(e) }); });
    p.on('close', () => { clearTimeout(timer); resolve({ out, err }); });
    p.stdin.end(fs.readFileSync(promptFile));
  });
}
const FATAL_RE = /OAuth|Failed to authenticate|Not logged in|session limit|hit your|usage limit|rate limit/i;

// ---------- merge ----------
const VS = new Set(['beat', 'inline', 'miss']);
const OUTLOOK = new Set(['positive', 'neutral', 'negative']);
function parseResult(txt) {
  if (!txt) return null;
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(txt.slice(s, e + 1)); } catch (err) { return null; }
}
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const yoyOf = (a, b) => (a != null && b != null && b > 0 ? +(a / b - 1).toFixed(4) : null);

// Accuracy guard: computed YoY vs the YoY the report prints. Returns a list of problems.
function checkResult(r) {
  const issues = [];
  for (const k of ['rev', 'ebitda']) {
    const c = yoyOf(num(r[k]), num(r[k + 'YearAgo'])), s = num(r[k + 'YoYStated']);
    if (c != null && s != null && Math.abs(c * 100 - s) > 1.5) issues.push(`${k} YoY computed ${(c * 100).toFixed(1)}% vs stated ${s}%`);
  }
  const rev = num(r.rev), ebd = num(r.ebitda);
  if (rev != null && rev <= 0) issues.push('revenue <= 0');
  if (rev != null && ebd != null && !r.revUnit && Math.abs(ebd) > rev * 1.05) issues.push('EBITDA larger than revenue');
  return issues;
}

// Put an absolute value into a quarter cell. Values from the quarter's own primary report
// ("own") always win; year-ago / prior-quarter columns of later reports only fill gaps or
// replace workbook values (whose units are unverified). Overwritten workbook values are audited.
function putAbs(row, qt, k, v, srcRef, role) {
  if (v == null) return;
  const d = row.q[qt] = row.q[qt] || {};
  d.abs = d.abs || {};
  const cur = d.abs[k];
  if (cur && cur.role === 'own' && role !== 'own') return;
  if (cur && cur.role !== 'own' && role !== 'own' && cur.key) return;      // first report to fill a gap keeps it
  if (d[k] != null && !cur && Math.abs(d[k] - v) > Math.abs(v) * 0.01)
    audit({ type: 'workbook-diff', name: row.name, quarter: qt, metric: k, workbook: d[k], pdf: v, src: srcRef.key });
  if (d[k] != null && !cur) d.abs['wb_' + k] = d[k];
  d[k] = v;
  d.abs[k] = { key: srcRef.key, broker: srcRef.broker, date: srcRef.date, role };
}

function mergeOne(E, it, r, flags = {}) {
  if (!r || r.name !== it.name || r.quarter !== it.quarter) return 'bad-json';
  let row = E.companies.find(c => c.name === it.name);
  if (r.skip) {
    // Remember the note set so it isn't re-mined daily; a new note for the quarter re-opens it.
    E.skipped = E.skipped || {};
    E.skipped[it.name + '|' + it.quarter] = { considered: it.keys, reason: String(r.skip).slice(0, 200) };
    return 'skip';
  }
  const rev = num(r.rev), ebd = num(r.ebitda);
  if (rev == null && ebd == null) return 'no-numbers';
  if (!row) {
    row = { name: it.name, sector: String(r.sector || it.sector || '').slice(0, 24), ticker: '', sym: '', basis: '', note: '',
      unit: r.unit || 'INR mn', revUnit: r.revUnit || null, metrics: r.metrics || { rev: 'Revenue', ebitda: 'EBITDA' }, q: {}, added: 'pdf' };
    E.companies.push(row);
  }
  if (r.unit && (!row.unit || row.added === 'pdf' || !Object.values(row.q).some(v => v.abs))) row.unit = row.unit || r.unit;
  if (r.revUnit && !row.revUnit) row.revUnit = r.revUnit;
  if (r.metrics && (!row.metrics || row.added === 'pdf')) row.metrics = r.metrics;
  const prev = row.q[it.quarter] || {};
  const p = r.primary || {};
  const ref = { key: p.key || '', broker: p.broker || '', date: p.date || '' };
  const d = { ...prev };
  for (const k of ['revVs', 'ebitdaVs', 'overall', 'revNote', 'ebitdaNote', 'vsBasis', 'revCons', 'ebitdaCons', 'check', 'checkNote']) delete d[k];
  row.q[it.quarter] = d;
  putAbs(row, it.quarter, 'rev', rev, ref, 'own');
  putAbs(row, it.quarter, 'ebitda', ebd, ref, 'own');
  const revYA = num(r.revYearAgo), ebdYA = num(r.ebitdaYearAgo);
  d.revYoY = yoyOf(rev, revYA);
  d.ebitdaYoY = ebd != null && ebdYA != null ? (ebdYA > 0 ? yoyOf(ebd, ebdYA) : null) : null;
  if (ebdYA != null && ebdYA <= 0 && ebd != null) d.ebitdaYoYNote = `Year-ago ${ebdYA < 0 ? 'loss' : 'zero'} (${ebdYA}) — YoY not meaningful`;
  d.revVs = VS.has(r.revVs) ? r.revVs : null;
  d.ebitdaVs = VS.has(r.ebitdaVs) ? r.ebitdaVs : null;
  d.overall = VS.has(r.overall) ? r.overall : null;
  if (r.revNote) d.revNote = String(r.revNote).slice(0, 700);
  if (r.ebitdaNote) d.ebitdaNote = String(r.ebitdaNote).slice(0, 700);
  if (r.vsBasis && r.vsBasis !== 'consensus') d.vsBasis = String(r.vsBasis).slice(0, 90);
  if (num(r.revCons) != null) d.revCons = r.revCons;
  if (num(r.ebitdaCons) != null) d.ebitdaCons = r.ebitdaCons;
  if (flags.check) { d.check = true; d.checkNote = flags.check.slice(0, 200); }
  d.src = { kind: 'pdf', broker: ref.broker, date: ref.date, key: ref.key, unit: r.unit || null, model: flags.model || MODEL,
    considered: it.keys, runs: ((prev.src && prev.src.kind === 'pdf' && prev.src.runs) || 0) + 1, mined: new Date().toISOString().slice(0, 10) };
  // Year-ago and prior-quarter columns of the SAME report fill the absolute panes.
  putAbs(row, it.yearAgoQuarter, 'rev', revYA, ref, 'yearAgo');
  putAbs(row, it.yearAgoQuarter, 'ebitda', ebdYA, ref, 'yearAgo');
  putAbs(row, it.prevQuarter, 'rev', num(r.revPrevQuarter), ref, 'prevQ');
  putAbs(row, it.prevQuarter, 'ebitda', num(r.ebitdaPrevQuarter), ref, 'prevQ');
  if (it.wantOutlook && r.outlook && OUTLOOK.has(String(r.outlook.call).toLowerCase())) {
    row.outlook = { call: String(r.outlook.call).toLowerCase(), note: String(r.outlook.note || '').slice(0, 700),
      broker: r.outlook.broker || ref.broker, date: r.outlook.date || ref.date, quarter: it.quarter };
  }
  if (it.workbook) {
    for (const k of ['rev', 'ebitda']) {
      const w = it.workbook[k + 'YoY'], m = d[k + 'YoY'];
      if (w != null && m != null && Math.abs(w - m) > 0.015)
        audit({ type: 'workbook-yoy-diff', name: it.name, quarter: it.quarter, metric: k, workbook: w, pdf: m, src: ref.key });
    }
  }
  return 'ok';
}

// ---------- post-pass ----------
// (1) Units. Workbook absolutes were typed in whatever unit the analyst used (ICICI Bank
// in ₹ lakh, IT revenue sometimes in ₹ rather than US$). Each workbook cell left in a row
// that also holds PDF-sourced values of the same metric is compared with the nearest
// PDF quarter: within 0.5x-2x it is kept; a clean power-of-ten gap is rescaled; anything
// else (e.g. ₹ vs US$) is set aside in abs.wb_<k> and blanked, so a row never mixes units.
function normaliseUnits(E) {
  let rescaled = 0, dropped = 0;
  for (const c of E.companies) {
    for (const k of ['rev', 'ebitda']) {
      const pdfQs = Object.entries(c.q || {}).filter(([, d]) => d[k] != null && d.abs && d.abs[k] && d.abs[k].key);
      if (!pdfQs.length) continue;
      for (const [qt, d] of Object.entries(c.q)) {
        if (d[k] == null || (d.abs && d.abs[k])) continue;           // empty, or already PDF/normalised
        const near = pdfQs.slice().sort((a, b) => Math.abs(qOrder(a[0]) - qOrder(qt)) - Math.abs(qOrder(b[0]) - qOrder(qt)))[0][1][k];
        if (!near || !d[k] || Math.sign(near) !== Math.sign(d[k])) continue;
        const r = d[k] / near, l = Math.log10(Math.abs(r)), p = Math.round(l);
        d.abs = d.abs || {};
        if (Math.abs(r) >= 0.5 && Math.abs(r) <= 2) { d.abs[k] = { role: 'workbook' }; continue; }
        d.abs['wb_' + k] = d[k];
        if (p !== 0 && Math.abs(l - p) < 0.12) { d[k] = +(d[k] / Math.pow(10, p)).toPrecision(8); d.abs[k] = { role: 'workbook-rescaled', factor: Math.pow(10, p) }; rescaled++; }
        else { d[k] = null; d.abs[k] = { role: 'workbook-dropped' }; dropped++;
          audit({ type: 'unit-drop', name: c.name, quarter: qt, metric: k, workbook: d.abs['wb_' + k], nearestPdf: near }); }
      }
    }
  }
  return { rescaled, dropped };
}
// (2) Attribution. A quarter still sourced from the workbook gets the broker whose note
// contains its comment text (the analyst pasted those comments from the notes).
const flat = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function attributeWorkbookNotes(E) {
  const PDFMAP = readJSON(path.join(ROOT, 'data', 'pdfmap.json'), {});
  const byFolder = {};
  for (const [key, p] of Object.entries(PDFMAP)) { const [h, d, f] = key.split('|'); if (h && d && f) (byFolder[f] = byFolder[f] || []).push({ key, p, broker: h, date: d }); }
  const textCache = {};
  const textOf = n => { if (!(n.key in textCache)) { try { textCache[n.key] = flat(execFileSync('pdftotext', ['-l', '4', n.p, '-'], { maxBuffer: 16 << 20, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch (e) { textCache[n.key] = ''; } } return textCache[n.key]; };
  let n = 0;
  for (const c of E.companies) {
    const keys = new Set([norm(c.name), norm(c.sheetName)]);
    const folders = Object.keys(byFolder).filter(f => keys.has(norm(f)) || FOLDER_ALIAS[f] === c.name);
    if (!folders.length) continue;
    const notes = folders.flatMap(f => byFolder[f]);
    for (const [qt, d] of Object.entries(c.q || {})) {
      if (!d.src || d.src.kind !== 'sheet' || d.src.attrib) continue;
      const probes = [d.revNote, d.ebitdaNote].filter(Boolean).map(flat).filter(t => t.length >= 30).map(t => t.slice(0, 60));
      if (!probes.length) continue;
      const inSeason = notes.filter(x => quarterForReport(x.date) === qt);
      const hit = (inSeason.length ? inSeason : notes).find(x => probes.some(pr => textOf(x).includes(pr)));
      if (hit) { d.src.attrib = { broker: hit.broker, date: hit.date, key: hit.key }; n++; }
    }
  }
  return n;
}
function postPass(E) {
  const u = normaliseUnits(E), a = attributeWorkbookNotes(E);
  log(`post-pass: ${u.rescaled} workbook figure(s) rescaled, ${u.dropped} set aside (unit mismatch), ${a} workbook comment(s) attributed to a broker note.`);
}

function finalize(E) {
  const qs = new Set();
  for (const c of E.companies) for (const q of Object.keys(c.q || {})) qs.add(q);
  E.quarters = [...qs].sort((a, b) => qOrder(a) - qOrder(b));
  E.updated = new Date().toISOString().slice(0, 10);
  E.companies.sort((a, b) => (a.sector || '').toLowerCase().localeCompare((b.sector || '').toLowerCase()) || a.name.localeCompare(b.name));
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(E, null, 1));
  fs.renameSync(tmp, OUT);
}

function mergeDir(E) {
  let ok = 0;
  for (const f of fs.readdirSync(WORK).filter(f => f.endsWith('.result.json'))) {
    const base = f.replace(/\.result\.json$/, '');
    const it = readJSON(path.join(WORK, base + '.item.json'), null);
    if (!it) continue;
    const r = parseResult(fs.readFileSync(path.join(WORK, f), 'utf8'));
    const issues = r && !r.skip ? checkResult(r) : [];
    const res = mergeOne(E, it, r, issues.length ? { check: issues.join('; '), model: 'manual' } : { model: 'manual' });
    log(`merge ${it.name} ${it.quarter}: ${res}${issues.length ? ' (check: ' + issues.join('; ') + ')' : ''}`);
    if (res === 'ok' || res === 'skip') { ok++; try { fs.unlinkSync(path.join(WORK, f)); } catch (e) {} cleanItem(it); }
  }
  return ok;
}

// ---------- main ----------
(async function main() {
  try {
    const mode = process.argv[2] || '';
    const backfill = mode === '--backfill';
    const E = readJSON(OUT, null);
    if (!E || !Array.isArray(E.companies)) { log('data/earnings.json missing or invalid - skipping.'); return; }
    fs.mkdirSync(WORK, { recursive: true });
    // One miner at a time: a manual backfill and the 09:30 step must never both write
    // data/earnings.json. A lock whose process is gone is stale and taken over.
    const LOCK = path.join(WORK, 'run.lock');
    if (mode !== '--count') {
      const held = readJSON(LOCK, null);
      let alive = false;
      if (held && held.pid && held.pid !== process.pid) { try { process.kill(held.pid, 0); alive = true; } catch (e) {} }
      if (alive) { log(`another earnings run (pid ${held.pid}, since ${held.t}) is in progress - skipping.`); return; }
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: new Date().toISOString(), mode }));
      process.on('exit', () => { try { if ((readJSON(LOCK, {}) || {}).pid === process.pid) fs.unlinkSync(LOCK); } catch (e) {} });
    }

    if (mode === '--merge') { const n = mergeDir(E); postPass(E); finalize(E); log(`merged ${n} result(s).`); return; }
    if (mode === '--postpass') { postPass(E); finalize(E); return; }

    // Drop items whose exact note set was already judged "not a results note".
    // Every season with notes: once the backfill is complete this only picks up new notes,
    // and until then each daily run chips away at whatever a stopped backfill left.
    let items = buildWorkList(E, { allSeasons: true }).filter(it => {
      const s = (E.skipped || {})[it.name + '|' + it.quarter];
      return !(s && s.considered.join() === it.keys.join());
    });
    const only = process.env.EARN_ONLY ? process.env.EARN_ONLY.split(';') : null;   // e.g. "Eternal|1Q27;Angel One"
    if (only) items = items.filter(it => only.some(o => o === it.name || o === it.name + '|' + it.quarter));
    log(`${items.length} company-quarter(s) need mining.`);
    if (mode === '--count') {                            // dry run: size of a --backfill
      items = buildWorkList(E, { allSeasons: true }).filter(it => { const s = (E.skipped || {})[it.name + '|' + it.quarter]; return !(s && s.considered.join() === it.keys.join()); });
      const by = {}; items.forEach(it => by[it.quarter] = (by[it.quarter] || 0) + 1);
      const fresh = [...new Set(items.filter(it => !E.companies.some(c => c.name === it.name)).map(it => it.name))];
      log(`backfill would mine ${items.length}: ${JSON.stringify(by)}; new companies ${fresh.length}: ${fresh.join(', ')}`);
      return;
    }
    if (mode === '--list' || mode === '--list-all') {
      let n = 0; for (const it of items) if (writeItem(it)) n++;
      log(`wrote ${n} work item(s) to ${path.relative(ROOT, WORK)}.`); return;
    }
    if (!fs.existsSync(CLAUDE)) { log('claude CLI not found - skipping mining.'); return; }

    const budgetS = backfill ? Infinity : +(process.env.EARN_BUDGET || 1500);
    const deadline = Date.now() + budgetS * 1000;
    const workers = +(process.env.EARN_WORKERS || (backfill ? 4 : 3));
    let done = 0, failsInRow = 0, stop = false, cursor = 0;

    async function one(it) {
      const pf = writeItem(it);
      if (!pf) { log(`${it.name} ${it.quarter}: no readable PDFs`); return; }
      let { out, err } = await runClaude(pf, MODEL);
      if (FATAL_RE.test(out.slice(0, 400) + err.slice(0, 400)) && !parseResult(out)) {
        log('claude unavailable: ' + (out + err).trim().slice(0, 160)); stop = true; cleanItem(it); return;
      }
      let r = parseResult(out), model = MODEL, issues = r && !r.skip ? checkResult(r) : [];
      if (!r || issues.length) {                        // second opinion on a stronger model
        const second = await runClaude(pf, CHECK_MODEL);
        const r2 = parseResult(second.out);
        if (r2) {
          const issues2 = r2.skip ? [] : checkResult(r2);
          if (!r || issues2.length <= issues.length) { r = r2; issues = issues2; model = CHECK_MODEL; }
        }
      }
      const res = mergeOne(E, it, r, { model, check: issues.length ? issues.join('; ') : null });
      log(`${it.name} ${it.quarter}: ${res}${model !== MODEL ? ' [' + model + ']' : ''}${issues.length ? ' CHECK ' + issues.join('; ') : ''}`);
      if (res === 'ok' || res === 'skip') { done++; failsInRow = 0; finalize(E); }
      else { failsInRow++; audit({ type: 'failed', name: it.name, quarter: it.quarter, res, out: out.slice(0, 300) }); }
      if (failsInRow >= 6) { log('6 failures in a row - stopping.'); stop = true; }
      cleanItem(it);
    }
    async function worker() {
      while (!stop && cursor < items.length && Date.now() < deadline) await one(items[cursor++]);
    }
    await Promise.all(Array.from({ length: workers }, worker));
    if (Date.now() >= deadline && cursor < items.length) log('budget reached - the rest resumes next run.');
    postPass(E);
    finalize(E);
    log(`mined ${done} item(s); ${items.length - cursor} left in queue.`);
  } catch (e) {
    log('error: ' + (e && e.stack || e));
  } finally {
    // Refresh market caps / symbols for every row (cheap, keyless).
    try { execFileSync(process.execPath, [path.join(__dirname, 'resolve-tickers.js')], { stdio: 'inherit', timeout: 120000 }); } catch (e) {}
  }
})();
