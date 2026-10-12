// Run with: node tests/js/returns_table.test.js   (also run by tests/test_returns_table_js.py)
const assert = require('assert');
const RT = require('../../static/js/returns_table.js');

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const DAY = 86400000;
/** daily NAVs (calendar days) starting at `start`, navs from fn(i) */
const series = (cls, start, n, fn) => Array.from({ length: n }, (_, i) => ({ share_class: cls, nav_date: iso(Date.UTC(...start) + i * DAY), nav: fn(i) }));
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);

// absolute return under a year, point to point: 100 -> 110 over a month of daily steps
{
  const h = series('Direct', [2026, 0, 1], 60, (i) => 100 * Math.pow(1.001, i));
  const m = RT.metricsFor(h);
  const last = h[h.length - 1];
  const start = h.find((r) => r.nav_date === '2026-01-29');            // 1 month before 1 Mar 2026 (the last date) is 1 Feb... checked below
  assert.strictEqual(m.last.date, last.nav_date);
  near(m.returns['1M'], (last.nav / h.find((r) => r.nav_date === iso(RT.monthsBefore(Date.parse(last.nav_date), 1))).nav - 1) * 100);
  near(m.returns.SI, (last.nav / h[0].nav - 1) * 100);                  // under a year: absolute
  assert.strictEqual(m.returns['3M'], null);                            // history shorter than 3 months: a dash, never an estimate
  assert.strictEqual(m.returns['1Y'], null);
}

// since inception and 3 years are annualised once the history is a year or more
{
  const h = series('Direct', [2024, 0, 1], 800, (i) => 100 * Math.pow(1.0004, i));
  const m = RT.metricsFor(h);
  const years = (h.length - 1) / 365;
  near(m.returns.SI, (Math.pow(h[h.length - 1].nav / 100, 1 / years) - 1) * 100, 1e-6);   // CAGR
  assert.ok(m.returns['1Y'] > 0 && m.returns['3Y'] === null);
}

// a period's start NAV may be up to 10 days before the date; further back it is not used
{
  const h = series('Direct', [2026, 0, 1], 120, (i) => 100 + i).filter((r) => !['2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'].includes(r.nav_date));
  assert.notStrictEqual(RT.metricsFor(h).returns['1M'], null);          // end 30 Apr: start 30 Mar has no NAV; 25 Mar is 5 days back: used
  const wide = series('Direct', [2026, 0, 1], 120, (i) => 100 + i).filter((r) => r.nav_date < '2026-03-10' || r.nav_date > '2026-03-31');
  assert.strictEqual(RT.metricsFor(wide).returns['1M'], null);          // 20 days with no NAV: not covered
}

