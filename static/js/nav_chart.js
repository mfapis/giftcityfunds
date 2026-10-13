/**
 * nav_chart.js
 * Full-width NAV history chart for a fund page: one line per share class (Direct and Regular side by side, other classes too), each in its own
 * colour, with a legend that doubles as an on/off switch and shows the change for the range being viewed. Needs Chart.js.
 *
 *   NavChart.render({ canvas, legend, note, history, range, isLight, currency })
 *
 * `history` rows: {nav_date, nav, share_class}. Rows without a share class are one series called "NAV".
 */
(function () {
  const COLORS = { direct: '#38bdf8', regular: '#f59e0b' };   // Direct keeps the cyan-blue the NAV line always had
  const EXTRA = ['#10b981', '#e11d48', '#7c3aed', '#0891b2', '#64748b', '#d946ef'];
  let selected = null;                      // share class being viewed; kept across range changes
  let chart = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const fmtDay = (ms, withYear) => {
    const d = new Date(ms);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}`;
  };

  /** [{label, points: [{x, y}]}] with Direct first, Regular second, then the rest as listed. */
  function seriesOf(history) {
    const by = new Map();
    for (const row of history || []) {
      const y = Number(row.nav), x = day(row.nav_date);
      if (!Number.isFinite(y) || y <= 0 || !Number.isFinite(x)) continue;
      const label = row.share_class || 'NAV';
      if (!by.has(label)) by.set(label, new Map());
      by.get(label).set(x, y);               // a date given twice keeps the last value
    }
    // Rows with no share class are old one-off snapshots; they are only drawn when the fund has nothing else.
    if (by.size > 1) by.delete('NAV');
    const list = [...by].map(([label, m]) => ({ label, points: [...m].map(([x, y]) => ({ x, y })).sort((a, b) => a.x - b.x) }));
    const rank = (l) => (/direct/i.test(l) ? 0 : /regular/i.test(l) ? 1 : 2);
    return list.sort((a, b) => rank(a.label) - rank(b.label));
  }

  // Direct and Regular keep their own colours; any other class (a fund with one unit class, HDFC India's Class A1, ...) takes the main colour
  // first and the extra palette after that. `other` counts the classes that are neither Direct nor Regular, in order.
  function colourFor(label, other) {
    if (/direct/i.test(label)) return COLORS.direct;
    if (/regular/i.test(label)) return COLORS.regular;
    return other === 0 ? COLORS.direct : EXTRA[(other - 1) % EXTRA.length];
  }

  function cutoffFor(range, lastMs) {
    if (range === 'ALL' || !range) return -Infinity;
    const end = new Date(lastMs);
    if (range === 'YTD') return Date.UTC(end.getUTCFullYear(), 0, 1);
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60 }[range] || 0;
    return Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate());
  }

  // Soft fade under each line: the line's colour at the top, clear at the baseline.
  function areaFill(context, colour, lines) {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return colour + '22';
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, colour + '52');
    g.addColorStop(1, colour + '00');
    return g;
  }

  function render(opts) {
    const { canvas, legend, note, history, range = 'ALL', isLight = true, currency = 'USD' } = opts;
    if (!canvas) return false;
    if (chart) { chart.destroy(); chart = null; }

    const all = seriesOf(history);
    if (!all.length) { canvas.style.display = 'none'; if (legend) legend.innerHTML = ''; if (note) note.textContent = ''; return false; }
    canvas.style.display = '';

    const lastMs = Math.max(...all.map((s) => s.points[s.points.length - 1].x));
    const from = cutoffFor(range, lastMs);
    let others = 0;
    const shown = all.map((s) => ({
      label: s.label, colour: colourFor(s.label, /direct|regular/i.test(s.label) ? -1 : others++), full: s.points,
      points: s.points.filter((p) => p.x >= from),
    }));
    // One share class at a time, picked with the Plan switch (Direct is first when the fund has it).
    const chosen = shown.find((s) => s.label === selected) || shown[0];
    const visible = chosen.points.length ? [chosen] : [];

    const rangeName = range === 'ALL' ? 'since launch' : range === 'YTD' ? 'year to date' : `over ${range}`;
    if (legend) {
      const p = chosen.points;
      const change = p.length > 1 ? (p[p.length - 1].y / p[0].y - 1) * 100 : null;
      const stat = change === null ? '' : `<span class="nav-legend-stat"><b style="color:${change >= 0 ? '#059669' : '#dc2626'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</b> <span class="nav-legend-sub">${rangeName}</span></span>`;
      const picker = shown.length > 1
        ? `<span class="nav-legend-sub" style="font-weight:700">Plan</span><span class="nav-plan-switch">${shown.map((s) => `<button type="button" class="nav-plan-btn ${s === chosen ? 'is-active' : ''}" data-class="${esc(s.label)}">${esc(s.label)}</button>`).join('')}</span>`
        : `<span class="nav-legend-name">${esc(chosen.label)}</span>`;
      legend.innerHTML = picker + stat;
      legend.querySelectorAll('.nav-plan-btn').forEach((b) => b.addEventListener('click', () => {
        selected = b.getAttribute('data-class');
        render(opts);
      }));
    }

    if (note) {
      const s = chosen;
      note.textContent = `${s.label}: ${s.points.length} daily NAV${s.points.length === 1 ? '' : 's'}${s.points.length ? `, ${fmtDay(s.points[0].x, true)} to ${fmtDay(s.points[s.points.length - 1].x, true)}` : ''}`;
    }
    if (!visible.length) { canvas.style.display = 'none'; return false; }

    const text = isLight ? '#64748b' : '#94a3b8';
    const grid = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    const spanDays = (Math.max(...visible.map((s) => s.points[s.points.length - 1].x)) - Math.min(...visible.map((s) => s.points[0].x))) / 864e5;

    const xMin = Math.min(...visible.map((s) => s.points[0].x));
    const xMax = Math.max(...visible.map((s) => s.points[s.points.length - 1].x));

    const crosshair = {
      id: 'navCrosshair',
      afterDatasetsDraw(c) {
        const a = c.tooltip && c.tooltip.getActiveElements && c.tooltip.getActiveElements();
        if (!a || !a.length) return;
        const x = a[0].element.x, { top, bottom } = c.chartArea, ctx = c.ctx;
        ctx.save(); ctx.strokeStyle = isLight ? 'rgba(15,23,42,.25)' : 'rgba(255,255,255,.3)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
      },
    };

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: visible.map((s) => ({
          label: s.label, data: s.points, parsing: false, borderColor: s.colour, backgroundColor: (ctx) => areaFill(ctx, s.colour, visible.length),
          borderWidth: 2.25, pointRadius: s.points.length < 40 ? 3 : 0, pointHoverRadius: 5, pointHoverBackgroundColor: s.colour, pointHoverBorderColor: isLight ? '#ffffff' : '#0b1220', pointHoverBorderWidth: 2, tension: 0.42, cubicInterpolationMode: 'monotone',
          fill: 'origin', spanGaps: true,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isLight ? '#0f172a' : '#1e293b', padding: 10, titleColor: '#fff', bodyColor: '#e2e8f0',
            callbacks: {
              title: (items) => (items.length ? fmtDay(items[0].parsed.x, true) : ''),
              label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toFixed(4)} ${currency}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear', min: xMin, max: xMax, grid: { display: false }, ticks: { color: text, maxTicksLimit: 9, maxRotation: 0, font: { size: 11 },
              callback: (v) => fmtDay(v, spanDays > 300) }, border: { display: false },
          },
          y: { position: 'right', grid: { color: grid }, border: { display: false }, ticks: { color: text, font: { size: 11 }, maxTicksLimit: 7 } },
        },
      },
      plugins: [crosshair],
    });
    return true;
  }

  window.NavChart = { render, seriesOf };
})();
