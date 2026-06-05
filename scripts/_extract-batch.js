// One-shot probe: for each company in the batch, run pdftotext -layout
// on the first 4 pages and last 8 pages (where summary + estimate tables
// live), and search for the standard "FY (Mar) 20XX[AE]" header rows
// followed by Rev/EBITDA/EPS rows. Dumps results so I can read them
// and hand-transcribe into financials-manual.json.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BATCH = JSON.parse(fs.readFileSync(path.join(__dirname,'logs','manual-batch.json'),'utf8'));
const TMP = path.join(__dirname,'logs','probe-tmp.txt');

function extractPages(pdfPath, firstPage, lastPage){
  try {
    execSync(`pdftotext -layout -f ${firstPage} -l ${lastPage} "${pdfPath}" "${TMP}"`, {stdio:['ignore','ignore','ignore']});
    return fs.readFileSync(TMP,'utf8');
  } catch (e) {
    return '';
  }
}

function findFYHeader(text){
  const lines = text.split(/\r?\n/);
  const yrRe = /\b(20[2-3]\d)\s*([AE])?\b/g;
  const hits = [];
  for (let i = 0; i < lines.length; i++){
    const l = lines[i];
    const matches = [...l.matchAll(yrRe)];
    if (matches.length >= 3){
      hits.push({lineIdx: i, line: l, years: matches.map(m=>({y:m[1],t:m[2]||''}))});
    }
  }
  return hits;
}

function dumpForCompany(co, info){
  const front = extractPages(info.path, 1, 3);
  const back  = extractPages(info.path, 18, 30);
  const header = `\n${'='.repeat(72)}\n${co} — ${info.broker} ${info.date}\n${'='.repeat(72)}`;

  // Look for FY headers in both regions and dump the surrounding lines.
  console.log(header);
  console.log('FILE:', info.path.split(/[\\\/]/).pop());

  for (const [label, txt] of [['FRONT pp 1-3', front], ['BACK pp 18-30', back]]){
    const hdrs = findFYHeader(txt);
    if (!hdrs.length){
      console.log(`-- ${label}: no FY header found`);
      continue;
    }
    console.log(`-- ${label}: ${hdrs.length} FY header hit(s)`);
    const lines = txt.split(/\r?\n/);
    // Print first FY hit + 14 lines below.
    for (const h of hdrs.slice(0, 2)){
      console.log(`   (line ${h.lineIdx}) ${h.line.trim().slice(0, 140)}`);
      for (let i = h.lineIdx + 1; i < Math.min(lines.length, h.lineIdx + 16); i++){
        const l = lines[i].trim();
        if (l) console.log(`     ${l.slice(0, 140)}`);
      }
      console.log('   ----');
    }
  }
}

for (const [co, info] of Object.entries(BATCH)){
  dumpForCompany(co, info);
}