// volatility: daily returns alternating +1% / -1% have a known standard deviation, annualised by sqrt(252)
{
  let nav = 100;
  const h = series('Direct', [2026, 0, 1], 200, (i) => (nav = i === 0 ? 100 : nav * (i % 2 ? 1.01 : 0.99)));
  const m = RT.metricsFor(h);
  const rets = h.slice(1).map((r, i) => r.nav / h[i].nav - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  near(m.volatility.SI, sd * Math.sqrt(252) * 100, 1e-9);
  assert.ok(m.volatility['1M'] > 0);
}

// too few daily returns for a volatility: a dash
{
  const m = RT.metricsFor(series('Direct', [2026, 0, 1], 6, (i) => 100 + i));
  assert.strictEqual(m.volatility.SI, null);
}

// the model: Direct and Regular first, unlabelled snapshots left out, a period no class can show is not a row
{
  const h = [...series('Class B', [2026, 0, 1], 120, (i) => 100 + i), ...series('Regular', [2026, 0, 1], 120, (i) => 100 + i),
             ...series('Direct', [2026, 0, 1], 120, (i) => 100 + i), ...series(null, [2026, 0, 1], 50, () => 77)];
  const model = RT.buildModel(h);
  assert.deepStrictEqual(model.classes, ['Direct', 'Regular', 'Class B']);
  assert.ok(model.returns.some((r) => r.key === '1M') && !model.returns.some((r) => r.key === '1Y' || r.key === '3Y'));
  assert.ok(model.returns.every((r) => r.values.length === 3));
  const young = RT.buildModel(series('Direct', [2026, 0, 1], 120, (i) => 100 + i).concat(series('Regular', [2026, 3, 20], 5, (i) => 100 + i)));
  assert.strictEqual(young.returns.find((r) => r.key === '3M').values[1], null);   // the younger class shows a dash beside the older one
}

// month arithmetic clamps to the end of a shorter month
assert.strictEqual(iso(RT.monthsBefore(Date.UTC(2026, 2, 31), 1)), '2026-02-28');
assert.strictEqual(iso(RT.monthsBefore(Date.UTC(2026, 0, 31), 12)), '2025-01-31');

// colours follow the size of the number, not its rank in the row
assert.strictEqual(RT.heat(null, [1, 2], 'returns'), '');
assert.ok(/hsl\(142/.test(RT.heat(5, [5, -2], 'returns')) && /hsl\(4,/.test(RT.heat(-5, [5, -5], 'returns')));
const pale = (c) => Number(/,(\d+(?:\.\d+)?)%\)/.exec(c)[1]);                      // lightness: higher = paler
assert.ok(pale(RT.heat(0.03, [0.03, 0.01], 'returns')) > 90);                              // a tiny return stays pale
assert.ok(Math.abs(pale(RT.heat(9.78, [9.78, 9.22], 'volatility')) - pale(RT.heat(9.22, [9.78, 9.22], 'volatility'))) < 3);   // nearly equal: nearly the same colour
assert.ok(/hsl\(142/.test(RT.heat(0, [0, 30], 'volatility')) || /hsl\(14\d/.test(RT.heat(0, [0, 30], 'volatility')));
assert.ok(/hsl\(4,/.test(RT.heat(30, [5, 30], 'volatility')));                            // the highest volatility is red


// ---- the comparison (a column per fund) ----
{
  const fund = (id, name, classes, extra = {}) => ({ fund_id: id, fund_name: name, amc_name: 'AMC', category: 'Retail MF', inception_date: '2025-09-18', aum: 5e6, aum_date: '2026-09-30', classes, ...extra });
  const pts = (n, f) => series('x', [2026, 0, 1], n, f).map((r) => [r.nav_date, r.nav]);
  const funds = [
    fund(1, 'Alpha', { Direct: { label: 'Direct', points: pts(200, (i) => 100 + i) }, Regular: { label: 'Regular', points: pts(200, (i) => 100 + 0.9 * i) } }),
    fund(2, 'Beta', { Direct: { label: 'Class A1', points: pts(150, (i) => 50 + i * 0.1) }, Regular: null }),   // no Regular plan: its headline class is shown
    fund(3, 'Gamma', { Direct: { label: 'Direct', points: pts(1, () => 10) }, Regular: null }),                 // one NAV: not a series, no column
  ];
  const d = RT.buildComparison(funds, 'Direct');
  assert.deepStrictEqual(d.columns.map((c) => c.fund.fund_name), ['Alpha', 'Beta']);
  const r = RT.buildComparison(funds, 'Regular');
  assert.deepStrictEqual(r.columns.map((c) => c.classLabel), ['Regular', 'Class A1']);                         // Beta falls back to its headline class
  assert.ok(d.returns.every((row) => row.values.length === 2) && d.volatility.every((row) => row.values.length === 2));
  assert.ok(d.returns.some((row) => row.key === '3M') && !d.returns.some((row) => row.key === '3Y'));
  assert.strictEqual(RT.buildComparison([], 'Direct').columns.length, 0);
  // the comparison agrees with the fund's own table for the same class
  const own = RT.metricsFor(funds[0].classes.Direct.points.map(([date, nav]) => ({ date, nav })));
  near(d.returns.find((x) => x.key === '1M').values[0], own.returns['1M'], 1e-12);
  near(d.volatility.find((x) => x.key === 'SI').values[0], own.volatility.SI, 1e-12);
  assert.strictEqual(RT.fmtDate('2026-09-30'), '30-Sep-26');
  assert.strictEqual(RT.fmtDate(null), '-');
  assert.strictEqual(RT.fmtUsd(61200000), '$61.20M');
  assert.strictEqual(RT.fmtUsd(null), '-');
}

console.log('ALL returns_table tests passed');
