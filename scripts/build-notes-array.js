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
// "Recent" = uploaded recently (file mtime), NOT necessarily dated
// recently. The user batches in backdated PDFs (e.g. drops 260605 reports
// on 260608), and they expect to see them in the Research tab. Using the
// YYMMDD in the filename misses these; using mtime catches them.
//   - any file with mtime within UPLOAD_DAYS of now            → recent
//   - any file with filename date within PUB_DAYS of newest     → recent
// Union of the two, so both "freshly dropped" and "freshly dated" PDFs
// surface together.
const UPLOAD_DAYS = 3;
const PUB_DAYS    = 2;
const PRIOR_DAYS_BACK = 45;

const RE = /^\[(\d{6})\]\s+\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)\.pdf$/i;
// Keep in sync with scripts/rebuild-pdfmap.js FOLDER_ALIAS — collapses
// duplicate notebook names onto a single canonical name. If these two
// scripts disagree, the renderer's pdfmap lookup misses and clicks fall
// through to a Google-search fallback instead of opening the PDF.
const FOLDER_ALIAS = {
  "L&T":                          "Larsen & Toubro",
  "Oil and Natural Gas":          "ONGC",
  "IndiGo":                       "InterGlobe Aviation",
  "Rainbow Children's Medicare":  "Rainbow Children's Hospitals",
};
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
      const rawFolder = path.basename(path.dirname(p));
      const folder = FOLDER_ALIAS[rawFolder] || rawFolder;
      const mtimeMs = fs.statSync(p).mtimeMs;
      all.push([house, date, folder, headline, mtimeMs]);
    }
  }
}
walk(REPORTS);
all.sort((a,b)=> a[0]<b[0]?-1: a[0]>b[0]?1 : a[1]<b[1]?-1: a[1]>b[1]?1 : a[2].localeCompare(b[2]));

// Anchor the recent window on the newest filename-date actually on disk,
// not "today" — so backdated PDFs (broker publishes on Mon stamped Fri)
// still land in the recent feed, and the window never goes stale just
// because no new PDFs arrived for a day.
function shiftYYMMDD(yymmdd, deltaDays){
  const yy = parseInt(yymmdd.slice(0,2),10);
  const mm = parseInt(yymmdd.slice(2,4),10);
  const dd = parseInt(yymmdd.slice(4,6),10);
  const d = new Date(2000+yy, mm-1, dd);
  d.setDate(d.getDate() + deltaDays);
  const y2 = String(d.getFullYear()-2000).padStart(2,"0");
  const m2 = String(d.getMonth()+1).padStart(2,"0");
  const d2 = String(d.getDate()).padStart(2,"0");
  return y2 + m2 + d2;
}
// Max filename date across the whole library — NOT all[-1] (which is the
// alphabetically-last house's newest date, missing a 260604 [Nomura]
// when "Unknown" entries with older dates sort after it).
const newestDate = all.reduce((max,r) => r[1] > max ? r[1] : max, "260101");
const CUTOFF_PUB       = shiftYYMMDD(newestDate, -PUB_DAYS);
const CUTOFF_PRIOR_MIN = shiftYYMMDD(newestDate, -PRIOR_DAYS_BACK);

// mtime cutoff: anything modified within the last UPLOAD_DAYS counts as
// "recent" regardless of its filename date.
const uploadCutoffMs = Date.now() - UPLOAD_DAYS * 86400 * 1000;
const isRecent = r => r[1] >= CUTOFF_PUB || r[4] >= uploadCutoffMs;

const recent = all.filter(isRecent);
const prior  = all.filter(r => !isRecent(r) && r[1] >= CUTOFF_PRIOR_MIN);

const uploadedRecently = all.filter(r => r[4] >= uploadCutoffMs).length;
const publishedRecently = all.filter(r => r[1] >= CUTOFF_PUB).length;

const jsStr = s => '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"';
const fmt = arr => arr.map(r => `  [${jsStr(r[0])},${jsStr(r[1])},${jsStr(r[2])},${jsStr(r[3])}],`).join("\n");

console.log("=== RECENT (" + recent.length + " rows; newest pub=" + newestDate +
  " · pub>=" + CUTOFF_PUB + " (" + publishedRecently + ") OR mtime within " +
  UPLOAD_DAYS + "d (" + uploadedRecently + ")) ===");
console.log(fmt(recent));
console.log("\n=== PRIOR (" + prior.length + " rows; " + CUTOFF_PRIOR_MIN + " <= date < " + CUTOFF_PUB + ") ===");
console.log(fmt(prior));
