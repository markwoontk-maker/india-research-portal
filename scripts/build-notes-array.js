// Walk the local PDF library and emit two JS-array literals:
//   - notes      : last 2 days (date >= CUTOFF_NEW), shown in the Research tab
//   - notesPrior : older reports (date >= CUTOFF_PRIOR_MIN and < CUTOFF_NEW),
//                  used only to populate Prev TP / Prev Call columns
//
// Run: node scripts/build-notes-array.js
//
// Pipe the output back into index.html (replace the `let notes = [...]` and
// `const notesPrior = [...]` blocks).

const fs = require("fs");
const path = require("path");

const REPORTS = "C:\\Users\\admin\\Desktop\\India Related Reports";
const TODAY = "260603";            // today (YYMMDD)
const CUTOFF_NEW = "260601";       // last 2 days = since this date inclusive
const CUTOFF_PRIOR_MIN = "260420"; // anything older than that = drop from prior

const RE = /^\[(\d{6})\]\s+\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)\.pdf$/i;
const all = [];

function walk(dir){
  for(const e of fs.readdirSync(dir, {withFileTypes:true})){
    const p = path.join(dir, e.name);
    if(e.isDirectory()) walk(p);
    else if(e.isFile() && p.toLowerCase().endsWith(".pdf")){
      const base = path.basename(p);
      const m = base.match(RE);
      if(!m) continue;
      const [, date, house, , headline] = m;
      const folder = path.basename(path.dirname(p));
      all.push([house, date, folder, headline]);
    }
  }
}
walk(REPORTS);
all.sort((a,b)=> a[0]<b[0]?-1: a[0]>b[0]?1 : a[1]<b[1]?-1: a[1]>b[1]?1 : a[2].localeCompare(b[2]));

const recent = all.filter(r => r[1] >= CUTOFF_NEW);
const prior  = all.filter(r => r[1] <  CUTOFF_NEW && r[1] >= CUTOFF_PRIOR_MIN);

const jsStr = s => '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"';
const fmt = arr => arr.map(r => `  [${jsStr(r[0])},${jsStr(r[1])},${jsStr(r[2])},${jsStr(r[3])}],`).join("\n");

console.log("=== RECENT (" + recent.length + " rows; date >= " + CUTOFF_NEW + ") ===");
console.log(fmt(recent));
console.log("\n=== PRIOR (" + prior.length + " rows; " + CUTOFF_PRIOR_MIN + " <= date < " + CUTOFF_NEW + ") ===");
console.log(fmt(prior));
