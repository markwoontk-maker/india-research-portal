// node scripts/estimates/test-lib.js
const assert = require('assert');
const L = require('./lib');
let n = 0;
const t = (name, f) => { f(); n++; console.log('ok  ' + name); };

t('parseUnit reads every house spelling', () => {
  assert.deepStrictEqual(L.parseUnit('INR mn'), { currency: 'INR', scale: 1, base: 'INR mn' });
  assert.strictEqual(L.parseUnit('Rs bn').scale, 1000);
  assert.strictEqual(L.parseUnit('₹ crore').scale, 10);
  assert.strictEqual(L.parseUnit('INR lakh').scale, 0.1);
  assert.strictEqual(L.parseUnit('US$ mn').base, 'US$ mn');
  assert.strictEqual(L.parseUnit('USD bn').base, 'US$ mn');
  assert.strictEqual(L.parseUnit('units'), null);
  assert.strictEqual(L.parseUnit(null), null);
});

t('scaleSeries converts to millions and drops nulls', () => {
  assert.deepStrictEqual(L.scaleSeries({ FY26: 1832.7, FY27: 2202, FY28: null }, 'Rs bn'), { unit: 'INR mn', values: { FY26: 1832700, FY27: 2202000 } });
  assert.strictEqual(L.scaleSeries({ FY27: null }, 'INR mn'), null);
  assert.strictEqual(L.scaleSeries({ FY27: 1 }, 'nonsense'), null);
});

t('year headers from each house are recognised', () => {
  for (const line of ['Year-end 31 Mar   FY26  FY27F  FY28F  FY29F', 'Fiscal Year Ending  03/26 03/27e 03/28e 03/29e', 'Year to 31 March  2025A  2026A  2027CL  2028CL  2029CL', 'March fiscal year ends  2026  2027E  2028E', 'Y/E Mar  Mar-27E  Mar-28E', 'F27e F28e F29e'])
    assert.ok(L.yearsInLine(line).size >= 2, line);
  assert.strictEqual(L.yearsInLine('Reported on 12 Aug 2026 with revenue up 12%').size <= 1, true);
});

t('pickPages prefers the P&L page and rejects notes with no forecast table', () => {
  const blank = 'Some commentary about the quarter with lots of words. '.repeat(10);
  const summary = 'Year-end Mar FY26 FY27F FY28F\nRevenue (mn) 1 2 3\nEPS 1 2 3';
  const pnl = 'Year to March 2026A 2027CL 2028CL 2029CL\nRevenue 1 2 3\nOp Ebitda 1 2 3\nDepreciation 1\nNet profit 2\nTax 3';
  assert.deepStrictEqual(L.pickPages([summary, blank, pnl], 3), [1, 3]);
  assert.deepStrictEqual(L.pickPages([summary, blank, pnl], 1), [3]);
  assert.deepStrictEqual(L.pickPages([blank, blank], 3), []);
  assert.deepStrictEqual(L.pickPages(['', '', '', ''], 3), [1, 2, 3], 'scanned note falls back to first pages');
});

t('EV/EBITDA alone does not count as an EBITDA row', () => {
  const s1 = L.scorePage('FY26 FY27F FY28F\nRevenue 1 2 3\nEV/EBITDA (x) 1 2 3');
  const s2 = L.scorePage('FY26 FY27F FY28F\nRevenue 1 2 3\nEBITDA 1 2 3');
  assert.ok(s2 > s1);
});

t('checkResult catches a wrong unit against the Earnings quarters', () => {
  const row = { unit: 'INR mn', q: { '1Q26': { rev: 100 }, '2Q26': { rev: 100 }, '3Q26': { rev: 100 }, '4Q26': { rev: 100 } } };
  assert.deepStrictEqual(L.checkResult({ rev: { FY26: 400, FY27: 450 }, revUnit: 'INR mn' }, row), []);
  const issues = L.checkResult({ rev: { FY26: 400, FY27: 450 }, revUnit: 'INR bn' }, row);
  assert.ok(issues.some(i => /Earnings tab/.test(i)), issues.join());
  assert.ok(L.checkResult({ rev: { FY27: 10, FY28: 90 }, revUnit: 'INR mn' }, {}).some(i => /jumps/.test(i)));
  assert.ok(L.checkResult({ rev: { FY27: 10 }, revUnit: 'INR mn', ebitda: { FY27: 50 }, ebitdaUnit: 'INR mn' }, {}).some(i => /larger/.test(i)));
  assert.deepStrictEqual(L.checkResult({ rev: { FY27: 10, FY28: 12 }, revUnit: 'INR mn', ebitda: { FY27: -3, FY28: 1 }, ebitdaUnit: 'INR mn' }, {}), [], 'a loss is allowed');
});

