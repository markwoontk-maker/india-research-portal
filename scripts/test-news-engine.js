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
