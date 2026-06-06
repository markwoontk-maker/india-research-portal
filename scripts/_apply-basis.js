// Retrofit entry.basis onto every existing manual financial entry.
// Basis assigned from probe-confirmed captions (scripts/logs/basis-probe.txt)
// + Indian-research reporting convention. Idempotent: re-running just resets
// the labels. Rebuilds each entry with a tidy key order:
//   currency, basis, metrics, alt?, segments?, notes
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname,'..','data','financials-manual.json');
const m = JSON.parse(fs.readFileSync(P,'utf8'));

// '' (none) entries are operating companies whose broker headline estimates
// are consolidated; STAND lists banks / single-entity / minimal-sub names.
const STANDALONE = new Set([
  'Aditya Birla Capital',     // confirmed: Kotak "(standalone)" NBFC table
  'Bharat Petroleum',         // confirmed: "Summary Standalone Income Statement"
  'InterGlobe Aviation',      // confirmed: "(standalone) reported PAT"; single entity
  'State Bank of India',      // bank: broker front-table models standalone bank PAT
  'Bharat Electronics',       // PSU, immaterial subs (standalone ≈ consolidated)
  'Cummins India',            // reports standalone primary; JVs are associates
  'GE Vernova T&D India',     // single operating entity
]);
// Everything else => Consolidated (material subsidiaries / broker default).
// Confirmed-consolidated captions: Eicher, Torrent, Bajaj Finserv, Apollo,
// Belrise, Lloyds, Reliance, Adani Ent/Ports.

function rebuild(e, basis){
  const o = {};
  if (e.currency!=null) o.currency = e.currency;
  o.basis = basis;
  if (e.metrics!=null)  o.metrics  = e.metrics;
  if (e.alt!=null)      o.alt      = e.alt;
  if (e.segments!=null) o.segments = e.segments;
  if (e.notes!=null)    o.notes    = e.notes;
  // carry any unexpected extra keys
  for (const k of Object.keys(e)) if (!(k in o)) o[k]=e[k];
  return o;
}

let con=0, sta=0;
const out = {};
for (const [co,e] of Object.entries(m)){
  if (co.startsWith('_')){ out[co]=e; continue; }
  const basis = STANDALONE.has(co) ? 'Standalone' : 'Consolidated';
  if (basis==='Standalone') sta++; else con++;
  out[co] = rebuild(e, basis);
}

// Pretty-print preserving the build script's 2-space style.
fs.writeFileSync(P, JSON.stringify(out, null, 2) + '\n');
console.log(`Applied basis: ${con} consolidated, ${sta} standalone.`);
