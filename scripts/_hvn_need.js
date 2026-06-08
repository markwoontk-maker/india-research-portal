// Print companies (one per line) that have houseViews but whose house_view_notes
// signature is missing/stale. Used by the parallel backfill orchestrator.
var P=require("path"),CWD=process.cwd();
var T=require(P.join(CWD,"data/theses.json"));
var n={};try{n=require(P.join(CWD,"data/house_view_notes.json")).companies||{}}catch(e){}
function sig(hv){return hv.map(function(v){return v.broker+"|"+v.date}).sort().join(",");}
// order-independent: a note is current if its sig covers the same broker|date keys
// (the generator may emit them in a different sort order). sig absent/empty => stale.
function norm(s){return String(s||"").split(",").map(function(x){return x.trim()}).filter(Boolean).sort().join(",");}
console.log(Object.keys(T).filter(function(c){
  var hv=T[c]&&T[c].houseViews; if(!hv||!hv.length) return false;
  var e=n[c]; return !(e && norm(e.sig)===sig(hv));
}).join("\n"));
