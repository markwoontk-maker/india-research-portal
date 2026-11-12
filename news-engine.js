/* News engine for the News tab: filters, left/right sorting, and merging the
   same story across outlets. Pure logic, no DOM, so it can be unit-tested in
   Node (scripts/test-news-engine.js) and loaded by index.html as a <script>.

   Input items come from the live relay (worker/) and the GitHub snapshot
   (data/news.json), both shaped { i, t, l, b, s, f, side, p, n? }:
   i id (hash of link), t title, l link, b publisher blurb, s source,
   f feed key, side L|R|M from the feed's section, p publish ms, n relay first-seen ms. */
(function (root) {
  'use strict';

  // ---- noise filters (carried over from the old fact-only News card) ----
  const SOC_RE = /(cricket|\bipl\b|sport|football|hockey|kabaddi|bollywood|\bfilm\b|movie|actor|actress|celebrit|singer|\bott\b|web series|murder|rape|assault|\bcrime\b|accident|road mishap|weather|rainfall|\bflood\b|cyclone|heatwave|festival|temple|mosque|church|religio|wedding|marriage|divorce|viral video|gossip|astrolog|horoscope|entertainment|fashion|recipe|lifestyle|obituary|tribute|birthday|box office|\bnba\b|\bnfl\b|net worth|\baffairs? with|\baffair\b)/i;
  const NEWS_EXCL = /\b(?:live updates?|live blog|results live|what to (?:expect|know)|stocks? to watch|buzzing stocks|stocks in news|in focus|ahead of (?:q[1-4]|results|earnings|the budget|monetary policy|rbi)|\d+ (?:things|reasons|stocks?|key|smart|top|best) (?:to|you|that|things)|key (?:takeaways|highlights|things to know)|all you need to know|here'?s (?:why|how|what|where)\b|will (?:rbi|the|govt|fed|markets?|inflation)\b|stocks to buy|set to (?:rise|fall|hike|cut)|why (?:is|are|did)\b|(?:might|may|could) (?:rise|fall|cut|hike|gain|drop)|\bpreview\b|\bexplained\b|\bexplainer\b|\bbreakdown\b|what changed|why it matters|\bdeep dive\b|\bby 20\d\d\b|needs? to\s|likely to\s|expected to\s|forecast(?:s|ing|ed)?\b|\bprojected\b|\bprojection\b|aims? to\s|targets? to\s|\bestimates? to\b|should (?:hit|reach|raise|boost|grow|cross|achieve)\s|\b(?:report|study|survey|paper)\s*:|\boutlook\b|seen at\b|price prediction|should you (?:buy|sell)|target price|unpacking|decoded|what (?:it|this) means|means for (?:you|your)|top (?:gainers|losers)|trade setup|market wrap|opening bell|closing bell|mid[- ]day (?:bell|update)|\bhow to\b|allotment status|check (?:allocation|status)|gmp\b|grey market premium|\bquiz\b|\bpodcast\b|\bwebinar\b|\bopinion\b|\bcolumn\b|\bview:|share price highlights|stock price history|results (?:today )?highlights|results today live|\blive:|\binterview\b|recommends|stock picks|stock recommendations|top \d+\s?@\s?\d+|stocks showing|marubozu|candlestick|\brsi\b|top picks?\b|what (?:historical )?data shows|share price live|triggers to watch|things to watch|market pulse|masterclass|\bawards\b|\bconclave\b)|^ET\s|^watch\b|^\d{1,2}:\d{2}\s*\|/i;   // last two: Bloomberg videos, "11:11 | ..." digest roundups
  const OPINION_VERB = '(?:says?|said|flags?|flagged|warns?|warned|argues?|argued|notes?|noted|believes?|opines?|cautions?|cautioned|told|tells|sees?|saw|reckons?|reckoned|comments?|commented|highlights?|highlighted|fears?|feared|expects?|predicts?|predicted)';
  const OPINION_NAMED_RE = new RegExp('\\b[A-Z][a-z]+\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?\\s+' + OPINION_VERB + '\\b');
  const QUESTION_RE = /^\s*(?:will|why|how|what|does|should|can|could|would|are|is|do|did)\s+/i;

  // ---- classification ----
  const EARN_RE = /(\bq[1-4]\b|q[1-4]\s?fy\d\d|quarter|results|earnings|net profit|profit after tax|revenue|ebitda|topline|bottom\s?line|profit (?:jumps?|rises?|falls?|drops?|surges?|declines?|doubles?)|net loss|swings? to (?:a )?(?:profit|loss))/i;
  const PAT_RE = /\bPAT\b/;
  const CORP_RE = /(merger|acquisition|acquires?|to buy|stake (?:sale|buy)|\bstake\b|divest|demerger|amalgamat|open offer|buyback|board (?:approves|approval)|resigns?|steps? down|appoint|new (?:ceo|md|cfo|chair)|managing director|\bceo\b|restructur|joint venture|\bjv\b|fund[- ]?rais|\bqip\b|preferential|rights issue|delisting|insolvency|order (?:win|worth|from|inflow)|bags? .*order|wins? .*order|contract|\bipo\b|listing|dividend|bonus issue|stock split|capex|plant|launches|expansion|partnership|tie[- ]?up|\bmou\b|block deal|promoter|pledge|credit rating|downgrad|upgrad)/i;
  const GOVT_APPT_RE = /(joint secretar|cabinet secretar|\bIAS\b|\bIPS\b|bureaucrat|civil servant|district magistrate|air marshal|army chief|navy chief|chief of (?:the )?(?:army|navy|air|defence)|governor appointed|chief minister|\bcm\b)/i;
  const INDEX_RE = /\b(sensex|nifty|bank nifty|gift nifty|dalal street|indices|benchmark|broader market|midcap index|smallcap index|market cap of top)\b/i;
  const POLICY_RE = /\b(government|govt|ministry|minister|cabinet|parliament|lok sabha|rajya sabha|election|modi|centre|\bbill\b|policy|regulat|sebi|tariff|trade deal|trade pact|\bfta\b|gst|budget|subsidy|scheme|pli\b|disinvest|privati|supreme court|high court|\bdgca\b|\btrai\b|cci\b)/i;
  const ECON_RE = /\b(rbi|repo|monetary|inflation|\bcpi\b|\bwpi\b|gdp|growth rate|\biip\b|industrial (?:output|production)|\bpmi\b|fiscal|deficit|current account|forex reserves|rupee|bond yield|g-sec|treasury|exports?|imports?|trade (?:deficit|balance)|direct tax|tax collection|unemployment|jobless|employment|\bfed\b|federal reserve|crude|oil price|brent|dollar index|economy|economic)\b/i;
  const FLOW_RE = /\b(FIIs?|DIIs?|FPIs?|foreign (?:investors?|portfolio|funds?|outflows?|inflows?))\b/i;
  // Corporate stories are kept unless they look foreign. (Requiring an Indian
  // marker instead would drop small Indian companies the NAMES list doesn't know.)
  const US_RE = /\bU\.?S\.?\b/;   // case-sensitive: not the pronoun "us"
  // Big foreign companies: their news is out even with an India angle ("Nvidia India
  // staff lose $600m"), unless an Indian listed company is named in the headline.
  // Case-sensitive so "India's apple imports" isn't caught.
  const FOREIGN_CO_RE = /\b(Nvidia|NVIDIA|Apple|Microsoft|Google|Alphabet|Amazon|Meta Platforms|Tesla|OpenAI|Samsung|TSMC|Intel|Boeing|Walmart|Jensen Huang|Elon Musk|SpaceX|Anthropic|Spotify|Netflix|Binance|CoreWeave)\b/;
  // Overseas-market stories (Fed, Wall Street, US Treasuries). Checked on the blurb
  // too, because headlines like "Market spooked because now the Fed…" read as local.
  const GLOBAL_MKT = (s) => /\bFed\b|GLOBAL-|\bECB\b/.test(s) || /wall street|nasdaq|dow jones|s&p 500|federal reserve|greenback|treasury yields|bank of (?:japan|england)/i.test(s);
  // Sections and topics the user doesn't want (2026-11-12: Wall Street/Nvidia,
  // crypto events, a Myanmar IPO, Spotify, a startup feature).
  const EXCL_URL_RE = /\/(?:us-stocks|cryptocurrency|crypto|world-news|world|international|global-markets)\//i;
  const CRYPTO_RE = /\b(crypto\w*|bitcoin|ethereum|blockchain|binance|web3|nft|stablecoin)\b/i;
  // Signs a corporate story is about a listed company (when the name isn't in NAMES).
  const LISTED_RE = /\b(shares?|stocks?|scrip|nse|bse|listed|q[1-4]|quarter(?:ly)?|results|net profit|ebitda|m-?cap|market cap|ipo|qip|order book|orders?|contract|board|dividend|bonus|buyback|stake|promoter|sebi)\b|\bPAT\b/i;
  const FOREIGN_RE = /\b(myanmar|bangladesh|pakistan|sri lanka|nepal|vietnam|indonesia|thailand|malaysia|philippines|australia|canada|brazil|mexico|russia|ukraine|iran|israel|saudi|uae|dubai|qatar|africa|nigeria|argentina|turkey|egypt|hong kong|asian?|global markets?|spacex|anthropic|xai|silicon valley|american|china|chinese|japan|japanese|korea|korean|taiwan|europe|european|britain|british|german|france|french|poland|polish|italy|spain|netherlands|swiss|switzerland|sweden|norway|nvidia|apple|microsoft|google|alphabet|amazon|meta|tesla|openai|samsung|tsmc|intel|boeing|walmart|jensen|musk|wall street|nasdaq)\b/i;
  // Market-topic words beyond the index names: sector/stock moves, index rejigs, broker calls on India.
  const MKT2_RE = /\b(index|indices|msci|ftse|rejig|rall(?:y|ies)|surges?|slumps?|tumbles?|jumps?|gains?|falls?|52-week|record high|valuations?|brokerages?|clsa|jefferies|goldman|morgan stanley|nomura|ubs|citi|macquarie|bernstein|hsbc|bofa|overweight|underweight|ipo|listing|f&o|derivatives?)\b/i;
  const INDIA_RE =/(₹|\brs\.?\s?[\d,]|\bcrore\b|\blakh\b|\brupee|\bpaise\b|gift city|\bindia|\bnse\b|\bbse\b|\bsebi\b|\brbi\b|sensex|nifty|mumbai|delhi|bengaluru|bangalore|chennai|hyderabad|kolkata|pune|gujarat|maharashtra|karnataka|tamil nadu|uttar pradesh|andhra|telangana|kerala|\bltd\b)/i;

  const STOP = new Set(('a an the of in on at to for by with from as is are was were be been its it this that these those after over amid into than and or but not no new up down says said say will may has have had how what why who whom via per vs amp ' +
    'ltd limited co inc share shares stock stocks today report reports rs cr crore lakh india indian its their his her company firm group year years day days week month amid also more most first second third one two three ' +
    'about against among across under while during since until when where which while just still yet only once again set sets gets get got sees seen latest update updates news').split(' '));

  function norm(s) {
    return String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  }
  function tokens(s) {
    const out = [];
    const t = norm(s).toLowerCase().replace(/₹/g, ' rs ').replace(/(\d),(?=\d)/g, '$1');
    for (let w of t.split(/[^a-z0-9.%]+/)) {
      w = w.replace(/^\.+|\.+$/g, '').replace(/%$/, '');
      if (!w || STOP.has(w)) continue;
      if (!/\d/.test(w)) {
        if (w.length < 3) continue;
        if (w.length > 4) w = w.replace(/(?:ing|ed|es|s)$/, '');   // crude stem: hikes/hiked/hiking -> hik
      }
      out.push(w);
    }
    return out;
  }

  function create(opts) {
    opts = opts || {};
    const WINDOW = opts.windowMs || 48 * 3600e3;
    const MERGE_WITHIN = 30 * 3600e3;
    const THRESHOLD = opts.threshold || 0.42;
    // Company names (NAMES map: ticker -> name), longest first, as lowercase phrases.
    const companies = Object.keys(opts.names || {}).map((tk) => ({ tk, nm: String(opts.names[tk]).toLowerCase() }))
      .filter((c) => c.nm.length >= 4).sort((a, b) => b.nm.length - a.nm.length);

    const items = new Map();     // id -> item (accepted only)
    const rejected = new Set();  // ids we've already filtered out
    const clusters = new Map();  // cid -> cluster
    const df = new Map();        // token -> number of items containing it
    const index = new Map();     // token -> Set(cid)  (title + blurb tokens)
    let nDocs = 0, seq = 0;

    function company(text) {
      const lt = text.toLowerCase();
      for (const c of companies) if (lt.includes(c.nm)) return c;
      return null;
    }

    // Returns null (drop) or { side: 'L'|'R', tag }.
    function classify(it) {
      const t = norm(it.t), tb = t + ' ' + norm(it.b);
      if (t.includes('?') || SOC_RE.test(t) || NEWS_EXCL.test(t) || QUESTION_RE.test(t) || OPINION_NAMED_RE.test(t)) return null;
      if (EXCL_URL_RE.test(it.l || '') || CRYPTO_RE.test(tb)) return null;
      const co = company(tb);
      const corpEvent = EARN_RE.test(t) || PAT_RE.test(t) || CORP_RE.test(t);
      // Every feed except the Google News wires is an Indian publisher, so a story
      // counts as Indian unless its headline points abroad (catches listed names the
      // NAMES map doesn't know, e.g. Meesho, NPST).
      const foreignTitle = FOREIGN_RE.test(t) || US_RE.test(t) || GLOBAL_MKT(t);
      if (FOREIGN_CO_RE.test(t) && !company(t)) return null;
      // No explicit Indian marker: an Indian publisher is enough unless the headline
      // points abroad or the blurb is about overseas markets. (Only market words are
      // checked in the blurb: "pre-US-Iran war levels" in an oil story is still Indian news.)
      const india = !!co || INDIA_RE.test(tb) || (it.f !== 'wires' && !foreignTitle && !GLOBAL_MKT(tb));
      const indexLevel = INDEX_RE.test(t) && !co;
      let side;
      if (it.side === 'R') side = (!co && !corpEvent && (POLICY_RE.test(t) || ECON_RE.test(t))) ? 'L' : 'R';
      else if (it.side === 'L') {
        // A company's results are always corporate news; other corporate verbs
        // ("stake", "order") also appear in market stories, so they need a company name.
        const results = (EARN_RE.test(t) || PAT_RE.test(t)) && !indexLevel;
        // One company's own stock move ("Motilal Oswal shares hit record high") is
        // corporate news; sector/index moves naming several companies stay left.
        const coInTitle = company(t), sectorMove = /\b(index|indices|sector|stocks)\b/i.test(t);
        // "<Company> shares surge/jump/hit …" for names the NAMES map doesn't know (e.g. Meesho).
        const ownMove = /\b(?:shares?|stock)\s+(?:surg|jump|ris|gain|fall|fell|drop|slump|zoom|rall|hit|climb|tank|plung|soar|sink|slid|extend)/i.test(t);
        side = ((results || (corpEvent && (co || /\b(?:ltd|limited)\b/i.test(tb))) || ((coInTitle || ownMove) && !sectorMove)) && !indexLevel && !GOVT_APPT_RE.test(t)) ? 'R' : 'L';
      }
      else side = (corpEvent && !indexLevel && !GOVT_APPT_RE.test(t)) ? 'R' : 'L';
      if (side === 'R') {
        if (!india && (FOREIGN_RE.test(tb) || US_RE.test(tb))) return null;   // foreign corporate news (e.g. a US CEO change)
        if (GOVT_APPT_RE.test(t)) return null;
        // Indian listed companies only: a known name, or stock-market signals. Drops
        // foreign brands' India launches (Spotify) and startup features.
        if (!co && !LISTED_RE.test(tb)) return null;
        let tag = 'Company';
        if (/\bq[1-4]\b|q[1-4]\s?fy|quarter|results|net profit|profit|net loss|ebitda/i.test(t) || PAT_RE.test(t)) tag = 'Results';
        else if (/merger|acqui|to buy|stake|divest|demerger|amalgamat|open offer|joint venture|\bjv\b|partnership|tie[- ]?up/i.test(t)) tag = 'Deal';
        else if (/order|contract/i.test(t)) tag = 'Order';
        else if (/fund[- ]?rais|\bqip\b|preferential|rights issue|\bipo\b|listing (?:day|date)|\bto list\b|\bbonds?\b|\bncds?\b|debt|share sale/i.test(t)) tag = 'Fundraise';
        else if (/ceo|\bmd\b|cfo|chair|resign|steps? down|appoint|board/i.test(t)) tag = 'Management';
        else if (/dividend|buyback|bonus|split/i.test(t)) tag = 'Payout';
        return { side, tag, co: co ? co.tk : '' };
      }
      // Left panel: Indian markets, economy and policy only. Overseas market moves
      // (Wall Street, Nvidia, a Myanmar IPO) are out, and so are features with no
      // market/economy/policy angle.
      const pol = POLICY_RE.test(t), econ = ECON_RE.test(t), mkt = INDEX_RE.test(t) || FLOW_RE.test(t) || MKT2_RE.test(t) || /market|stocks?|shares|equit|rupee|bond|ipo/i.test(t);
      if (!india || !(pol || econ || mkt)) return null;
      if (foreignTitle && !INDIA_RE.test(t) && !co) return null;
      const tag = FLOW_RE.test(t) ? 'Flows' : econ ? 'Economy' : pol ? 'Policy' : 'Markets';
      return { side, tag, co: '' };
    }

    function vec(it) {
      const v = new Map();
      for (const w of tokens(it.t)) v.set(w, (v.get(w) || 0) + 1);
      for (const w of tokens(it.b).slice(0, 30)) v.set(w, (v.get(w) || 0) + 0.5);
      return v;
    }
    function idf(w) { return Math.log((nDocs + 1) / ((df.get(w) || 0) + 1)) + 1; }
    function cosine(a, b) {
      let dot = 0, na = 0, nb = 0;
      for (const [w, x] of a) { const k = idf(w); const xa = x * k; na += xa * xa; const y = b.get(w); if (y) dot += xa * y * k; }
      for (const [w, y] of b) { const k = idf(w); nb += (y * k) * (y * k); }
      return dot / (Math.sqrt(na * nb) || 1);
    }
    function titleKey(t) { return norm(t).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80); }

    function attach(it, c) {
      c.members.push(it);
      it.cid = c.id;
      // Representative: earliest item that has a blurb (else earliest).
      const withBlurb = c.members.filter((m) => m.b);
      const pool = withBlurb.length ? withBlurb : c.members;
      c.rep = pool.reduce((a, b) => (b.p < a.p ? b : a));
      c.p = Math.min(c.p, it.p);
      c.sources = [...new Set(c.members.map((m) => String(m.s || '').replace(/\.com$/i, '')).filter(Boolean))];
      // Panel follows the majority of versions (ties go to corporate), so one
      // outlet's market-angle headline doesn't pull a deal story to the left.
      const r = c.members.filter((m) => m.side === 'R').length;
      c.side = r * 2 >= c.members.length ? 'R' : 'L';
      if (c.side === c.rep.side) { c.tag = c.rep.tag; c.co = c.rep.co; }
      else { const m = c.members.find((x) => x.side === c.side); if (m) { c.tag = m.tag; c.co = m.co; } }
      for (const w of it.v.keys()) { let s = index.get(w); if (!s) index.set(w, (s = new Set())); s.add(c.id); }
    }

    function add(list) {
      const fresh = [];
      for (const raw of list || []) {
        if (!raw || !raw.i || items.has(raw.i) || rejected.has(raw.i)) continue;
        const cls = classify(raw);
        if (!cls) { rejected.add(raw.i); continue; }
        const it = Object.assign({}, raw, cls);
        it.p = Math.min(it.p, it.n || it.p, Date.now());
        it.v = vec(it);
        items.set(it.i, it);
        nDocs++;
        for (const w of it.v.keys()) df.set(w, (df.get(w) || 0) + 1);
        // Find the best matching story: exact headline first, then IDF-weighted cosine.
        const key = titleKey(it.t);
        let best = null, bestSim = 0;
        const cand = new Set();
        for (const w of it.v.keys()) {
          if ((df.get(w) || 0) > Math.max(25, nDocs * 0.04)) continue;   // ignore very common words for candidate search
          const s = index.get(w); if (s) for (const cid of s) cand.add(cid);
        }
        for (const cid of cand) {
          const c = clusters.get(cid);
          if (!c || Math.abs(c.p - it.p) > MERGE_WITHIN) continue;
          for (const m of c.members) {
            const sim = titleKey(m.t) === key ? 1 : cosine(it.v, m.v);
            if (sim > bestSim) { bestSim = sim; best = c; }
          }
        }
        if (best && bestSim >= THRESHOLD) { attach(it, best); fresh.push({ it, c: best, merged: true }); }
        else {
          const c = { id: 'c' + (++seq), side: it.side, tag: it.tag, co: it.co, members: [], p: it.p, rep: it, sources: [], born: Date.now() };
          clusters.set(c.id, c);
          attach(it, c);
          fresh.push({ it, c, merged: false });
        }
      }
      return fresh;
    }

    function prune(now) {
      const cutoff = (now || Date.now()) - WINDOW;
      let gone = 0;
      for (const [cid, c] of clusters) {
        if (c.p < cutoff) {
          for (const m of c.members) items.delete(m.i);
          clusters.delete(cid); gone++;
        }
      }
      if (gone) for (const s of index.values()) for (const cid of s) if (!clusters.has(cid)) s.delete(cid);
      return gone;
    }

    function list(side) {
      return [...clusters.values()].filter((c) => c.side === side).sort((a, b) => b.p - a.p);
    }

    function rawItems() {
      return [...items.values()].map(({ i, t, l, b, s, f, side, p, n }) => ({ i, t, l, b, s, f, side: rawSide(f, side), p, n }));
    }
    // The stored item's `side` was overwritten by the classifier; recover the feed's own side.
    const feedSide = new Map();
    function rawSide(f, side) { return feedSide.get(f) || side; }
    function noteFeedSides(list) { for (const r of list || []) if (r && r.f && !feedSide.has(r.f)) feedSide.set(r.f, r.side); }

    return {
      add(list) { noteFeedSides(list); return add(list); },
      prune, list, rawItems,
      stats() { return { items: items.size, clusters: clusters.size, rejected: rejected.size }; },
      _classify: classify, _tokens: tokens,
    };
  }

  const api = { create, tokens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NewsEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
