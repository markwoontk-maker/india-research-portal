"""Build data/news.json for the News tab's "News You Need to Know" card.

Runs in GitHub Actions (.github/workflows/news.yml) every 30 minutes, the same
way the Indonesia portal does it. The page only reads the committed JSON.
Fetching in the browser through free CORS proxies (rss2json, allorigins,
codetabs) stopped working, and the page then fell back to a cached render that
was months old. Server-side fetching avoids that.

Source: Google News RSS (India edition), one query per bucket, last 2 days.
The filters are ported from the old client-side loadNews(): the per-bucket
topic test, then a "fact-only" pass that drops listicles, previews, forecasts,
pundit commentary and question headlines.

Stdlib only.  Usage:  python scripts/refresh_news.py
"""
import datetime as dt
import email.utils
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "news.json")
WINDOW_H = 48          # the News tab shows the last 2 days only
PER_BUCKET = 25
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

# key: (label, query). Order here is the order of the filter pills.
BUCKETS = {
    "POL": ("Policy", 'India (cabinet OR "Modi government" OR PMO OR ministry OR "fuel price" OR "excise duty" '
                      'OR budget OR GST OR tariff OR reform OR disinvestment OR "trade deal" OR SEBI OR policy OR parliament)'),
    "ECON": ("Economy", 'India (inflation OR CPI OR WPI OR "repo rate" OR "rate cut" OR RBI OR "monetary policy" OR GDP '
                        'OR IIP OR "industrial production" OR "fiscal deficit" OR "current account" OR FDI OR rupee '
                        'OR "bond yield" OR "forex reserves")'),
    "MKT": ("Markets", '(Sensex OR Nifty OR "Dalal Street" OR "Indian shares" OR "Indian stocks" OR "Nifty 50" OR "Bank Nifty")'),
    "EARN": ("Earnings", 'India ("Q1 results" OR "Q2 results" OR "Q3 results" OR "Q4 results" OR "quarterly results" OR earnings '
                         'OR "net profit" OR "profit after tax" OR EBITDA)'),
    "CORP": ("Corporate", 'India (merger OR acquisition OR "stake sale" OR demerger OR "open offer" OR buyback OR "board approves" '
                          'OR "appointed as" OR "new CEO" OR "joint venture" OR QIP OR "fund raise" OR "order win" OR IPO)'),
    # Phrased for the daily provisional prints ("FIIs net sell Rs 2,961 crore, DIIs net buy ...").
    # A looser query made Google ignore when:2d and return only month-old roundups.
    "FLOW": ("Foreign flows", '(FIIs OR DIIs OR FPIs OR FII OR FPI) crore (Sensex OR Nifty OR equities OR "cash market" OR "Indian equities")'),
    # Global wires via site: so Reuters/Bloomberg/AP stories are always represented.
    "WIRE": ("Wires", '(site:reuters.com OR site:bloomberg.com OR site:apnews.com) (intitle:India OR intitle:Indian '
                      'OR intitle:rupee OR intitle:RBI OR intitle:Sensex OR intitle:Nifty)'),
}

