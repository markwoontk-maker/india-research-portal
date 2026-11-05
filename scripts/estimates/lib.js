// Pure helpers for the Company tab's broker-estimates miner (build-estimates.js).
// No file or network access here, so test-lib.js can exercise everything directly.

const FYS = ['FY26', 'FY27', 'FY28', 'FY29'];
const SHOW_FYS = ['FY27', 'FY28', 'FY29'];

// ---------- broker names ----------
const BROKER_CANON = { 'Goldman Sachs': 'GoldmanSachs', 'Morgan Stanley': 'MorganStanley', 'JP Morgan': 'JPMorgan', 'J.P. Morgan': 'JPMorgan' };
const canonBroker = b => BROKER_CANON[b] || b;

// ---------- units ----------
// The miner returns numbers exactly as printed plus one of these units; everything is
// stored in millions of its currency so brokers can be compared and averaged.
const UNIT_SCALE = { mn: 1, bn: 1000, tn: 1000000, cr: 10, lakh: 0.1 };
function parseUnit(u) {
  const s = String(u || '').trim().toLowerCase().replace(/[₹]/g, 'inr ').replace(/\brs\.?\b/g, 'inr').replace(/\busd\b/g, 'us$').replace(/\s+/g, ' ');
  const cur = /us\$|\$/.test(s) ? 'US$' : /inr/.test(s) ? 'INR' : null;
  let scale = null;
  if (/\b(mn|m|mm|million)\b/.test(s)) scale = UNIT_SCALE.mn;
  else if (/\b(bn|b|billion)\b/.test(s)) scale = UNIT_SCALE.bn;
  else if (/\b(tn|trillion)\b/.test(s)) scale = UNIT_SCALE.tn;
  else if (/\b(cr|crs|crore|crores)\b/.test(s)) scale = UNIT_SCALE.cr;
  else if (/\b(lakh|lakhs|lac)\b/.test(s)) scale = UNIT_SCALE.lakh;
  if (!cur || scale == null) return null;
  return { currency: cur, scale, base: cur + ' mn' };
}
const round = v => +(+v).toFixed(Math.abs(v) >= 100 ? 0 : 2);
function scaleSeries(s, unit) {
  const u = parseUnit(unit);
  if (!u || !s || typeof s !== 'object') return null;
  const out = {};
  for (const fy of FYS) {
    const v = s[fy];
    if (typeof v === 'number' && isFinite(v)) out[fy] = round(v * u.scale);
  }
  return Object.keys(out).length ? { unit: u.base, values: out } : null;
}

// ---------- page finder ----------
// A forecast table has a header naming at least two of FY26-FY30 in any house's spelling:
// FY27E, F27e, 2027CL, 2027E, Mar-27F, 03/27e, 3/27, 27E.
const YEAR_TOKEN = /(?:\b(?:FY|F|CY)\s?'?(2[6-9]|30)(?:[A-Za-z]{0,2})\b)|(?:\b20(2[6-9]|30)\s?(?:[A-Za-z]{0,2})\b)|(?:\b(?:Mar|Dec|Sep|Jun)[-' ]?(2[6-9]|30)[A-Za-z]?\b)|(?:\b\d{1,2}\/(2[6-9]|30)[A-Za-z]?\b)|(?:\b(2[6-9]|30)[EFA]\b)/g;
const REV_LABEL = /(^|\s)((net\s+)?revenues?|(net\s+)?sales|turnover|total\s+(op\.?|operating)\s+income|total\s+income|net\s+interest\s+income|\bNII\b|\bAPE\b|\bGWP\b|\bGDPI\b|gross\s+written|net\s+earned|\bNEP\b|net\s+premium)\b/i;
const EBITDA_LABEL = /(^|[^/\w])(adj\.?\s+)?(EBITDA|PPOP|PPoP|pre-?\s?provision|operating\s+profit|\bVNB\b|value\s+of\s+new\s+business|\bEBIT\b|\bPBT\b|profit\s+before\s+tax)\b/i;
const PNL_WORDS = /\b(depreciation|amortisation|amortization|interest|tax|net\s+profit|PAT|EPS|net\s+income)\b/gi;
function yearsInLine(l) {
  const ys = new Set();
  for (const m of l.matchAll(YEAR_TOKEN)) ys.add(m[1] || m[2] || m[3] || m[4] || m[5]);
  return ys;
}
function scorePage(text) {
  const lines = String(text || '').split(/\r?\n/);
  let header = 0;
  for (const l of lines) {
    const ys = yearsInLine(l);
    if (ys.size >= 2 && (ys.has('27') || ys.has('28'))) header = Math.max(header, ys.size);
  }
  if (!header) return 0;
  const rev = lines.some(l => REV_LABEL.test(l));
  const eb = lines.some(l => EBITDA_LABEL.test(l));
  if (!rev && !eb) return 0;
  const pnl = new Set((String(text).match(PNL_WORDS) || []).map(s => s.toLowerCase())).size;
  return Math.min(header, 4) + (rev ? 3 : 0) + (eb ? 4 : 0) + Math.min(pnl, 4);
}
// Up to `max` pages, best first, returned in page order. No text at all = a scanned note,
// so the first pages are sent as images; text with no forecast table = no pages.
function pickPages(pageTexts, max = 3) {
  const total = pageTexts.join('').trim().length;
  if (total < 200) return pageTexts.slice(0, max).map((_, i) => i + 1);
  return pageTexts.map((t, i) => ({ page: i + 1, s: scorePage(t) })).filter(p => p.s > 0)
    .sort((a, b) => b.s - a.s || a.page - b.page).slice(0, max).map(p => p.page).sort((a, b) => a - b);
}

