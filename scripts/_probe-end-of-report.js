// Probe Jefferies + Kotak reports for back-of-report financial summary
// tables — these are typically a higher-numbered exhibit (Jefferies'
// "Exhibit 25 - <Co>: Summary income statement" / "Exhibit 42 - Income
// Statement") sitting on pages 10-30. The page-1 mini-table is sometimes
// missing; the end-of-report version is the fallback.
//
// Output: scripts/logs/eor-probe.txt — one block per (company, broker)
// with the income-statement lines that look financially meaningful.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const m = JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','pdfmap.json'),'utf8'));

const SECTORS = new Set(['India Macro','India Strategy','Indian Financials','Indian Autos','Indian Banks','Indian Pharmaceuticals','Indian IT','Indian Oil & Gas','Indian Power','Indian Real Estate','Indian Insurance','Indian Cement','Indian Telecom','Indian Steel','Indian Metals','Indian Consumer','Indian Healthcare','Indian Infra','Indian Mortgages','Indian NBFCs','Indian Asset Managers','Indian Aviation','Indian Chemicals','Indian Consumer Durables','Indian Datacenters','Indian Jewellery','Indian Paints','Indian Pipes','Indian Power Equipment','Capital Markets','Asia Equity Strategy','Indian India Insights','Unknown']);

// A-C only this batch (extend later by changing the regex).
const FILTER = /^[A-Ca-c]/;

const latest = {};
for (const k of Object.keys(m)){
  const [h, d, c] = k.split('|');
  if (h !== 'Jefferies' && h !== 'Kotak') continue;
  if (SECTORS.has(c) || !FILTER.test(c)) continue;
  const key = `${c}|${h}`;
  if (!latest[key] || latest[key].d < d) latest[key] = { broker: h, co: c, d, path: m[k] };
}

const TMP = path.join(__dirname,'logs','probe-tmp.txt');
const out = [];

function extractPages(pdf, fp, lp){
  try {
    execSync(`pdftotext -layout -f ${fp} -l ${lp} "${pdf}" "${TMP}"`, {stdio:['ignore','ignore','ignore']});
    return fs.readFileSync(TMP, 'utf8');
  } catch { return ''; }
}

for (const key of Object.keys(latest).sort()){
  const info = latest[key];
  out.push('\n'+'='.repeat(72)+'\n'+info.co+' :: '+info.broker+' '+info.d+'\n'+'='.repeat(72));
  // Probe pages 5-30 — covers Jefferies' late-exhibit summaries and
  // Kotak's appendix financial tables.
  const text = extractPages(info.path, 5, 30);
  if (!text){ out.push('  (pdftotext failed)'); continue; }
  const lines = text.split(/\r?\n/);
  // Find lines that look like income-statement anchors.
  const ANCHOR = /\b(?:Summary\s+income\s+statement|Income\s+statement|Profit\s+(?:and|&)\s+Loss|P\s*&\s*L\s+summary|Financial\s+summary|Financial\s+Summary|Standalone\s+income|Consolidated\s+income|Exhibit\s+\d+\s*[-:].*(?:Income|Financial|Summary))/i;
  let anchorIdx = -1;
  for (let i = 0; i < lines.length; i++){
    if (ANCHOR.test(lines[i])){ anchorIdx = i; break; }
  }
  if (anchorIdx === -1){ out.push('  (no income-statement anchor found in pp 5-30)'); continue; }
  // Print 25 lines from anchor.
  for (let i = anchorIdx; i < Math.min(lines.length, anchorIdx + 26); i++){
    const l = lines[i].trim();
    if (l && l.length < 180) out.push('  '+l);
  }
}

fs.writeFileSync(path.join(__dirname,'logs','eor-probe.txt'), out.join('\n'));
console.log('Probed', Object.keys(latest).length, '(Jefferies+Kotak) A-C reports → scripts/logs/eor-probe.txt');
