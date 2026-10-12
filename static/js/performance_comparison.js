/**
 * performance_comparison.js
 * Home page: returns and volatility of every fund with a live daily NAV, side by side (a column per fund), with a Direct / Regular switch.
 * Data: /api/performance-comparison (the NAV series); the numbers are calculated here by ReturnsTable, exactly as on a fund's own page.
 */
document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('perfCompareBody');
  if (!body || !window.ReturnsTable) return;
  const note = document.getElementById('perfCompareNote');
  const buttons = document.querySelectorAll('[data-perf-plan]');
  let funds = null;
  let plan = 'Direct';

  const paint = () => {
    buttons.forEach((b) => {
      const on = b.getAttribute('data-perf-plan') === plan;
      b.className = 'px-3 py-1 text-xs font-bold rounded transition-all ' + (on ? 'bg-blue-600 text-white' : 'text-[var(--color-text-muted)] hover:text-blue-500');
    });
    if (!window.ReturnsTable.renderComparison(body, funds, plan)) {
      body.innerHTML = '<div class="p-6 text-center text-xs text-[var(--color-text-subtle)]">No fund has a daily NAV history to compare yet.</div>';
    }
  };

  buttons.forEach((b) => b.addEventListener('click', () => {
    plan = b.getAttribute('data-perf-plan');
    if (funds) paint();
    if (window.gaTrack) window.gaTrack('Performance Compare Plan', { plan });
  }));

  fetch('/api/performance-comparison')
    .then((r) => r.json())
    .then((data) => {
      if (!data.success) throw new Error(data.error || 'request failed');
      funds = data.funds;
      if (note) note.textContent = `${funds.length} funds with a live daily NAV`;
      paint();
    })
    .catch((e) => {
      console.error('Performance comparison failed:', e);
      body.innerHTML = '<div class="p-6 text-center text-xs text-[var(--color-text-subtle)]">The performance comparison could not be loaded right now. Please try again shortly.</div>';
    });
});
