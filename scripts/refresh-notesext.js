// Refresh the notesExt (external Trendlyne broker calls) array in index.html
// with the latest 2 days' reports, and move the now-stale entries into
// notesPrior so the Prev TP / Prev Call lookup still has history.
//
// Usage: node scripts/refresh-notesext.js
//
// The fresh entries are hardcoded below (manually curated from a WebFetch
// pull of trendlyne.com/research-reports/all/). Replace TRENDLYNE_NEW each
// time the routine runs.

const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "..", "index.html");

// Today is 2026-06-03. The fresh batch covers reports dated 260601-260603.
// Schema: [house, dateYYMMDD, folder, headline-with-call+TP, url].
const TRENDLYNE_NEW = [
  ['Motilal Oswal','260602','Shriram Finance','Buy · TP ₹1,175 — Capital strength and NIM expansion to accelerate earnings growth','https://trendlyne.com/get-document/post/pdf/5676381/'],
  ['Motilal Oswal','260602','ITC','Neutral · TP ₹300 — Cigarette earnings under a cloud; remain cautious','https://trendlyne.com/get-document/post/pdf/5676379/'],
  ['Emkay','260602','Ipca Laboratories','Buy · TP ₹1,800 — Sharp price-value disconnect emerging','https://trendlyne.com/get-document/post/pdf/5676375/'],
  ['IDBI Capital','260602','NMDC','Buy · TP ₹102 — Technical pick update, consolidation breakout','https://trendlyne.com/get-document/post/pdf/5675960/'],
  ['Axis Direct','260602','Ahluwalia Contracts','Buy · TP ₹915 — Result update, estimates rolled to FY28','https://trendlyne.com/get-document/post/pdf/5675952/'],
  ['Prabhudas Lilladhar','260602','KNR Constructions','Hold · TP ₹119 — Q4FY26, execution recovery deferred to FY28','https://trendlyne.com/get-document/post/pdf/5675944/'],
  ['Prabhudas Lilladhar','260602','NMDC','Accumulate · TP ₹97 — Q4FY26, stepping up capex; higher pricing','https://trendlyne.com/get-document/post/pdf/5675943/'],
  ['Prabhudas Lilladhar','260602','Ipca Laboratories','Buy · TP ₹1,800 — Q4FY26, strong FY27 guidance','https://trendlyne.com/get-document/post/pdf/5675942/'],
];

const fmt = arr => arr.map(r => "  [" + r.map(s => JSON.stringify(s)).join(",") + "],").join("\n");

let html = fs.readFileSync(HTML, "utf8");

// Capture the existing notesExt array body so we can park its rows
// (dates 260518-260519) in notesPrior for prev-TP lookup.
const extRe = /let notesExt = \[\r?\n([\s\S]*?)\r?\n\];/;
const extM = html.match(extRe);
if(!extM){ console.error("notesExt block not found"); process.exit(1); }
const existingExtBody = extM[1];
const existingExtCount = existingExtBody.split("\n").filter(l => l.trim().startsWith("[")).length;

// Replace notesExt with the fresh batch.
const newExtBlock =
  "let notesExt = [\n" + fmt(TRENDLYNE_NEW) + "\n];";
html = html.replace(extRe, newExtBlock);

// Append the now-stale Trendlyne rows (260518-260519) to notesPrior. They
// already use the same 5-tuple schema; renderer's keyOf for prior uses
// only positions 0-3, ignoring the URL.
const priorRe = /const notesPrior = \[\r?\n([\s\S]*?)\r?\n\];/;
const priorM = html.match(priorRe);
if(!priorM){ console.error("notesPrior block not found"); process.exit(1); }
const priorBody = priorM[1];

const newPriorBlock =
  "const notesPrior = [\n" +
  priorBody + "\n" +
  "  // Trendlyne (parked from notesExt — dates 260518-260519)\n" +
  existingExtBody + "\n" +
  "];";
html = html.replace(priorRe, newPriorBlock);

fs.writeFileSync(HTML, html);
console.log("Refreshed notesExt with " + TRENDLYNE_NEW.length + " entries.");
console.log("Parked " + existingExtCount + " stale Trendlyne rows into notesPrior.");
