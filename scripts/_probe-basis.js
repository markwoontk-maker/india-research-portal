// Probe each manual entry's source PDF for the basis of its financial TABLE,
// by finding caption lines that pair a basis word (consolidated/standalone)
// with a statement heading (income statement / P&L / financial summary / key
// metrics / snapshot / forecasts). Output: scripts/logs/basis-probe.txt
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const manual = JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','financials-manual.json'),'utf8'));
const TMP = path.join(__dirname,'logs','basis-tmp.txt');
const out = [];

function urlToPath(u){
  if(!u) return null;
  let s = u.replace(/^file:\/+/, '');
  s = decodeURIComponent(s);
  if(/^[A-Za-z]\//.test(s)) s = s[0]+':'+s.slice(1);
  return s.replace(/\//g,'\\');
}
function pages(pdf, fp, lp){
  try { execSync(`pdftotext -layout -f ${fp} -l ${lp} "${pdf}" "${TMP}"`, {stdio:['ignore','ignore','ignore']}); return fs.readFileSync(TMP,'utf8'); }
  catch { return ''; }
}

const STMT = /(income statement|profit\s*(and|&)\s*loss|p\s*&\s*l|financial summary|key metrics|financial snapshot|summary income|forecasts|financial statements)/i;
const BASIS = /(consolidated|standalone)/i;

// known path fixes
const FIX = { 'L&T':'Larsen & Toubro' };

for(const [co, e] of Object.entries(manual)){
  if(co.startsWith('_')) continue;
  let url=null;
  outer: for(const mk of Object.values(e.metrics||{})) for(const fy of Object.values(mk)) for(const b of (fy.brokers||[])){ url=b.url; break outer; }
  let pdf = urlToPath(url);
  // path fix: some urls encode the display name (e.g. L&T) differently
  if(pdf && !fs.existsSync(pdf)){
    const alt = pdf.replace(/\\L&T\\/, '\\Larsen & Toubro\\');
    if(fs.existsSync(alt)) pdf = alt;
  }
  out.push('\n'+'='.repeat(70)+'\n'+co+'  ['+(e.notes||'')+']');
  if(!pdf || !fs.existsSync(pdf)){ out.push('  (pdf not found: '+pdf+')'); continue; }
  const txt = pages(pdf,1,25);
  const lines = txt.split(/\r?\n/);
  const caps = [];
  for(const l of lines){
    const t=l.trim();
    if(t.length>4 && t.length<120 && STMT.test(t) && BASIS.test(t)) caps.push(t);
  }
  // also bare statement captions (basis often implied)
  const bare = [];
  for(const l of lines){
    const t=l.trim();
    if(t.length>4 && t.length<90 && /(income statement|profit\s*(and|&)\s*loss|summary income statement)/i.test(t) && !BASIS.test(t)) bare.push(t);
  }
  if(caps.length){ out.push('  BASIS-CAPTIONS:'); [...new Set(caps)].slice(0,6).forEach(c=>out.push('    '+c)); }
  else if(bare.length){ out.push('  bare statement captions (basis not stated in caption):'); [...new Set(bare)].slice(0,5).forEach(c=>out.push('    '+c)); }
  else out.push('  (no statement caption found in pp1-25)');
}

fs.writeFileSync(path.join(__dirname,'logs','basis-probe.txt'), out.join('\n'));
console.log('Wrote scripts/logs/basis-probe.txt');
