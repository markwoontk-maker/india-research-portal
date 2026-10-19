// Earnings tab refresher: fill data/earnings.json from new broker results notes.
//
//   node scripts/earnings/build-earnings.js            full run: list -> headless claude per item -> merge -> market caps
//   node scripts/earnings/build-earnings.js --list     only write work items to scripts/.earnings-work/
//   node scripts/earnings/build-earnings.js --merge    only merge scripts/.earnings-work/*.result.json
//
// Wired into scripts/daily-refresh.ps1 AFTER the daily-return step (refresh-wl-returns),
// so it runs serially at 09:30 MYT on weekdays; that script commits data/earnings.json.
//
// A work item = (company, quarter) that has >=1 post-results note in the PDF library
// (data/pdfmap.json) and no figures for that quarter yet, or new notes since it was
// last mined (max MAX_RUNS passes per item, so a first-cut note is upgraded by the
// full note a day later). Rows/quarters seeded from the analyst's workbook
// (src.kind == "sheet") are never overwritten. Numbers come only from the PDFs
// (claude reads the PDFs itself, per docs/earnings-miner-prompt.md); revenue,
// EBITDA and both year-ago figures must come from ONE report (consistency).
// Never throws; always exits 0.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'earnings.json');
const WORK = path.join(ROOT, 'scripts', '.earnings-work');
const PROMPT = path.join(ROOT, 'docs', 'earnings-miner-prompt.md');
const CLAUDE = process.env.CLAUDE_EXE || 'C:\\Users\\admin\\.local\\bin\\claude.exe';
const UV = process.env.UV_EXE || 'C:\\Users\\admin\\.local\\bin\\uv.exe';
const BUDGET_S = +(process.env.EARN_BUDGET || 1500);
const CALL_TIMEOUT_S = 300;
const MAX_FILES = 3, PAGES = 6, MAX_RUNS = 2;

const log = (...a) => console.log('[build-earnings]', ...a);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };

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
const yearAgo = q => q.slice(0, 2) + String(+q.slice(2) - 1).padStart(2, '0');
const qOrder = q => +q.slice(2) * 4 + +q[0];   // linear quarter index

const RESULTS_RE = /result|qtr|quarter|[1-4]q|q[1-4]|firstcut|firsttake|first(cut|take)|beat|miss|inline|review|print|earnings|ebitda|ppop|\bnii|vnb|\bape|(jun|sep|dec|mar)q|strongquarter|weakquarter|decentquarter|goodquarter/;
const NOT_RESULTS_RE = /preview|businessupdate|operationalupdate|tradingupdate|preqtr|preq|quarterlyupdate|tradingstatement|monthly|investorday|analystmeet|ceomeeting/;

const norm = s => String(s || '').toLowerCase().replace(/\[.*?\]|\(.*?\)/g, ' ')
  .replace(/\b(ltd|limited|the|india|co|company|corporation|corp|industries|of)\b/g, ' ').replace(/[^a-z0-9]/g, '');
// Library folders that hold the same company under another name.
const FOLDER_ALIAS = {
  'HDFC Asset Management': 'HDFC AMC', 'ICICI Prudential Asset Management': 'ICICI Prudential AMC',
  'ICICI Prudential Asset Management Company Limited': 'ICICI Prudential AMC', 'ICICI Prudential Life Insurance': 'ICICI Prudential Life',
  'ICICI Life Insurance': 'ICICI Prudential Life', 'Groww': "Billionbrains Garage Ventures ('Groww')", 'Canfin': 'Can Fin Homes',
  'Sterlite Tech [SOTL IN]': 'Sterlite Tech', 'Tata Comm': 'Tata Communications','Adani Ports and SEZ': 'Adani Ports and SEZ',
};

function sectorLabel(companiesEntry) {
  const s = (companiesEntry && companiesEntry.sector) || '';
  return s.split('·')[0].trim();
}