// ---------- result check ----------
// The row's quarterly figures give an independent size check on the annual numbers:
// catches a wrong unit, a wrong row or a segment figure.
function annualRef(row, m) {
  const unit = m === 'rev' && row.revUnit ? row.revUnit : row.unit;
  const u = parseUnit(unit);
  if (!u) return null;
  const q = row.q || {};
  const all = ['1Q26', '2Q26', '3Q26', '4Q26'].map(k => q[k] && q[k][m]);
  if (all.every(v => typeof v === 'number')) return { value: all.reduce((a, b) => a + b, 0) * u.scale, base: u.base, year: 'FY26' };
  const fy27 = ['1Q27', '2Q27'].map(k => q[k] && q[k][m]).filter(v => typeof v === 'number');
  if (fy27.length) return { value: fy27.reduce((a, b) => a + b, 0) / fy27.length * 4 * u.scale, base: u.base, year: 'FY27' };
  return null;
}
function checkResult(r, row) {
  const issues = [];
  const rev = scaleSeries(r.rev, r.revUnit), eb = scaleSeries(r.ebitda, r.ebitdaUnit);
  if (r.rev && !rev && Object.values(r.rev).some(v => v != null)) issues.push(`unknown revenue unit "${r.revUnit}"`);
  if (r.ebitda && !eb && Object.values(r.ebitda).some(v => v != null)) issues.push(`unknown EBITDA unit "${r.ebitdaUnit}"`);
  for (const [m, s] of [['rev', rev], ['ebitda', eb]]) {
    if (!s) continue;
    for (const fy of FYS) if (m === 'rev' && s.values[fy] != null && s.values[fy] <= 0) issues.push(`revenue ${fy} <= 0`);
    for (const [a, b] of [['FY26', 'FY27'], ['FY27', 'FY28'], ['FY28', 'FY29']]) {
      const x = s.values[a], y = s.values[b];
      if (m === 'rev' && x > 0 && y > 0 && (y / x > 4 || y / x < 0.3)) issues.push(`revenue jumps ${a}->${b} (${x} -> ${y})`);
    }
    const ref = row && annualRef(row, m);
    if (ref && ref.value > 0 && ref.base === s.unit) {
      const v = s.values[ref.year];
      if (v > 0 && (v / ref.value > 2 || v / ref.value < 0.5)) issues.push(`${m} ${ref.year} ${v} vs ${Math.round(ref.value)} from the Earnings tab quarters`);
    }
  }
  if (rev && eb && rev.unit === eb.unit) {
    for (const fy of FYS) if (rev.values[fy] > 0 && Math.abs(eb.values[fy] || 0) > rev.values[fy] * 1.05) issues.push(`EBITDA larger than revenue in ${fy}`);
  }
  // EPS against the share price: a P/E outside this range usually means a wrong row or a per-ADR figure.
  const eps = epsSeries(r), px = row && row._px;
  if (eps && px > 0 && eps.unit === ((row && row._pxCur) || 'INR') && eps.values.FY27 > 0) {
    const pe = px / eps.values.FY27;
    if (pe < 2 || pe > 1500) issues.push(`FY27 EPS ${eps.values.FY27} gives a P/E of ${pe.toFixed(1)} at price ${px}`);
  }
  // A target price far from the share price usually means the wrong number on the front page.
  const tp = tpOf(r, {});
  if (tp && px > 0 && tp.cur === ((row && row._pxCur) || 'INR') && (tp.tp / px < 0.3 || tp.tp / px > 3.5)) issues.push(`target price ${tp.tp} is far from the share price ${px}`);
  return issues;
}
// A note counts as read only if it has revenue or EBITDA: an EPS-only summary box shouldn't stop
// the search for that broker's fuller table in an older note.
function hasNumbers(r) {
  return !!(scaleSeries(r.rev, r.revUnit) || scaleSeries(r.ebitda, r.ebitdaUnit));
}
// EPS stays per share, in rupees or US$ (US-listed names). The page converts the price at the day's rate if they differ.
function epsSeries(r) {
  if (!r.eps || typeof r.eps !== 'object') return null;
  const u = String(r.epsUnit || 'INR');
  const unit = /us\$|usd|\$/i.test(u) ? 'US$' : /inr|rs|₹/i.test(u) ? 'INR' : null;
  if (!unit) return null;
  const out = {};
  for (const fy of FYS) if (typeof r.eps[fy] === 'number' && isFinite(r.eps[fy])) out[fy] = +r.eps[fy].toFixed(2);
  return Object.keys(out).length ? { values: out, unit } : null;
}
// A mined result -> the record stored per broker (all values in millions of their currency).
function toRecord(r, note, extra = {}) {
  const rev = scaleSeries(r.rev, r.revUnit), eb = scaleSeries(r.ebitda, r.ebitdaUnit), alt = scaleSeries(r.revAlt, r.revAltUnit);
  const short = (s, n) => (s ? String(s).slice(0, n) : null);
  const rec = { date: note.date, key: note.key, page: typeof r.page === 'number' ? r.page : null, fye: r.fye || 'Mar', basis: short(r.basis, 40),
    revLabel: short(r.revLabel, 40), ebitdaLabel: short(r.ebitdaLabel, 40) };
  if (rev) { rec.rev = rev.values; rec.revUnit = rev.unit; }
  if (eb) { rec.ebitda = eb.values; rec.ebitdaUnit = eb.unit; }
  if (alt && (!rev || alt.unit !== rev.unit)) { rec.revAlt = alt.values; rec.revAltUnit = alt.unit; }
  const eps = epsSeries(r);
  if (eps) { rec.eps = eps.values; rec.epsUnit = eps.unit; rec.epsLabel = short(r.epsLabel, 40); }
  return Object.assign(rec, extra);
}

