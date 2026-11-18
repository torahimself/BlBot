'use strict';
// Card backgrounds. Two kinds:
//   • drawn ones (below) — painted by code, no files needed
//   • your own pictures — drop an image into assets/backgrounds/ and add one line to
//     assets/backgrounds/backgrounds.json (see the README next to it)
//
// Each background has an `unlock` rule (null = free for everyone):
//   { streak: 30 }            best daily streak ever reached
//   { level: 20 }             profile level
//   { title: 'gb_first_win' } owns a title whose id starts with this text (badges, event titles …)
// Unlocks are permanent: streak "best", level and titles never go down, so a saved choice never turns invalid.

const fs = require('fs');
const path = require('path');
const R = require('./render');

const rgba = R.rgba;
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const base = (g, W, H, a, b, ang = 0.9) => { const x = Math.cos(ang) * W, y = Math.sin(ang) * H; const gr = g.createLinearGradient(W / 2 - x / 2, H / 2 - y / 2, W / 2 + x / 2, H / 2 + y / 2); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
const glow = (g, x, y, r, color, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(color, a)); gr.addColorStop(1, rgba(color, 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
const dots = (g, W, H, rnd, n, color, aMax, rMin, rMax) => { for (let i = 0; i < n; i++) { g.fillStyle = rgba(color, 0.15 + rnd() * aMax); g.beginPath(); g.arc(rnd() * W, rnd() * H, rMin + rnd() * (rMax - rMin), 0, 7); g.fill(); } };

const DRAWN = [
  { id: 'void', label: 'Shattered Void', emoji: '🕳️', unlock: null, draw(g, W, H, rnd) {
    base(g, W, H, '#0a0614', '#2a1050', 0.7);
    glow(g, W * 0.5, H * 0.05, W * 0.55, '#8a4dff', 0.35); glow(g, W * 0.1, H * 0.9, W * 0.4, '#5b2bb0', 0.25);
    g.strokeStyle = 'rgba(190,150,255,0.22)'; g.lineWidth = 2;
    for (let i = 0; i < 16; i++) { let x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 160; y += (rnd() - 0.2) * 120; g.lineTo(x, y); } g.stroke(); }
    dots(g, W, H, rnd, 70, '#c9a8ff', 0.5, 1, 3.2);
  } },
  { id: 'galaxy', label: 'Galaxy', emoji: '🌌', unlock: null, draw(g, W, H, rnd) {
    base(g, W, H, '#05061a', '#14123a', 0.5);
    glow(g, W * 0.25, H * 0.35, W * 0.45, '#5b6cff', 0.3); glow(g, W * 0.8, H * 0.7, W * 0.5, '#c24bd6', 0.26); glow(g, W * 0.55, H * 0.15, W * 0.3, '#2fd0ff', 0.18);
    dots(g, W, H, rnd, 220, '#ffffff', 0.75, 0.6, 2.2);
  } },
  { id: 'embers', label: 'Embers', emoji: '🔥', unlock: { streak: 3 }, draw(g, W, H, rnd) {
    base(g, W, H, '#160503', '#4a1307', 1.4);
    glow(g, W * 0.5, H * 1.05, W * 0.8, '#ff6a1a', 0.55); glow(g, W * 0.15, H, W * 0.4, '#ff3b1a', 0.3);
    for (let i = 0; i < 120; i++) { const x = rnd() * W, y = H * (0.2 + rnd() * 0.85), r = 1 + rnd() * 3.2; g.fillStyle = rgba(rnd() > 0.5 ? '#ffb347' : '#ff6a1a', 0.2 + rnd() * 0.7 * (y / H)); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  } },
  { id: 'ocean', label: 'Deep Ocean', emoji: '🌊', unlock: { streak: 7 }, draw(g, W, H, rnd) {
    base(g, W, H, '#03121f', '#08506b', 1.3);
    for (let i = 0; i < 6; i++) { const x = W * (0.1 + i * 0.17); const gr = g.createLinearGradient(x, 0, x + 120, H); gr.addColorStop(0, 'rgba(120,230,255,0.13)'); gr.addColorStop(1, 'rgba(120,230,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 60, 0); g.lineTo(x + 220, H); g.lineTo(x + 40, H); g.closePath(); g.fill(); }
    g.lineWidth = 2; for (let k = 0; k < 8; k++) { g.strokeStyle = rgba('#7be8ff', 0.05 + k * 0.012); g.beginPath(); for (let x = 0; x <= W; x += 8) { const y = H * (0.25 + k * 0.1) + Math.sin(x / 60 + k * 1.7) * 14; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    dots(g, W, H, rnd, 50, '#bff3ff', 0.4, 1, 4);
  } },
  { id: 'forest', label: 'Mystic Forest', emoji: '🌲', unlock: { level: 8 }, draw(g, W, H, rnd) {
    base(g, W, H, '#04120c', '#123a26', 1.5);
    glow(g, W * 0.7, H * 0.2, W * 0.4, '#7dffb0', 0.16);
    for (let layer = 0; layer < 3; layer++) { g.fillStyle = rgba('#020a06', 0.35 + layer * 0.22); const h0 = H * (0.55 + layer * 0.14), step = 46 - layer * 8; for (let x = -20; x < W + 40; x += step) { const hh = 90 + rnd() * 110 + layer * 30, w = step * 0.9; g.beginPath(); g.moveTo(x, h0 + 40); g.lineTo(x + w / 2, h0 - hh); g.lineTo(x + w, h0 + 40); g.closePath(); g.fill(); } g.fillRect(0, h0 + 30, W, H); }
    for (let i = 0; i < 40; i++) { const x = rnd() * W, y = H * (0.25 + rnd() * 0.7); glow(g, x, y, 14, '#c8ff7a', 0.8); }
  } },
  { id: 'sakura', label: 'Sakura', emoji: '🌸', unlock: { title: 'gb_first_win' }, draw(g, W, H, rnd) {
    base(g, W, H, '#1d0b1a', '#5a1f45', 0.8);
    glow(g, W * 0.8, H * 0.15, W * 0.5, '#ff9ccf', 0.28); glow(g, W * 0.1, H * 0.8, W * 0.35, '#ff5c93', 0.2);
    for (let i = 0; i < 46; i++) { const x = rnd() * W, y = rnd() * H, s = 6 + rnd() * 12, a = rnd() * 6.28; g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = rgba(rnd() > 0.4 ? '#ffc2dd' : '#ff8fbf', 0.25 + rnd() * 0.5); g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, 7); g.fill(); g.restore(); }
  } },
  { id: 'cyber', label: 'Neon City', emoji: '🌆', unlock: { level: 20 }, draw(g, W, H, rnd) {
    base(g, W, H, '#0b0620', '#2a0a4a', 1.57);
    const hy = H * 0.52; glow(g, W / 2, hy, W * 0.45, '#ff3fb0', 0.5);
    const sun = g.createLinearGradient(0, hy - 150, 0, hy); sun.addColorStop(0, '#ffd45a'); sun.addColorStop(1, '#ff3fb0'); g.fillStyle = sun; g.beginPath(); g.arc(W / 2, hy, 150, Math.PI, 0); g.fill();
    g.fillStyle = '#0b0620'; for (let k = 0; k < 6; k++) g.fillRect(W / 2 - 150, hy - 10 - k * 22, 300, 3 + k);
    g.fillStyle = '#0b0620'; g.fillRect(0, hy, W, H);
    g.strokeStyle = 'rgba(255,63,176,0.55)'; g.lineWidth = 2;
    for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * 12, hy); g.lineTo(W / 2 + i * 150, H); g.stroke(); }
    for (let k = 1; k < 9; k++) { const y = hy + Math.pow(k / 9, 2.2) * (H - hy); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  } },
  { id: 'gold', label: 'Royal Gold', emoji: '👑', unlock: { streak: 30 }, draw(g, W, H, rnd) {
    base(g, W, H, '#140f05', '#4a3510', 0.8);
    glow(g, W * 0.5, H * 0.1, W * 0.6, '#ffd45a', 0.35);
    g.strokeStyle = 'rgba(255,214,110,0.16)'; g.lineWidth = 2;
    for (let x = -H; x < W + H; x += 54) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); g.beginPath(); g.moveTo(x + H, 0); g.lineTo(x, H); g.stroke(); }
    dots(g, W, H, rnd, 60, '#ffe9a8', 0.5, 1, 3);
  } },
  { id: 'storm', label: 'Thunderstorm', emoji: '⛈️', unlock: { streak: 60 }, draw(g, W, H, rnd) {
    base(g, W, H, '#070a14', '#1d2740', 1.2);
    for (let i = 0; i < 7; i++) glow(g, rnd() * W, rnd() * H * 0.5, 220 + rnd() * 160, '#4b5d8c', 0.3);
    g.strokeStyle = 'rgba(210,225,255,0.9)'; g.lineWidth = 3; g.shadowColor = '#9bb7ff'; g.shadowBlur = 18;
    for (let b = 0; b < 2; b++) { let x = W * (0.2 + b * 0.55 + rnd() * 0.15), y = 0; g.beginPath(); g.moveTo(x, y); while (y < H * 0.85) { x += (rnd() - 0.45) * 60; y += 30 + rnd() * 40; g.lineTo(x, y); } g.stroke(); }
    g.shadowBlur = 0; g.strokeStyle = 'rgba(180,200,255,0.12)'; g.lineWidth = 1; for (let i = 0; i < 90; i++) { const x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y + 26); g.stroke(); }
  } },
  { id: 'halloween', label: 'Haunted Night', emoji: '🎃', unlock: { title: 'event_halloween2026' }, draw(g, W, H, rnd) {
    base(g, W, H, '#0d0516', '#3a1405', 1.2);
    glow(g, W * 0.82, H * 0.22, 260, '#ffb347', 0.5); g.fillStyle = '#ffe2a8'; g.beginPath(); g.arc(W * 0.82, H * 0.22, 64, 0, 7); g.fill();
    g.fillStyle = 'rgba(10,4,18,0.95)'; for (let k = 0; k < 9; k++) { const x = rnd() * W * 0.8, y = rnd() * H * 0.5, s = 10 + rnd() * 14; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s, y - s, x + 2 * s, y); g.quadraticCurveTo(x + s, y - s * 0.2, x, y); g.moveTo(x, y); g.quadraticCurveTo(x - s, y - s, x - 2 * s, y); g.quadraticCurveTo(x - s, y - s * 0.2, x, y); g.fill(); }
    g.fillStyle = '#06020c'; g.fillRect(0, H * 0.86, W, H); for (let i = 0; i < 9; i++) { const x = 40 + i * (W / 8.5); glow(g, x, H * 0.9, 50, '#ff8a1f', 0.55); g.fillStyle = '#ff8a1f'; g.beginPath(); g.ellipse(x, H * 0.9, 24, 20, 0, 0, 7); g.fill(); }
  } },
];

DRAWN.push(
  { id: 'leaves', label: 'Leaf Skeletons', emoji: 'ico:s_veins', unlock: { shop: 'bg_leaves' }, draw(g, W, H, rnd) {
    base(g, W, H, '#03100f', '#0b3a37', 1.1);
    glow(g, W * 0.2, H * 0.8, W * 0.5, '#14b8a6', 0.16); glow(g, W * 0.85, H * 0.1, W * 0.4, '#5eead4', 0.12);
    g.lineCap = 'round';
    for (let n = 0; n < 7; n++) {                                     // big leaves reduced to their vein networks
      const cx = rnd() * W, cy = rnd() * H, len = 190 + rnd() * 210, rot = rnd() * 6.28, a = 0.4 + rnd() * 0.35;
      g.save(); g.translate(cx, cy); g.rotate(rot); g.shadowColor = '#5eead4'; g.shadowBlur = 14; g.strokeStyle = rgba('#7ff5e0', a);
      g.lineWidth = 4; g.beginPath(); g.moveTo(0, -len / 2); g.lineTo(0, len / 2); g.stroke();
      g.lineWidth = 2.2;
      for (let k = 1; k < 11; k++) {
        const y = -len / 2 + (k / 11) * len, w = Math.sin((k / 11) * Math.PI) * len * 0.34;
        for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(sd * w * 0.5, y - 10, sd * w, y - 26); g.stroke();
          for (let t = 1; t < 4; t++) { const bx = sd * w * (t / 4), by = y - 6 - t * 5; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sd * 12, by - 14); g.stroke(); } }
      }
      g.beginPath(); g.moveTo(0, -len / 2); g.quadraticCurveTo(len * 0.36, -len * 0.1, 0, len / 2); g.quadraticCurveTo(-len * 0.36, -len * 0.1, 0, -len / 2); g.lineWidth = 1.2; g.stroke();
      g.restore();
    }
    dots(g, W, H, rnd, 40, '#a7fff0', 0.45, 0.8, 2.4);
  } },
  { id: 'harvest', label: 'Black Sun Harvest', emoji: 'ico:s_eclipse', unlock: { shop: 'bg_harvest' }, draw(g, W, H, rnd) {
    base(g, W, H, '#1a0603', '#7a2a07', 1.5);
    const sx = W * 0.68, sy = H * 0.34;
    glow(g, sx, sy, W * 0.5, '#ff9a2e', 0.5); glow(g, sx, sy, W * 0.22, '#ffd36b', 0.55);
    g.save(); g.translate(sx, sy); g.strokeStyle = 'rgba(255,200,110,0.55)'; g.lineCap = 'round';
    for (let i = 0; i < 48; i++) { const a = Math.PI * 2 * i / 48, r0 = 96, r1 = 120 + (i % 3 === 0 ? 70 : i % 2 ? 22 : 40); g.lineWidth = i % 3 === 0 ? 3 : 1.6; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); }
    g.restore();
    g.fillStyle = '#050206'; g.beginPath(); g.arc(sx, sy, 90, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,225,150,0.9)'; g.lineWidth = 3; g.beginPath(); g.arc(sx, sy, 92, -0.6, 1.2); g.stroke();
    // wheat: rows of curved stalks in silhouette
    for (let row = 0; row < 3; row++) {
      g.strokeStyle = row === 0 ? '#2a0e04' : row === 1 ? '#1a0903' : '#0a0402'; g.fillStyle = g.strokeStyle; g.lineWidth = 2 + row;
      const yb = H * (0.8 + row * 0.1), step = 22 - row * 4;
      for (let x = -10; x < W + 20; x += step) {
        const h = 70 + rnd() * 70 + row * 18, sway = (rnd() - 0.5) * 40, tx = x + sway, ty = yb - h;
        g.beginPath(); g.moveTo(x, H + 10); g.quadraticCurveTo(x + sway * 0.2, yb - h * 0.5, tx, ty); g.stroke();
        for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(tx + (k % 2 ? 4 : -4), ty + k * 7, 3, 7, (k % 2 ? 0.5 : -0.5), 0, 7); g.fill(); }
      }
    }
    dots(g, W, H, rnd, 45, '#ffb347', 0.6, 0.8, 2.6);
  } },
  { id: 'stained', label: 'Stained Glass', emoji: 'ico:s_glass', unlock: { level: 12 }, draw(g, W, H, rnd) {
    base(g, W, H, '#0b0716', '#1a1030', 0.8);
    const pts = []; for (let i = 0; i < 46; i++) pts.push([rnd() * W, rnd() * H]);
    const cols = ['#7c3aed', '#db2777', '#0ea5e9', '#f59e0b', '#14b8a6', '#6366f1', '#ef4444'];
    // each pixel block takes the colour of its nearest point: a stained-glass (Voronoi) window
    const step = 2; const owner = (x, y) => { let b = 0, bd = 1e9; for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const o = owner(x, y), c = cols[o % cols.length]; g.fillStyle = rgba(c, 0.18 + ((o * 37) % 10) / 55); g.fillRect(x, y, step, step); }
    g.fillStyle = 'rgba(10,5,20,0.92)';
    for (let y = step; y < H; y += step) for (let x = step; x < W; x += step) { const o = owner(x, y); if (owner(x - step, y) !== o || owner(x, y - step) !== o) g.fillRect(x - 1, y - 1, 3, 3); }
    glow(g, W * 0.75, H * 0.15, W * 0.4, '#ffffff', 0.12);
  } },
  { id: 'contour', label: 'Contour Map', emoji: 'ico:s_topo', unlock: null, draw(g, W, H, rnd) {
    base(g, W, H, '#0c0a06', '#2a1f0b', 0.9);
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = rgba(k % 5 === 0 ? '#ffd98a' : '#d9b05a', k % 5 === 0 ? 0.7 : 0.38); g.lineWidth = k % 5 === 0 ? 3 : 1.6; g.beginPath();
      for (let x = 0; x <= W; x += 8) { const y = H * (0.02 + k * 0.04) + Math.sin(x / 120 + k * 0.5) * 26 + Math.sin(x / 41 + k * 1.3) * 7 + Math.cos(x / 260 + k) * 22; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    glow(g, W * 0.3, H * 0.7, W * 0.4, '#ffb347', 0.12);
  } },
);

