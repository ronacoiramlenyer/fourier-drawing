(() => {
'use strict';
// Shared helpers for every tool in the collection.
const downloadsReady = (window.claude && typeof window.claude.use === 'function')
  ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
  : Promise.resolve(null);
let exportUrl = null;
// Saves a generated file. Returns 'saved', 'declined' or 'fallback' (download link plus a preview).
async function saveBlob(blob, filename) {
  const dl = await Promise.race([downloadsReady, new Promise(r => setTimeout(() => r(null), 1500))]);
  if (dl) {
    try { await dl.save({ filename, data: blob }); return 'saved'; }
    catch (err) { if (err && (err.code === 'declined' || err.code === 'rate_limited')) return 'declined'; }
  }
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = exportUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  const img = document.getElementById('export-img');
  if (img) { img.src = exportUrl; document.getElementById('export-modal').hidden = false; }
  return 'fallback';
}
const VIEWS = ['home', 'grapher', 'fourier'];
function show(view) {
  if (!VIEWS.includes(view)) view = 'home';
  document.body.dataset.view = view;
  for (const v of VIEWS) { const el = document.getElementById('view-' + v); if (el) el.hidden = v !== view; }
  document.querySelectorAll('.suite-nav a').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  try { if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view); } catch { /* sandboxed */ }
  window.dispatchEvent(new CustomEvent('suite:view', { detail: view }));
}
window.Suite = { saveBlob, show };
// Start on the view named in the link, before the tools initialise.
const start = location.hash.slice(1);
document.body.dataset.view = VIEWS.includes(start) ? start : 'home';
})();
