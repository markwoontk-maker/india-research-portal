// One-shot migration: convert all values in data/financials-manual.json
// from ₹ cr to ₹ mn (multiply by 10), and flip the currency label.
// data/financials.json gets rebuilt by build-financials.js after this.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MANUAL = path.join(ROOT, 'data', 'financials-manual.json');

const obj = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));

function scaleNum(v){
  if (v == null || typeof v !== 'number' || !isFinite(v)) return v;
  return +(v * 10).toFixed(1);
}

let touched = 0;
for (const [co, entry] of Object.entries(obj)){
  if (co.startsWith('_')) continue;
  if (entry.currency === '₹ cr' || entry.currency === '₹ cr'){
    entry.currency = '₹ mn';
    touched++;
  } else if (!entry.currency){
    entry.currency = '₹ mn';
  }
  // metrics.{revenue,ebitda,netProfit}.{FYxx}.{avg, brokers:[{value}]}
  for (const m of Object.values(entry.metrics || {})){
    for (const fy of Object.values(m)){
      if (fy.avg != null) fy.avg = scaleNum(fy.avg);
      if (Array.isArray(fy.brokers)){
        for (const b of fy.brokers){
          if (b.value != null) b.value = scaleNum(b.value);
        }
      }
    }
  }
  // Adani Enterprises segments — same scaling.
  if (entry.segments){
    for (const seg of Object.values(entry.segments)){
      for (const m of Object.values(seg.metrics || {})){
        for (const segRow of Object.values(m)){
          for (const fy of Object.keys(segRow)){
            if (segRow[fy] != null) segRow[fy] = scaleNum(segRow[fy]);
          }
        }
      }
    }
  }
}

// Re-serialise (one company per line so diffs stay clean).
const KEYS = Object.keys(obj).sort((a,b)=>{
  if (a.startsWith('_')) return -1;
  if (b.startsWith('_')) return 1;
  return a.localeCompare(b);
});
const json = '{\n' + KEYS.map(k =>
  '  ' + JSON.stringify(k) + ': ' + JSON.stringify(obj[k], null, 2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')
).join(',\n') + '\n}\n';
fs.writeFileSync(MANUAL, json);
console.log(`Migrated ${touched} entries from ₹ cr → ₹ mn (×10).`);
