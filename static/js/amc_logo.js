/**
 * amc_logo.js
 * Logo for a fund house, chosen from static/data/amc_logos.json (the list of AMC-name words -> logo file lives there, not here).
 * An AMC with no logo in that file gets a coloured initials badge, so every card looks the same shape.
 *
 *   await AmcLogo.ready;                       // optional: wait for the list before the first paint
 *   AmcLogo.html('HDFC AMC International', 48) // <img> or initials badge, `size` px square
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const words = (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let entries = [];

  const ready = fetch('/static/data/amc_logos.json')
    .then((r) => (r.ok ? r.json() : { logos: [] }))
    .then((d) => { entries = d.logos || []; })
    .catch(() => { entries = []; });

  function entryFor(name) {
    const w = new Set(words(name));
    return entries.find((e) => (e.match || []).length && e.match.every((m) => w.has(String(m).toLowerCase()))) || null;
  }
  const fileFor = (name) => { const e = entryFor(name); return e ? e.file : null; };

  // The badge colour comes from the name, so the same AMC always gets the same one.
  const PALETTE = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#e11d48', '#0d9488', '#4f46e5', '#0891b2'];
  function initials(name) {
    const cleaned = String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
    if (!cleaned.length) return '?';
    return (cleaned.length > 1 && cleaned[0].length <= 3 ? cleaned[0] : cleaned[0].slice(0, 2)).slice(0, 3).toUpperCase();
  }

  function html(name, size = 44, extraClass = '') {
    const px = Number(size) || 44;
    const entry = entryFor(name);
    const file = entry ? entry.file : null;
    const wide = !!(entry && entry.wide);
    const box = `width:${wide ? Math.round(px * 3) : px}px;height:${px}px;border-radius:${Math.round(px * 0.28)}px`;
    if (file) {
      const img = wide ? 'max-width:88%;max-height:72%;width:auto;height:auto' : 'width:78%;height:78%';
      return `<span class="amc-logo ${wide ? 'amc-logo-wide' : ''} ${extraClass}" style="${box}" title="${esc(name)}"><img src="/static/img/amc/${esc(file)}" alt="${esc(name)} logo" loading="lazy" style="${img};object-fit:contain"></span>`;
    }
    const sum = [...String(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
    const colour = PALETTE[sum % PALETTE.length];
    return `<span class="amc-logo ${extraClass}" style="${box};background:${colour}1a;color:${colour};font-weight:800;font-size:${Math.round(px * 0.3)}px" title="${esc(name)}">${esc(initials(name))}</span>`;
  }

  window.AmcLogo = { ready, html, fileFor };
})();
