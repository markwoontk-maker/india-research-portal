// Scan local broker PDFs for SEGMENT-wise revenue/results tables (the user's
// first-choice source: "annual report only if not in the analyst report").
// For each target company folder, pdftotext every report and dump context
// around segment anchors. Output: scripts/logs/seg-probe.txt
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = 'C:\\Users\\admin\\Desktop\\India Related Reports';
const TARGETS = [
  'Adani Ports and SEZ',
  'Aditya Birla Capital',
  'Apar Industries',
  'Bajaj Finserv',
  'Container Corporation of India',
  'Cummins India',
  'Bharat Petroleum',
  'Bharat Electronics',
];
const TMP = path.join(__dirname,'logs','seg-tmp.txt');
const out = [];

// A real segment table caption (avoid prose mentions of "segment").
const ANCHOR = /(segment[- ]?wise|segmental|business segment|segment revenue|segment results|revenue by segment|segment-wise (?:revenue|projections)|Exhibit\s+\d+[^\n]*segment)/i;

function pdftext(pdf){
  try { execSync(`pdftotext -layout "${pdf}" "${TMP}"`, {stdio:['ignore','ignore','ignore']}); return fs.readFileSync(TMP,'utf8'); }
  catch { return ''; }
}

for (const co of TARGETS){
  const dir = path.join(ROOT, co);
  out.push('\n'+'#'.repeat(72)+'\n# '+co+'\n'+'#'.repeat(72));
  let files = [];
  try { files = fs.readdirSync(dir).filter(f=>/\.pdf$/i.test(f)); } catch { out.push('  (folder missing)'); continue; }
  for (const f of files){
    const txt = pdftext(path.join(dir,f));
    if (!txt){ continue; }
    const lines = txt.split(/\r?\n/);
    const hits = [];
    for (let i=0;i<lines.length;i++){
      if (ANCHOR.test(lines[i])){
        // require some numbers nearby to be a table, not prose
        const win = lines.slice(i, i+12).join(' ');
        const nums = (win.match(/\d[\d,]{2,}/g)||[]).length;
        if (nums >= 6) hits.push(i);
      }
    }
    if (!hits.length) continue;
    out.push('\n  -- '+f);
    const shown = new Set();
    for (const idx of hits.slice(0,2)){
      for (let i=idx; i<Math.min(lines.length, idx+16); i++){
        if (shown.has(i)) continue; shown.add(i);
        const l = lines[i].replace(/\s+$/,'');
        if (l.trim() && l.length < 170) out.push('     '+l);
      }
      out.push('     ----');
    }
  }
}

fs.writeFileSync(path.join(__dirname,'logs','seg-probe.txt'), out.join('\n'));
console.log('Wrote scripts/logs/seg-probe.txt');
