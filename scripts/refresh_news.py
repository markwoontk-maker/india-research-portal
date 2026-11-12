"""Build data/news.json: the 48-hour news record behind the News tab.

Runs in GitHub Actions (.github/workflows/news.yml) every 30 minutes. The page
polls the live relay (worker/, Cloudflare) every 10 seconds; this snapshot is
the backstop that holds the full 48 hours, so the record survives reloads,
other devices and any relay outage.

It reads the same feed list as the relay (worker/feeds.json) and writes items
in the relay's exact shape, including the same id (FNV-1a of the link), so the
page can merge both without double-counting. Filtering, left/right sorting
and cross-outlet merging all happen in the browser (news-engine.js).

Each run unions the new items with the previous snapshot by id (feeds only
hold a day or so, so older stories would otherwise fall off) and drops
anything older than 48 hours.

Stdlib only.  Usage:  python scripts/refresh_news.py
"""
import datetime as dt
import email.utils
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "news.json")
FEEDS = json.load(open(os.path.join(ROOT, "worker", "feeds.json"), encoding="utf-8"))["feeds"]
WINDOW_MS = 48 * 3600 * 1000
BLURB_MAX = 360
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

# ---- helpers kept in step with worker/src/index.js -------------------------
ENT = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ", "rsquo": "'", "lsquo": "'",
       "rdquo": '"', "ldquo": '"', "ndash": "-", "mdash": "-", "hellip": "...", "rupee": "₹"}


def fnv(s):
    """FNV-1a over UTF-16 code units, base-36, matching the relay's fnv()."""
    h = 0x811C9DC5
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        h, r = divmod(h, 36)
        out = digits[r] + out
        if h == 0:
            return out


def decode(s):
    s = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", s)
    s = re.sub(r"&#x([0-9a-f]+);", lambda m: chr(int(m.group(1), 16)), s, flags=re.I)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    return re.sub(r"&([a-z]+);", lambda m: ENT.get(m.group(1).lower(), m.group(0)), s, flags=re.I)


def clean(s):
    s = decode(decode(s or ""))
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", s)).strip()


def tag(block, name):
    m = re.search(r"<" + re.escape(name) + r"(?:\s[^>]*)?>([\s\S]*?)</" + re.escape(name) + ">", block, re.I)
    return m.group(1) if m else ""


def parse_date(s):
    s = clean(s)
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except Exception:
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return int(d.timestamp() * 1000)


def parse_feed(xml, feed, now_ms):
    cutoff = now_ms - WINDOW_MS
    out, expired_run = [], 0
    for m in re.finditer(r"<item[\s>][\s\S]*?</item>", xml, re.I):
        b = m.group(0)
        pub = parse_date(tag(b, "pubDate")) or parse_date(tag(b, "dc:date"))
        if not pub:
            continue
        if pub < cutoff:
            expired_run += 1
            if expired_run >= 3:
                break
            continue
        expired_run = 0
        title = clean(tag(b, "title"))
        link = clean(tag(b, "link")) or clean(tag(b, "guid"))
        if not title or not re.match(r"^https?:", link, re.I):
            continue
        src = feed["src"]
        if not src:  # Google News: publisher in <source>, suffix on the title
            src = clean(tag(b, "source"))
            if src and title.endswith(" - " + src):
                title = title[: -(len(src) + 3)].strip()
        blurb = "" if feed["key"] == "wires" else clean(tag(b, "description"))
        if blurb and blurb.lower().startswith(title.lower()):
            blurb = re.sub(r"^[\s:.\-–—|]+", "", blurb[len(title):])
        if len(blurb) > BLURB_MAX:
            blurb = re.sub(r"\s+\S*$", "", blurb[:BLURB_MAX]) + "…"
        out.append({"i": fnv(link), "t": title, "l": link, "b": blurb, "s": src, "f": feed["key"],
                    "side": feed["side"], "p": min(pub, now_ms)})
    return out


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; india-research-portal news snapshot)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    now_ms = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    cutoff = now_ms - WINDOW_MS
    prev = []
    if os.path.exists(OUT):
        try:
            j = json.load(open(OUT, encoding="utf-8"))
            prev = j.get("items", []) if j.get("v") == 2 else []   # older formats are simply replaced
        except Exception:
            prev = []
    merged = {x["i"]: x for x in prev if x.get("p", 0) >= cutoff}
    failed, fresh = [], 0
    for feed in FEEDS:
        try:
            items = parse_feed(fetch(feed["url"]), feed, now_ms)
        except Exception as e:
            failed.append(feed["key"])
            print(f"  {feed['key']}: FAILED ({e})")
            continue
        for x in items:
            if x["i"] not in merged:
                fresh += 1
            merged[x["i"]] = x
        print(f"  {feed['key']}: {len(items)} items")
    if len(failed) == len(FEEDS):
        print("Every feed failed; leaving the existing news.json untouched.")
        return
    items = sorted(merged.values(), key=lambda x: -x["p"])
    data = {"v": 2, "updated": dt.datetime.now(IST).isoformat(timespec="minutes"),
            "window_h": 48, "failed": failed, "items": items}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(items)} items ({fresh} new), {len(failed)} feeds failed")


if __name__ == "__main__":
    main()
