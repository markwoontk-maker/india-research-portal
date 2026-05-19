// Forthcoming results calendar via BSE's public "forthcoming results"
// API (free, no key). ICICIdirect's results page is a JS app shell
// with no data in the HTML, so BSE is used as the free equivalent.
// Server-side fetch sets the Referer BSE expects.

function ymd(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600, s-maxage=3600",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  const today = new Date();
  const end = new Date(today.getTime() + 14 * 864e5);
  const url = "https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w" +
    "?scripcode=&Fdate=" + ymd(today) + "&TDate=" + ymd(end) + "&ddlcat=All";
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.bseindia.com/corporates/Forth_Results.html",
        "Origin": "https://www.bseindia.com",
      },
    });
    if (!r.ok) return { statusCode: 502, headers: cors, body: '{"error":"bse fetch failed","items":[]}' };
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j && j.Table) || [];
    const items = [];
    for (const o of arr) {
      const name = o.short_name || o.scrip_Name || o.Scrip_Name || o.Long_Name || o.LongName;
      const raw = o.meeting_date || o.MeetingDate || o.Result_Date || o.AnnouncementDate || o.Date;
      if (!name || !raw) continue;
      const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/) ||
        String(raw).match(/(\d{2})\/(\d{2})\/(\d{4})/);
      let iso = "";
      if (m && m[0].includes("-")) iso = `${m[1]}-${m[2]}-${m[3]}`;
      else if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (!iso) continue;
      items.push({ name: String(name).trim(), date: iso });
    }
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ source: "BSE", items, asOf: new Date().toISOString() }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e), items: [] }) };
  }
};