// ---------- work list ----------
function buildWorkList(E) {
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
    if (!RESULTS_RE.test(title) || NOT_RESULTS_RE.test(title)) continue;
    const name = folderToRow(folder);
    if (!name) continue;
    (groups[`${name}|${q}`] = groups[`${name}|${q}`] || []).push({ key, path: p, broker, date, title });
  }

  const latestSeason = Object.keys(groups).map(k => k.split('|')[1]).sort((a, b) => qOrder(b) - qOrder(a))[0];
  const items = [];
  for (const [gk, files] of Object.entries(groups)) {
    const [name, quarter] = gk.split('|');
    // Only the current season and the one before it (late reporters); older seasons are history.
    if (latestSeason && qOrder(latestSeason) - qOrder(quarter) > 1) continue;
    const row = rows[name];
    // Companies outside the tab join it only when they report in the CURRENT season.
    if (!row && quarter !== latestSeason) continue;
    const have = row && row.q && row.q[quarter];
    if (have && have.src && have.src.kind === 'sheet') continue;               // analyst's own numbers win
    const keys = files.map(f => f.key).sort();
    if (have && have.src && have.src.kind === 'pdf') {
      const seen = have.src.considered || [];
      const fresh = keys.filter(k => !seen.includes(k));
      if (!fresh.length || (have.src.runs || 1) >= MAX_RUNS) continue;
    }
    const rank = f => (/consensus|cons|beat|miss|inline|firstcut|firsttake/.test(f.title) ? 2 : 0) + (/firstcut|firsttake/.test(f.title) ? -1 : 0);
    const pick = files.slice().sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date)).slice(0, MAX_FILES);
    const co = COMPANIES[name] || {};
    items.push({
      name, quarter, yearAgoQuarter: yearAgo(quarter), keys,
      sector: row ? row.sector : sectorLabel(co),
      metrics: row && row.metrics, unit: row && row.unit, revUnit: row && row.revUnit, basis: row && row.basis,
      priorQuarters: row ? Object.fromEntries(Object.entries(row.q || {}).map(([k, v]) => [k, { rev: v.rev, ebitda: v.ebitda }])) : {},
      files: pick,
    });
  }
  items.sort((a, b) => qOrder(b.quarter) - qOrder(a.quarter) || a.name.localeCompare(b.name));
  return items;
}

const slug = it => (it.name + '_' + it.quarter).replace(/[^A-Za-z0-9]+/g, '_');

// The prompt lists the PDFs; claude opens them with its Read tool (pages 1-PAGES),
// which keeps results tables intact (pdftotext -layout scrambles their columns).
function writeItem(it) {
  const parts = [fs.readFileSync(PROMPT, 'utf8'), '\n=== WORK ITEM ===\n',
    JSON.stringify({ name: it.name, quarter: it.quarter, yearAgoQuarter: it.yearAgoQuarter, sector: it.sector,
      metrics: it.metrics || null, unit: it.unit || null, revUnit: it.revUnit || null, basis: it.basis || null,
      priorQuarters: it.priorQuarters }, null, 1), '\n\n=== REPORTS ===\n'];
  const files = it.files.filter(f => fs.existsSync(f.path));
  if (!files.length) return null;
  // Page images: claude's Read tool can't rasterise PDFs here (no poppler), so render with pymupdf.
  const imgDir = path.join(WORK, slug(it));
  let imgs = [];
  try {
    imgs = execFileSync(UV, ['run', '--quiet', '--python', '3.12', '--with', 'pymupdf', 'python', '-I',
      path.join(__dirname, 'render_pages.py'), imgDir, String(PAGES), ...files.map(f => f.path)],
      { timeout: 180000, maxBuffer: 8 << 20 }).toString().split(/\r?\n/).filter(Boolean);
  } catch (e) { log(`render failed for ${it.name}: ${String(e.message).slice(0, 120)}`); }
  if (!imgs.length) return null;
  files.forEach((f, i) => {
    const mine = imgs.filter(p => path.basename(p).startsWith(`r${i + 1}_`));
    if (mine.length) parts.push(`REPORT ${i + 1}: ${f.broker} ${f.date} — pdfmap key: ${f.key}\n` + mine.map(p => `  page image: ${p}\n`).join(''));
  });
  const file = path.join(WORK, slug(it) + '.prompt.txt');
  fs.writeFileSync(file, parts.join(''));
  fs.writeFileSync(path.join(WORK, slug(it) + '.item.json'), JSON.stringify(it, null, 1));
  return file;
}

