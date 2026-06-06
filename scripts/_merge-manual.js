// Overlay data/financials-manual.json onto the existing data/financials.json
// WITHOUT rescanning the PDF library (no new auto-data has changed). Mirrors
// the manual-merge + writer in scripts/build-financials.js exactly, so the
// output format matches and diffs stay minimal.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname,'..');
const OUT = path.join(ROOT,'data','financials.json');

const out = JSON.parse(fs.readFileSync(OUT,'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(ROOT,'data','financials-manual.json'),'utf8'));
let overridden = 0;
for (const [co, entry] of Object.entries(manual)){
  if (co.startsWith('_')) continue;
  out[co] = entry;
  overridden++;
}
const keys = Object.keys(out).sort();
const lines = keys.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k]));
fs.writeFileSync(OUT, '{\n' + lines.join(',\n') + '\n}\n');
console.log(`Merged ${overridden} manual entries -> data/financials.json (${keys.length} companies total)`);
