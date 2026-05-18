// Stock news via Google News RSS (India-localized, free, no key).
// Server-side so it's reliable and CDN-cached; client falls back to
// public CORS proxies if this isn't deployed yet.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">"));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const q = event.queryStringParameters && event.queryStringParameters.q;
  if (!q) return { statusCode: 400, headers: cors, body: '{"error":"q required"}' };

  const rss = "https://news.google.com/rss/search?q=" +
    encodeURIComponent(q) + "&hl=en-IN&gl=IN&ceid=IN:en";
  try {
    const r = await fetch(rss, { headers: { "User-Agent": UA } });
    if (!r.ok) return { statusCode: 502, headers: cors, body: '{"error":"rss fetch failed"}' };
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) && items.length < 8) {
      const b = m[1];
      items.push({
        title: tag(b, "title"),
        link: tag(b, "link"),
        pubDate: tag(b, "pubDate"),
        source: tag(b, "source"),
      });
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ items }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
