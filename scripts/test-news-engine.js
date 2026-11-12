// Exercise news-engine.js against a captured set of real feed items.
//   node scripts/test-news-engine.js <fixture.json> [--show]
// The fixture is a /news?since=0 response from the relay (or data/news.json).
// Prints how many stories were kept, merged and dropped, plus the merged
// clusters so false merges can be eyeballed, and runs a few fixed assertions.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const NE = require('../news-engine.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const NAMES = eval('(' + html.match(/const NAMES\s*=\s*(\{[\s\S]*?\});/)[1] + ')');

// ---- fixed cases (no network) ----
const now = Date.now();
const mk = (i, t, b, s, f, side, minsAgo) => ({ i, t, b, s, f, side, l: 'https://x/' + i, p: now - minsAgo * 60e3 });
{
  const e = NE.create({ names: NAMES });
  e.add([
    mk('a1', 'RBI hikes repo rate by 25 bps to 5.5%, first hike in nearly four years', 'The Monetary Policy Committee raised the repo rate by 25 basis points to 5.5% citing inflation risks.', 'Mint', 'mint-economy', 'L', 30),
    mk('a2', 'RBI raises repo rate 25 basis points to 5.50% as inflation risks broaden', 'The central bank lifted the policy repo rate by 25 bps to 5.5 per cent.', 'Business Standard', 'bs-economy', 'L', 25),
    mk('b1', 'Bajaj Finance launches ₹11,700 crore QIP', 'The NBFC opened its qualified institutional placement at an indicative price.', 'CNBC-TV18', 'cnbc-market', 'L', 20),
    mk('c1', 'Nvidia working with external firm to explore new CEO candidates', 'Nvidia board searches for successors to CEO Jensen Huang.', 'CNBC-TV18', 'cnbc-business', 'R', 15),
    mk('d1', 'Sensex Today | Stock Market Live Updates: GIFT Nifty up 30 points', 'Live coverage.', 'CNBC-TV18', 'cnbc-market', 'L', 10),
    mk('e1', 'Top stocks to watch today: Tata Power, Bajaj Finance, HAL', 'Stocks to watch.', 'Mint', 'mint-markets', 'L', 5),
    mk('f1', 'Sensex falls 460 points as RBI hikes rates; banks drag', 'Benchmark indices fell after the policy decision.', 'The Hindu', 'wires', 'M', 8),
  ]);
  const L = e.list('L'), R = e.list('R');
  const rbi = L.find((c) => /repo/i.test(c.rep.t));
  assert(rbi && rbi.members.length === 2, 'the two RBI repo-rate stories should merge into one');
  assert(R.some((c) => /Bajaj Finance/.test(c.rep.t)), 'a company QIP from a markets feed belongs on the right');
  assert(!R.concat(L).some((c) => /Nvidia/.test(c.rep.t)), 'foreign corporate news is dropped');
  assert(!L.some((c) => /Live Updates|stocks to watch/i.test(c.rep.t)), 'live blogs and watch-lists are dropped');
  assert(L.some((c) => /Sensex falls 460/.test(c.rep.t)), 'index moves stay on the left');
  assert(!L.find((c) => /Sensex falls/.test(c.rep.t)).members.some((m) => /repo rate/.test(m.t)), 'a market-move story must not swallow the RBI story');
  console.log('fixed cases: ok');
}