// ── your own pictures ────────────────────────────────────────────────────────
const DIR = process.env.BL_BG_DIR || ['assets', 'assests'].map(n => path.join(__dirname, '..', '..', n, 'backgrounds')).find(d => { try { return fs.existsSync(d); } catch (_) { return false; } })
  || path.join(__dirname, '..', '..', 'assets', 'backgrounds');

let custom = null;
function loadCustom() {
  if (custom) return custom;
  custom = [];
  try {
    const list = JSON.parse(fs.readFileSync(path.join(DIR, 'backgrounds.json'), 'utf8'));
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || !e.id || !e.file || !/^[a-z0-9_-]{1,24}$/i.test(String(e.id))) continue;
      const file = path.join(DIR, path.basename(String(e.file)));
      if (!fs.existsSync(file)) { console.warn(`[UI] background "${e.id}": file ${e.file} not found in ${DIR}`); continue; }
      custom.push({ id: 'c_' + e.id, label: String(e.label || e.id).slice(0, 40), emoji: e.emoji || '🖼️', unlock: normaliseUnlock(e.unlock), file });
    }
  } catch (_) { /* no backgrounds.json: no custom pictures */ }
  return custom;
}
function normaliseUnlock(u) {
  if (!u || typeof u !== 'object') return null;
  const out = {};
  if (Number(u.streak) > 0) out.streak = Math.floor(Number(u.streak));
  if (Number(u.level) > 0) out.level = Math.floor(Number(u.level));
  if (typeof u.title === 'string' && u.title) out.title = u.title;
  if (typeof u.shop === 'string' && u.shop) out.shop = u.shop;
  return Object.keys(out).length ? out : null;
}

