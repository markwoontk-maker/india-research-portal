// One-shot: dedupe NOTEBOOKS aliases across data files.
//
// Canonical name → list of aliases to fold INTO the canonical.
// Keep in sync with FOLDER_ALIAS in scripts/rebuild-pdfmap.js +
// scripts/extract-pdfdata.js + NOTEBOOKS in index.html.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ALIASES = {
  'Larsen & Toubro':              ['L&T'],
  'ONGC':                         ['Oil and Natural Gas'],
  'InterGlobe Aviation':          ['IndiGo'],
  'Rainbow Children\'s Hospitals':['Rainbow Children\'s Medicare'],
};

function loadJson(rel){
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return null; }
}
function writeJsonPretty(rel, obj){
  // One key per line so diffs stay readable.
  const keys = Object.keys(obj).sort((a,b)=>{
    if (a.startsWith('_')) return -1;
    if (b.startsWith('_')) return 1;
    return a.localeCompare(b);
  });
  const lines = keys.map(k =>
    '  ' + JSON.stringify(k) + ': ' + JSON.stringify(obj[k], null, 2).split('\n').map((l,i)=>i?'  '+l:l).join('\n'));
  fs.writeFileSync(path.join(ROOT, rel), '{\n' + lines.join(',\n') + '\n}\n');
}

// 1) companies.json — drop alias keys (canonical already exists).
const companies = loadJson('data/companies.json');
if (companies){
  let dropped = 0;
  for (const [canon, aliases] of Object.entries(ALIASES)){
    for (const alias of aliases){
      if (companies[alias]){
        // If canonical missing a description but alias has one, lift it across.
        if (companies[canon] && !companies[canon].desc && companies[alias].desc){
          companies[canon].desc = companies[alias].desc;
        }
        delete companies[alias];
        dropped++;
      }
    }
  }
  console.log(`companies.json: dropped ${dropped} alias key(s)`);
  // Re-serialise one-line-per-key.
  const keys = Object.keys(companies).sort();
  const lines = keys.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(companies[k]));
  fs.writeFileSync(path.join(ROOT, 'data/companies.json'), '{\n' + lines.join(',\n') + '\n}\n');
}

// 2) financials-manual.json — merge alias's broker rows into canonical
//    where possible, then drop the alias key.
const finManual = loadJson('data/financials-manual.json');
if (finManual){
  let merged = 0;
  for (const [canon, aliases] of Object.entries(ALIASES)){
    for (const alias of aliases){
      if (!finManual[alias]) continue;
      if (!finManual[canon]){
        finManual[canon] = finManual[alias];
      } else {
        // Merge per-metric, per-FY broker arrays.
        const a = finManual[canon], b = finManual[alias];
        const allMetrics = new Set([...Object.keys(a.metrics||{}), ...Object.keys(b.metrics||{})]);
        for (const mk of allMetrics){
          a.metrics[mk] = a.metrics[mk] || {};
          for (const [fy, bRow] of Object.entries((b.metrics||{})[mk]||{})){
            const aRow = a.metrics[mk][fy];
            if (!aRow){ a.metrics[mk][fy] = bRow; continue; }
            const merged = [...aRow.brokers, ...bRow.brokers];
            // Dedupe by broker name.
            const seen = new Set(); const dedup = [];
            for (const br of merged){
              const k = br.name + '|' + br.date;
              if (seen.has(k)) continue; seen.add(k); dedup.push(br);
            }
            const avg = +(dedup.reduce((s,b)=>s+b.value,0)/dedup.length).toFixed(1);
            a.metrics[mk][fy] = { tag: aRow.tag || bRow.tag, avg, brokers: dedup };
          }
        }
      }
      delete finManual[alias];
      merged++;
    }
  }
  console.log(`financials-manual.json: merged ${merged} alias key(s) into canonical`);
  writeJsonPretty('data/financials-manual.json', finManual);
}

// 3) theses-manual.json — same dedup logic (rare overlap).
const thManual = loadJson('data/theses-manual.json');
if (thManual){
  let dropped = 0;
  for (const [canon, aliases] of Object.entries(ALIASES)){
    for (const alias of aliases){
      if (thManual[alias]){
        if (!thManual[canon]) thManual[canon] = thManual[alias];
        delete thManual[alias];
        dropped++;
      }
    }
  }
  console.log(`theses-manual.json: folded ${dropped} alias key(s)`);
  writeJsonPretty('data/theses-manual.json', thManual);
}

console.log('Done. Now re-run rebuild-pdfmap, extract-pdfdata, build-theses, build-financials to refresh the auto-built files.');
