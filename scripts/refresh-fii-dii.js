// Append the latest daily FII/DII cash-market net flows to data/fii_dii.json.
//
// Runs as a step in daily-refresh.ps1 (local Windows Task Scheduler, ~9:35 AM
// MYT Mon-Fri), which then commits + pushes. This replaces the remote cloud
// routine's git push, which silently fails because the CCR environment clones
// the public repo read-only (no write token) — so its appends never reached
// GitHub. Doing it here means the existing local git step publishes it.
//
// Source: fatafatniftylevels.in/fii-dii.php (the same primary the original
// build + remote-routine prompt use). Append-only: never rewrites history.
// Idempotent: a no-op when already current. Never throws non-zero on a fetch
// failure (must not abort the daily refresh) — it just logs and leaves the file.
//
// Run: node scripts/refresh-fii-dii.js

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "fii_dii.json");
const URL = "https://fatafatniftylevels.in/fii-dii.php";
const MON = { Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
              Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12" };

function num(s){ return parseFloat(String(s).replace(/[+,\s]/g, "")); }

// Parse fatafat's HTML table into [{date,fii_net,dii_net}].
function parse(html){
  const out = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows){
    const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&#8377;/g, "").trim());
    if (cells.length < 5) continue;
    const m = cells[0].match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/);  // "Wed, 04 Jun 26"
    if (!m || !MON[m[2]]) continue;
    const date = `20${m[3]}-${MON[m[2]]}-${String(m[1]).padStart(2,"0")}`;
    const fii = num(cells[3]), dii = num(cells[4]);          // ₹ Cr columns
    if (Number.isFinite(fii) && Number.isFinite(dii)) out.push({ date, fii_net: fii, dii_net: dii });
  }
  return out;
}

(async () => {
  let data;
  try { data = JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch(e){ console.log("refresh-fii-dii: cannot read data/fii_dii.json — skipping."); return; }
  if (!Array.isArray(data) || !data.length){ console.log("refresh-fii-dii: empty file — skipping."); return; }

  const have = new Set(data.map(r => r.date));
  const lastDate = data[data.length - 1].date;

  let html;
  try {
    const res = await fetch(URL, { headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9"
    } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
  } catch(e){ console.log("refresh-fii-dii: source fetch failed (" + e.message + ") — leaving file unchanged."); return; }

  const fresh = parse(html).filter(r => r.date > lastDate && !have.has(r.date));
  if (!fresh.length){ console.log("refresh-fii-dii: already current (latest " + lastDate + ")."); return; }

  fresh.sort((a,b) => a.date < b.date ? -1 : 1);
  for (const r of fresh) data.push(r);
  data.sort((a,b) => a.date < b.date ? -1 : 1);

  const lines = data.map(r => `  { "date": "${r.date}", "fii_net": ${r.fii_net}, "dii_net": ${r.dii_net} }`);
  fs.writeFileSync(FILE, "[\n" + lines.join(",\n") + "\n]\n");
  console.log("refresh-fii-dii: appended " + fresh.length + " day(s) [" + fresh.map(r=>r.date).join(", ") + "]; latest now " + data[data.length-1].date + ".");
})();
