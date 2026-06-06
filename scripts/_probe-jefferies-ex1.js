// Probe Jefferies reports for "Exhibit 1: ... Financial Summary" tables
// on page 1 — the canonical format the user just confirmed for Adani
// Power. Dumps each report's Exhibit 1 block (or notes that it's
// missing) so we can read 20+ companies in one screen.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const m = JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','pdfmap.json'),'utf8'));

const SECTORS = new Set(['India Macro','India Strategy','Indian Financials','Indian Autos','Indian Banks','Indian Pharmaceuticals','Indian IT','Indian Oil & Gas','Indian Power','Indian Real Estate','Indian Insurance','Indian Cement','Indian Telecom','Indian Steel','Indian Metals','Indian Consumer','Indian Healthcare','Indian Infra','Indian Mortgages','Indian NBFCs','Indian Asset Managers','Indian Aviation','Indian Chemicals','Indian Consumer Durables','Indian Datacenters','Indian Jewellery','Indian Paints','Indian Pipes','Indian Power Equipment','Capital Markets','Asia Equity Strategy','Indian India Insights','Unknown']);

// Latest Jefferies report per A-C company.
const latest = {};
for (const k of Object.keys(m)){
  const [h, d, c] = k.split('|');
  if (h !== 'Jefferies' || SECTORS.has(c)) continue;
  if (!/^[A-Ca-c]/.test(c)) continue;
  if (!latest[c] || latest[c].d < d) latest[c] = { d, path: m[k] };
}

const TMP = path.join(__dirname,'logs','probe-tmp.txt');
const out = [];
for (const co of Object.keys(latest).sort()){
  const info = latest[co];
  out.push('\n'+'='.repeat(72)+'\n'+co+' :: Jefferies '+info.d+'\n'+'='.repeat(72));
  try {
    execSync(`pdftotext -layout -f 1 -l 1 "${info.path}" "${TMP}"`, {stdio:['ignore','ignore','ignore']});
    const text = fs.readFileSync(TMP,'utf8');
    const lines = text.split(/\r?\n/);
    let idx = lines.findIndex(l => /Exhibit\s*1\b.*Financial\s*Summary/i.test(l));
    if (idx === -1) idx = lines.findIndex(l => /Exhibit\s*1\b/i.test(l));
    if (idx === -1){ out.push('  (no Exhibit 1 marker on page 1)'); continue; }
    // Dump 22 lines from the exhibit marker
    for (let j = idx; j < Math.min(lines.length, idx + 22); j++){
      const l = lines[j].trim();
      if (l) out.push('  '+l.slice(0, 160));
    }
  } catch (e){
    out.push('  ERR '+e.message);
  }
}
fs.writeFileSync(path.join(__dirname,'logs','jeff-ex1-probe.txt'), out.join('\n'));
console.log('Probed', Object.keys(latest).length, 'A-C Jefferies reports');