t('aggregate averages per year and computes like-for-like growth', () => {
  const b = {
    A: { rev: { FY26: 100, FY27: 120, FY28: 140, FY29: 160 }, revUnit: 'INR mn', ebitda: { FY26: 10, FY27: 12 }, ebitdaUnit: 'INR mn' },
    B: { rev: { FY26: 100, FY27: 110, FY28: 120 }, revUnit: 'INR mn', ebitda: { FY26: 10, FY27: 14 }, ebitdaUnit: 'INR mn' },
  };
  const a = L.aggregate(b, {});
  assert.strictEqual(a.avg.rev.FY27, 115);
  assert.strictEqual(a.avg.rev.FY29, 160);
  assert.strictEqual(a.n.rev.FY27, 2);
  assert.strictEqual(a.n.rev.FY29, 1);
  assert.strictEqual(a.growth.rev.FY27, 0.15);
  // FY29 uses A only: 160/140, not 160 vs the two-broker FY28 average of 130.
  assert.strictEqual(a.growth.rev.FY29, +(160 / 140 - 1).toFixed(4));
  assert.strictEqual(a.growth.ebitda.FY27, 0.3);
  assert.strictEqual(a.growth.ebitda.FY28, undefined);
});

t('aggregate marks a loss-making base as not meaningful', () => {
  const a = L.aggregate({ A: { ebitda: { FY26: -50, FY27: 10, FY28: 40 }, ebitdaUnit: 'INR mn' } }, {});
  assert.strictEqual(a.growth.ebitda.FY27, undefined);
  assert.strictEqual(a.nm.ebitda.FY27, true);
  assert.strictEqual(a.growth.ebitda.FY28, 3);
  assert.strictEqual(a.avg.ebitda.FY27, 10);
});

t('aggregate keeps every broker in the average, however far from the others', () => {
  const a = L.aggregate({ A: { rev: { FY26: 100, FY27: 110 }, revUnit: 'INR mn' }, B: { rev: { FY26: 101, FY27: 112 }, revUnit: 'INR mn' }, C: { rev: { FY26: 60, FY27: 66 }, revUnit: 'INR mn' } }, {});
  assert.deepStrictEqual(a.excluded.rev, {});
  assert.strictEqual(a.n.rev.FY27, 3);
  assert.strictEqual(a.avg.rev.FY27, 96);
});

t('IT revenue: the currency most brokers can supply wins and alt series are used', () => {
  const b = {
    A: { rev: { FY27: 20000 }, revUnit: 'US$ mn', revAlt: { FY27: 1800000 }, revAltUnit: 'INR mn' },
    B: { rev: { FY27: 1900000 }, revUnit: 'INR mn' },
    C: { rev: { FY27: 1700000 }, revUnit: 'INR mn' },
  };
  const a = L.aggregate(b, { revUnit: 'US$ mn' });
  assert.strictEqual(a.unit.rev, 'INR mn');
  assert.strictEqual(a.avg.rev.FY27, 1800000);
  assert.strictEqual(a.used.rev.A, 'alt');
  const c = L.aggregate({ A: { rev: { FY27: 20000 }, revUnit: 'US$ mn' }, B: { rev: { FY27: 1900000 }, revUnit: 'INR mn' } }, { revUnit: 'US$ mn' });
  assert.strictEqual(c.unit.rev, 'US$ mn', 'a tie goes to the row\'s own currency');
  assert.ok(c.excluded.rev.B);
});

t('nextNote walks back only until a table is found, and picks up newer notes', () => {
  const n = [{ key: 'c', date: '261010' }, { key: 'b', date: '260810' }, { key: 'a', date: '260601' }];
  assert.strictEqual(L.nextNote(n, [], null).key, 'c');
  assert.strictEqual(L.nextNote(n, ['c'], null).key, 'b');
  assert.strictEqual(L.nextNote(n, ['c', 'b', 'a'], null), null);
  assert.strictEqual(L.nextNote(n, ['c', 'b'], null, 2), null, 'stops at maxTries');
  assert.strictEqual(L.nextNote(n, ['c'], { date: '261010' }), null, 'already holds the newest');
  assert.strictEqual(L.nextNote(n, ['b'], { date: '260810' }).key, 'c', 'newer note re-opens the pair');
  assert.strictEqual(L.nextNote(n, ['c', 'b'], { date: '260810' }), null, 'newer note already tried, no table');
});

t('toRecord keeps alt revenue only when it is a different currency', () => {
  const r = L.toRecord({ rev: { FY27: 20 }, revUnit: 'US$ bn', revAlt: { FY27: 1800 }, revAltUnit: 'INR bn', ebitda: { FY27: 300 }, ebitdaUnit: 'INR bn', page: 3, fye: 'Mar' }, { date: '261010', key: 'k' });
  assert.deepStrictEqual(r.rev, { FY27: 20000 });
  assert.strictEqual(r.revAltUnit, 'INR mn');
  assert.deepStrictEqual(r.ebitda, { FY27: 300000 });
  assert.strictEqual(r.page, 3);
});