// ---------- aggregation ----------
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function chooseRevUnit(brokers, row) {
  const count = {};
  for (const b of Object.values(brokers)) {
    if (b.revUnit) count[b.revUnit] = (count[b.revUnit] || 0) + 1;
    if (b.revAltUnit) count[b.revAltUnit] = (count[b.revAltUnit] || 0) + 1;
  }
  const units = Object.keys(count);
  if (!units.length) return null;
  const pref = (row && row.revUnit) || 'INR mn';
  return units.sort((a, b) => count[b] - count[a] || (b === pref) - (a === pref) || a.localeCompare(b))[0];
}
function chooseUnit(brokers, m) {
  const count = {};
  for (const b of Object.values(brokers)) if (b[m + 'Unit']) count[b[m + 'Unit']] = (count[b[m + 'Unit']] || 0) + 1;
  const units = Object.keys(count);
  if (!units.length) return null;
  return units.sort((a, b) => count[b] - count[a] || (b === 'INR mn') - (a === 'INR mn') || a.localeCompare(b))[0];
}
function seriesFor(b, m, unit) {
  if (m === 'rev' && b.revAltUnit === unit && b.revUnit !== unit) return b.revAlt;
  return b[m + 'Unit'] === unit ? b[m] : null;
}
function aggregate(brokers, row) {
  const out = { unit: {}, avg: {}, n: {}, growth: {}, nm: {}, used: {}, excluded: {} };
  for (const m of ['rev', 'ebitda', 'eps']) {
    const unit = m === 'rev' ? chooseRevUnit(brokers, row) : chooseUnit(brokers, m);
    out.unit[m] = unit; out.avg[m] = {}; out.n[m] = {}; out.growth[m] = {}; out.nm[m] = {}; out.used[m] = {}; out.excluded[m] = {};
    if (!unit) continue;
    const list = [];
    for (const [broker, b] of Object.entries(brokers)) {
      const s = seriesFor(b, m, unit);
      if (s) { list.push({ broker, s }); out.used[m][broker] = (m === 'rev' && b.revUnit !== unit) ? 'alt' : 'main'; }
      else if (b[m + 'Unit'] || (m === 'rev' && b.revAltUnit)) out.excluded[m][broker] = `Reported in ${b[m + 'Unit'] || b.revAltUnit}, not ${unit}, so left out of the average`;
    }
    const clean = list;   // user rule: every broker counts, however far from the others
    for (const fy of FYS) {
      const vals = clean.map(x => x.s[fy]).filter(v => v != null);
      if (vals.length) { const mean = vals.reduce((a, b) => a + b, 0) / vals.length; out.avg[m][fy] = m === 'eps' ? +mean.toFixed(2) : round(mean); out.n[m][fy] = vals.length; }
    }
    // Growth is like-for-like: only brokers with both years count, so a broker dropping out
    // in the later year can't create a jump that no house is forecasting.
    for (let i = 1; i < FYS.length; i++) {
      const fy = FYS[i], prev = FYS[i - 1];
      const both = clean.filter(x => x.s[fy] != null && x.s[prev] != null);
      if (!both.length) continue;
      const a = both.reduce((t, x) => t + x.s[fy], 0), p = both.reduce((t, x) => t + x.s[prev], 0);
      if (p > 0) out.growth[m][fy] = +(a / p - 1).toFixed(4);
      else out.nm[m][fy] = true;
    }
  }
  return out;
}

