// Rebuild data/pdfmap.json from the local broker-PDF library. The Research
// tab uses this to point each headline straight at its local PDF (file://
// URL) when the dashboard is opened from disk, instead of bouncing through
// NotebookLM.
//
// Run: node scripts/rebuild-pdfmap.js

const fs = require("fs");
const path = require("path");

const REPORTS = "C:\\Users\\admin\\Desktop\\India Related Reports";
const OUT = path.join(__dirname, "..", "data", "pdfmap.json");
const RE = /^\[(\d{6})\]\s+\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)\.pdf$/i;

// Folder-alias map — collapses duplicate notebook names (one ticker, two
// folder labels) onto the canonical name so the rest of the pipeline
// (theses / financials / dropdowns) only sees one identity per stock.
// Keep this in sync with the NOTEBOOKS dedup in index.html.
const FOLDER_ALIAS = {
  "L&T":                          "Larsen & Toubro",
  "Oil and Natural Gas":          "ONGC",
  "IndiGo":                       "InterGlobe Aviation",
  "Rainbow Children's Medicare":  "Rainbow Children's Hospitals",
};

const map = {};
let count = 0;

function walk(dir){
  for(const e of fs.readdirSync(dir, {withFileTypes:true})){
    const p = path.join(dir, e.name);
    if(e.isDirectory()){ walk(p); continue; }
    if(!e.isFile() || !p.toLowerCase().endsWith(".pdf")) continue;
    const base = path.basename(p);
    const m = base.match(RE);
    if(!m) continue;
    const [, date, house, , titleRaw] = m;
    const rawFolder = path.basename(path.dirname(p));
    const folder = FOLDER_ALIAS[rawFolder] || rawFolder;
    const titleNoSuffix = titleRaw.replace(/\s*\(\d+\)\s*$/, "").trim();
    const titleNorm = titleNoSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const key = `${house.trim()}|${date}|${folder}|${titleNorm}`;
    // First-write wins (drops "(2)" duplicates after the original — sort
    // order from readdirSync usually puts the un-suffixed file first).
    if(!(key in map)) { map[key] = p; count++; }
  }
}
walk(REPORTS);

fs.writeFileSync(OUT, JSON.stringify(map));
console.log("Wrote " + count + " entries to " + OUT);
