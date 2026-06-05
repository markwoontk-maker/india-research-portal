// Probe A-C companies: for each (latest report), pull pages 1-3 and
// dump the FY-header block (Jefferies "FY (Mar)" or JPMorgan "Key Metrics
// (FYE Mar)" or Kotak "Forecasts/Valuations" or Nomura "Income statement").
// Output goes to scripts/logs/ac-batch.txt for me to read in one pass.

const fs=require('fs');
const path=require('path');
const {execSync}=require('child_process');
const m=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','pdfmap.json'),'utf8'));

const SECTORS=new Set(['India Macro','India Strategy','Indian Financials','Indian Autos','Indian Banks','Indian Pharmaceuticals','Indian IT','Indian Oil & Gas','Indian Power','Indian Real Estate','Indian Insurance','Indian Cement','Indian Telecom','Indian Steel','Indian Metals','Indian Consumer','Indian Healthcare','Indian Infra','Indian Mortgages','Indian NBFCs','Indian Asset Managers','Indian Aviation','Indian Chemicals','Indian Consumer Durables','Indian Datacenters','Indian Jewellery','Indian Paints','Indian Pipes','Indian Power Equipment','Capital Markets','Asia Equity Strategy']);
const DONE=new Set(['Adani Enterprises','Adani Ports and SEZ','Amber Enterprises','Apollo Hospitals','Avenue Supermarts']);

const byCo={};
for (const k of Object.keys(m)){
  const [h,d,c]=k.split('|');
  if (SECTORS.has(c) || DONE.has(c)) continue;
  if (!/^[A-Ca-c]/.test(c)) continue;
  if (!byCo[c]) byCo[c]={};
  if (!byCo[c][h] || byCo[c][h].d<d) byCo[c][h]={d, path: m[k]};
}

const TMP=path.join(__dirname,'logs','probe-tmp.txt');
function extract(p, fp, lp){
  try { execSync(`pdftotext -layout -f ${fp} -l ${lp} "${p}" "${TMP}"`, {stdio:['ignore','ignore','ignore']}); return fs.readFileSync(TMP,'utf8'); }
  catch { return ''; }
}

const out=[];
for (const co of Object.keys(byCo).sort()){
  out.push('\n'+'='.repeat(70)+'\n'+co+'\n'+'='.repeat(70));
  for (const h of Object.keys(byCo[co]).sort()){
    const info=byCo[co][h];
    const file=info.path.split(/[\\\/]/).pop();
    out.push(`\n--- ${h} ${info.d} :: ${file}`);
    const text=extract(info.path, 1, 3);
    if (!text){ out.push('  (pdftotext failed)'); continue; }
    const lines=text.split(/\r?\n/);
    // Find the first FY-header line and dump 14 lines around it.
    let found=false;
    for (let i=0; i<lines.length; i++){
      const l=lines[i];
      const yrs=l.match(/\b20[2-3]\d\s*[AEF]?\b/g) || [];
      if (yrs.length>=3 && /FY|Mar|Year end|Key Metrics|Forecasts|Income statement|Financials/i.test(l) ||
          /^(FY \(Mar\)|FYE Mar|Year end March|Key Metrics \(FYE Mar\)|Income statement)/i.test(l)){
        found=true;
        for (let j=Math.max(0,i-1); j<Math.min(lines.length, i+18); j++){
          const ll=lines[j].trim();
          if (ll && ll.length<160) out.push('  '+ll);
        }
        break;
      }
    }
    if (!found) out.push('  (no FY header block found in pp 1-3)');
  }
}
fs.writeFileSync(path.join(__dirname,'logs','ac-batch.txt'), out.join('\n'));
console.log('Wrote scripts/logs/ac-batch.txt with', Object.keys(byCo).length, 'companies');
