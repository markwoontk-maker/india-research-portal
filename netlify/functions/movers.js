// Server-side Nifty 500 movers aggregator.
// Fetches the whole Nifty 500 from Yahoo (free) in 20-symbol chunks
// with a small concurrency pool, returns only the computed top/bottom
// 20 plus breadth. CDN-cached 5 min so it stays well within free tier.

const NIFTY500 = ("RELIANCE,TCS,HDFCBANK,ICICIBANK,INFY,SBIN,BHARTIARTL,LICI,ITC,LT," +
"HINDUNILVR,KOTAKBANK,BAJFINANCE,AXISBANK,MARUTI,SUNPHARMA,HCLTECH,NTPC,TATAMOTORS,ONGC," +
"ADANIENT,M&M,WIPRO,ADANIPORTS,POWERGRID,ULTRACEMCO,TITAN,ASIANPAINT,COALINDIA,BAJAJFINSV," +
"NESTLEIND,JSWSTEEL,TATASTEEL,DMART,BAJAJ-AUTO,HDFCLIFE,SBILIFE,GRASIM,HINDALCO,TECHM," +
"INDUSINDBK,DIVISLAB,DRREDDY,CIPLA,EICHERMOT,BPCL,BRITANNIA,APOLLOHOSP,HEROMOTOCO,TATACONSUM," +
"PIDILITIND,SHRIRAMFIN,DABUR,GODREJCP,VEDL,IOC,SIEMENS,BANKBARODA,PNB,GAIL," +
"AMBUJACEM,DLF,VBL,HAVELLS,ZYDUSLIFE,TVSMOTOR,ICICIPRULI,ICICIGI,TRENT,BEL," +
"ADANIGREEN,ADANIPOWER,CHOLAFIN,MARICO,BOSCHLTD,SRF,BAJAJHLDNG,TORNTPHARM,COLPAL,INDIGO," +
"NAUKRI,JINDALSTEL,LTIM,CANBK,HDFCAMC,ABB,UNIONBANK,IDBI,BERGEPAINT,PEL," +
"AUROPHARMA,LUPIN,MOTHERSON,ASHOKLEY,MFSL,PGHH,UBL,MUTHOOTFIN,PIIND,SAIL," +
"NMDC,PFC,RECLTD,HINDPETRO,TATAPOWER,INDUSTOWER,IRCTC,NHPC,ZOMATO,POLYCAB," +
"PAYTM,GMRINFRA,IGL,PETRONET,OFSS,PAGEIND,ALKEM,GLAND,BIOCON,IPCALAB," +
"GLENMARK,LAURUSLABS,ABBOTINDIA,SANOFI,FORTIS,MAXHEALTH,METROPOLIS,LALPATHLAB,SYNGENE,JUBLFOOD," +
"DEVYANI,WESTLIFE,VOLTAS,BLUESTARCO,WHIRLPOOL,CROMPTON,DIXON,AMBER,VGUARD,KAJARIACER," +
"CERA,FINPIPE,SUPREMEIND,ASTRAL,APLAPOLLO,RATNAMANI,JKCEMENT,SHREECEM,RAMCOCEM,DALBHARAT," +
"ACC,NUVOCO,BIRLACORPN,STARCEMENT,HEIDELBERG,JSWENERGY,TORNTPOWER,CESC,SJVN,IEX," +
"PTC,KEC,KALPATPOWR,THERMAX,CUMMINSIND,AIAENG,GRINDWELL,SKFINDIA,SCHAEFFLER,TIMKEN," +
"BHARATFORG,SUNDRMFAST,ENDURANCE,BALKRISIND,APOLLOTYRE,MRF,CEATLTD,JKTYRE,EXIDEIND,AMARAJABAT," +
"HAL,BDL,MAZDOCK,COCHINSHIP,GRSE,IRFC,RVNL,RAILTEL,IRCON,NBCC," +
"NCC,PNCINFRA,KNRCON,CONCOR,BLUEDART,TCIEXP,DELHIVERY,MAHLOG,GUJGASLTD,MGL," +
"AEGISCHEM,CASTROLIND,GULFOILLUB,DEEPAKNTR,AARTIIND,NAVINFLUOR,FLUOROCHEM,VINATIORGA,ATUL,CLEAN," +
"ALKYLAMINE,BALAMINES,TATACHEM,GNFC,CHAMBLFERT,COROMANDEL,UPL,RALLIS,SUMICHEM,BAYERCROP," +
"SUDARSCHEM,JUBLINGREA,FINEORG,GALAXYSURF,EIDPARRY,BALRAMCHIN,TRIVENI,DCMSHRIRAM,KANSAINER,AKZOINDIA," +
"INDIGOPNTS,SHEELAFOAM,CENTURYPLY,GREENPLY,GREENPANEL,JYOTHYLAB,EMAMILTD,GILLETTE,HONAUT,3MINDIA," +
"RAYMOND,ARVIND,KPRMILL,TRIDENT,WELSPUNLIV,WELCORP,RHIM,JINDALSAW,APARINDS,FINOLEXIND," +
"POLYPLEX,UFLEX,EPL,TIMETECHNO,VIPIND,SAFARI,RELAXO,BATAINDIA,METROBRAND,CAMPUS," +
"KALYANKJIL,TITAGARH,JWL,STARHEALTH,NIACL,GICRE,POLICYBZR,CDSL,CAMS,BSE," +
"MCX,ANGELONE,IIFL,360ONE,NAM-INDIA,UTIAMC,ABCAPITAL,L&TFH,SUNDARMFIN,M&MFIN," +
"MANAPPURAM,CREDITACC,FIVESTAR,AAVAS,APTUS,HOMEFIRST,CANFINHOME,PNBHOUSING,LICHSGFIN,REPCO," +
"JMFINANCIL,MOTILALOFS,ANANDRATHI,PRUDENT,FEDERALBNK,BANDHANBNK,IDFCFIRSTB,RBLBANK,AUBANK,CITYUNIONBANK," +
"KARURVYSYA,SOUTHBANK,J&KBANK,DCBBANK,INDIANB,IOB,CENTRALBK,MAHABANK,UCOBANK,PSB," +
"EQUITASBNK,UJJIVANSFB,SURYODAY,TATAELXSI,COFORGE,PERSISTENT,LTTS,MPHASIS,KPITTECH,CYIENT," +
"SONACOMS,ZENSARTECH,BIRLASOFT,INTELLECT,NEWGEN,MASTEK,HAPPSTMNDS,LATENTVIEW,TANLA,ROUTE," +
"FSL,RATEGAIN,MAPMYINDIA,SBICARD,POONAWALLA,ABFRL,VMART,SHOPERSTOP,GOCOLORS,VEDANT," +
"PVRINOX,SUNTV,ZEEL,NETWORK18,TV18BRDCST,SAREGAMA,NAZARA,DBCORP,JAGRAN,HATHWAY," +
"DISHTV,GTPL,TIPSINDLTD,ENIL,OBEROIRLTY,GODREJPROP,LODHA,PRESTIGE,BRIGADE,SOBHA," +
"PHOENIXLTD,MAHLIFE,SUNTECK,KOLTEPATIL,ANANTRAJ,IBREALEST,SIGNATURE,PURVA,ASHIANA,GESHIP," +
"SCI,RITES,ENGINERSIN,HUDCO,SOLARINDS,GHCL,TATACOMM,3IINFOTECH,KFINTECH,INDIAMART," +
"JUSTDIAL,AFFLE,EASEMYTRIP,IXIGO,TBOTEK,DREAMFOLKS,GODREJIND,GODREJAGRO,AVANTIFEED,CCL," +
"HERITGFOOD,DODLA,HATSUN,KRBL,LTFOODS,USHAMART,SHYAMMETL,GPIL,SARDAEN,MAITHANALL," +
"KIRLOSENG,KIRLOSBROS,ELGIEQUIP,TIINDIA,GREAVESCOT,VSTTILLERS,ESCORTS,FORCEMOT,WABAG,EMUDHRA," +
"DATAPATTNS,ZENTEC,PARAS,ASTRAMICRO,MTARTECH,IDEAFORGE,JTLIND,SANSERA,UNOMINDA,DALMIASUG")
  .split(",").map(s => s.trim()).filter(Boolean);

