/**
 * returns_table.js
 * Returns and volatility of every share class, calculated from its daily NAV, laid out as one table: a column per share class, a row per
 * period (the layout of the sif360 performance table). Nothing is estimated: a period the NAV history does not cover shows a dash.
 *
 *   Returns   < 1 year: absolute (simple point-to-point); 3 and 5 years, and since inception once it is a year or more: annualised (CAGR).
 *   Volatility: annualised standard deviation of the daily NAV returns (x sqrt(252)).
 *
 * A period starts on the same calendar date N months before the last NAV, or on the closest earlier NAV when that date has none, but
 * only when that NAV is within 10 days of it (4 days for one week). Works in the browser (window.ReturnsTable) and in node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReturnsTable = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const MAX_GAP_DAYS = { default: 10, '1W': 4 };
  const MIN_RETURNS_FOR_VOLATILITY = 10;

  const RETURN_PERIODS = [
    { key: '1W', label: '1 Week', days: 7 },
    { key: '1M', label: '1 Month', months: 1 },
    { key: '3M', label: '3 Months', months: 3 },
    { key: '6M', label: '6 Months', months: 6 },
    { key: 'YTD', label: 'Year to Date' },
    { key: '1Y', label: '1 Year', months: 12 },
    { key: '3Y', label: '3 Years', months: 36, annualised: true },
    { key: '5Y', label: '5 Years', months: 60, annualised: true },
    { key: 'SI', label: 'Since Inception' },
  ];
  const VOLATILITY_PERIODS = RETURN_PERIODS.filter((p) => p.key !== '1W' && p.key !== 'YTD');

  const ts = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };

  function monthsBefore(t, n) {
    const d = new Date(t);
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), lastDay));
  }

  /** Index of the last point on or before time t (points sorted ascending), or -1. */
  function onOrBefore(points, t) {
    let lo = 0, hi = points.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  /** The point a period starts from, or null when the history does not cover it. */
  function startPoint(points, period) {
    const first = points[0], last = points[points.length - 1];
    if (period.key === 'SI') return first;
    let target;
    if (period.key === 'YTD') target = Date.UTC(new Date(last.t).getUTCFullYear() - 1, 11, 31);
    else if (period.days) target = last.t - period.days * DAY;
    else target = monthsBefore(last.t, period.months);
    if (first.t > target) return null;
    const i = onOrBefore(points, target);
    if (i < 0) return null;
    const limit = period.key === '1W' ? MAX_GAP_DAYS['1W'] : MAX_GAP_DAYS.default;
    if ((target - points[i].t) / DAY > limit) return null;
    return points[i].t < last.t ? points[i] : null;
  }

  function returnFor(points, period) {
    const start = startPoint(points, period);
    if (!start) return null;
    const last = points[points.length - 1];
    const ratio = last.nav / start.nav;
    const years = (last.t - start.t) / (365 * DAY);
    const annualise = period.annualised || (period.key === 'SI' && years >= 1);
    return (annualise ? Math.pow(ratio, 1 / years) - 1 : ratio - 1) * 100;
  }

  function volatilityFor(points, period) {
    const start = startPoint(points, period);
    if (!start) return null;
    const from = points.indexOf(start);
    const rets = [];
    for (let i = from + 1; i < points.length; i++) rets.push(points[i].nav / points[i - 1].nav - 1);
    if (rets.length < MIN_RETURNS_FOR_VOLATILITY) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  /** points: [{date|nav_date, nav}] in any order. Returns the class's returns and volatility per period key. */
  function metricsFor(rows) {
    const points = rows
      .map((r) => ({ t: ts(r.date || r.nav_date), nav: Number(r.nav), date: String(r.date || r.nav_date).slice(0, 10) }))
      .filter((p) => Number.isFinite(p.t) && p.nav > 0)
      .sort((a, b) => a.t - b.t);
    const out = { count: points.length, first: points[0] || null, last: points[points.length - 1] || null, returns: {}, volatility: {} };
    if (points.length < 2) return out;
    RETURN_PERIODS.forEach((p) => { out.returns[p.key] = returnFor(points, p); });
    VOLATILITY_PERIODS.forEach((p) => { out.volatility[p.key] = volatilityFor(points, p); });
    return out;
  }

  const CLASS_ORDER = ['Direct', 'Regular'];
  function sortClasses(names) {
    const rank = (n) => { const i = CLASS_ORDER.indexOf(n); return i < 0 ? CLASS_ORDER.length : i; };
    return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
  }

  /** history: [{share_class, nav_date, nav}]. Rows with no share class are old one-off snapshots, not a series, and are left out. */
  function buildModel(history) {
    const byClass = {};
    (history || []).forEach((r) => { if (r.share_class) (byClass[r.share_class] = byClass[r.share_class] || []).push(r); });
    const classes = sortClasses(Object.keys(byClass));
    const metrics = {};
    classes.forEach((c) => { metrics[c] = metricsFor(byClass[c]); });
    const rowsOf = (periods, kind) => periods
      .map((p) => ({ key: p.key, label: p.label, values: classes.map((c) => metrics[c][kind][p.key] ?? null) }))
      .filter((r) => r.values.some((v) => v !== null));        // a period no class can show is left out, not shown as a row of dashes
    return { classes, metrics, returns: rowsOf(RETURN_PERIODS, 'returns'), volatility: rowsOf(VOLATILITY_PERIODS, 'volatility') };
  }

  // ---------- heat colours ----------
  // Intensity follows the size of the number itself, not its rank in the row, so two nearly equal numbers look nearly equal and a tiny
  // return stays pale. Returns: green above zero, red below, full strength at 5% or at the row's largest move if that is bigger.
  // Volatility: green when low to red when high, full red at 20% or at the row's highest if that is bigger.
  const RETURN_FULL = 5, VOLATILITY_FULL = 20;
  function heat(value, row, kind) {
    if (value === null || !Number.isFinite(value)) return '';
    const vals = row.filter((v) => v !== null && Number.isFinite(v));
    if (kind === 'returns') {
      if (value === 0) return 'background:#fdf6e3;color:#1f2937';
      const k = Math.min(1, Math.abs(value) / Math.max(RETURN_FULL, ...vals.map(Math.abs)));
      return `background:hsl(${value > 0 ? 142 : 4},62%,${93 - 43 * k}%);color:${k > 0.8 ? '#fff' : '#1f2937'}`;
    }
    const k = Math.min(1, value / Math.max(VOLATILITY_FULL, ...vals));
    return `background:hsl(${Math.round(142 - 138 * k)},62%,${90 - 32 * k}%);color:${k > 0.85 ? '#fff' : '#1f2937'}`;
  }

  const pct = (v) => (v === null || !Number.isFinite(v) ? '-' : `${v.toFixed(2)}%`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Renders the table into `container`. meta: {category, aum, aumCurrency, aumDate}. Returns false when there is nothing to show. */
  function render(container, history, meta) {
    const m = buildModel(history);
    if (!m.classes.length || (!m.returns.length && !m.volatility.length)) return false;
    const n = m.classes.length;
    const th = 'style="padding:8px 12px;text-align:center;white-space:nowrap"';
    const sticky = 'position:sticky;left:0;z-index:1;background:var(--color-bg-subtle,#f8fafc);text-align:left;padding:8px 12px;white-space:nowrap;font-weight:700';
    const info = (label, cells) => `<tr><td style="${sticky}">${label}</td>${cells}</tr>`;
    const one = (text) => `<td colspan="${n}" style="padding:8px 12px;text-align:center;font-weight:600">${esc(text)}</td>`;
    const perClass = (fn) => m.classes.map((c) => `<td ${th}>${esc(fn(m.metrics[c]))}</td>`).join('');
    const block = (title, rows, kind) => rows.length ? `
      <tr><td style="${sticky};text-transform:uppercase;font-size:11px;letter-spacing:.04em" colspan="${n + 1}">${title}</td></tr>
      ${rows.map((r) => `<tr><td style="${sticky};font-weight:600">${esc(r.label)}</td>${r.values.map((v) =>
        `<td style="padding:8px 12px;text-align:center;font-weight:600;${heat(v, r.values, kind)}">${pct(v)}</td>`).join('')}</tr>`).join('')}` : '';
    const aum = meta && meta.aum != null
      ? `${meta.aumCurrency === 'USD' || !meta.aumCurrency ? '$' : ''}${Number(meta.aum).toLocaleString(undefined, { maximumFractionDigits: 0 })}${meta.aumDate ? ` as on ${meta.aumDate}` : ''}` : null;
    container.innerHTML = `
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
        <table style="border-collapse:collapse;min-width:100%;font-size:12px">
          <thead><tr><th style="${sticky}">Share class</th>${m.classes.map((c) => `<th ${th}>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>
            ${info('Inception date', perClass((x) => (x.first ? x.first.date : '-')))}
            ${meta && meta.category ? info('Category', one(meta.category)) : ''}
            ${aum ? info('AUM', one(aum)) : ''}
            ${info('Performance as on', perClass((x) => (x.last ? x.last.date : '-')))}
            ${block('Absolute returns (%)', m.returns, 'returns')}
            ${block('Volatility (%) (annualised SD)', m.volatility, 'volatility')}
          </tbody>
        </table>
      </div>
      <p style="margin-top:10px;font-size:11px;color:var(--color-text-subtle,#64748b)">
        <b>Returns:</b> under 1 year, absolute (simple point-to-point); 3 and 5 years, and since inception once it is a year or more, annualised (CAGR).
        Calculated from each share class's daily subscription NAV. <b>Volatility:</b> annualised standard deviation of daily NAV returns (&times; &radic;252).
        A dash means the NAV history does not cover that period.
      </p>`;
    return true;
  }

  return { RETURN_PERIODS, VOLATILITY_PERIODS, metricsFor, buildModel, heat, render, monthsBefore };
});