# ---- filters (ported verbatim from the old client-side loadNews) ----------------
SOC_RE = re.compile(r"(cricket|\bipl\b|sport|football|hockey|kabaddi|bollywood|\bfilm\b|movie|actor|actress|celebrit|singer|\bott\b|web series|murder|rape|assault|\bcrime\b|accident|road mishap|weather|rainfall|\bflood\b|cyclone|heatwave|festival|temple|mosque|church|religio|wedding|marriage|divorce|viral video|gossip|astrolog|horoscope|entertainment|fashion|recipe|lifestyle|obituary|tribute|birthday|box office)", re.I)
MKT_RE = re.compile(r"(econom|market|sensex|nifty|stock|share|equit|rbi|sebi|budget|gst|tariff|\btax\b|fiscal|\bfii\b|\bfpi\b|\bfdi\b|rupee|inflation|repo|bond|monetary|disinvest|divest|\bpsu\b|\bipo\b|reform|trade (deal|pact|deficit)|export|import|\bgdp\b|industrial|earnings|capex|subsid|\bpli\b|infrastructure|deficit|borrow|bank|rate (cut|hike)|sector|investor|crude|foreign)", re.I)
# "PAT" is matched case-sensitively below (PAT_RE) so a person named Pat isn't an earnings story.
PAT_RE = re.compile(r"\bPAT\b")
EARN_RE = re.compile(r"(\bq[1-4]\b|quarter|results|earnings|net profit|profit after tax|revenue|ebitda|topline|bottom\s?line|posts|reports|beats|misses|profit (jump|rise|fall|drop|surge|decline)|loss)", re.I)
EARN_EXCL = re.compile(r"(among (?:\d+\s*\+?\s*)?(?:companies|firms)|companies to (?:declare|post|watch|report)|firms to post|to (?:post|declare|announce|report) (?:q[1-4]|its q[1-4]|earnings|results)|results (?:today|preview|calendar|live|date|expectations?|to watch)|stocks? to watch|buzzing stocks|top (?:buzzing|gainers|losers)|ahead of (?:q[1-4]|results|earnings)|what to expect|check (?:full |the )?list|earnings (?:calendar|preview)|q[1-4][^.]*\b(?:preview|expectations|to watch)\b|live updates?|here'?s the (?:full )?list|schedules? .*earnings call|earnings call on|to host .*(?:earnings|investor) call|board meeting (?:on|date)|to consider .*results on|call scheduled|results watch|earnings call|(?:median|weekly|average) earnings|highest-paid)", re.I)
CORP_RE = re.compile(r"(merger|acquisition|acquire|to buy|stake (sale|buy)|divest|demerger|amalgamat|open offer|buyback|board (approves|approval)|resign|steps? down|appointed|elevat|new (ceo|md|cfo|chair)|managing director|restructur|joint venture|\bjv\b|fund[- ]?rais|\bqip\b|preferential|rights issue|delisting|insolvency|order win|bags? .*order|contract win|\bipo\b)", re.I)
GOVT_RE = re.compile(r"(joint secretar|government of india|cabinet secretar|\bIAS\b|\bIPS\b|\bIFS officer|ministry of|bureaucrat|govt (officer|reshuffle)|civil servant|district magistrate|collector appointed|air marshal|army chief|navy chief|chief of (?:the )?(?:army|navy|air|defence))", re.I)
NEWS_EXCL = re.compile(r"\b(?:live updates?|results live|what to (?:expect|know)|stocks? to watch|buzzing stocks|in focus|ahead of (?:q[1-4]|results|earnings|the budget|monetary policy|rbi)|\d+ (?:things|reasons|stocks?|key|smart|top|best) (?:to|you|that|things)|key (?:takeaways|highlights|things to know)|all you need to know|here'?s (?:why|how|what|where)\b|will (?:rbi|the|govt|fed|markets?|inflation)\b|stocks to buy|set to (?:rise|fall|hike|cut)|why (?:is|are|did)\b|(?:might|may|could) (?:rise|fall|cut|hike|gain|drop)|\bpreview\b|\bexplained\b|\bexplainer\b|\bbreakdown\b|what changed|why it matters|\bdeep dive\b|\bby 20\d\d\b|needs? to\s|likely to\s|expected to\s|forecast(?:s|ing|ed)?\b|\bprojected\b|\bprojection\b|aims? to\s|targets? to\s|\bestimates? to\b|to (?:reach|boost|raise|grow|hit|cross|touch|achieve|become|spend|invest)\s|should (?:hit|reach|raise|boost|grow|cross|achieve)\s|\b(?:report|study|survey|paper)\s*:|\boutlook\b|seen at\b|price prediction|should you (?:buy|sell)|target price|unpacking|decoded|what (?:it|this) means|means for (?:you|your))", re.I)
OPINION_VERB = r"(?:says?|said|flags?|flagged|warns?|warned|argues?|argued|notes?|noted|believes?|opines?|cautions?|cautioned|told|tells|sees?|saw|reckons?|reckoned|comments?|commented|highlights?|highlighted|fears?|feared|expects?|predicts?|predicted)"
OPINION_NAMED_RE = re.compile(r"\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+" + OPINION_VERB + r"\b")
INSTITUTION = "RBI|SEBI|Govt|Government|PMO|Cabinet|Ministry|Court|Supreme|High|FED|US|EU|UK|UN|IMF|OECD|World|Bank|Inc|Ltd|India|Indian|National|Modi|Centre|State|Parliament|Lok|Rajya|White|House|Trump|President|Prime|Minister|Mr|Mrs|Ms|Dr|CM"
OPINION_SINGLE_RE = re.compile(r"\b(?!(?:" + INSTITUTION + r")\b)[A-Z][a-z]+\s+" + OPINION_VERB + r"\b")
QUESTION_RE = re.compile(r"^\s*(?:will|why|how|what|does|should|can|could|would|are|is|do|did)\s+", re.I)


