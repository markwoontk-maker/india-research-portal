// Append the latest daily FII/DII cash-market net flows to data/fii_dii.json.
//
// Runs as a step in daily-refresh.ps1 AND as the standalone "India FII-DII
// Refresh" task (weekday 09:00), which then commits + pushes. Local, because a
// remote cloud routine's git push silently fails (read-only clone).
//
// SOURCES (tried in order, results merged):
//   1. fatafatniftylevels.in/fii-dii.php  — the canonical primary the series was
//      built from; needs Accept/Accept-Language headers or it 502s.
//   2. groww.in/fii-dii-data              — FALLBACK. CLAUDE.md's designated
//      reference (fatafat was validated to match Groww + NSE exactly). Added
//      2026-08-04 because fatafat routinely lags a full trading day (it sat on
//      31 Jul while Groww already had 03 Aug), which left the chart stale.
// For any date, fatafat's value wins when both carry it; Groww only fills days
// fatafat is missing. If the two disagree by >1 cr on a shared date it logs a
// warning and keeps fatafat (guards against a bad source silently diverging).
//
// Append-only: never rewrites history. Idempotent: a no-op when already current
// (both sources ordered by date, only dates newer than the file's last are
// added). Never throws non-zero on a fetch failure — it must not abort the
// daily refresh; it just logs and leaves the file.
//
// Run: node scripts/refresh-fii-dii.js

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "fii_dii.json");
const MON = { Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
              Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12" };

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9"
};

function num(s){ return parseFloat(String(s).replace(/[+,\s]/g, "")); }

// Split an HTML table into rows of trimmed, tag-stripped cell strings.
function rowsCells(html){
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows.map(row => (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
    .map(c => c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&#8377;/g, "").replace(/&amp;/g, "&").trim()));
}

// fatafat: date like "Wed, 04 Jun 26"; cells[3]=FII net, cells[4]=DII net (₹ Cr).
function parseFatafat(html){
  const out = [];
  for (const cells of rowsCells(html)){
    if (cells.length < 5) continue;
    const m = cells[0].match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/);
    if (!m || !MON[m[2]]) continue;
    const date = `20${m[3]}-${MON[m[2]]}-${String(m[1]).padStart(2,"0")}`;
    const fii = num(cells[3]), dii = num(cells[4]);
    if (Number.isFinite(fii) && Number.isFinite(dii)) out.push({ date, fii_net: fii, dii_net: dii });
  }
  return out;
}

// groww: date like "03 Aug 2026"; cells = [date, FIIbuy, FIIsell, FIInet, DIIbuy, DIIsell, DIInet].
function parseGroww(html){
  const out = [];
  for (const cells of rowsCells(html)){
    if (cells.length < 7) continue;
    const m = cells[0].match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (!m || !MON[m[2]]) continue;
    const date = `${m[3]}-${MON[m[2]]}-${String(m[1]).padStart(2,"0")}`;
    const fii = num(cells[3]), dii = num(cells[6]);
    if (Number.isFinite(fii) && Number.isFinite(dii)) out.push({ date, fii_net: fii, dii_net: dii });
  }
  return out;
}

const SOURCES = [
  { name: "fatafat", url: "https://fatafatniftylevels.in/fii-dii.php", parse: parseFatafat },
  { name: "groww",   url: "https://groww.in/fii-dii-data",             parse: parseGroww }
];

async function getText(url){
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

(async () => {
  let data;
  try { data = JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch(e){ console.log("refresh-fii-dii: cannot read data/fii_dii.json — skipping."); return; }
  if (!Array.isArray(data) || !data.length){ console.log("refresh-fii-dii: empty file — skipping."); return; }

  const have = new Set(data.map(r => r.date));
  const lastDate = data[data.length - 1].date;

  // Merge new rows from every source; first source to carry a date wins, so
  // fatafat (listed first) is authoritative and groww only fills its gaps.
  const collected = new Map();  // date -> {date, fii_net, dii_net, src}
  let anySource = false;
  for (const s of SOURCES){
    let rows;
    try { rows = s.parse(await getText(s.url)); anySource = true; }
    catch(e){ console.log(`refresh-fii-dii: ${s.name} fetch/parse failed (${e.message}) — trying next.`); continue; }
    for (const r of rows){
      if (r.date <= lastDate || have.has(r.date)) continue;
      const prev = collected.get(r.date);
      if (!prev){ collected.set(r.date, { ...r, src: s.name }); }
      else if (Math.abs(prev.fii_net - r.fii_net) > 1 || Math.abs(prev.dii_net - r.dii_net) > 1){
        console.log(`refresh-fii-dii: WARNING ${r.date} sources disagree — ${prev.src} ${prev.fii_net}/${prev.dii_net} vs ${s.name} ${r.fii_net}/${r.dii_net}; keeping ${prev.src}.`);
      }
    }
  }
  if (!anySource){ console.log("refresh-fii-dii: all sources failed — leaving file unchanged."); return; }

  const fresh = [...collected.values()].sort((a,b) => a.date < b.date ? -1 : 1);
  if (!fresh.length){ console.log("refresh-fii-dii: already current (latest " + lastDate + ")."); return; }

  for (const r of fresh) data.push({ date: r.date, fii_net: r.fii_net, dii_net: r.dii_net });
  data.sort((a,b) => a.date < b.date ? -1 : 1);

  const lines = data.map(r => `  { "date": "${r.date}", "fii_net": ${r.fii_net}, "dii_net": ${r.dii_net} }`);
  fs.writeFileSync(FILE, "[\n" + lines.join(",\n") + "\n]\n");

  const bySrc = fresh.reduce((m,r) => { (m[r.src] = m[r.src] || []).push(r.date); return m; }, {});
  const tag = Object.entries(bySrc).map(([s,ds]) => `${s}:[${ds.join(", ")}]`).join(" ");
  console.log("refresh-fii-dii: appended " + fresh.length + " day(s) " + tag + "; latest now " + data[data.length-1].date + ".");
})();
