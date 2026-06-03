const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname,"..","index.html"), "utf8");
const m = html.match(/const NOTEBOOKS = \[\r?\n([\s\S]*?)\r?\n\];/);
const entries = m[1].split(/\r?\n/).map(l => {
  const lm = l.match(/\{\s*name:\s*"([^"]+)"\s*,\s*url:\s*"([^"]*)"\s*\}/);
  return lm ? {name: lm[1], url: lm[2]} : null;
}).filter(Boolean);
console.log("Parsed entries:", entries.length);

const REPORTS = "C:\\Users\\admin\\Desktop\\India Related Reports";
const folders = fs.readdirSync(REPORTS, {withFileTypes:true})
  .filter(e => e.isDirectory()).map(e => e.name);
const skipped = ["Sorting Folder","Unknown","India"];
const expected = folders.filter(f => !skipped.includes(f)).sort();
const got = entries.map(e => e.name).sort();
const missing = expected.filter(f => !got.includes(f));
const extra = got.filter(f => !expected.includes(f));
console.log("In folders but NOT in NOTEBOOKS:", missing.length);
missing.forEach(f => console.log(" -", f));
console.log("In NOTEBOOKS but NOT on disk:", extra.length);
extra.forEach(f => console.log(" -", f));