const all = () => [...DRAWN, ...loadCustom()].slice(0, 24);       // a Discord menu holds 25 entries: 24 + "theme default"
const byId = (id) => all().find(b => b.id === id) || null;

/** ctx = { bestStreak, level, titleIds: string[] } */
function isUnlocked(bg, ctx) {
  const u = bg && bg.unlock;
  if (!u) return true;
  if (u.streak && (ctx.bestStreak || 0) < u.streak) return false;
  if (u.level && (ctx.level || 0) < u.level) return false;
  if (u.title && !(ctx.titleIds || []).some(t => t.startsWith(u.title))) return false;
  if (u.shop && !(ctx.shopItems || []).includes(u.shop)) return false;
  return true;
}
function describe(bg) {
  const u = bg && bg.unlock;
  if (!u) return 'Free';
  const parts = [];
  if (u.streak) parts.push(`${u.streak}-day streak`);
  if (u.level) parts.push(`level ${u.level}`);
  if (u.shop) parts.push('buy it in the seasonal shop (/buy)');
  if (u.title) parts.push(u.title.startsWith('gb_') ? 'win a party game' : u.title.startsWith('event_') ? 'an event title' : 'a special title');
  return parts.join(' + ');
}

// Painted layers are cached (one per background and size), so a profile does not repaint the scenery every time.
const cache = new Map();
async function layer(bg, W, H) {
  const key = `${bg.id}:${W}x${H}`;
  if (cache.has(key)) return cache.get(key);
  const { c, g } = R.newCanvas(W, H);
  if (bg.file) {
    const img = await R.canvas().loadImage(fs.readFileSync(bg.file));
    const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;       // "cover"
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  } else {
    bg.draw(g, W, H, seeded(11));
  }
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  return c;
}

/**
 * Paints the chosen background (and a soft dark veil so text stays readable). Returns false when `id` is unknown,
 * so the caller can paint the theme's own background instead.
 */
async function paint(g, W, H, id, accent) {
  const bg = id ? byId(id) : null;
  if (!bg) return false;
  try {
    g.drawImage(await layer(bg, W, H), 0, 0);
  } catch (err) { console.error('[UI] background failed:', err.message); return false; }
  const veil = g.createLinearGradient(0, 0, 0, H); veil.addColorStop(0, 'rgba(4,4,12,0.28)'); veil.addColorStop(1, 'rgba(4,4,12,0.5)');
  g.fillStyle = veil; g.fillRect(0, 0, W, H);
  return true;
}

module.exports = { all, byId, isUnlocked, describe, paint, DIR, DRAWN, _reset: () => { custom = null; cache.clear(); } };
