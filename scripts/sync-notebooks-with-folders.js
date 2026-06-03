// Sync the NOTEBOOKS array + SECTOR_NAMES set in index.html with the actual
// folder structure under C:\Users\admin\Desktop\India Related Reports.
// Existing NotebookLM URLs are preserved; new folders are added with
// empty URL (the UI shows them as "pending"). Folders that no longer
// exist on disk are dropped.
//
// Run: node scripts/sync-notebooks-with-folders.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");
const REPORTS = "C:\\Users\\admin\\Desktop\\India Related Reports";

// Folders that aren't research workspaces (admin / fallback bins).
const SKIP = new Set([
  "Sorting Folder",
  "Unknown",
  "India",          // empty placeholder; sector reports live in "Indian X"
]);

// Heuristic: thematic / sector workspaces vs single-company workspaces.
// All "India X" / "Indian X" buckets default to sectors. A short curated
// list covers cross-sector themes that don't follow the "India" prefix.
const SECTOR_EXTRA = new Set([
  "Capital Markets",      // sector wrap (Kotak/Capital Markets weekly)
  "ANCHOR REPORT",        // Nomura's thematic anchor series
  "Asia Chart Alert",     // Nomura economics
  "Quant Research",       // Kotak quant
  "Friday Flash",         // Kotak weekly
]);
// "Indian X" names that are actually single companies, not sectors.
// Keep these on the companies dropdown.
const COMPANY_OVERRIDE = new Set([
  "Indian Hotels",            // Indian Hotels Company Ltd (Taj operator)
  "Indian Oil Corporation",   // IOC
  "Indian Paints",            // sector wrap on Asian Paints / Birla Opus; kept as company per existing COMPANY_TICKERS
]);
function isSector(name){
  if(COMPANY_OVERRIDE.has(name)) return false;
  if(SECTOR_EXTRA.has(name)) return true;
  // "India ..." or "Indian ..." — sectoral by default.
  return /^Indian?\s/.test(name);
}

// Parse existing NOTEBOOKS array out of index.html so we can preserve
// URLs for folders that haven't been renamed.
const html = fs.readFileSync(HTML, "utf8");
const NB_RE = /const NOTEBOOKS = \[\r?\n([\s\S]*?)\r?\n\];/;
const m = html.match(NB_RE);
if(!m){ console.error("NOTEBOOKS block not found in index.html"); process.exit(1); }
const existing = {};
for(const line of m[1].split(/\r?\n/)){
  const lm = line.match(/\{\s*name:\s*"([^"]+)"\s*,\s*url:\s*"([^"]*)"\s*\}/);
  if(lm) existing[lm[1]] = lm[2];
}

// Read the live folder list.
const folders = fs.readdirSync(REPORTS, {withFileTypes:true})
  .filter(e => e.isDirectory() && !SKIP.has(e.name))
  .map(e => e.name)
  .sort((a,b)=>a.localeCompare(b));

// Build the new NOTEBOOKS entries (existing URL or empty).
const notebooks = folders.map(name => ({name, url: existing[name] || ""}));
const sectors   = folders.filter(isSector);
const companies = folders.filter(n => !isSector(n));

// Format as JS-array literal, sorted alphabetically (matches the legacy
// ordering). Two-column wrapping kept simple for diff legibility.
const escJs = s => s.replace(/\\/g,"\\\\").replace(/"/g,'\\"');
const NB_BLOCK =
  "const NOTEBOOKS = [\n" +
  notebooks.map(n => `  {name:"${escJs(n.name)}", url:"${n.url}"},`).join("\n") +
  "\n];";

// SECTOR_NAMES set (sorted alpha for diff-friendliness; wrapped roughly
// 3-per-line to fit the existing visual style).
const sectorLines = [];
for(let i=0; i<sectors.length; i+=3){
  sectorLines.push("  " + sectors.slice(i, i+3).map(s=>`'${escJs(s)}'`).join(","));
}
const SECTOR_BLOCK =
  "const SECTOR_NAMES=new Set([\n" +
  sectorLines.join(",\n") +
  "\n]);";

// Patch index.html in place.
let out = html.replace(NB_RE, NB_BLOCK);
const SECT_RE = /const SECTOR_NAMES=new Set\(\[\r?\n[\s\S]*?\r?\n\]\);/;
if(!SECT_RE.test(out)){ console.error("SECTOR_NAMES block not found"); process.exit(1); }
out = out.replace(SECT_RE, SECTOR_BLOCK);
fs.writeFileSync(HTML, out);

// Report.
const newToList = notebooks.filter(n => !(n.name in existing));
const droppedFromList = Object.keys(existing).filter(k => !folders.includes(k));
console.log(`Patched index.html.`);
console.log(`  folders on disk:        ${folders.length}`);
console.log(`  -> companies in dropdown: ${companies.length}`);
console.log(`  -> sectors in dropdown:   ${sectors.length}`);
console.log(`  -> with NotebookLM URL:   ${notebooks.filter(n=>n.url).length}`);
console.log(`  -> pending creation:      ${notebooks.filter(n=>!n.url).length}`);
console.log(``);
if(newToList.length){
  console.log(`New folders added (${newToList.length}):`);
  newToList.forEach(n => console.log(`  + ${n.name}${isSector(n.name)?"  [sector]":""}`));
}
if(droppedFromList.length){
  console.log(`Folders no longer on disk (${droppedFromList.length}):`);
  droppedFromList.forEach(n => console.log(`  - ${n}`));
}
