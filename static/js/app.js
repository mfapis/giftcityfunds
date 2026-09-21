/**
 * app.js
 * Frontend application controller for GIFT360 Platform.
 * Manages reactive UI, Chart.js instances, table filtering, search, comparison drawer, and detail modals.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global Application State
  const state = {
    allFunds: [],
    filteredFunds: [],
    stats: null,
    compareIds: new Set(),
    searchQuery: '',
    tierFilter: 'all',
    categoryFilter: 'all',
    currencyFilter: 'ALL',
    navFilter: 'all',
    sortBy: 'nav',
    sortOrder: 'desc',
    currentPage: 1,
    pageSize: 15,
    viewMode: 'table', // 'table' or 'grid'
    charts: {},
  };

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  const themeToggleLight = document.getElementById('themeToggleLight');
  const themeToggleDark = document.getElementById('themeToggleDark');
  const storedTheme = localStorage.getItem('gcf-theme') || 'light';

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('gcf-theme', theme);
    if (themeToggleLight) themeToggleLight.classList.toggle('active', theme === 'light');
    if (themeToggleDark) themeToggleDark.classList.toggle('active', theme === 'dark');
  }

  applyTheme(storedTheme);

  if (themeToggleLight) {
    themeToggleLight.addEventListener('click', () => {
      applyTheme('light');
      updateChartThemes();
    });
  }
  if (themeToggleDark) {
    themeToggleDark.addEventListener('click', () => {
      applyTheme('dark');
      updateChartThemes();
    });
  }

  // --------------------------------------------------------------------------
  // Fetch Initial Data
  // --------------------------------------------------------------------------
  async function init() {
    try {
      await Promise.all([fetchStats(), fetchFunds()]);
      setupEventListeners();
    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success) {
        state.stats = data;
        renderHeroCounters(data.summary);
        renderCharts(data.charts);
        renderAmcDirectory(data.charts.amc_distribution);
        renderMarqueeTicker(data);
      }
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  }

  async function fetchFunds() {
    try {
      const res = await fetch('/api/funds');
      const data = await res.json();
      if (data.success) {
        state.allFunds = data.funds;
        applyFilters();
        renderHeroFundPreview(data.funds);
        updateCategoryTabCounts();
      }
    } catch (e) {
      console.error('Failed to fetch funds:', e);
    }
  }

  // Keeps the category tab labels ("All Funds (83)", "PMS Strategies (12)",
  // etc.) in sync with whatever is actually in the DB, instead of a number
  // typed into the HTML by hand that silently goes stale the moment a fund
  // is added or removed. Uses the same substring-match logic as
  // applyFilters()'s category filter so a tab's count always matches what
  // clicking it actually shows.
  function updateCategoryTabCounts() {
    document.querySelectorAll('.cat-filter-btn').forEach(btn => {
      const countEl = btn.querySelector('.cat-count');
      if (!countEl) return;
      const cat = btn.getAttribute('data-category');
      const count = cat === 'all'
        ? state.allFunds.length
        : state.allFunds.filter(f => f.category && f.category.toLowerCase().includes(cat.toLowerCase())).length;
      countEl.textContent = `(${count})`;
    });
  }

  // Real, live fund data shown right under the hero -- not a hardcoded
  // sample list, so it always reflects whatever's actually in the API.
  // Prefers funds with a live NAV (more useful at a glance); falls back to
  // the first few funds if none have one yet.
  function renderHeroFundPreview(funds) {
    const container = document.getElementById('heroFundPreview');
    if (!container) return;
    if (!funds || !funds.length) {
      container.innerHTML = '<div class="p-6 text-center text-xs text-[var(--color-text-subtle)]">No funds available right now.</div>';
      return;
    }
    const withNav = funds.filter(f => f.nav != null);
    const preview = (withNav.length ? withNav : funds).slice(0, 3);

    const rows = preview.map(f => {
      const slug = slugify(f.fund_name);
      const navText = f.nav != null ? `${Number(f.nav).toFixed(2)} ${f.nav_currency || 'USD'}` : '—';
      return `
        <a href="/fund/${f.fund_id}/${slug}" class="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-[var(--color-card-hover)] transition-colors border-b border-[var(--color-border)] last:border-b-0">
          <div class="min-w-0">
            <div class="text-xs sm:text-sm font-bold text-[var(--color-text)] truncate">${escapeHtml(f.fund_name)}</div>
            <div class="text-[10px] sm:text-[11px] text-[var(--color-text-subtle)] truncate">${escapeHtml(f.category || 'Unclassified')} · ${escapeHtml(f.amc_name || '')}</div>
          </div>
          <div class="text-xs sm:text-sm font-mono font-bold text-[var(--color-text)] shrink-0">${navText}</div>
        </a>`;
    }).join('');

    container.innerHTML = rows;
  }

  // --------------------------------------------------------------------------
  // Render Hero & Ticker
  // --------------------------------------------------------------------------
  function renderHeroCounters(summary) {
    const elTotal = document.getElementById('statTotalFunds');
    const elTier1 = document.getElementById('statTier1');
    const elLiveNav = document.getElementById('statLiveNav');
    const elAmcs = document.getElementById('statTotalAmcs');

    if (elTotal) elTotal.textContent = summary.total_funds;
    if (elTier1) elTier1.textContent = (summary.outbound_funds || 0) + (summary.inbound_funds || 0);
    if (elLiveNav) elLiveNav.textContent = summary.funds_with_live_nav;
    if (elAmcs) elAmcs.textContent = summary.total_amcs;
  }

  // Badge accent colors for the AMC Directory cards -- purely decorative
  // identity avatars (not a data-encoding chart), cycled in a fixed order.
  const AMC_BADGE_COLORS = [
    { bg: 'bg-blue-600/10', border: 'border-blue-500/20', text: 'text-blue-400' },
    { bg: 'bg-emerald-600/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
    { bg: 'bg-purple-600/10', border: 'border-purple-500/20', text: 'text-purple-400' },
    { bg: 'bg-amber-600/10', border: 'border-amber-500/20', text: 'text-amber-400' },
    { bg: 'bg-rose-600/10', border: 'border-rose-500/20', text: 'text-rose-400' },
    { bg: 'bg-teal-600/10', border: 'border-teal-500/20', text: 'text-teal-400' },
  ];

  // Strips common corporate-entity suffixes so AMC names fit a small card
  // without truncating the part that actually identifies the fund house.
  function shortenAmcName(name) {
    if (!name) return 'Unknown AMC';
    let s = name
      .replace(/\(IFSC\)/gi, '')
      .replace(/IFSC\s*Private\s*Limited/gi, '')
      .replace(/IFSC\s*Branch/gi, '')
      .replace(/Private\s*Limited/gi, '')
      .replace(/Pvt\.?\s*Ltd\.?/gi, '')
      .replace(/\bLimited\b/gi, '')
      .replace(/International/gi, "Int'l")
      .replace(/Asset Managers?/gi, 'AMC')
      .replace(/Investment Managers?/gi, 'AMC')
      .replace(/\s+/g, ' ')
      .trim();
    return truncateLabel(s, 24);
  }

  // Short badge initials from the first word(s) of a (already-truncated
  // in the caller's view, but this uses the raw) AMC name.
  function amcBadgeInitials(name) {
    const cleaned = (name || '').replace(/\(.*?\)/g, '').trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return words[0].slice(0, 6).toUpperCase();
  }

  // Renders the "Active GIFT City Fund Houses" cards from real
  // /api/stats amc_distribution data -- previously this section was 6
  // hardcoded cards with invented fund counts that didn't match the
  // actual database (e.g. claimed "Kotak Mahindra -- 8 GIFT Funds" when
  // the real AMC name is "Kotak Mutual Fund" with 10 funds).
  function renderAmcDirectory(amcDistribution) {
    const grid = document.getElementById('amcDirectoryGrid');
    if (!grid || !amcDistribution) return;
    const top = amcDistribution.slice(0, 6);
    grid.innerHTML = top.map((a, i) => {
      const color = AMC_BADGE_COLORS[i % AMC_BADGE_COLORS.length];
      const shortName = shortenAmcName(a.amc);
      return `
        <div class="glass-card rounded-2xl p-4 text-center flex flex-col items-center justify-between" title="${escapeHtml(a.amc)}">
          <div class="w-12 h-12 rounded-xl ${color.bg} border ${color.border} flex items-center justify-center font-bold ${color.text} text-xs mb-2">
            ${escapeHtml(amcBadgeInitials(a.amc))}
          </div>
          <span class="font-bold text-xs text-[var(--color-text)]">${escapeHtml(shortName)}</span>
          <span class="text-[10px] text-[var(--color-text-subtle)]">${a.count} GIFT Fund${a.count === 1 ? '' : 's'}</span>
        </div>
      `;
    }).join('');
  }

  function renderMarqueeTicker(data) {
    const tickerContainer = document.getElementById('marqueeTickerTrack');
    if (!tickerContainer) return;

    const performers = data.charts.nav_performers || [];
    let itemsHtml = '';

    performers.forEach(p => {
      itemsHtml += `
        <span class="inline-flex items-center gap-2 mx-6 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span class="text-[var(--color-text)]">${escapeHtml(p.fund_name)}</span>
          <span class="text-emerald-400 font-mono font-bold">${p.nav} ${p.nav_currency || 'USD'}</span>
          <span class="text-[var(--color-text-subtle)] text-[10px]">(${p.nav_as_of || 'Live'})</span>
        </span>
      `;
    });

    // Duplicate content for smooth marquee loop
    tickerContainer.innerHTML = itemsHtml + itemsHtml;
  }

  // --------------------------------------------------------------------------
  // Render Visual Analytics (Chart.js)
  // --------------------------------------------------------------------------
  // Validated categorical order (dataviz skill reference palette) -- fixed
  // hue order, never cycled/re-sorted. A category beyond this count folds
  // into a neutral "Other" bucket rather than generating a new hue.
  const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
  const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'];
  const OTHER_GRAY_DARK = '#64748b';
  const OTHER_GRAY_LIGHT = '#94a3b8';

  // Buckets a sorted-by-value list into its top N entries plus a single
  // "Other" entry summing the remainder -- keeps legends/axes readable
  // instead of rendering dozens of tiny categorical slices.
  function bucketTopN(items, n, labelKey, valueKey) {
    const sorted = [...items].sort((a, b) => b[valueKey] - a[valueKey]);
    const top = sorted.slice(0, n);
    const restSum = sorted.slice(n).reduce((sum, item) => sum + item[valueKey], 0);
    const result = top.map(i => ({ label: i[labelKey], value: i[valueKey] }));
    if (restSum > 0) result.push({ label: 'Other', value: restSum, isOther: true });
    return result;
  }

  // Shortens a long label for axis display while keeping the full text
  // available for the tooltip -- avoids Chart.js silently clipping/
  // overlapping long fund/AMC names.
  function truncateLabel(label, maxLen) {
    if (!label) return '';
    return label.length > maxLen ? label.slice(0, maxLen - 1).trim() + '…' : label;
  }

  function renderCharts(chartData) {
    const isLight = document.documentElement.classList.contains('light');
    const textColor = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

    // 1. Category Distribution (Doughnut) -- top 7 categories + "Other"
    const catCanvas = document.getElementById('chartCategory');
    if (catCanvas && chartData.category_distribution) {
      const bucketed = bucketTopN(chartData.category_distribution, 7, 'category', 'count');
      const categoricalSet = isLight ? CATEGORICAL_LIGHT : CATEGORICAL_DARK;
      const otherGray = isLight ? OTHER_GRAY_LIGHT : OTHER_GRAY_DARK;

      state.charts.category = new Chart(catCanvas, {
        type: 'doughnut',
        data: {
          labels: bucketed.map(b => b.label),
          datasets: [{
            data: bucketed.map(b => b.value),
            backgroundColor: bucketed.map((b, i) => b.isOther ? otherGray : categoricalSet[i]),
            borderColor: isLight ? '#ffffff' : '#131d31',
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: textColor, boxWidth: 10, padding: 10, font: { size: 11 } }
            }
          },
          cutout: '62%',
        }
      });
    }

    // 2. AMC Market Share (Horizontal Bar)
    const amcCanvas = document.getElementById('chartAmc');
    if (amcCanvas && chartData.amc_distribution) {
      const topAmcs = chartData.amc_distribution.slice(0, 8);
      state.charts.amc = new Chart(amcCanvas, {
        type: 'bar',
        data: {
          labels: topAmcs.map(a => a.amc),
          datasets: [{
            label: 'Funds Tracked',
            data: topAmcs.map(a => a.count),
            backgroundColor: 'rgba(37, 99, 235, 0.85)',
            hoverBackgroundColor: '#79fe0c',
            borderRadius: 6,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 8 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => topAmcs[items[0].dataIndex].amc
              }
            }
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: textColor, stepSize: 1 }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: textColor, font: { size: 10 },
                callback: function (value) { return truncateLabel(this.getLabelForValue(value), 24); }
              }
            }
          }
        }
      });
    }

    // 3. Launch Timeline (Line/Bar)
    const timelineCanvas = document.getElementById('chartTimeline');
    if (timelineCanvas && chartData.launch_timeline) {
      state.charts.timeline = new Chart(timelineCanvas, {
        type: 'bar',
        data: {
          labels: chartData.launch_timeline.map(t => t.year),
          datasets: [{
            label: 'New Registrations',
            data: chartData.launch_timeline.map(t => t.count),
            backgroundColor: '#6366f1',
            borderRadius: 6,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor } },
            y: { grid: { color: gridColor }, ticks: { color: textColor, stepSize: 2 } }
          }
        }
      });
    }

    // 4. Top Live NAVs (Horizontal Bar) -- fund names read left-to-right on
    // the y-axis instead of rotated/overlapping on the x-axis.
    const navCanvas = document.getElementById('chartNav');
    if (navCanvas && chartData.nav_performers) {
      const topNav = chartData.nav_performers.slice(0, 8);
      state.charts.nav = new Chart(navCanvas, {
        type: 'bar',
        data: {
          labels: topNav.map(n => n.fund_name),
          datasets: [{
            label: 'Current NAV (USD)',
            data: topNav.map(n => n.nav),
            backgroundColor: 'rgba(16, 185, 129, 0.85)',
            hoverBackgroundColor: '#34d399',
            borderRadius: 6,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 8 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => topNav[items[0].dataIndex].fund_name
              }
            }
          },
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: textColor } },
            y: {
              grid: { display: false },
              ticks: {
                color: textColor, font: { size: 10 },
                callback: function (value) { return truncateLabel(this.getLabelForValue(value), 26); }
              }
            }
          }
        }
      });
    }
  }

  function updateChartThemes() {
    const isLight = document.documentElement.classList.contains('light');
    const textColor = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

    Object.values(state.charts).forEach(chart => {
      if (chart.options.scales) {
        if (chart.options.scales.x) {
          chart.options.scales.x.ticks.color = textColor;
          if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = gridColor;
        }
        if (chart.options.scales.y) {
          chart.options.scales.y.ticks.color = textColor;
          if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = gridColor;
        }
      }
      if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
        chart.options.plugins.legend.labels.color = textColor;
      }
      chart.update();
    });

    // The category doughnut's slice colors are chosen from a light/dark
    // categorical set at creation time (including the "Other" gray) --
    // refresh them here too so a theme toggle doesn't leave stale colors.
    if (state.charts.category) {
      const categoricalSet = isLight ? CATEGORICAL_LIGHT : CATEGORICAL_DARK;
      const otherGray = isLight ? OTHER_GRAY_LIGHT : OTHER_GRAY_DARK;
      const dataset = state.charts.category.data.datasets[0];
      dataset.backgroundColor = state.charts.category.data.labels.map((label, i) =>
        label === 'Other' ? otherGray : categoricalSet[i]
      );
      state.charts.category.options.plugins.legend.labels.color = textColor;
      state.charts.category.data.datasets[0].borderColor = isLight ? '#ffffff' : '#131d31';
      state.charts.category.update();
    }
  }

  // --------------------------------------------------------------------------
  // Filtering & Search
  // --------------------------------------------------------------------------
  function applyFilters() {
    let result = [...state.allFunds];

    // Search text query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(f => 
        (f.fund_name && f.fund_name.toLowerCase().includes(q)) ||
        (f.amc_name && f.amc_name.toLowerCase().includes(q)) ||
        (f.category && f.category.toLowerCase().includes(q))
      );
    }

    // Flow type filter (Outbound / Inbound / Not Yet Classified)
    if (state.tierFilter !== 'all') {
      if (state.tierFilter === 'unclassified') {
        result = result.filter(f => !f.fund_flow_type);
      } else {
        result = result.filter(f => f.fund_flow_type === state.tierFilter);
      }
    }

    // Category filter
    if (state.categoryFilter !== 'all') {
      result = result.filter(f => f.category && f.category.toLowerCase().includes(state.categoryFilter.toLowerCase()));
    }

    // Currency filter
    if (state.currencyFilter !== 'ALL') {
      result = result.filter(f => (f.nav_currency === state.currencyFilter || f.aum_currency === state.currencyFilter));
    }

    // NAV status filter
    if (state.navFilter === 'live') {
      result = result.filter(f => f.nav !== null);
    } else if (state.navFilter === 'nfo') {
      result = result.filter(f => f.category && f.category.toLowerCase().includes('retail') && f.nav === null);
    } else if (state.navFilter === 'institutional') {
      result = result.filter(f => f.source_tier === 'tier2_directory' && f.nav === null);
    }

    // Sorting
    result.sort((a, b) => {
      let valA = a[state.sortBy];
      let valB = b[state.sortBy];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return state.sortOrder === 'desc' ? valB - valA : valA - valB;
      }
      valA = String(valA).toLowerCase();
      valB = String(valB).toLowerCase();
      if (valA < valB) return state.sortOrder === 'desc' ? 1 : -1;
      if (valA > valB) return state.sortOrder === 'desc' ? -1 : 1;
      return 0;
    });

    state.filteredFunds = result;
    state.currentPage = 1;
    renderFundsList();
    renderPagination();
  }

  // --------------------------------------------------------------------------
  // Table & Card Grid Rendering
  // --------------------------------------------------------------------------
  function renderFundsList() {
    const tableBody = document.getElementById('fundsTableBody');
    const cardsContainer = document.getElementById('fundsCardsContainer');
    const countDisplay = document.getElementById('filteredFundsCount');

    if (countDisplay) {
      countDisplay.textContent = `${state.filteredFunds.length} Funds Found`;
    }

    const start = (state.currentPage - 1) * state.pageSize;
    const paginated = state.filteredFunds.slice(start, start + state.pageSize);

    if (state.viewMode === 'table') {
      if (tableBody) {
        if (paginated.length === 0) {
          tableBody.innerHTML = `
            <tr>
              <td colspan="7" class="py-12 text-center text-[var(--color-text-muted)]">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                No funds matched the selected filters. Try broadening your search.
              </td>
            </tr>`;
        } else {
          tableBody.innerHTML = paginated.map(fund => createTableRow(fund)).join('');
        }
      }
    } else {
      if (cardsContainer) {
        if (paginated.length === 0) {
          cardsContainer.innerHTML = `<div class="col-span-full py-12 text-center text-[var(--color-text-muted)]">No funds matched.</div>`;
        } else {
          cardsContainer.innerHTML = paginated.map(fund => createFundCard(fund)).join('');
        }
      }
    }
  }

  function planBadgeHtml(planType) {
    const styles = {
      'Direct': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      'Regular': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      'Direct & Regular': 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    };
    if (!planType || planType === '—' || !styles[planType]) {
      return `<span class="text-[var(--color-text-subtle)] text-xs">—</span>`;
    }
    return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${styles[planType]}">${escapeHtml(planType)}</span>`;
  }

  function createTableRow(fund) {
    const isCompared = state.compareIds.has(fund.fund_id);
    const navText = fund.nav !== null 
      ? `<span class="font-mono font-bold text-emerald-400">${fund.nav.toFixed(2)} ${fund.nav_currency || 'USD'}</span>`
      : `<span class="text-[var(--color-text-subtle)] text-xs italic">N/A (Institutional/NFO)</span>`;
    
    const terText = fund.expense_ratio !== null 
      ? `<span class="font-mono font-medium">${fund.expense_ratio.toFixed(2)}%</span>`
      : `<span class="text-[var(--color-text-subtle)] text-xs">—</span>`;

    const launchText = fund.launch_date || `<span class="text-[var(--color-text-subtle)] text-xs">—</span>`;

    const planText = planBadgeHtml(fund.plan_type);

    return `
      <tr class="border-b border-[var(--color-border)] hover:bg-[var(--color-card-hover)] transition-colors group">
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-3">
            <button class="compare-toggle-btn w-5 h-5 rounded border ${isCompared ? 'bg-blue-600 border-blue-600 text-white' : 'border-[var(--color-border-strong)] text-transparent'} flex items-center justify-center transition-all hover:border-blue-500" data-id="${fund.fund_id}" title="Add to compare">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </button>
            <div class="min-w-0">
              <div class="font-bold text-[0.88rem] text-[var(--color-text)] group-hover:text-blue-400 transition-colors flex items-center gap-2">
                <span class="truncate">${escapeHtml(fund.fund_name)}</span>
              </div>
              <div class="text-[0.72rem] text-[var(--color-text-muted)] flex items-center gap-2 mt-0.5">
                <span>${escapeHtml(fund.amc_name || 'GIFT City Issuer')}</span>
              </div>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          ${flowBadgeHtml(fund, 'text-xs px-2.5 py-1 font-semibold')}
        </td>
        <td class="py-3.5 px-4 text-xs font-medium text-[var(--color-text-muted)]">
          ${escapeHtml(fund.category || 'General Fund')}
        </td>
        <td class="py-3.5 px-4 text-center">
          ${planText}
        </td>
        <td class="py-3.5 px-4 text-right">
          ${navText}
        </td>
        <td class="py-3.5 px-4 text-right text-xs">
          ${terText}
        </td>
        <td class="py-3.5 px-4 text-center text-xs font-mono text-[var(--color-text-muted)]">
          ${launchText}
        </td>
        <td class="py-3.5 px-4 text-right">
          <div class="flex items-center justify-end gap-2">
            <button class="view-detail-btn px-2.5 py-1 text-xs font-bold rounded-lg bg-[var(--color-bg-subtle)] hover:bg-blue-600 hover:text-white border border-[var(--color-border)] transition-all" data-id="${fund.fund_id}">
              Details
            </button>
            <a href="${fund.source_url}" target="_blank" rel="noopener noreferrer" class="p-1 text-[var(--color-text-subtle)] hover:text-blue-400 transition-colors" title="Open Official Source">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
          </div>
        </td>
      </tr>
    `;
  }

  function createFundCard(fund) {
    return `
      <div class="glass-card rounded-2xl p-5 flex flex-col justify-between group">
        <div>
          <div class="flex items-start justify-between gap-2 mb-3">
            ${flowBadgeHtml(fund, 'text-[10px] uppercase px-2 py-0.5')}
            <span class="text-xs text-[var(--color-text-subtle)] font-mono">${fund.launch_date || 'N/A'}</span>
          </div>
          <h3 class="font-bold text-sm text-[var(--color-text)] group-hover:text-blue-400 transition-colors line-clamp-2 mb-1">
            ${escapeHtml(fund.fund_name)}
          </h3>
          <p class="text-xs text-[var(--color-text-muted)] mb-4">${escapeHtml(fund.amc_name || 'GIFT City AMC')}</p>
          <div class="grid grid-cols-2 gap-2 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] p-3 rounded-xl mb-4">
            <div>
              <span class="block text-[10px] text-[var(--color-text-subtle)] uppercase">NAV</span>
              <span class="font-mono font-bold text-sm text-emerald-400">
                ${fund.nav !== null ? `${fund.nav.toFixed(2)} ${fund.nav_currency || 'USD'}` : '—'}
              </span>
            </div>
            <div>
              <span class="block text-[10px] text-[var(--color-text-subtle)] uppercase">TER</span>
              <span class="font-mono font-bold text-sm text-[var(--color-text)]">
                ${fund.expense_ratio !== null ? `${fund.expense_ratio.toFixed(2)}%` : '—'}
              </span>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-[var(--color-border)]">
          <button class="view-detail-btn text-xs font-bold text-blue-400 hover:text-blue-300" data-id="${fund.fund_id}">View Intelligence →</button>
          <button class="compare-toggle-btn text-xs px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-card-hover)]" data-id="${fund.fund_id}">
            ${state.compareIds.has(fund.fund_id) ? '✓ Compared' : '+ Compare'}
          </button>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // Pagination
  // --------------------------------------------------------------------------
  function renderPagination() {
    const paginationContainer = document.getElementById('paginationControls');
    if (!paginationContainer) return;

    const totalPages = Math.ceil(state.filteredFunds.length / state.pageSize) || 1;
    let html = '';

    if (totalPages > 1) {
      html += `
        <button class="page-nav-btn px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-bold ${state.currentPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-600 hover:text-white'}" data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? 'disabled' : ''}>
          Previous
        </button>
      `;

      for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= state.currentPage - 1 && p <= state.currentPage + 1)) {
          html += `
            <button class="page-num-btn w-8 h-8 rounded-lg text-xs font-bold ${p === state.currentPage ? 'bg-blue-600 text-white' : 'border border-[var(--color-border)] hover:bg-[var(--color-card-hover)]'}" data-page="${p}">
              ${p}
            </button>
          `;
        } else if (p === state.currentPage - 2 || p === state.currentPage + 2) {
          html += `<span class="text-xs text-[var(--color-text-subtle)] px-1">...</span>`;
        }
      }

      html += `
        <button class="page-nav-btn px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-bold ${state.currentPage === totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-600 hover:text-white'}" data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? 'disabled' : ''}>
          Next
        </button>
      `;
    }

    paginationContainer.innerHTML = html;
  }

  // --------------------------------------------------------------------------
  // Buy Panel (Demo Simulation)
  // --------------------------------------------------------------------------
  function setupBuyPanel(f) {
    const loggedOutEl = document.getElementById('modalBuyLoggedOut');
    const noNavEl = document.getElementById('modalBuyNoNav');
    const formEl = document.getElementById('modalBuyForm');
    const summaryEl = document.getElementById('modalBuySummary');
    const successEl = document.getElementById('modalBuySuccess');
    const errorEl = document.getElementById('modalBuyError');
    if (!loggedOutEl || !formEl) return;

    // Reset to a clean state every time the modal opens for a fund
    [loggedOutEl, noNavEl, formEl, summaryEl, successEl].forEach(el => el.classList.add('hidden'));
    if (errorEl) { errorEl.classList.add('hidden'); errorEl.textContent = ''; }
    const amountInput = document.getElementById('modalBuyAmount');
    if (amountInput) amountInput.value = '';

    // This fund's real minimum investment (server-computed from its share
    // classes / factsheet minimum_investment text, falling back to the
    // platform's $500 floor only when no real minimum is on file) --
    // NOT a fixed $500 for every fund.
    const minBuy = Number(f.effective_min_investment_usd) || 500;
    state.currentModalMinBuy = minBuy;
    const labelEl = document.getElementById('modalBuyAmountLabel');
    if (labelEl) labelEl.textContent = `Amount (USD) — Min $${minBuy.toLocaleString()}`;
    if (amountInput) {
      amountInput.min = String(minBuy);
      amountInput.placeholder = String(minBuy);
    }

    if (!window.GIFT360_LOGGED_IN) {
      loggedOutEl.classList.remove('hidden');
    } else if (f.nav === null || f.nav === undefined) {
      noNavEl.classList.remove('hidden');
    } else {
      formEl.classList.remove('hidden');
    }
  }

  function fmtUsd(n) { return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtInr(n) { return '₹' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Step 1 -> Step 2: fetch a Payment Summary quote (no commit yet)
  async function requestBuyQuote() {
    const fund = state.currentModalFund;
    if (!fund) return;
    const amountInput = document.getElementById('modalBuyAmount');
    const errorEl = document.getElementById('modalBuyError');
    const amount = parseFloat(amountInput ? amountInput.value : '');
    const minBuy = state.currentModalMinBuy || 500;

    if (!amount || amount < minBuy) {
      if (errorEl) { errorEl.textContent = `Minimum investment for this fund is $${minBuy.toLocaleString()}.`; errorEl.classList.remove('hidden'); }
      return;
    }
    if (errorEl) errorEl.classList.add('hidden');

    const btn = document.getElementById('modalBuyProceedBtn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
      const res = await fetch('/api/buy/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fund_id: fund.id, amount: amount }),
      });
      const data = await res.json();
      if (!data.success) {
        if (errorEl) { errorEl.textContent = data.error || 'Could not fetch quote.'; errorEl.classList.remove('hidden'); }
        return;
      }

      const q = data.quote;
      state.currentBuyQuote = q;
      document.getElementById('sumAmount').textContent = fmtUsd(q.amount);
      document.getElementById('sumFee').textContent = fmtUsd(q.transaction_fee);
      document.getElementById('sumSubtotal').textContent = fmtUsd(q.subtotal_usd);
      document.getElementById('sumFx').textContent = `~${q.fx_rate} → ${fmtInr(q.subtotal_inr)}`;
      document.getElementById('sumGst').textContent = fmtInr(q.gst_inr);
      document.getElementById('sumPayable').textContent = fmtInr(q.payable_inr);
      document.getElementById('sumBank').textContent = `From: ${q.linked_bank} · Folio ${q.folio}`;

      document.getElementById('modalBuyForm').classList.add('hidden');
      document.getElementById('modalBuySummary').classList.remove('hidden');
    } catch (e) {
      if (errorEl) { errorEl.textContent = 'Network error — please try again.'; errorEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  }

  // Step 2 -> Step 3: "Notify for Payment" -- commits the demo order
  async function submitBuyOrder() {
    const fund = state.currentModalFund;
    const quote = state.currentBuyQuote;
    if (!fund || !quote) return;

    const btn = document.getElementById('modalBuyNotifyBtn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

    try {
      const res = await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fund_id: fund.id, amount: quote.amount }),
      });
      const data = await res.json();

      if (!data.success) {
        document.getElementById('modalBuySummary').classList.add('hidden');
        document.getElementById('modalBuyForm').classList.remove('hidden');
        const errorEl = document.getElementById('modalBuyError');
        if (errorEl) { errorEl.textContent = data.error || 'Purchase failed. Please try again.'; errorEl.classList.remove('hidden'); }
        return;
      }

      document.getElementById('modalBuySummary').classList.add('hidden');
      const successEl = document.getElementById('modalBuySuccess');
      const detailEl = document.getElementById('modalBuySuccessDetail');
      if (detailEl) {
        detailEl.textContent = `${data.order.units} units of ${data.order.fund_name} allotted at NAV ${data.order.nav} ${data.order.currency} · Folio ${data.order.folio}`;
      }
      successEl.classList.remove('hidden');
    } catch (e) {
      // Network failure -- leave the summary visible so the presenter can retry
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  }

  function backToBuyForm() {
    document.getElementById('modalBuySummary').classList.add('hidden');
    document.getElementById('modalBuyForm').classList.remove('hidden');
  }

  const modalBuyProceedBtnEl = document.getElementById('modalBuyProceedBtn');
  if (modalBuyProceedBtnEl) modalBuyProceedBtnEl.addEventListener('click', requestBuyQuote);

  const modalBuyNotifyBtnEl = document.getElementById('modalBuyNotifyBtn');
  if (modalBuyNotifyBtnEl) modalBuyNotifyBtnEl.addEventListener('click', submitBuyOrder);

  const modalBuyBackBtnEl = document.getElementById('modalBuyBackBtn');
  if (modalBuyBackBtnEl) modalBuyBackBtnEl.addEventListener('click', backToBuyForm);

  // --------------------------------------------------------------------------
  // Fund Detail Modal
  // --------------------------------------------------------------------------
  async function openFundDetail(fundId) {
    const modal = document.getElementById('fundDetailModal');
    if (!modal) return;

    try {
      const res = await fetch(`/api/fund/${fundId}`);
      const data = await res.json();
      if (!data.success) return;

      const f = data.fund;
      state.currentModalFund = { id: f.fund_id, name: f.fund_name, nav: f.nav, currency: f.nav_currency || 'USD' };
      setupBuyPanel(f);
      document.getElementById('modalFundName').textContent = f.fund_name;
      document.getElementById('modalAmcName').textContent = f.amc_name || 'GIFT City Asset Manager';
      document.getElementById('modalCategory').textContent = f.category || 'Specialized Investment Fund';
      // Primary classification badge is now Outbound/Inbound (source_tier
      // moved to a smaller supporting-provenance line -- see modalFlowBadge
      // below, which is repurposed to show that instead of a second flow badge).
      const tierBadgeEl = document.getElementById('modalTierBadge');
      if (f.fund_flow_type === 'outbound') {
        tierBadgeEl.textContent = 'Outbound Fund';
        tierBadgeEl.className = 'text-xs px-3 py-1 rounded-full font-bold badge-outbound';
      } else if (f.fund_flow_type === 'inbound') {
        tierBadgeEl.textContent = 'Inbound Fund';
        tierBadgeEl.className = 'text-xs px-3 py-1 rounded-full font-bold badge-inbound';
      } else {
        tierBadgeEl.textContent = 'Not Yet Classified';
        tierBadgeEl.className = 'text-xs px-3 py-1 rounded-full font-bold badge-tier2';
      }

      document.getElementById('modalNav').textContent = f.nav !== null ? `${f.nav.toFixed(2)} ${f.nav_currency || 'USD'}` : 'Private / NFO Pending';
      document.getElementById('modalNavDate').textContent = f.nav_as_of ? `As of ${f.nav_as_of}` : (f.nav !== null ? 'Live Daily NAV' : 'Institutional Non-Public');
      const terEl = document.getElementById('modalTer');
      const terSubtitleEl = document.getElementById('modalTerSubtitle');
      if (f.expense_ratio !== null) {
        terEl.textContent = `${f.expense_ratio.toFixed(2)}%`;
        if (terSubtitleEl) terSubtitleEl.textContent = 'Direct Plan TER';
      } else if (f.fee_notes) {
        // No single TER figure, but a real fee structure was found and
        // verified (e.g. management fee + performance fee) -- show that
        // instead of a flat "not disclosed", never a fabricated TER number.
        terEl.textContent = 'See Fee Schedule';
        if (terSubtitleEl) terSubtitleEl.textContent = 'TER not separately disclosed';
      } else {
        terEl.textContent = 'Not Publicly Disclosed';
        if (terSubtitleEl) terSubtitleEl.textContent = 'Direct Plan TER';
      }
      document.getElementById('modalLaunchDate').textContent = f.launch_date || 'Not Publicly Disclosed';
      document.getElementById('modalSourceLink').href = f.source_url;
      document.getElementById('modalSourceLink').textContent = f.source_name;

      // Source-tier provenance note -- repurposed from the old secondary
      // flow badge slot; shows how verified the data is, now as
      // supporting text rather than the headline classification.
      const flowBadge = document.getElementById('modalFlowBadge');
      if (flowBadge) {
        flowBadge.textContent = f.source_tier === 'tier1_amc' ? 'Verified from official AMC source' : 'Sourced from fund directory listing';
        flowBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-bold badge-tier2';
        flowBadge.classList.remove('hidden');
      }

      // Fund manager name -- only shown when captured from a real source
      const managerEl = document.getElementById('modalFundManager');
      if (managerEl) {
        if (f.fund_manager_name) {
          managerEl.textContent = `Fund Manager: ${f.fund_manager_name}`;
          managerEl.classList.remove('hidden');
        } else {
          managerEl.classList.add('hidden');
        }
      }

      // Benchmark index -- only shown when captured from a real source
      const benchmarkEl = document.getElementById('modalBenchmark');
      if (benchmarkEl) {
        if (f.benchmark_index) {
          benchmarkEl.textContent = `Benchmark: ${f.benchmark_index}`;
          benchmarkEl.classList.remove('hidden');
        } else {
          benchmarkEl.classList.add('hidden');
        }
      }

      renderModalDataSections(f);

      // Render real NAV trend chart (or an honest "no history yet" note) --
      // previously this generated a fake Math.random() trajectory that
      // changed on every page reload. Now it's the actual recorded series
      // from /api/fund/<id>/nav-history.
      let navHistory = [];
      try {
        const historyRes = await fetch(`/api/fund/${fundId}/nav-history`);
        const historyData = await historyRes.json();
        if (historyData.success) navHistory = historyData.nav_history;
      } catch (e) {
        console.error('Error fetching NAV history:', e);
      }
      renderModalNavChart(f, navHistory);

      modal.classList.remove('hidden');
      modal.classList.add('flex');
    } catch (e) {
      console.error('Error opening detail modal:', e);
    }
  }

  // Renders Underlying Fund / Holdings / Geographic / Sector / Taxation
  // sections from the expanded /api/fund/<id> response. Each section only
  // renders (and is un-hidden) when real captured data exists for it -- no
  // fabricated numbers or blanket claims, consistent with the rest of the
  // dashboard. If nothing at all has been captured yet, a single honest
  // "not yet captured" placeholder is shown instead.
  function renderModalDataSections(f) {
    const feeNotesSection = document.getElementById('modalFeeNotesSection');
    const feeNotesBody = document.getElementById('modalFeeNotesBody');
    const underlyingSection = document.getElementById('modalUnderlyingSection');
    const underlyingBody = document.getElementById('modalUnderlyingBody');
    const holdingsSection = document.getElementById('modalHoldingsSection');
    const holdingsBody = document.getElementById('modalHoldingsBody');
    const holdingsBasisNote = document.getElementById('modalHoldingsBasisNote');
    const geoSection = document.getElementById('modalGeoSection');
    const geoBody = document.getElementById('modalGeoBody');
    const sectorSection = document.getElementById('modalSectorSection');
    const sectorBody = document.getElementById('modalSectorBody');
    const marketCapSection = document.getElementById('modalMarketCapSection');
    const marketCapBody = document.getElementById('modalMarketCapBody');
    const assetClassSection = document.getElementById('modalAssetClassSection');
    const assetClassBody = document.getElementById('modalAssetClassBody');
    const taxSection = document.getElementById('modalTaxSection');
    const taxBody = document.getElementById('modalTaxBody');
    const shareClassSection = document.getElementById('modalShareClassSection');
    const shareClassBody = document.getElementById('modalShareClassBody');
    const performanceSection = document.getElementById('modalPerformanceSection');
    const performanceBody = document.getElementById('modalPerformanceBody');
    const riskMetricsSection = document.getElementById('modalRiskMetricsSection');
    const riskMetricsBody = document.getElementById('modalRiskMetricsBody');
    const pendingSection = document.getElementById('modalDataPendingSection');

    let anyRendered = false;

    // Fee schedule -- only when captured, and only as a supplement to
    // (never a substitute for) an actual TER figure.
    if (feeNotesSection && feeNotesBody) {
      if (f.fee_notes) {
        anyRendered = true;
        feeNotesBody.textContent = f.fee_notes;
        feeNotesSection.classList.remove('hidden');
      } else {
        feeNotesSection.classList.add('hidden');
      }
    }

    // Underlying fund (feeder-structure funds only)
    if (underlyingSection && underlyingBody) {
      if (f.underlying_fund_name) {
        anyRendered = true;
        underlyingBody.innerHTML = `
          <div><span class="text-[var(--color-text-subtle)]">Fund:</span> <span class="font-semibold text-[var(--color-text)]">${escapeHtml(f.underlying_fund_name)}</span></div>
          ${f.underlying_fund_manager ? `<div><span class="text-[var(--color-text-subtle)]">Manager:</span> ${escapeHtml(f.underlying_fund_manager)}</div>` : ''}
          ${f.underlying_fund_domicile ? `<div><span class="text-[var(--color-text-subtle)]">Domicile:</span> ${escapeHtml(f.underlying_fund_domicile)}</div>` : ''}
        `;
        underlyingSection.classList.remove('hidden');
      } else {
        underlyingSection.classList.add('hidden');
      }
    }

    // Top holdings -- rendered as one or two groups (fund-direct holdings,
    // and look-through/underlying-fund holdings for feeder structures), each
    // with its own "Show all" toggle so a long list isn't silently truncated.
    if (holdingsSection && holdingsBody) {
      const holdings = Array.isArray(f.holdings) ? f.holdings : [];
      if (holdings.length > 0) {
        anyRendered = true;
        if (holdingsBasisNote) {
          holdingsBasisNote.textContent = '';
        }
        const directHoldings = holdings.filter(h => h.holdings_basis !== 'underlying_fund');
        const underlyingHoldings = holdings.filter(h => h.holdings_basis === 'underlying_fund');
        const groups = [];
        if (directHoldings.length) groups.push({ label: 'Direct Holdings', rows: directHoldings, id: 'direct' });
        if (underlyingHoldings.length) groups.push({ label: 'Look-through: Underlying Fund Holdings', rows: underlyingHoldings, id: 'underlying' });

        const INITIAL_SHOW = 10;
        holdingsBody.innerHTML = groups.map(g => {
          const maxWeight = Math.max(...g.rows.map(h => h.weight_pct || 0), 1);
          const rowHtml = (h) => `
            <div class="flex items-center gap-2 mb-1.5 last:mb-0">
              <span class="text-[11px] text-[var(--color-text-muted)] w-1/2 truncate">${escapeHtml(h.holding_name)}</span>
              <div class="flex-1 h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div class="h-full bg-blue-400 rounded-full" style="width:${((h.weight_pct || 0) / maxWeight * 100).toFixed(1)}%"></div>
              </div>
              <span class="text-[11px] font-mono text-[var(--color-text)] w-12 text-right">${h.weight_pct != null ? h.weight_pct.toFixed(1) + '%' : '—'}</span>
            </div>
          `;
          const visibleRows = g.rows.slice(0, INITIAL_SHOW).map(rowHtml).join('');
          const hiddenRows = g.rows.slice(INITIAL_SHOW).map(rowHtml).join('');
          const groupHeader = groups.length > 1
            ? `<div class="text-[10px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide mb-1.5 ${g.id === 'underlying' ? 'mt-3' : ''}">${escapeHtml(g.label)}</div>`
            : '';
          const toggleId = `holdings-more-${g.id}`;
          const toggleBtn = hiddenRows
            ? `<button type="button" onclick="
                 const box = document.getElementById('${toggleId}');
                 const expanded = box.classList.toggle('hidden');
                 this.textContent = expanded ? 'Show all ${g.rows.length} holdings' : 'Show less';
               " class="text-[10px] text-blue-400 hover:underline mt-1">Show all ${g.rows.length} holdings</button>`
            : '';
          return `
            <div class="mb-2 last:mb-0">
              ${groupHeader}
              ${visibleRows}
              <div id="${toggleId}" class="hidden">${hiddenRows}</div>
              ${toggleBtn}
            </div>
          `;
        }).join('');
        holdingsSection.classList.remove('hidden');
      } else {
        holdingsSection.classList.add('hidden');
      }
    }

    // Geographic allocation
    if (geoSection && geoBody) {
      const geo = Array.isArray(f.geographic_allocation) ? f.geographic_allocation : [];
      if (geo.length > 0) {
        anyRendered = true;
        geoBody.innerHTML = renderAllocationBars(geo);
        geoSection.classList.remove('hidden');
      } else {
        geoSection.classList.add('hidden');
      }
    }

    // Sector allocation
    if (sectorSection && sectorBody) {
      const sector = Array.isArray(f.sector_allocation) ? f.sector_allocation : [];
      if (sector.length > 0) {
        anyRendered = true;
        sectorBody.innerHTML = renderAllocationBars(sector);
        sectorSection.classList.remove('hidden');
      } else {
        sectorSection.classList.add('hidden');
      }
    }

    // Market capitalisation allocation
    if (marketCapSection && marketCapBody) {
      const mcap = Array.isArray(f.market_cap_allocation) ? f.market_cap_allocation : [];
      if (mcap.length > 0) {
        anyRendered = true;
        marketCapBody.innerHTML = renderAllocationBars(mcap);
        marketCapSection.classList.remove('hidden');
      } else {
        marketCapSection.classList.add('hidden');
      }
    }

    // Asset class allocation (e.g. Equity vs. Cash & Cash Equivalents)
    if (assetClassSection && assetClassBody) {
      const assetClass = Array.isArray(f.asset_class_allocation) ? f.asset_class_allocation : [];
      if (assetClass.length > 0) {
        anyRendered = true;
        assetClassBody.innerHTML = renderAllocationBars(assetClass);
        assetClassSection.classList.remove('hidden');
      } else {
        assetClassSection.classList.add('hidden');
      }
    }

    // Taxation -- show explicit rates when disclosed, otherwise descriptive
    // notes only. Never render a fabricated percentage.
    if (taxSection && taxBody) {
      const tax = f.taxation;
      if (tax && (tax.ltcg_rate || tax.stcg_rate || tax.dividend_rate || tax.tax_notes)) {
        anyRendered = true;
        const rateRows = [];
        if (tax.ltcg_rate) rateRows.push(`<div><span class="text-[var(--color-text-subtle)]">LTCG:</span> <span class="font-mono font-semibold text-[var(--color-text)]">${escapeHtml(tax.ltcg_rate)}</span></div>`);
        if (tax.stcg_rate) rateRows.push(`<div><span class="text-[var(--color-text-subtle)]">STCG:</span> <span class="font-mono font-semibold text-[var(--color-text)]">${escapeHtml(tax.stcg_rate)}</span></div>`);
        if (tax.dividend_rate) rateRows.push(`<div><span class="text-[var(--color-text-subtle)]">Dividend:</span> <span class="font-mono font-semibold text-[var(--color-text)]">${escapeHtml(tax.dividend_rate)}</span></div>`);
        taxBody.innerHTML = `
          ${rateRows.length ? `<div class="grid grid-cols-3 gap-2 mb-2">${rateRows.join('')}</div>` : ''}
          ${tax.tax_notes ? `<div class="text-[var(--color-text-subtle)] italic">${escapeHtml(tax.tax_notes)}</div>` : ''}
        `;
        taxSection.classList.remove('hidden');
      } else {
        taxSection.classList.add('hidden');
      }
    }

    // Share classes -- multiple NAV classes per fund, each with its own
    // fee/exit-load terms where disclosed.
    if (shareClassSection && shareClassBody) {
      const classes = Array.isArray(f.share_classes) ? f.share_classes : [];
      if (classes.length > 0) {
        anyRendered = true;
        shareClassBody.innerHTML = `
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wide">
                <th class="pb-1.5 pr-3">Class</th>
                <th class="pb-1.5 pr-3">NAV</th>
                <th class="pb-1.5 pr-3">Mgmt Fee</th>
                <th class="pb-1.5 pr-3">TER</th>
                <th class="pb-1.5 pr-3">Min. Investment</th>
                <th class="pb-1.5">Exit Load</th>
              </tr>
            </thead>
            <tbody>
              ${classes.map(c => {
                let navCell;
                if (c.subscription_nav != null || c.redemption_nav_long_term != null || c.redemption_nav_short_term != null) {
                  // Fund discloses separate subscription vs. redemption NAVs (e.g. Direct/Regular
                  // classes on gift.ppfas.com) -- show all three rather than collapsing to one number.
                  navCell = `
                    <div class="leading-tight">
                      <div>Sub: ${c.subscription_nav != null ? c.subscription_nav : '—'}</div>
                      <div>Redeem (LT): ${c.redemption_nav_long_term != null ? c.redemption_nav_long_term : '—'}</div>
                      <div>Redeem (ST): ${c.redemption_nav_short_term != null ? c.redemption_nav_short_term : '—'}</div>
                    </div>
                  `;
                } else {
                  navCell = c.nav != null ? c.nav : '—';
                }
                return `
                <tr class="border-t border-[var(--color-border)]">
                  <td class="py-1.5 pr-3 font-semibold text-[var(--color-text)]">${escapeHtml(c.class_name || '—')}</td>
                  <td class="py-1.5 pr-3 font-mono">${navCell}</td>
                  <td class="py-1.5 pr-3 font-mono">${c.management_fee_pct != null ? c.management_fee_pct + '%' : '—'}</td>
                  <td class="py-1.5 pr-3 font-mono">${c.ter_pct != null ? c.ter_pct + '%' : '—'}</td>
                  <td class="py-1.5 pr-3 font-mono">${c.min_investment_usd != null ? '$' + c.min_investment_usd.toLocaleString() : '—'}</td>
                  <td class="py-1.5 font-mono">${c.exit_load_pct != null ? c.exit_load_pct + '%' + (c.exit_load_months ? ' (' + c.exit_load_months + 'mo)' : '') : '—'}</td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        `;
        shareClassSection.classList.remove('hidden');
      } else {
        shareClassSection.classList.add('hidden');
      }
    }

    // Performance / returns series -- grouped by share class where present.
    if (performanceSection && performanceBody) {
      const perf = Array.isArray(f.performance) ? f.performance : [];
      if (perf.length > 0) {
        anyRendered = true;
        renderPerformanceChart(perf);
        performanceBody.innerHTML = `
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wide">
                <th class="pb-1.5 pr-3">Period</th>
                <th class="pb-1.5 pr-3">Class</th>
                <th class="pb-1.5 pr-3">Fund</th>
                <th class="pb-1.5 pr-3">Benchmark</th>
                <th class="pb-1.5">Excess</th>
              </tr>
            </thead>
            <tbody>
              ${perf.map(p => `
                <tr class="border-t border-[var(--color-border)]">
                  <td class="py-1.5 pr-3 font-semibold text-[var(--color-text)]">${escapeHtml(p.period || '—')}</td>
                  <td class="py-1.5 pr-3">${escapeHtml(p.share_class || '—')}</td>
                  <td class="py-1.5 pr-3 font-mono">${p.fund_return_pct != null ? p.fund_return_pct + '%' : '—'}</td>
                  <td class="py-1.5 pr-3 font-mono">${p.benchmark_return_pct != null ? p.benchmark_return_pct + '%' : '—'}</td>
                  <td class="py-1.5 font-mono ${p.excess_return_pct > 0 ? 'text-emerald-400' : p.excess_return_pct < 0 ? 'text-red-400' : ''}">${p.excess_return_pct != null ? p.excess_return_pct + '%' : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        performanceSection.classList.remove('hidden');
      } else {
        performanceSection.classList.add('hidden');
      }
    }

    // Risk metrics -- rare; render whichever fields are actually populated.
    if (riskMetricsSection && riskMetricsBody) {
      const risk = Array.isArray(f.risk_metrics) ? f.risk_metrics : [];
      const metricLabels = {
        alpha_pct: 'Alpha', beta: 'Beta', r_squared: 'R²',
        tracking_error_pct: 'Tracking Error', information_ratio: 'Info. Ratio',
        sharpe_ratio: 'Sharpe', upside_capture_pct: 'Upside Capture',
        downside_capture_pct: 'Downside Capture', active_share_pct: 'Active Share',
        batting_average_pct: 'Batting Avg.',
      };
      const tiles = [];
      risk.forEach(rm => {
        Object.keys(metricLabels).forEach(key => {
          if (rm[key] != null) {
            const isPct = key.endsWith('_pct');
            tiles.push(`
              <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl px-2.5 py-2">
                <div class="text-[9px] text-[var(--color-text-subtle)] uppercase tracking-wide">${metricLabels[key]}${rm.period ? ' (' + escapeHtml(rm.period) + ')' : ''}</div>
                <div class="text-sm font-mono font-semibold text-[var(--color-text)]">${rm[key]}${isPct ? '%' : ''}</div>
              </div>
            `);
          }
        });
      });
      if (tiles.length > 0) {
        anyRendered = true;
        riskMetricsBody.innerHTML = tiles.join('');
        riskMetricsSection.classList.remove('hidden');
      } else {
        riskMetricsSection.classList.add('hidden');
      }
    }

    if (pendingSection) {
      pendingSection.classList.toggle('hidden', anyRendered);
    }
  }

  function renderAllocationBars(items) {
    const sorted = [...items].sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0));
    const maxWeight = Math.max(...sorted.map(i => i.weight_pct || 0), 1);
    return sorted.map(i => `
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-[var(--color-text-muted)] w-1/3 truncate">${escapeHtml(i.category)}</span>
        <div class="flex-1 h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
          <div class="h-full bg-emerald-400 rounded-full" style="width:${((i.weight_pct || 0) / maxWeight * 100).toFixed(1)}%"></div>
        </div>
        <span class="text-[11px] font-mono text-[var(--color-text)] w-12 text-right">${i.weight_pct != null ? i.weight_pct.toFixed(1) + '%' : '—'}</span>
      </div>
    `).join('');
  }

  // Soft top-to-bottom fade under the NAV line -- cool cyan-blue at the top,
  // fully transparent at the baseline, so the area fill reads as a subtle
  // glow rather than a flat block of color. Scriptable per Chart.js's own
  // recommended pattern (chart.chartArea isn't known until after the first
  // layout pass, so this can't be built once up front off the raw canvas).
  function navGradientFill(context) {
    const chart = context.chart;
    const { ctx, chartArea } = chart;
    if (!chartArea) return 'rgba(56, 189, 248, 0.12)'; // first pass, before layout
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');
    return gradient;
  }

  // Fund vs. benchmark returns, grouped by period, as a bar chart. A fund can
  // have several share classes in fund_performance -- we pick the one with the
  // most periods disclosed (ties broken by first-seen) so the chart shows one
  // coherent series rather than mixing classes, and label which class it is.
  const PERFORMANCE_PERIOD_ORDER = ['1M', '3M', 'YTD', '1Y', '3Y', '5Y', 'SI', 'ALL'];

  function renderPerformanceChart(perf) {
    const canvas = document.getElementById('modalPerformanceCanvas');
    const shareClassLabel = document.getElementById('modalPerformanceShareClass');
    if (!canvas) return;

    if (state.charts.modalPerformance) {
      state.charts.modalPerformance.destroy();
      state.charts.modalPerformance = null;
    }

    const withBenchmark = perf.filter(p => p.benchmark_return_pct != null);
    const rows = withBenchmark.length > 0 ? withBenchmark : perf;

    const byClass = {};
    rows.forEach(p => {
      const key = p.share_class || '—';
      (byClass[key] = byClass[key] || []).push(p);
    });
    const bestClass = Object.keys(byClass).sort((a, b) => byClass[b].length - byClass[a].length)[0];
    const classRows = byClass[bestClass] || [];

    if (shareClassLabel) {
      shareClassLabel.textContent = bestClass && bestClass !== '—' ? `Share class: ${bestClass}` : '';
    }

    const sorted = [...classRows].sort((a, b) => {
      const ai = PERFORMANCE_PERIOD_ORDER.indexOf(a.period);
      const bi = PERFORMANCE_PERIOD_ORDER.indexOf(b.period);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const labels = sorted.map(p => p.period || '—');
    const fundData = sorted.map(p => p.fund_return_pct);
    const benchmarkData = sorted.map(p => p.benchmark_return_pct);
    const isLight = document.documentElement.classList.contains('light');
    const fundColor = '#38bdf8';
    const benchmarkColor = isLight ? '#94a3b8' : '#64748b';

    state.charts.modalPerformance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Fund', data: fundData, backgroundColor: fundColor, borderRadius: 4, maxBarThickness: 28 },
          { label: 'Benchmark', data: benchmarkData, backgroundColor: benchmarkColor, borderRadius: 4, maxBarThickness: 28 },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: isLight ? '#334155' : '#cbd5e1', boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.raw != null ? ctx.raw + '%' : '—'}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: isLight ? '#64748b' : '#94a3b8', font: { size: 10 } } },
          y: {
            grid: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)' },
            ticks: { color: isLight ? '#64748b' : '#94a3b8', font: { size: 10 }, callback: (v) => v + '%' }
          }
        }
      }
    });
  }

  function renderModalNavChart(fund, history) {
    const canvas = document.getElementById('modalNavCanvas');
    const wrapper = document.getElementById('modalNavChartWrapper');
    const subtitle = document.getElementById('modalNavSubtitle');
    if (!canvas || !wrapper) return;

    if (state.charts.modalNav) {
      state.charts.modalNav.destroy();
      state.charts.modalNav = null;
    }

    const existingNote = wrapper.querySelector('.chart-empty-note');
    if (existingNote) existingNote.remove();

    if (!history || history.length === 0) {
      canvas.style.display = 'none';
      if (subtitle) subtitle.textContent = 'No History Yet';
      const note = document.createElement('div');
      note.className = 'chart-empty-note absolute inset-0 flex items-center justify-center text-center text-[11px] text-[var(--color-text-subtle)] px-4';
      note.textContent = 'No NAV history recorded yet for this fund. A real trend will build up here as the data pipeline runs over time.';
      wrapper.appendChild(note);
      return;
    }

    canvas.style.display = '';
    const isLight = document.documentElement.classList.contains('light');
    const isSingle = history.length === 1;
    if (subtitle) subtitle.textContent = isSingle ? '1 Snapshot Recorded' : `${history.length} Recorded Points`;

    const labels = history.map(h => h.nav_date);
    const values = history.map(h => h.nav);

    const navLineColor = '#38bdf8'; // cool cyan-blue accent, distinct from UI blue but still in-family

    state.charts.modalNav = new Chart(canvas, {
      type: isSingle ? 'bar' : 'line',
      data: {
        labels,
        datasets: [{
          label: `${fund.fund_name} NAV (${fund.nav_currency || 'USD'})`,
          data: values,
          borderColor: navLineColor,
          backgroundColor: isSingle ? navLineColor : navGradientFill,
          borderWidth: 2.25,
          fill: !isSingle,
          tension: 0.42,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: navLineColor,
          pointHoverBorderColor: isLight ? '#ffffff' : '#0b1220',
          pointHoverBorderWidth: 2,
          maxBarThickness: 48,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { display: false } },
          y: { grid: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)' }, ticks: { color: isLight ? '#64748b' : '#94a3b8', font: { size: 10 } } }
        }
      }
    });

    if (isSingle) {
      const note = document.createElement('div');
      note.className = 'chart-empty-note absolute bottom-1 right-2 text-[9px] text-[var(--color-text-subtle)] italic';
      note.textContent = 'Only one NAV snapshot recorded so far -- not enough history yet for a trend line.';
      wrapper.appendChild(note);
    }
  }

  // --------------------------------------------------------------------------
  // Comparison Matrix
  // --------------------------------------------------------------------------
  function toggleCompare(fundId) {
    fundId = Number(fundId);
    if (state.compareIds.has(fundId)) {
      state.compareIds.delete(fundId);
    } else {
      if (state.compareIds.size >= 4) {
        alert('You can compare up to 4 funds at a time.');
        return;
      }
      state.compareIds.add(fundId);
    }
    updateCompareDrawer();
    renderFundsList();
  }

  function updateCompareDrawer() {
    const drawer = document.getElementById('compareFloatingDrawer');
    const countBadge = document.getElementById('compareDrawerCount');
    if (!drawer || !countBadge) return;

    const count = state.compareIds.size;
    countBadge.textContent = count;

    if (count > 0) {
      drawer.classList.remove('translate-y-32', 'opacity-0');
      drawer.classList.add('translate-y-0', 'opacity-100');
    } else {
      drawer.classList.add('translate-y-32', 'opacity-0');
      drawer.classList.remove('translate-y-0', 'opacity-100');
    }
  }

  async function openCompareModal() {
    const modal = document.getElementById('compareModal');
    const container = document.getElementById('compareMatrixContainer');
    if (!modal || !container) return;

    const idList = Array.from(state.compareIds).join(',');
    if (!idList) return;

    try {
      const res = await fetch(`/api/compare?ids=${idList}`);
      const data = await res.json();
      if (!data.success || !data.funds.length) return;

      const funds = data.funds;
      let matrixHtml = `
        <div class="grid grid-cols-${funds.length + 1} gap-3 min-w-[640px]">
          <!-- Metric Headers -->
          <div class="space-y-4 font-bold text-xs text-[var(--color-text-muted)] uppercase tracking-wider py-2">
            <div class="h-16 flex items-end">Fund Details</div>
            <div class="h-10 flex items-center">AMC House</div>
            <div class="h-10 flex items-center">Flow Type</div>
            <div class="h-10 flex items-center">Category</div>
            <div class="h-10 flex items-center">Current NAV</div>
            <div class="h-10 flex items-center">Expense Ratio (TER)</div>
            <div class="h-10 flex items-center">Launch Date</div>
            <div class="h-10 flex items-center">Min Ticket Size</div>
            <div class="h-10 flex items-center">IFSC Tax Status</div>
          </div>
      `;

      funds.forEach(f => {
        matrixHtml += `
          <div class="space-y-4 text-xs py-2 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-xl p-3">
            <div class="h-16 flex flex-col justify-end">
              <span class="font-extrabold text-sm text-[var(--color-text)] line-clamp-2">${escapeHtml(f.fund_name)}</span>
            </div>
            <div class="h-10 flex items-center font-semibold text-[var(--color-text-muted)]">${escapeHtml(f.amc_name || '—')}</div>
            <div class="h-10 flex items-center">
              ${flowBadgeHtml(f, 'px-2 py-0.5 text-[10px]')}
            </div>
            <div class="h-10 flex items-center text-[var(--color-text-muted)] truncate">${escapeHtml(f.category || 'General')}</div>
            <div class="h-10 flex items-center font-mono font-bold text-emerald-400 text-sm">
              ${f.nav !== null ? `${f.nav.toFixed(2)} ${f.nav_currency || 'USD'}` : 'Private/NFO'}
            </div>
            <div class="h-10 flex items-center font-mono font-semibold">
              ${f.expense_ratio !== null ? `${f.expense_ratio.toFixed(2)}%` : '—'}
            </div>
            <div class="h-10 flex items-center font-mono text-[var(--color-text-muted)]">${f.launch_date || '—'}</div>
            <div class="h-10 flex items-center font-medium truncate" title="${escapeHtml(f.minimum_investment || '')}">${escapeHtml(f.minimum_investment || '—')}</div>
            <div class="h-10 flex items-center text-[var(--color-text-muted)]">—</div>
          </div>
        `;
      });

      matrixHtml += `</div>`;
      container.innerHTML = matrixHtml;
      modal.classList.remove('hidden');
      modal.classList.add('flex');

      // Visual comparison chart -- fetch each compared fund's real NAV
      // history in parallel and plot as a multi-line chart. Funds with
      // sparse history (most currently have 0-1 points, since real
      // history only accumulates over multiple future pipeline runs)
      // are shown honestly rather than papered over with a fake trend.
      const histories = await Promise.all(
        funds.map(f =>
          fetch(`/api/fund/${f.fund_id}/nav-history`)
            .then(r => r.json())
            .then(d => (d.success ? d.nav_history : []))
            .catch(() => [])
        )
      );
      renderCompareNavChart(funds, histories);
    } catch (e) {
      console.error('Error opening compare modal:', e);
    }
  }

  function renderCompareNavChart(funds, histories) {
    const section = document.getElementById('compareChartSection');
    const wrapper = document.getElementById('compareChartWrapper');
    const canvas = document.getElementById('compareNavCanvas');
    const note = document.getElementById('compareChartNote');
    if (!section || !wrapper || !canvas || !note) return;

    if (state.charts.compareNav) {
      state.charts.compareNav.destroy();
      state.charts.compareNav = null;
    }
    const existingEmptyNote = wrapper.querySelector('.chart-empty-note');
    if (existingEmptyNote) existingEmptyNote.remove();

    section.classList.remove('hidden');

    // Only funds with at least one recorded NAV snapshot are plotted.
    const plottable = funds
      .map((f, i) => ({ fund: f, history: histories[i] || [] }))
      .filter(x => x.history.length > 0);

    if (plottable.length === 0) {
      canvas.style.display = 'none';
      note.textContent = '';
      const emptyNote = document.createElement('div');
      emptyNote.className = 'chart-empty-note absolute inset-0 flex items-center justify-center text-center text-[11px] text-[var(--color-text-subtle)] px-6';
      emptyNote.textContent = 'None of the selected funds have recorded NAV history yet -- the trend chart will populate as the data pipeline runs over time.';
      wrapper.appendChild(emptyNote);
      return;
    }

    canvas.style.display = '';
    const isLight = document.documentElement.classList.contains('light');
    const categoricalSet = isLight ? CATEGORICAL_LIGHT : CATEGORICAL_DARK;

    // Union of all NAV dates across compared funds, sorted, used as the
    // shared category axis. Each fund's series uses spanGaps so a date it
    // has no snapshot for just leaves a gap rather than a fabricated value.
    const allDates = Array.from(new Set(plottable.flatMap(x => x.history.map(h => h.nav_date)))).sort();

    const datasets = plottable.map((x, idx) => {
      const byDate = new Map(x.history.map(h => [h.nav_date, h.nav]));
      const data = allDates.map(d => (byDate.has(d) ? byDate.get(d) : null));
      const color = categoricalSet[idx % categoricalSet.length];
      const single = x.history.length === 1;
      return {
        label: `${x.fund.fund_name}${single ? ' (single snapshot)' : ''}`,
        data,
        backgroundColor: color,
        borderRadius: 4,
        maxBarThickness: 40,
      };
    });

    state.charts.compareNav = new Chart(canvas, {
      type: 'bar',
      data: { labels: allDates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: isLight ? '#0b0b0b' : '#ffffff', font: { size: 10 }, boxWidth: 12, usePointStyle: true }
          },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { display: false } },
          y: { grid: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)' }, ticks: { color: isLight ? '#64748b' : '#94a3b8', font: { size: 10 } } }
        }
      }
    });

    const skipped = funds.length - plottable.length;
    const singleCount = plottable.filter(x => x.history.length === 1).length;
    const notes = [];
    if (skipped > 0) notes.push(`${skipped} of ${funds.length} selected fund${skipped === 1 ? '' : 's'} ${skipped === 1 ? 'has' : 'have'} no NAV history yet and ${skipped === 1 ? 'is' : 'are'} omitted from the chart.`);
    if (singleCount > 0) notes.push(`${singleCount} fund${singleCount === 1 ? '' : 's'} only ${singleCount === 1 ? 'has' : 'have'} a single recorded snapshot so far, shown as one bar rather than a trend.`);
    note.textContent = notes.join(' ');
  }

  // --------------------------------------------------------------------------
  // Event Listeners Setup
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Search input (Fund Screener section)
    const searchInput = document.getElementById('fundsSearchInput');
    if (searchInput) {
      let searchTrackTimer = null;
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        applyFilters();
        // Debounced -- fire once ~600ms after the user stops typing,
        // not on every keystroke.
        clearTimeout(searchTrackTimer);
        const q = e.target.value.trim();
        if (q && window.gaTrack) {
          searchTrackTimer = setTimeout(() => window.gaTrack('Search Fund', { query: q }), 600);
        }
      });
    }

    // Quick search (top nav bar) -- was previously unwired and did nothing
    // when typed into. Mirrors the screener search box and scrolls the
    // screener into view so the filtered results are actually visible.
    const navSearchInput = document.getElementById('navQuickSearch');
    if (navSearchInput) {
      navSearchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        if (searchInput) searchInput.value = e.target.value;
        applyFilters();
        const screener = document.getElementById('screener');
        if (screener && e.target.value.trim().length > 0) {
          screener.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    // Tier filter selector
    const tierSelect = document.getElementById('tierFilterSelect');
    if (tierSelect) {
      tierSelect.addEventListener('change', (e) => {
        state.tierFilter = e.target.value;
        applyFilters();
        if (window.gaTrack) window.gaTrack('Filter Used', { filter: 'flow_type', value: e.target.value });
      });
    }

    // Category filter tabs
    document.querySelectorAll('.cat-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active', 'bg-blue-600', 'text-white'));
        btn.classList.add('active', 'bg-blue-600', 'text-white');
        state.categoryFilter = btn.getAttribute('data-category');
        applyFilters();
        if (window.gaTrack) window.gaTrack('Filter Used', { filter: 'category', value: state.categoryFilter });
      });
    });

    // Currency selector
    const currSelect = document.getElementById('currencyFilterSelect');
    if (currSelect) {
      currSelect.addEventListener('change', (e) => {
        state.currencyFilter = e.target.value;
        applyFilters();
        if (window.gaTrack) window.gaTrack('Filter Used', { filter: 'currency', value: e.target.value });
      });
    }

    // Sort column headers
    document.querySelectorAll('.sortable-col').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (state.sortBy === col) {
          state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortBy = col;
          state.sortOrder = 'asc';
        }
        applyFilters();
      });
    });

    // Table click delegation (Details & Compare buttons)
    document.addEventListener('click', (e) => {
      const detailBtn = e.target.closest('.view-detail-btn');
      if (detailBtn) {
        const id = detailBtn.getAttribute('data-id');
        const fund = state.allFunds.find(f => String(f.fund_id) === String(id));
        const slug = fund ? slugify(fund.fund_name) : null;
        window.location.href = slug ? `/fund/${id}/${slug}` : `/fund/${id}`;
        return;
      }

      const compareBtn = e.target.closest('.compare-toggle-btn');
      if (compareBtn) {
        const id = compareBtn.getAttribute('data-id');
        toggleCompare(id);
        return;
      }

      const pageNumBtn = e.target.closest('.page-num-btn, .page-nav-btn');
      if (pageNumBtn) {
        state.currentPage = Number(pageNumBtn.getAttribute('data-page'));
        renderFundsList();
        renderPagination();
        return;
      }
    });

    // Compare Drawer Actions
    const openCompareBtn = document.getElementById('openCompareModalBtn');
    if (openCompareBtn) {
      openCompareBtn.addEventListener('click', () => {
        if (window.gaTrack) window.gaTrack('Compare Fund', { fund_count: state.compareIds.size });
        openCompareModal();
      });
    }

    const clearCompareBtn = document.getElementById('clearCompareBtn');
    if (clearCompareBtn) {
      clearCompareBtn.addEventListener('click', () => {
        state.compareIds.clear();
        updateCompareDrawer();
        renderFundsList();
      });
    }

    // Modal Close buttons
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('fundDetailModal')?.classList.add('hidden');
        document.getElementById('compareModal')?.classList.add('hidden');
      });
    });

    // View mode toggle
    const btnViewTable = document.getElementById('btnViewTable');
    const btnViewGrid = document.getElementById('btnViewGrid');
    const tableWrap = document.getElementById('fundsTableWrapper');
    const gridWrap = document.getElementById('fundsCardsContainer');

    if (btnViewTable && btnViewGrid) {
      btnViewTable.addEventListener('click', () => {
        state.viewMode = 'table';
        btnViewTable.classList.add('bg-blue-600', 'text-white');
        btnViewGrid.classList.remove('bg-blue-600', 'text-white');
        tableWrap?.classList.remove('hidden');
        gridWrap?.classList.add('hidden');
        renderFundsList();
      });

      btnViewGrid.addEventListener('click', () => {
        state.viewMode = 'grid';
        btnViewGrid.classList.add('bg-blue-600', 'text-white');
        btnViewTable.classList.remove('bg-blue-600', 'text-white');
        tableWrap?.classList.add('hidden');
        gridWrap?.classList.remove('hidden');
        renderFundsList();
      });

      // The wide fund table has no usable mobile layout -- its columns
      // (NAV, tier, launch date, actions) sit off-screen with no visible
      // scroll indicator on a phone, so a mobile visitor only ever sees
      // the fund name column. Cards view has no horizontal overflow and
      // shows every field, so default to it below the `md` breakpoint.
      if (window.innerWidth < 768) {
        btnViewGrid.click();
      }
    }

    // Knowledge Hub Accordion
    document.querySelectorAll('.accordion-toggle').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const arrow = header.querySelector('.accordion-arrow');
        if (content) {
          content.classList.toggle('hidden');
          arrow?.classList.toggle('rotate-180');
        }
      });
    });
  }

  // Primary classification badge: Outbound / Inbound (replaces the old
  // Tier 1 / Tier 2 badge as the headline classification -- source_tier
  // still exists on the record as backend provenance metadata, surfaced
  // as smaller supporting text, never as the main badge).
  function flowBadgeHtml(fund, sizeClass) {
    const size = sizeClass || 'text-xs px-2.5 py-1';
    if (fund.fund_flow_type === 'outbound') {
      return `<span class="${size} rounded-full font-bold badge-outbound">Outbound</span>`;
    }
    if (fund.fund_flow_type === 'inbound') {
      return `<span class="${size} rounded-full font-bold badge-inbound">Inbound</span>`;
    }
    return `<span class="${size} rounded-full font-bold badge-tier2">Unclassified</span>`;
  }

  // Utility helper to turn a fund name into a URL slug, matching the
  // server-side _slugify() in app.py -- keeps the fund's name visible in
  // the URL instead of just its numeric id.
  function slugify(str) {
    if (!str) return 'fund';
    return String(str).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'fund';
  }

  // Utility helper for safe HTML strings
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run initialization
  init();
});
