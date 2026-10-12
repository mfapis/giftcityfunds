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

console.log('ALL returns_table tests passed');
