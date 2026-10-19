(() => {
'use strict';
// Navigation between tools, plus the home page thumbnails.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-view]');
  if (!a) return;
  e.preventDefault();
  window.Suite.show(a.dataset.view);
  if (a.dataset.view !== 'home') window.scrollTo(0, 0);
});
window.addEventListener('hashchange', () => window.Suite.show(location.hash.slice(1)));
window.Suite.show(document.body.dataset.view);

function setup(c) {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0f18'; ctx.fillRect(0, 0, r.width, r.height);
  return [ctx, r.width, r.height];
}
function grid(ctx, w, h, step) {
  ctx.strokeStyle = 'rgba(140, 165, 215, 0.09)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = (w / 2) % step; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
  for (let y = (h / 2) % step; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(214, 222, 240, 0.4)';
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}
function plot(ctx, w, h, s, f, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let px = 0; px <= w; px++) { const y = f((px - w / 2) / s); const py = h / 2 - y * s; px ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
}
function drawThumbs() {
  const g = document.getElementById('thumb-grapher');
  if (g && g.getBoundingClientRect().width > 2) {
    const [ctx, w, h] = setup(g);
    const s = h / 7;
    grid(ctx, w, h, s);
    plot(ctx, w, h, s, x => 0.35 * x * x - 2, '#ff6b6b');
    plot(ctx, w, h, s, x => 1.6 * Math.sin(1.4 * x), '#5aa9ff');
    plot(ctx, w, h, s, x => 0.5 * x + 1, '#5fd38d');
    for (const [x, y] of [[-1.4, 0.3], [2.39, 0]]) { ctx.fillStyle = '#c9d1e0'; ctx.beginPath(); ctx.arc(w / 2 + x * s, h / 2 - y * s, 4.5, 0, 7); ctx.fill(); }
  }
  const f = document.getElementById('thumb-fourier');
  if (f && f.getBoundingClientRect().width > 2) {
    const [ctx, w, h] = setup(f);
    const s = (h / 2 - 12) / 210;
    const circles = [[110, 1, 0], [55, -6, Math.PI / 2], [28, 8, 0], [16, -13, Math.PI / 4]];
    const at = (t) => circles.reduce((p, [r, k, ph]) => [p[0] + r * Math.cos(2 * Math.PI * k * t + ph), p[1] + r * Math.sin(2 * Math.PI * k * t + ph)], [0, 0]);
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(255, 209, 102, 0.5)'; ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i <= 1400; i++) { const [x, y] = at(i / 1400 * 0.82); const px = w / 2 + x * s, py = h / 2 - y * s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke(); ctx.shadowBlur = 0;
    let p = [0, 0];
    const t = 0.82, cols = ['#5fd3ea', '#ff7eb6', '#a990ff', '#7ee08f'];
    circles.forEach(([r, k, ph], i) => {
      const cx = w / 2 + p[0] * s, cy = h / 2 - p[1] * s;
      const np = [p[0] + r * Math.cos(2 * Math.PI * k * t + ph), p[1] + r * Math.sin(2 * Math.PI * k * t + ph)];
      ctx.globalAlpha = 0.6; ctx.strokeStyle = cols[i]; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, r * s, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(w / 2 + np[0] * s, h / 2 - np[1] * s); ctx.stroke();
      p = np;
    });
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(w / 2 + p[0] * s, h / 2 - p[1] * s, 4.5, 0, 7); ctx.fill();
  }
}
const ro = new ResizeObserver(drawThumbs);
['thumb-grapher', 'thumb-fourier'].forEach(id => { const el = document.getElementById(id); if (el) ro.observe(el); });
})();