const SYMS = [...new Set(NIFTY500)].map(s => s + ".NS");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Ticker -> company name (used to query stock-specific news).
const NAMES = require("./_names.js");

// Timeframe -> Yahoo spark range/interval + return basis.
// 1D: last vs previous close; others: last vs first close in window.
const TF = {
  "1D": ["1d", "5m", "prev"], "1W": ["5d", "15m", "first"],
  "1M": ["1mo", "1d", "first"], "6M": ["6mo", "1d", "first"],
  "YTD": ["ytd", "1d", "first"], "1Y": ["1y", "1wk", "first"],
};

function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

async function fetchChunk(syms, range, interval, mode) {
  const url = "https://query1.finance.yahoo.com/v8/finance/spark?symbols=" +
    encodeURIComponent(syms.join(",")) + "&range=" + range + "&interval=" + interval;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    const out = [];
    for (const sy of syms) {
      const d = j && j[sy];
      if (!d || !d.close) continue;
      let lp = null;
      for (let k = d.close.length - 1; k >= 0; k--) { if (d.close[k] != null) { lp = d.close[k]; break; } }
      let base;
      if (mode === "prev") base = d.chartPreviousClose != null ? d.chartPreviousClose : d.previousClose;
      else { for (let k = 0; k < d.close.length; k++) { if (d.close[k] != null) { base = d.close[k]; break; } } }
      if (lp != null && base) out.push({ s: sy.replace(".NS", ""), p: lp, ch: (lp - base) / base * 100 });
    }
    return out;
  } catch (e) { return []; }
}