// ---- stories the user said they don't want (2026-11-12), verbatim from the feeds ----
{
  const e = NE.create({ names: NAMES });
  const unwanted = [
    { i: 'u1', f: 'cnbc-market', side: 'L', s: 'CNBC-TV18', l: 'https://www.cnbctv18.com/market/cryptocurrency/binance-blockchain-week-bangkok-2026-unveils-first-speakers-spotlighting-traditional-finance-digital-assets-20031872.htm',
      t: 'Binance Blockchain Week Bangkok 2026 unveils first speakers, spotlighting traditional finance & digital assets',
      b: 'The flagship event, under this year’s theme of ‘Evolve’, will convene leading policymakers, central bankers, institutional asset managers and technology leaders' },
    { i: 'u2', f: 'cnbc-market', side: 'L', s: 'CNBC-TV18', l: 'https://www.cnbctv18.com/market/wall-street-rises-as-tech-shares-lead-rebound-nasdaq-gains-as-nvidia-shares-jump-20031856.htm',
      t: 'Wall Street rises as tech shares lead rebound, Nasdaq gains as Nvidia jumps 5%',
      b: 'Wall Street rebounded on Wednesday as technology stocks led gains, with Nvidia jumping 5% and CoreWeave rallying 13% after strong quarterly results and an upbeat outlook' },
    { i: 'u3', f: 'bl-companies', side: 'R', s: 'BusinessLine', l: 'https://www.thehindubusinessline.com/companies/spotify-launches-audiobooks-in-india-with-over-35-lakh-titles/article71692688.ece',
      t: 'Spotify launches audiobooks in India with over 3.5 lakh titles',
      b: 'The audiobook is a subscription service called Audiobooks+, priced at ₹199 per month, which gives listeners 15 hours of listening time' },
    { i: 'u4', f: 'bl-economy', side: 'L', s: 'BusinessLine', l: 'https://www.thehindubusinessline.com/economy/agri-business/combining-ai-with-gis-to-solve-real-time-farm-problems-the-farmwise-ai-way/article71686477.ece',
      t: 'Combining AI with GIS to solve real-time farm problems - the Farmwise AI way',
      b: 'The Chennai-based startup has attracted attention after its founder Anand Vetrivel interacted with Prime Minister Narendra Modi during the inaugural run of the' },
    { i: 'u5', f: 'mint-markets', side: 'L', s: 'Mint', l: 'https://www.livemint.com/market/rare-ipo-bets-on-end-of-war-and-economic-crisis-in-myanmar-11794443215168.html',
      t: 'Rare IPO Bets on End of War and Economic Crisis in Myanmar',
      b: 'A Myanmar company is going public in the middle of a civil war and economic downturn, betting on an eventual recovery.' },
    { i: 'u6', f: 'et-markets', side: 'L', s: 'Economic Times', l: 'https://economictimes.indiatimes.com/markets/us-stocks/news/nvidia-shares-slide-as-investors-consider-future-without-huang/articleshow/135753594.cms',
      t: 'Nvidia shares plummet 10% in after-hours trade as investors consider a future without Huang',
      b: "Nvidia Corp's stock faced a sharp decline following troubling reports about CEO Jensen Huang's personal affairs." },
  ].map((x) => Object.assign(x, { p: now - 60e3 }));
  e.add(unwanted);
  const kept = [...e.list('L'), ...e.list('R')].map((c) => c.rep.t);
  assert.deepStrictEqual(kept, [], 'unwanted stories leaked through: ' + kept.join(' | '));
  console.log('unwanted stories: all 6 dropped');
}

// ---- real fixture ----
const fx = process.argv[2];
if (fx) {
  const j = JSON.parse(fs.readFileSync(fx, 'utf8'));
  const raw = j.items || [];
  const e = NE.create({ names: NAMES });
  const t0 = Date.now();
  e.add(raw);
  const ms = Date.now() - t0;
  const L = e.list('L'), R = e.list('R');
  const merged = [...L, ...R].filter((c) => c.members.length > 1);
  console.log(`raw ${raw.length} -> kept ${e.stats().items}, dropped ${e.stats().rejected}; stories L=${L.length} R=${R.length}; merged ${merged.length} (${ms} ms)`);
  if (process.argv.includes('--show')) {
    for (const c of merged.sort((a, b) => b.members.length - a.members.length)) {
      console.log(`\n[${c.side} ${c.tag}] x${c.members.length} ${c.sources.join(', ')}`);
      for (const m of c.members) console.log('   - ' + m.t.slice(0, 110));
    }
    const tagCount = (arr) => arr.reduce((a, c) => ((a[c.tag] = (a[c.tag] || 0) + 1), a), {});
    console.log('\nLEFT tags', tagCount(L), '\nRIGHT tags', tagCount(R));
    console.log('\nLEFT sample:'); for (const c of L.slice(0, 15)) console.log(`  ${c.tag.padEnd(8)} ${c.rep.t.slice(0, 100)}`);
    console.log('\nRIGHT sample:'); for (const c of R.slice(0, 15)) console.log(`  ${c.tag.padEnd(10)} ${c.rep.t.slice(0, 100)}`);
  }
}
