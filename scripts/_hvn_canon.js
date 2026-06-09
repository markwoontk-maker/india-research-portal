// Accuracy-safe signature recovery for house_view_notes.json.
// A note's content was generated against a specific set of houseViews. The
// generator may emit the sig in a different sort order, and the daily theses
// rebuild can change a company's houseViews. We ONLY canonicalize (mark current)
// a note whose broker set EXACTLY matches the company's CURRENT houseViews — i.e.
// the views haven't changed since generation, so the content is still complete
// and the only discrepancy is sig formatting. Notes whose houseViews changed
// (different broker/date set) are left stale so they get regenerated.
const fs=require("fs"),P=require("path"),CWD=process.cwd();
const T=require(P.join(CWD,"data/theses.json"));
const path=P.join(CWD,"data/house_view_notes.json");
const d=JSON.parse(fs.readFileSync(path,"utf8").replace(/^﻿/,""));
const sig=hv=>hv.map(v=>v.broker+"|"+v.date).sort().join(",");
const setEq=(a,b)=>{a=[...new Set(a)].sort();b=[...new Set(b)].sort();return a.length===b.length&&a.every((x,i)=>x===b[i]);};
let fixed=0;
Object.keys(d.companies||{}).forEach(c=>{
  const hv=T[c]&&T[c].houseViews; if(!hv||!hv.length) return;
  const e=d.companies[c];
  if(typeof e.summary!=="string"||e.summary.length<40||!e.brokers) return;
  const hvKeys=hv.map(v=>v.broker+"|"+v.date);
  const noteKeys=Object.keys(e.brokers);
  if(setEq(hvKeys,noteKeys)){            // views unchanged -> content still complete
    const want=sig(hv);
    if(e.sig!==want){ e.sig=want; fixed++; }
  }
});
fs.writeFileSync(path, JSON.stringify(d,null,2));
const cur=Object.keys(d.companies).filter(c=>T[c]&&T[c].houseViews&&d.companies[c].sig===sig(T[c].houseViews)).length;
console.log("canonicalized:"+fixed+" | accurate:"+cur+"/169 | in-file:"+Object.keys(d.companies).length);