t('EPS: rupees per share only, averaged and grown like the other lines', () => {
  const rec = L.toRecord({ rev: { FY27: 100 }, revUnit: 'INR mn', eps: { FY26: 40.123, FY27: 50 }, epsUnit: 'INR', epsLabel: 'Adj. EPS' }, { date: '261010', key: 'k' });
  assert.deepStrictEqual(rec.eps, { FY26: 40.12, FY27: 50 });
  assert.strictEqual(rec.epsUnit, 'INR');
  assert.strictEqual(L.toRecord({ rev: { FY27: 100 }, revUnit: 'INR mn', eps: { FY27: 1.2 }, epsUnit: 'US$' }, { date: '261010', key: 'k' }).epsUnit, 'US$');
  const a = L.aggregate({ A: { eps: { FY26: 40, FY27: 50 }, epsUnit: 'INR' }, B: { eps: { FY26: 40, FY27: 60 }, epsUnit: 'INR' } }, {});
  assert.strictEqual(a.avg.eps.FY27, 55);
  assert.strictEqual(a.growth.eps.FY27, 0.375);
  assert.strictEqual(a.unit.eps, 'INR');
  assert.strictEqual(L.aggregate({ A: { eps: { FY27: 466.875 }, epsUnit: 'INR' } }, {}).avg.eps.FY27, 466.88, 'EPS keeps its decimals');
});

t('EPS: kept when far from the others, and checked against the price', () => {
  const b = { A: { eps: { FY26: 40, FY27: 50 }, epsUnit: 'INR' }, B: { eps: { FY26: 41, FY27: 52 }, epsUnit: 'INR' }, C: { eps: { FY26: 400, FY27: 500 }, epsUnit: 'INR' } };
  const a = L.aggregate(b, {});
  assert.deepStrictEqual(a.excluded.eps, {});
  assert.strictEqual(a.avg.eps.FY27, 200.67);
  assert.ok(L.checkResult({ rev: { FY27: 10 }, revUnit: 'INR mn', eps: { FY27: 900 }, epsUnit: 'INR' }, { _px: 1000 }).some(i => /P\/E/.test(i)));
  assert.deepStrictEqual(L.checkResult({ rev: { FY27: 10 }, revUnit: 'INR mn', eps: { FY27: 50 }, epsUnit: 'INR' }, { _px: 1000 }), []);
  assert.strictEqual(L.hasNumbers({ eps: { FY27: 50 }, epsUnit: 'INR' }), false, 'EPS alone does not end the search');
});

t('target price: read from a result, sanity-checked, averaged per currency', () => {
  const note = { date: '261010', key: 'k' };
  assert.deepStrictEqual(L.tpOf({ targetPrice: 1250, tpCurrency: 'INR', rating: 'Buy' }, note), { tp: 1250, cur: 'INR', rating: 'Buy', date: '261010', key: 'k' });
  assert.strictEqual(L.tpOf({ targetPrice: 80, tpCurrency: 'US$', rating: 'Hold' }, note).cur, 'US$');
  assert.strictEqual(L.tpOf({ targetPrice: null, rating: 'Hold' }, note).tp, null, 'a rating with no TP still counts');
  assert.strictEqual(L.tpOf({ found: false }, note), null);
  assert.ok(L.checkResult({ targetPrice: 15, rating: 'Buy' }, { _px: 388 }).some(i => /target price/.test(i)));
  assert.deepStrictEqual(L.checkResult({ targetPrice: 450, rating: 'Buy' }, { _px: 388 }), []);
  assert.deepStrictEqual(L.checkResult({ targetPrice: 80, tpCurrency: 'US$' }, { _px: 6000 }), [], 'other currency is not compared');
  const a = L.aggregateTp({ A: { tp: 100, cur: 'INR' }, B: { tp: 120, cur: 'INR' }, C: { tp: null, cur: 'INR' }, D: { tp: 5, cur: 'US$' } });
  assert.deepStrictEqual(a, { avg: 110, n: 2, cur: 'INR' });
  assert.deepStrictEqual(L.aggregateTp({}), { avg: null, n: 0, cur: null });
});

t('rating changes: ranked across house scales, same rank is no event', () => {
  const note = { date: '261027', key: 'k' };
  assert.strictEqual(L.ratingRank('Overweight'), 4);
  assert.strictEqual(L.ratingRank('Equal-weight'), 2);
  assert.strictEqual(L.ratingRank('O-PF'), 4);
  assert.strictEqual(L.ratingRank('ADD'), 3);
  assert.strictEqual(L.ratingRank('Rating suspended'), null);
  assert.deepStrictEqual(L.ratingEvent('Add', 'Buy', note, 'Kotak'), { d: '261027', b: 'Kotak', from: 'Add', to: 'Buy', dir: 'up', key: 'k' });
  assert.strictEqual(L.ratingEvent('Neutral', 'Underweight', note, 'JPMorgan').dir, 'down');
  assert.strictEqual(L.ratingEvent('Buy', 'Outperform', note, 'X'), null, 'same rank');
  assert.strictEqual(L.ratingEvent(null, 'Buy', note, 'X'), null);
  assert.strictEqual(L.tpOf({ targetPrice: 100, rating: 'Buy', previousRating: 'Hold' }, note).prev, 'Hold');
});

console.log(`\n${n} tests passed`);
