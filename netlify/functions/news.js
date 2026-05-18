// Stock news via Google News RSS (India-localized, free, no key).
// Server-side so it's reliable and CDN-cached; client falls back to
// public CORS proxies if this isn't deployed yet.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">"));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

// Google News description is HTML (often a related-links list). Strip
// to plain text; drop it if it merely echoes the headline.
function snippet(descHtml, title, source) {
  // Google News encodes the description HTML as entities inside CDATA,
  // so decode &lt;/&gt; first, THEN strip tags, then decode the rest.
  let t = String(descHtml || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
  if (!t) return "";
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Strip the headline and the publisher name, see what real text is left.
  let rest = norm(t);
  rest = rest.replace(norm(title), "").replace(norm(source || ""), "");
  // Google News descriptions are usually just "headline  publisher" —
  // only keep a snippet if there's real extra prose left.
  if (rest.length < 40) return "";
  if (t.length > 240) t = t.slice(0, 237).replace(/\s+\S*$/, "") + "…";
  return t;
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
    const cap = Math.min(Math.max(parseInt((event.queryStringParameters || {}).n, 10) || 8, 1), 12);
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) && items.length < cap) {
      const b = m[1];
      const title = tag(b, "title");
      const source = tag(b, "source");
      items.push({
        title,
        link: tag(b, "link"),
        pubDate: tag(b, "pubDate"),
        source,
        snippet: snippet(tag(b, "description"), title, source),
      });
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ items }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
