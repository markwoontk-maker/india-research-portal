// India Research Portal: live news relay (Cloudflare Worker, free plan).
//
// The News tab polls GET /news?since=<ms> every 10 s. This worker keeps the
// latest items of each publisher feed in memory, re-checks a few stale feeds
// per call, and returns the items it first saw at or after `since`.
//
// Why it is built this way: the free plan allows ~10 ms of CPU per request, so
// the worker only fetches and lightly parses. Merging stories across outlets,
// left/right sorting and the noise filters all run in the browser. Memory here
// is best-effort (an idle isolate can be recycled); after a cold start every
// item is dated by its publish time, the browser de-duplicates by id, and the
// GitHub snapshot (data/news.json) carries the full 48-hour record.

import REGISTRY from "../feeds.json";

// relay:false feeds are left to the GitHub snapshot (Google News returns 503 to Cloudflare).
const FEEDS = REGISTRY.feeds.filter((f) => f.relay !== false);
const WINDOW_MS = 48 * 3600e3;
const MAX_REFRESH_PER_CALL = 4;      // keeps parsing well inside the CPU budget
const BLURB_MAX = 360;
const ALLOWED_ORIGINS = [
  "https://markwoontk-maker.github.io",
  "http://localhost:4178", "http://localhost:8766", "http://127.0.0.1:8766",
];

// key -> { fetchedAt, etag, lastMod, sig, items: Map(id -> item), ok, status }
const STATE = new Map();

// Each feed is re-checked every 15-24 s (staggered so they don't all expire together).
function ttlFor(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 15000 + (h % 10) * 1000;
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "...", rupee: "₹" };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function clean(s) {
  // decode twice: some feeds entity-encode their HTML
  return decode(decode(s || "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

function parseFeed(xml, feed, now, prev) {
  const out = new Map();
  const cutoff = now - WINDOW_MS;
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m, expiredRun = 0;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const pub = Date.parse(clean(tag(b, "pubDate")) || clean(tag(b, "dc:date")));
    if (!pub) continue;
    if (pub < cutoff) {
      // Feeds are newest-first: stop after 3 expired items in a row (a single
      // out-of-order old entry shouldn't end the scan early).
      if (++expiredRun >= 3) break;
      continue;
    }
    expiredRun = 0;
    let title = clean(tag(b, "title"));
    let link = clean(tag(b, "link")) || clean(tag(b, "guid"));
    if (!title || !/^https?:/i.test(link)) continue;
    let src = feed.src;
    if (!src) {                                  // Google News: publisher in <source>, suffix on title
      src = clean(tag(b, "source"));
      if (src && title.endsWith(" - " + src)) title = title.slice(0, -(src.length + 3)).trim();
    }
    let blurb = feed.key === "wires" ? "" : clean(tag(b, "description"));
    if (blurb && blurb.toLowerCase().startsWith(title.toLowerCase())) blurb = blurb.slice(title.length).replace(/^[\s:.\-–—|]+/, "");
    if (blurb.length > BLURB_MAX) blurb = blurb.slice(0, BLURB_MAX).replace(/\s+\S*$/, "") + "…";
    const id = fnv(link);
    const old = prev.get(id);
    // `n` = when this relay first saw the item. On a cold start we don't know,
    // so use the publish time (never later than now).
    const seen = old ? old.n : (prev.size ? now : Math.min(pub, now));
    out.set(id, { i: id, t: title, l: link, b: blurb, s: src, f: feed.key, side: feed.side, p: pub, n: seen });
  }
  return out;
}

async function refresh(feed, now) {
  const st = STATE.get(feed.key) || { fetchedAt: 0, items: new Map() };
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; india-research-portal news relay)", "Accept": "application/rss+xml, application/xml, text/xml, */*" };
  if (st.etag) headers["If-None-Match"] = st.etag;
  if (st.lastMod) headers["If-Modified-Since"] = st.lastMod;
  try {
    const r = await fetch(feed.url, { headers, cf: { cacheTtl: 5 } });
    st.status = r.status;
    if (r.status === 304) { st.fetchedAt = now; st.ok = true; }
    else if (r.ok) {
      const xml = await r.text();
      const sig = xml.length + ":" + xml.slice(0, 400);
      if (sig !== st.sig) { st.items = parseFeed(xml, feed, now, st.items); st.sig = sig; }
      st.etag = r.headers.get("etag") || undefined;
      st.lastMod = r.headers.get("last-modified") || undefined;
      st.fetchedAt = now; st.ok = true;
    } else { st.fetchedAt = now; st.ok = false; }
  } catch (e) { st.fetchedAt = now; st.ok = false; st.status = 0; }
  STATE.set(feed.key, st);
}

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const now = Date.now();
    if (url.pathname === "/health") {
      const feeds = {};
      for (const f of FEEDS) { const s = STATE.get(f.key); feeds[f.key] = s ? { ok: s.ok, status: s.status, ageS: Math.round((now - s.fetchedAt) / 1000), n: s.items.size } : null; }
      return new Response(JSON.stringify({ now, feeds }), { headers: cors(req) });
    }
    if (url.pathname !== "/news") return new Response("Not found", { status: 404 });

    // Re-check the stalest few feeds (all of them on a cold start, in batches across calls).
    const stale = FEEDS
      .map((f) => ({ f, age: now - ((STATE.get(f.key) || {}).fetchedAt || 0) }))
      .filter((x) => x.age >= ttlFor(x.f.key))
      .sort((a, b) => b.age - a.age)
      .slice(0, MAX_REFRESH_PER_CALL);
    await Promise.all(stale.map((x) => refresh(x.f, now)));

    const since = Number(url.searchParams.get("since")) || 0;
    const cutoff = now - WINDOW_MS;
    const items = [];
    for (const st of STATE.values()) {
      for (const it of st.items.values()) if (it.n >= since && it.p >= cutoff) items.push(it);
    }
    const ready = FEEDS.filter((f) => STATE.has(f.key)).length;
    return new Response(JSON.stringify({ now, ready, total: FEEDS.length, items }), { headers: cors(req) });
  },
};