// ---------- target prices ----------
// The broker's current TP and rating from a mined result, or null if the note prints neither.
function tpOf(r, note) {
  const tp = typeof r.targetPrice === 'number' && isFinite(r.targetPrice) && r.targetPrice > 0 ? +r.targetPrice.toFixed(2) : null;
  const rating = r.rating ? String(r.rating).trim().slice(0, 24) : null;
  if (tp == null && !rating) return null;
  const cur = /us\$|usd|\$/i.test(String(r.tpCurrency || '')) ? 'US$' : 'INR';
  return { tp, cur, rating, date: note.date, key: note.key };
}
// Average TP in the currency most brokers use; a TP in the other currency isn't averaged in.
function aggregateTp(tps) {
  const count = {};
  for (const t of Object.values(tps)) if (t.tp != null) count[t.cur] = (count[t.cur] || 0) + 1;
  const cur = Object.keys(count).sort((a, b) => count[b] - count[a] || (b === 'INR') - (a === 'INR'))[0];
  if (!cur) return { avg: null, n: 0, cur: null };
  const vals = Object.values(tps).filter(t => t.tp != null && t.cur === cur).map(t => t.tp);
  return { avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2), n: vals.length, cur };
}

// ---------- which note to read next for a company-broker pair ----------
// Notes newest first. Returns the first note not tried yet, unless the pair already holds
// an estimate from a note at least as new as every untried one (older notes add nothing),
// or `maxTries` notes have already come back without a table.
function nextNote(notes, state, have, maxTries = 3) {
  const tried = state || [];
  const newest = notes[0];
  if (!newest) return null;
  const untried = notes.filter(n => !tried.includes(n.key));
  if (!untried.length) return null;
  if (have) return untried[0].date > have.date ? untried[0] : null;
  const triedFromCurrent = notes.filter(n => tried.includes(n.key)).length;
  if (triedFromCurrent >= maxTries) return null;
  return untried[0];
}

module.exports = { tpOf, aggregateTp, FYS, SHOW_FYS, canonBroker, parseUnit, scaleSeries, yearsInLine, scorePage, pickPages, annualRef, checkResult, hasNumbers, epsSeries, toRecord, aggregate, nextNote, median };