// ---------- merge ----------
const VS = new Set(['beat', 'inline', 'miss']);
function parseResult(txt) {
  if (!txt) return null;
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(txt.slice(s, e + 1)); } catch (err) { return null; }
}
const numOrNull = v => (typeof v === 'number' && isFinite(v) ? v : null);

function mergeOne(E, it, r) {
  if (!r || r.name !== it.name || r.quarter !== it.quarter) return 'bad-json';
  let row = E.companies.find(c => c.name === it.name);
  if (r.skip) {
    // Remember the note set so it isn't re-mined daily; a new note for the quarter re-opens it.
    E.skipped = E.skipped || {};
    E.skipped[it.name + '|' + it.quarter] = { considered: it.keys, reason: String(r.skip).slice(0, 200) };
    return 'skip';
  }
  const rev = numOrNull(r.rev), revYA = numOrNull(r.revYearAgo), ebd = numOrNull(r.ebitda), ebdYA = numOrNull(r.ebitdaYearAgo);
  if (rev == null && ebd == null) return 'no-numbers';
  if (!row) {
    row = { name: it.name, sector: it.sector || '', ticker: '', sym: '', basis: '', note: '', unit: r.unit || 'INR mn',
      revUnit: r.revUnit || null, metrics: r.metrics || { rev: 'Revenue', ebitda: 'EBITDA' }, q: {} };
    E.companies.push(row);
  }
  if (!row.unit && r.unit) row.unit = r.unit;
  if (!row.revUnit && r.revUnit) row.revUnit = r.revUnit;
  if (!row.metrics && r.metrics) row.metrics = r.metrics;
  const prev = row.q[it.quarter] || {};
  const d = { rev, ebitda: ebd };
  if (rev != null && revYA) d.revYoY = +(rev / revYA - 1).toFixed(4);
  if (ebd != null && ebdYA) d.ebitdaYoY = +(ebd / Math.abs(ebdYA) - (ebdYA < 0 ? -1 : 1)).toFixed(4);
  if (ebd != null && ebdYA && ebdYA < 0) d.ebitdaYoY = null;  // YoY meaningless off a loss base
  d.revVs = VS.has(r.revVs) ? r.revVs : null;
  d.ebitdaVs = VS.has(r.ebitdaVs) ? r.ebitdaVs : null;
  d.overall = VS.has(r.overall) ? r.overall : null;
  if (r.revNote) d.revNote = String(r.revNote).slice(0, 600);
  if (r.ebitdaNote) d.ebitdaNote = String(r.ebitdaNote).slice(0, 600);
  if (r.vsBasis && r.vsBasis !== 'consensus') d.vsBasis = String(r.vsBasis).slice(0, 80);
  if (numOrNull(r.revCons) != null) d.revCons = r.revCons;
  if (numOrNull(r.ebitdaCons) != null) d.ebitdaCons = r.ebitdaCons;
  const p = r.primary || {};
  d.src = { kind: 'pdf', broker: p.broker || '', date: p.date || '', key: p.key || '', unit: r.unit || null,
    considered: it.keys, runs: ((prev.src && prev.src.runs) || 0) + 1, mined: new Date().toISOString().slice(0, 10) };
  row.q[it.quarter] = d;
  // Year-ago absolutes from the SAME report, only where the row has none (keeps units consistent).
  const ya = it.yearAgoQuarter, y = row.q[ya] = row.q[ya] || {};
  if (y.rev == null && revYA != null) y.rev = revYA;
  if (y.ebitda == null && ebdYA != null) y.ebitda = ebdYA;
  if (!Object.keys(y).length) delete row.q[ya];
  return 'ok';
}

