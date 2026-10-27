'use strict';
// Result map for a geo round: the real location (green ★) and every player's pin (numbered, coloured),
// joined by dashed lines. Drawn with @napi-rs/canvas on a Natural Earth land outline
// (data/world-land.json, public domain). Without the canvas module render() returns null and the bot
// simply posts the text results.

let canvasMod;   // undefined = not tried, null = unavailable
function canvas() {
  if (canvasMod !== undefined) return canvasMod;
  try { canvasMod = process.env.BL_WHEEL_FORCE_PURE ? null : require('@napi-rs/canvas'); } catch (_) { canvasMod = null; }
  return canvasMod;
}

let LAND = null;
function land() {
  if (!LAND) { try { LAND = require('./data/world-land.json'); } catch (_) { LAND = []; } }
  return LAND;
}

const W = 960, H = 540;
const PIN_COLORS = ['#ff5252', '#4d9fff', '#ffd54d', '#b57bff', '#4dffb8', '#ff9442', '#ff6ec7', '#a8e63d', '#2fd8f0', '#f2f2f2'];
const pinColor = (i) => PIN_COLORS[i % PIN_COLORS.length];

/** View rectangle containing every point, with margin, at the canvas aspect ratio. */
function viewFor(points) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of points) { minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon); minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); }
  const minSpanLon = 8;
  let spanLon = Math.max(maxLon - minLon, 0) * 1.5, spanLat = Math.max(maxLat - minLat, 0) * 1.5;
  spanLon = Math.max(spanLon, minSpanLon);
  spanLat = Math.max(spanLat, minSpanLon * H / W);
  // keep the canvas aspect ratio (equirectangular: 1° lon = 1° lat on screen)
  if (spanLon / spanLat > W / H) spanLat = spanLon * H / W; else spanLon = spanLat * W / H;
  spanLon = Math.min(spanLon, 360); spanLat = Math.min(spanLat, 180);
  if (spanLon >= 360 || spanLat >= 180) { spanLon = 360; spanLat = 180; }
  let cx = (minLon + maxLon) / 2, cy = (minLat + maxLat) / 2;
  cx = Math.max(-180 + spanLon / 2, Math.min(180 - spanLon / 2, cx));
  cy = Math.max(-90 + spanLat / 2, Math.min(90 - spanLat / 2, cy));
  return { x0: cx - spanLon / 2, y1: cy + spanLat / 2, k: W / spanLon };
}

/**
 * @param {{lat:number, lon:number}} truth
 * @param {{lat:number, lon:number}[]} guesses  in ranking order — pin n has the number n+1
 * @returns {Buffer|null} PNG
 */
function render(truth, guesses) {
  const cv = canvas();
  if (!cv || !truth || !Number.isFinite(truth.lat)) return null;
  const pts = [truth, ...guesses.filter(g => g && Number.isFinite(g.lat))];
  const view = viewFor(pts);
  const px = (lon) => (lon - view.x0) * view.k;
  const py = (lat) => (view.y1 - lat) * view.k;

  const c = cv.createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16263a'; ctx.fillRect(0, 0, W, H);

  // graticule
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  const step = view.k > 40 ? 5 : view.k > 12 ? 10 : 30;
  for (let lo = Math.ceil(view.x0 / step) * step; px(lo) < W; lo += step) { ctx.beginPath(); ctx.moveTo(px(lo), 0); ctx.lineTo(px(lo), H); ctx.stroke(); }
  for (let la = Math.floor(view.y1 / step) * step; py(la) < H; la -= step) { ctx.beginPath(); ctx.moveTo(0, py(la)); ctx.lineTo(W, py(la)); ctx.stroke(); }

  // land
  ctx.fillStyle = '#34506b'; ctx.strokeStyle = '#4f7391'; ctx.lineWidth = 1; ctx.lineJoin = 'round';
  const xMax = view.x0 + W / view.k, yMin = view.y1 - H / view.k;
  for (const poly of land()) {
    const outer = poly[0];
    if (!outer) continue;
    let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity;
    for (let i = 0; i < outer.length; i += 2) { a = Math.min(a, outer[i]); b = Math.max(b, outer[i]); d = Math.min(d, outer[i + 1]); e = Math.max(e, outer[i + 1]); }
    if (b < view.x0 || a > xMax || e < yMin || d > view.y1) continue;
    ctx.beginPath();
    for (const ring of poly) {
      // A jump of more than 180° of longitude is the outline crossing the date line: don't draw across the map.
      for (let i = 0; i < ring.length; i += 2) {
        if (i === 0 || Math.abs(ring[i] - ring[i - 2]) > 180) ctx.moveTo(px(ring[i]), py(ring[i + 1])); else ctx.lineTo(px(ring[i]), py(ring[i + 1]));
      }
    }
    ctx.fill('evenodd'); ctx.stroke();
  }

  // lines guess → truth
  ctx.lineWidth = 2.5; ctx.setLineDash([9, 7]);
  guesses.forEach((g, i) => {
    if (!g || !Number.isFinite(g.lat)) return;
    ctx.strokeStyle = pinColor(i); ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(px(g.lon), py(g.lat)); ctx.lineTo(px(truth.lon), py(truth.lat)); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // the real location: a green ring and a star
  const tx = px(truth.lon), ty = py(truth.lat);
  ctx.beginPath(); ctx.arc(tx, ty, 17, 0, Math.PI * 2); ctx.fillStyle = 'rgba(46,204,113,0.35)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#2ecc71'; ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 5 : 11, a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(tx + Math.cos(a) * r, ty + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill();

  // pins (drawn far → near so the best guess stays on top)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 15px sans-serif';
  for (let i = guesses.length - 1; i >= 0; i--) {
    const g = guesses[i]; if (!g || !Number.isFinite(g.lat)) continue;
    const x = px(g.lon), y = py(g.lat);
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = pinColor(i); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#0b1420'; ctx.stroke();
    ctx.fillStyle = '#0b1420'; ctx.fillText(String(i + 1), x, y + 1);
  }

  return c.toBuffer('image/png');
}

module.exports = { render, viewFor, pinColor, PIN_COLORS, W, H, canvas };