async function pool(tasks, size) {
  const results = []; let i = 0;
  async function worker() { while (i < tasks.length) { const idx = i++; results[idx] = await tasks[idx](); } }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return results;
}

function cleanTitle(t) {
  return String(t || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\s+-\s+[^-]+$/, "").trim();
}

const GENERIC = new Set(("india,bank,finance,financial,industries,limited,ltd,corporation,corp," +
  "motors,power,steel,energy,services,company,the,and,group,enterprises,international," +
  "intl,life,insurance,paints,pharma,labs,laboratories,cement,cements,chemicals,foods," +
  "gas,oil,auto,electric,electronics,technologies,technology,tech,housing,products," +
  "consumer,natural,national").split(","));
function nameTokens(name) {
  return String(name).toLowerCase().replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9&]+/).filter(w => w.length >= 4 && !GENERIC.has(w));
}
const MOVE_RE = /(share|stock|jump|surg|rall|ris(e|es|ing)|gain|fall|drop|slump|plunge|tank|soar|crash|\d{1,3}\s?%|q[1-4]\b|quarter|results|profit|loss|order|deal|acquir|merger|buyback|dividend|stake|block deal|upgrade|downgrade|target price|earnings|revenue|ipo|listing|fundrais|fund-rais|guidance|bonus|split|approval|contract|wins?\b)/i;
const WHY_EXCL_RE = /(among (?:\d+\s*\+?\s*)?(?:companies|firms|stocks)|companies to (?:declare|post|watch|report)|firms to post|to (?:post|declare|announce|report) (?:its )?(?:q[1-4]|earnings|results)|results (?:today|preview|calendar|live|date|expectations?|to watch)|q[1-4] results today|stocks? to watch|buzzing stocks|top (?:buzzing|gainers|losers)|ahead of (?:q[1-4]|results|earnings)|what to expect|check (?:full |the )?list|earnings (?:calendar|preview)|live updates?|here's the (?:full )?list|schedules? .*earnings call|board meeting (?:on|date)|stocks in focus|stocks to buy)/i;

async function whyFor(name, deadline) {
  if (Date.now() > deadline) return "";
  const q = `"${name}" (share OR stock OR results OR Q4 OR order OR deal OR profit) when:2d`;
  const url = "https://news.google.com/rss/search?q=" +
    encodeURIComponent(q) + "&hl=en-IN&gl=IN&ceid=IN:en";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Math.min(3000, Math.max(400, deadline - Date.now())));
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ctl.signal });
    const xml = await r.text();
    const toks = nameTokens(name);
    const lname = String(name).toLowerCase();
    let best = "", bestScore = 0, idx = 0;
    const re = /<item>([\s\S]*?)<\/item>/g; let m;
    while ((m = re.exec(xml)) && idx < 8) {
      idx++;
      const tm = m[1].match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const title = cleanTitle(tm && tm[1]);
      if (!title || WHY_EXCL_RE.test(title)) continue;  // no list/preview headlines
      const lt = title.toLowerCase();
      const nameHit = lname && lt.includes(lname) || toks.some(w => lt.includes(w));
      if (!nameHit) continue;                       // must be about THIS company
      let score = 2;
      if (lname && lt.includes(lname)) score += 1.5; // exact company name
      if (MOVE_RE.test(lt)) score += 2;              // explains a move
      score += Math.max(0, 3 - idx) * 0.2;           // mild recency preference
      if (score > bestScore) { bestScore = score; best = title; }
    }
    // Require the chosen item to actually be move-relevant, not just a mention.
    if (!best || bestScore < 4) return "";
    if (best.length > 130) best = best.slice(0, 127).replace(/\s+\S*$/, "") + "…";
    return best;
  } catch (e) { return ""; }
  finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  try {
    const qp = event.queryStringParameters || {};
    const tfKey = TF[qp.tf] ? qp.tf : "1D";
    const [range, interval, mode] = TF[tfKey];

    const chunks = chunk(SYMS, 20);
    const parts = await pool(chunks.map(c => () => fetchChunk(c, range, interval, mode)), 6);
    const all = parts.flat();
    all.sort((a, b) => b.ch - a.ch);
    const top = all.slice(0, 20);
    const bottom = all.slice(-20).reverse();

    // Per-stock news reason (best-effort, bounded so we never time out).
    const picks = [...top, ...bottom];
    const deadline = Date.now() + 5000;
    await pool(picks.map(it => () =>
      whyFor(NAMES[it.s] || it.s, deadline).then(w => { it.why = w; })), 16);

    const body = JSON.stringify({
      tf: tfKey,
      count: all.length,
      adv: all.filter(x => x.ch > 0).length,
      dec: all.filter(x => x.ch < 0).length,
      top, bottom,
      asOf: new Date().toISOString(),
    });
    return { statusCode: 200, headers: cors, body };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