function finalize(E) {
  const qs = new Set(E.quarters || []);
  for (const c of E.companies) for (const q of Object.keys(c.q || {})) qs.add(q);
  E.quarters = [...qs].sort((a, b) => qOrder(a) - qOrder(b));
  E.updated = new Date().toISOString().slice(0, 10);
  E.companies.sort((a, b) => a.sector.toLowerCase().localeCompare(b.sector.toLowerCase()) || a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(E, null, 1));
}

function mergeDir(E) {
  let ok = 0;
  for (const f of fs.readdirSync(WORK).filter(f => f.endsWith('.result.json'))) {
    const base = f.replace(/\.result\.json$/, '');
    const it = readJSON(path.join(WORK, base + '.item.json'), null);
    if (!it) continue;
    const res = mergeOne(E, it, parseResult(fs.readFileSync(path.join(WORK, f), 'utf8')));
    log(`merge ${it.name} ${it.quarter}: ${res}`);
    if (res === 'ok' || res === 'skip') { ok++; for (const ext of ['.result.json', '.item.json', '.prompt.txt']) try { fs.unlinkSync(path.join(WORK, base + ext)); } catch (e) {} try { fs.rmSync(path.join(WORK, base), { recursive: true, force: true }); } catch (e) {} }
  }
  return ok;
}

// ---------- main ----------
(function main() {
  try {
    const mode = process.argv[2] || '';
    const E = readJSON(OUT, null);
    if (!E || !Array.isArray(E.companies)) { log('data/earnings.json missing or invalid - skipping.'); return; }
    fs.mkdirSync(WORK, { recursive: true });

    if (mode === '--merge') { const n = mergeDir(E); finalize(E); log(`merged ${n} result(s).`); return; }

    // Drop items whose exact note set was already judged "not a results note".
    const items = buildWorkList(E).filter(it => {
      const s = (E.skipped || {})[it.name + '|' + it.quarter];
      return !(s && s.considered.join() === it.keys.join());
    });
    log(`${items.length} company-quarter(s) need mining.`);
    if (mode === '--list') {
      let n = 0; for (const it of items) if (writeItem(it)) n++;
      log(`wrote ${n} work item(s) to ${path.relative(ROOT, WORK)}.`); return;
    }

    if (!fs.existsSync(CLAUDE)) { log('claude CLI not found - skipping mining.'); }
    const deadline = Date.now() + BUDGET_S * 1000;
    let done = 0, fails = 0;
    for (const it of items) {
      if (Date.now() > deadline) { log('budget reached - the rest resumes tomorrow.'); break; }
      if (!fs.existsSync(CLAUDE) || fails >= 4) break;
      const pf = writeItem(it);
      if (!pf) continue;
      const r = spawnSync(CLAUDE, ['-p', '--model', 'sonnet', '--output-format', 'text', '--permission-mode', 'bypassPermissions', '--allowedTools', 'Read'],
        { input: fs.readFileSync(pf), cwd: ROOT, timeout: CALL_TIMEOUT_S * 1000, maxBuffer: 8 << 20 });
      const out = (r.stdout || '').toString();
      if (/OAuth|Failed to authenticate|session limit|hit your/i.test(out + (r.stderr || ''))) { log('claude unavailable: ' + out.trim().slice(0, 160)); break; }
      const res = mergeOne(E, it, parseResult(out));
      log(`${it.name} ${it.quarter}: ${res}`);
      if (res === 'ok' || res === 'skip') { done++; fails = 0; finalize(E); } else fails++;
      for (const ext of ['.item.json', '.prompt.txt']) try { fs.unlinkSync(path.join(WORK, slug(it) + ext)); } catch (e) {}
      try { fs.rmSync(path.join(WORK, slug(it)), { recursive: true, force: true }); } catch (e) {}
    }
    finalize(E);
    log(`mined ${done} item(s).`);
  } catch (e) {
    log('error: ' + (e && e.stack || e));
  } finally {
    // Refresh market caps / symbols for every row (cheap, keyless).
    try { execFileSync(process.execPath, [path.join(__dirname, 'resolve-tickers.js')], { stdio: 'inherit', timeout: 120000 }); } catch (e) {}
  }
})();
