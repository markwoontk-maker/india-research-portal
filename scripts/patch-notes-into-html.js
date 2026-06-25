// Patcher for the Research tab's notes data.
//
// As of the 2026-06-23 outage, the inline `let notes = [...]` and
// `const notesPrior = [...]` arrays in index.html are PERMANENT empty
// stubs — the canonical source is data/research.json, which the page
// fetches on load and overlays into the in-memory arrays. The old
// behaviour of splicing literal arrays into the inline <script> bundle
// has been removed; a malformed splice was what blanked the site.
//
// This script now:
//   1. Reads scripts/notes-recent.txt + scripts/notes-prior.txt
//      (each line is one JS-tuple literal: ["house","date","folder","headline"],)
//   2. Parses each line into a real JS array.
//   3. Calls safe-write-json's patchResearchJson({notes, prior}) — atomic
//      tmp→parse-check→rename, never leaves a half-written file in main.
//
// Read: scripts/notes-recent.txt, scripts/notes-prior.txt
// Write: data/research.json (atomic; keeps any existing `ext` etc. intact)

const fs = require("fs");
const path = require("path");
const { patchResearchJson } = require("./safe-write-json");

const ROOT   = path.join(__dirname, "..");
const RECENT = path.join(__dirname, "notes-recent.txt");
const PRIOR  = path.join(__dirname, "notes-prior.txt");

// Trendlyne externals (BOB, BP Wealth, ICICI Direct, Prabhudas Lilladhar) —
// not in the local library, so keep them in notesPrior to power Prev TP lookup.
const TRENDLYNE_PRIOR = [
  ["BOB Capital Markets","260517","Somany Ceramics","Buy · TP ₹520 — Sharp margin recovery drives earnings beat"],
  ["BOB Capital Markets","260517","Devyani International","Buy · TP ₹141 — Recovery trends"],
  ["BOB Capital Markets","260516","Tata Steel","Hold · TP ₹223 — Results beat on better volumes, cost saving"],
  ["BOB Capital Markets","260516","Steel Authority of India","Sell · TP ₹178 — Operational performance beats on lower cost"],
  ["BOB Capital Markets","260516","Alembic Pharma","Buy · TP ₹1,013 — Higher R&D spend underscores focus on US market"],
  ["BP Wealth","260516","Vedanta","Buy · TP ₹387"],
  ["ICICI Direct","260517","Bharti Airtel","Buy · TP ₹2,350"],
  ["ICICI Direct","260516","Solar Industries","Buy · TP ₹20,200 — Defence business enters accelerated growth phase"],
  ["ICICI Direct","260516","Hindustan Aeronautics","Buy · TP ₹5,300 — Execution recovery and manufacturing ramp-up"],
  ["ICICI Direct","260516","Pearl Global","Buy · TP ₹2,255 — Double-digit revenue growth guidance of 12-14% retained"],
  ["Prabhudas Lilladhar","260516","NCC","Buy · TP ₹195 — Strong fundamentals, but FY27E caution persists"],
  ["Prabhudas Lilladhar","260516","Carborundum Universal","Sell · TP ₹986 — Mixed Q4, subsidiaries recovery remains key"],
  ["Prabhudas Lilladhar","260516","Steel Authority of India","Accumulate · TP ₹209 — Higher steel pricing drive Q4; stepped up capex"],
];

// Each non-blank line of the staging files is a JS-literal array followed
// by a trailing comma. JSON.parse rejects trailing commas + JS quote style
// is already double-quoted, so strip the comma + whitespace and parse.
function parseTuples(filePath){
  const text = fs.readFileSync(filePath, "utf8");
  const out = [];
  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const trimmed = raw.trim().replace(/,$/,"");
    if (!trimmed || !trimmed.startsWith("[")) continue;
    try {
      const tup = JSON.parse(trimmed);
      if (Array.isArray(tup) && tup.length >= 4) out.push(tup);
    } catch (e) {
      console.error(`  WARN: ${path.basename(filePath)}:${lineNo} — ${e.message}: ${trimmed.slice(0,60)}`);
    }
  }
  return out;
}

const notes = parseTuples(RECENT);
const prior = parseTuples(PRIOR).concat(TRENDLYNE_PRIOR);

if (notes.length === 0) {
  // Refuse to clobber research.json with an empty notes array — that
  // would blank the Research tab silently. The build-notes-array step
  // upstream is what actually populates RECENT; an empty result means
  // something broke before we got here.
  console.error("ERROR: notes-recent.txt parsed to 0 rows — refusing to overwrite data/research.json.");
  process.exit(1);
}

patchResearchJson(ROOT, { notes, prior });
console.log("Wrote data/research.json (atomic):");
console.log("  notes:       " + notes.length + " rows");
console.log("  notesPrior:  " + prior.length + " rows  (" +
            (prior.length - TRENDLYNE_PRIOR.length) + " local + " +
            TRENDLYNE_PRIOR.length + " Trendlyne)");