# Additions beyond the old client filters (found while porting): celebrity
# "net worth"/US sports pieces matching "earnings", how-to explainers, and
# outlets whose headlines are machine-generated price snapshots.
SOC2_RE = re.compile(r"\b(nba|nfl|mlb|net worth|salary and career)\b", re.I)
JUNK_RE = re.compile(r"(^watch\b|\bhow to\b|allotment status|check (?:allocation|status)|what'?s ahead|\bseen (?:rising|falling|growing|at|to|up|down)\b|\bfind\b.*\bresults\b|results 20\d\d\s*-)", re.I)
JUNK_SOURCES = {"marketscreener.com", "AD HOC NEWS"}
# The Wires bucket's site: query brings in any Reuters/Bloomberg story; keep
# only those whose headline is actually about India.
FLOW_RE = re.compile(r"\b(FIIs?|DIIs?|FPIs?|foreign (?:investors?|portfolio|funds?|outflows?|inflows?|selling|buying))\b", re.I)
INDIA_RE = re.compile(r"\b(india|indian|sensex|nifty|rupee|rbi|sebi|mumbai|new delhi|modi|adani|reliance|tata|infosys)\b", re.I)


def topical(key, t):
    """Per-bucket topic test, as in the old filterBucket()."""
    if SOC_RE.search(t) or SOC2_RE.search(t) or JUNK_RE.search(t):
        return False
    if key == "WIRE" and not INDIA_RE.search(t):
        return False
    if key == "FLOW" and not FLOW_RE.search(t):   # market wraps that only mention FIIs in the body
        return False
    if key == "EARN":
        return bool(EARN_RE.search(t) or PAT_RE.search(t)) and not EARN_EXCL.search(t)
    if key == "CORP":
        return bool(CORP_RE.search(t)) and not GOVT_RE.search(t)
    return bool(MKT_RE.search(t))


def factual(t):
    # Any "?" means commentary ("...What's holding it back?"), not a reported fact.
    return not ("?" in t or NEWS_EXCL.search(t) or QUESTION_RE.search(t)
                or OPINION_NAMED_RE.search(t) or OPINION_SINGLE_RE.search(t))


def gnews(q):
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:2d")
           + "&hl=en-IN&gl=IN&ceid=IN:en")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (india-research-portal news bot)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                root = ET.fromstring(r.read())
            break
        except Exception as e:  # network blip or bad XML: retry, then give up on this bucket
            print(f"    attempt {attempt + 1} failed: {e}")
            time.sleep(3)
    else:
        return None
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src_el = it.find("source")
        src = (src_el.text or "").strip() if src_el is not None else ""
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3].strip()
        try:
            pub = email.utils.parsedate_to_datetime(it.findtext("pubDate")).astimezone(dt.timezone.utc)
        except Exception:
            continue
        items.append({"t": title, "l": it.findtext("link") or "", "d": pub, "s": src})
    return items


def main():
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(hours=WINDOW_H)
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT, encoding="utf-8")).get("b", {})
        except Exception:
            prev = {}
    out, seen, failed = {}, set(), []
    for key, (label, q) in BUCKETS.items():
        items = gnews(q)
        if items is None:
            # Keep last run's headlines for this bucket (still held to the 2-day window).
            failed.append(key)
            out[key] = [x for x in prev.get(key, []) if x.get("d", "") >= cutoff.isoformat(timespec="minutes")]
            print(f"  {key}: FETCH FAILED, kept {len(out[key])} from last run")
            continue
        keep = []
        for x in sorted(items, key=lambda x: x["d"], reverse=True):
            if x["d"] < cutoff:
                continue
            norm = re.sub(r"[^a-z0-9]", "", x["t"].lower())[:70]
            tq = x["t"].replace("’", "'").replace("‘", "'")   # curly quotes would dodge "here's why" etc.
            if (norm in seen or x["s"] in JUNK_SOURCES
                    or not topical(key, tq) or not factual(tq)):
                continue
            seen.add(norm)
            keep.append({"t": x["t"], "l": x["l"], "d": x["d"].isoformat(timespec="minutes"), "s": x["s"], "c": key})
        out[key] = keep[:PER_BUCKET]
        print(f"  {key}: {len(items)} fetched -> {len(out[key])} kept")
        time.sleep(1)
    if len(failed) == len(BUCKETS):
        print("All buckets failed; leaving the existing news.json untouched.")
        return
    data = {
        "updated": now.astimezone(IST).isoformat(timespec="minutes"),
        "window_h": WINDOW_H,
        "labels": {k: v[0] for k, v in BUCKETS.items()},
        "failed": failed,
        "b": out,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {sum(len(v) for v in out.values())} headlines")


if __name__ == "__main__":
    main()
