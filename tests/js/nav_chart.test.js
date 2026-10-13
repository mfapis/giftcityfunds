// NavChart: the class series and the subscription / redemption NAV switch (the chart itself needs a browser; the data shaping does not).
global.window = {};
require('../../static/js/nav_chart.js');
const assert = require('assert');
const { seriesOf, hasRedemption } = global.window.NavChart;

const rows = [
  { nav_date: '2026-10-08', nav: 105.8946, redemption_nav: 105.201, share_class: 'Class U' },
  { nav_date: '2026-10-09', nav: 106.249, redemption_nav: 105.4377, share_class: 'Class U' },
  { nav_date: '2026-10-09', nav: 107.2855, redemption_nav: 106.4663, share_class: 'Class I' },
];
assert.ok(hasRedemption(rows));
assert.deepStrictEqual(seriesOf(rows).map((s) => s.label), ['Class U', 'Class I']);
assert.strictEqual(seriesOf(rows)[0].points[1].y, 106.249);
assert.strictEqual(seriesOf(rows, 'redemption')[0].points[1].y, 105.4377);

// a fund that publishes one figure for both (DSP): no switch
const same = [{ nav_date: '2026-10-09', nav: 9.3, redemption_nav: 9.3, share_class: 'Direct' }];
assert.ok(!hasRedemption(same));
assert.ok(!hasRedemption([{ nav_date: '2026-10-09', nav: 9.3, share_class: 'Direct' }]));

// rows without a redemption NAV are left out of the redemption series, not drawn as zero
const mixed = [{ nav_date: '2026-10-08', nav: 100, share_class: 'Class U' }, { nav_date: '2026-10-09', nav: 101, redemption_nav: 99, share_class: 'Class U' }];
assert.deepStrictEqual(seriesOf(mixed, 'redemption')[0].points.map((p) => p.y), [99]);
console.log('ALL nav_chart tests passed');
