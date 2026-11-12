// List feed items news-engine.js drops, to check the filters aren't throwing
// away real news.   node scripts/news-dropped.js [data/news.json] [feedPrefix]
const fs = require('fs');
const path = require('path');
const NE = require('../news-engine.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const NAMES = eval('(' + html.match(/const NAMES\s*=\s*(\{[\s\S]*?\});/)[1] + ')');
const j = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'data', 'news.json'), 'utf8'));
const pre = process.argv[3] || '';
const e = NE.create({ names: NAMES });
let n = 0;
for (const it of j.items) {
  if (pre && !it.f.startsWith(pre)) continue;
  if (!e._classify(it)) { console.log(`${it.f.padEnd(14)} ${it.t.slice(0, 115)}`); n++; }
}
console.log(`\n${n} dropped`);
