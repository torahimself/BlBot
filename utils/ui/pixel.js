'use strict';
// Pixel-art sprite engine for BlBot's own icons. Each sprite is drawn on a 20x20 grid of region letters, then
// shaded (light top-left, dark bottom-right), outlined and given a drop shadow on a 24x24 canvas.
//   a / b   = the icon's main / accent colour (bevel shaded)   A / B = same colours, flat
//   y gold · s steel · n wood · r red · p pale-blue glass (bevel shaded)    Y S N flat versions
//   W white highlight · k dark detail
const G = 20, N = 24, OFF = 2;
const INK = [26, 15, 38];

const hex = (h) => { const v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
const mix = (c, t, k) => c.map((v, i) => Math.round(v + (t[i] - v) * k));
const ramp = (c) => { const lum = (c[0] + c[1] + c[2]) / 3, k = lum > 200 ? 0.28 : 0.5; return [mix(c, [255, 255, 255], 0.5), mix(c, [255, 255, 255], 0.2), c, mix(c, [112, 30, 78], k)]; };
const FIXED = { y: '#ffcf3a', s: '#c4cfe2', n: '#b9733a', r: '#e8344a', p: '#8fe3ff', o: '#f3e8d2' };

// ── grid primitives ──────────────────────────────────────────────────────────
const mk = () => Array.from({ length: G }, () => Array(G).fill(' '));
const put = (m, x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < G && y < G) m[y][x] = ch; };
const rect = (m, x, y, w, h, ch) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(m, x + i, y + j, ch); };
const disc = (m, cx, cy, r, ch) => { for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r) m[y][x] = ch; };
const ring = (m, cx, cy, r, t, ch) => { for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const d = Math.hypot(x + .5 - cx, y + .5 - cy); if (d <= r && d > r - t) m[y][x] = ch; } };
const ell = (m, cx, cy, rx, ry, rot, ch) => { const c = Math.cos(rot), s = Math.sin(rot); for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const dx = x + .5 - cx, dy = y + .5 - cy, u = dx * c + dy * s, v = -dx * s + dy * c; if ((u / rx) ** 2 + (v / ry) ** 2 <= 1) m[y][x] = ch; } };
const poly = (m, pts, ch) => { for (let y = 0; y < G; y++) for (let x0 = 0; x0 < G; x0++) { const x = x0 + .5, yy = y + .5; let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > yy) !== (yj > yy) && x < (xj - xi) * (yy - yi) / (yj - yi) + xi) ins = !ins; } if (ins) m[y][x0] = ch; } };
const line = (m, x0, y0, x1, y1, ch, th = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1; for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; for (let a = 0; a < th; a++) for (let b = 0; b < th; b++) put(m, x + a, y + b, ch); } };
const clr = (m, fn) => { for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (fn(x + .5, y + .5)) m[y][x] = ' '; };
const sparkle = (m, x, y) => { put(m, x, y, 'W'); put(m, x - 1, y, 'W'); put(m, x + 1, y, 'W'); put(m, x, y - 1, 'W'); put(m, x, y + 1, 'W'); };

// ── sprites ──────────────────────────────────────────────────────────────────
const S = {
  gem(m) { poly(m, [[5, 2], [15, 2], [18.4, 7], [1.6, 7]], 'a'); poly(m, [[1.6, 7], [18.4, 7], [10, 19]], 'b'); poly(m, [[7.2, 2], [12.8, 2], [14, 7], [6, 7]], 'A'); poly(m, [[6, 7], [14, 7], [10, 19]], 'B'); put(m, 4, 4, 'W'); put(m, 5, 3, 'W'); put(m, 8, 3, 'W'); put(m, 3, 7, 'W'); },
  star(m) { poly(m, [[10, 0], [13, 7], [20, 10], [13, 13], [10, 20], [7, 13], [0, 10], [7, 7]], 'a'); poly(m, [[10, 10], [13, 13], [10, 20], [7, 13]], 'b'); poly(m, [[10, 10], [13, 7], [20, 10], [13, 13]], 'b'); put(m, 9, 6, 'W'); put(m, 10, 5, 'W'); put(m, 8, 8, 'W'); put(m, 9, 8, 'W'); },
  leaf(m) { poly(m, [[10, 0], [12.4, 4], [15.6, 2.6], [14.6, 8], [19.4, 7], [16, 11.4], [18.4, 14.4], [11.6, 14.2], [11, 19.6], [9, 19.6], [8.4, 14.2], [1.6, 14.4], [4, 11.4], [0.6, 7], [5.4, 8], [4.4, 2.6], [7.6, 4]], 'a'); line(m, 10, 6, 10, 18, 'b'); line(m, 10, 13, 5, 9, 'b'); line(m, 10, 13, 15, 9, 'b'); put(m, 9, 3, 'W'); put(m, 6, 4, 'W'); put(m, 4, 8, 'W'); put(m, 9, 18, 'n'); },
  moon(m) { disc(m, 10, 10, 8, 'y'); disc(m, 7, 8, 1.6, 'Y'); disc(m, 12, 13, 2.2, 'Y'); disc(m, 13, 6, 1.2, 'Y'); put(m, 6, 5, 'W'); put(m, 7, 4, 'W'); put(m, 5, 6, 'W'); },
  flame(m) { poly(m, [[10, 0], [15, 6], [17, 12], [14, 18], [10, 19], [6, 18], [3, 13], [5, 8], [8, 11], [8, 5]], 'a'); poly(m, [[10, 8], [13, 12], [13, 16], [10, 18], [7, 16], [8, 12]], 'y'); poly(m, [[10, 12], [11, 15], [10, 17], [9, 15]], 'W'); },
  crown(m) { poly(m, [[2, 16], [1, 5], [6, 10], [10, 3], [14, 10], [19, 5], [18, 16]], 'y'); rect(m, 2, 15, 16, 3, 'y'); rect(m, 2, 15, 16, 1, 'W'); disc(m, 10, 12, 1.4, 'r'); disc(m, 5, 13, 1, 'a'); disc(m, 15, 13, 1, 'a'); put(m, 10, 6, 'W'); },
  comet(m) { poly(m, [[11, 5], [16, 9], [1, 18], [3, 14], [7, 9]], 'b'); disc(m, 13, 7, 4.6, 'a'); put(m, 11, 5, 'W'); put(m, 12, 4, 'W'); put(m, 10, 6, 'W'); },
  crescent(m) { disc(m, 9, 10, 8, 'a'); clr(m, (x, y) => (x - 13) ** 2 + (y - 8) ** 2 <= 49); sparkle(m, 15, 5); },
  bolt(m) { poly(m, [[13, 0], [3, 11], [9, 11], [6, 19], [17, 7], [11, 7]], 'a'); poly(m, [[9, 11], [6, 19], [17, 7], [11, 7]], 'b'); put(m, 11, 2, 'W'); put(m, 10, 3, 'W'); },
  ring(m) { ring(m, 10, 11, 8.6, 4, 'y'); disc(m, 10, 11, 4.6, ' '); ring(m, 10, 11, 4.6, 1, 'Y'); disc(m, 10, 2.5, 2.8, 'a'); put(m, 9, 1, 'W'); put(m, 4, 8, 'W'); put(m, 3, 10, 'W'); },
  wings(m) { for (let k = 0; k < 4; k++) { const L = 8 - k * 0.9, yy = 3 + k * 3.4, r = -0.55 + k * 0.28; ell(m, 10 + L * 0.62 + 2, yy, L * 0.62, 1.7, r, k % 2 ? 'b' : 'a'); ell(m, 10 - L * 0.62 - 2, yy, L * 0.62, 1.7, -r, k % 2 ? 'b' : 'a'); } disc(m, 10, 10, 2.6, 'y'); rect(m, 9, 12, 2, 6, 'y'); put(m, 9, 9, 'W'); },
  sun(m) { for (let i = 0; i < 8; i++) { const a = Math.PI / 4 * i; line(m, 10 + Math.cos(a) * 6, 10 + Math.sin(a) * 6, 10 + Math.cos(a) * 9, 10 + Math.sin(a) * 9, 'A', 2); } disc(m, 10, 10, 5.6, 'y'); put(m, 8, 7, 'W'); put(m, 7, 8, 'W'); put(m, 8, 8, 'W'); },
  medal(m) { poly(m, [[4, 1], [10, 1], [12, 9], [7, 9]], 'a'); poly(m, [[16, 1], [10, 1], [8, 9], [13, 9]], 'b'); disc(m, 10, 13.4, 6.4, 'y'); disc(m, 10, 13.4, 3.8, 'Y'); put(m, 10, 11, 'W'); put(m, 9, 12, 'W'); put(m, 11, 12, 'W'); put(m, 10, 13, 'W'); put(m, 8, 9, 'W'); },
  arena(m) { poly(m, [[10, 1], [19.4, 6], [0.6, 6]], 's'); rect(m, 1, 6, 18, 2, 'S'); [3, 7, 11, 15].forEach(x => rect(m, x, 8, 2, 7, 'a')); rect(m, 1, 15, 18, 2, 'S'); rect(m, 0, 17, 20, 2, 's'); put(m, 6, 3, 'W'); put(m, 7, 2, 'W'); put(m, 3, 9, 'W'); put(m, 3, 10, 'W'); },
  trophy(m) { poly(m, [[4, 1], [16, 1], [15, 9], [11, 12], [9, 12], [5, 9]], 'y'); ring(m, 3.4, 5.4, 3.4, 1.4, 'Y'); ring(m, 16.6, 5.4, 3.4, 1.4, 'Y'); poly(m, [[4, 1], [16, 1], [15, 9], [11, 12], [9, 12], [5, 9]], 'y'); rect(m, 9, 12, 2, 3, 'y'); rect(m, 5, 15, 10, 3, 'n'); rect(m, 6, 15, 8, 1, 'W'); line(m, 6, 3, 6, 7, 'W'); put(m, 9, 4, 'a'); put(m, 10, 4, 'a'); },
  confetti(m) { [[2, 3, 'a'], [8, 1, 'b'], [15, 3, 'y'], [4, 9, 'y'], [11, 8, 'a'], [17, 10, 'b'], [2, 15, 'b'], [8, 14, 'y'], [14, 16, 'a']].forEach(([x, y, c], i) => { rect(m, x, y, i % 2 ? 3 : 2, i % 2 ? 2 : 3, c); }); sparkle(m, 10, 11); },
  pad(m) { poly(m, [[4, 4], [16, 4], [19, 9], [18, 15], [15, 16], [12, 12], [8, 12], [5, 16], [2, 15], [1, 9]], 'a'); rect(m, 3, 8, 6, 2, 'k'); rect(m, 5, 6, 2, 6, 'k'); disc(m, 14.5, 7, 1.2, 'y'); disc(m, 16.5, 9, 1.2, 'r'); put(m, 5, 5, 'W'); put(m, 6, 5, 'W'); },
  flag(m) { rect(m, 3, 1, 2, 18, 'n'); poly(m, [[5, 2], [10, 1], [14, 4], [19, 3], [19, 12], [14, 13], [10, 10], [5, 11]], 'a'); poly(m, [[10, 10], [14, 13], [19, 12], [19, 8], [14, 9]], 'b'); put(m, 7, 4, 'W'); put(m, 8, 3, 'W'); },
  compass(m) { ring(m, 10, 10, 9, 2.4, 's'); disc(m, 10, 10, 6.6, 'W'); poly(m, [[10, 3], [13, 10], [7, 10]], 'r'); poly(m, [[10, 17], [13, 10], [7, 10]], 'S'); disc(m, 10, 10, 1.2, 'k'); },
  quill(m) { ell(m, 11, 8, 4.4, 8.6, 0.65, 'a'); line(m, 3, 18, 14, 4, 'N'); line(m, 6, 11, 9, 14, 'B'); line(m, 8, 9, 11, 12, 'B'); put(m, 13, 3, 'W'); put(m, 12, 4, 'W'); },
  wheel(m) { ring(m, 10, 10, 9, 2, 'n'); for (let i = 0; i < 4; i++) { const a = Math.PI / 4 * i; line(m, 10 - Math.cos(a) * 8, 10 - Math.sin(a) * 8, 10 + Math.cos(a) * 8, 10 + Math.sin(a) * 8, 'N'); } disc(m, 10, 10, 2.8, 'y'); put(m, 9, 9, 'W'); },
  masks(m) { poly(m, [[1, 2], [10, 2], [10, 11], [7, 16], [4, 14], [1, 9]], 'a'); poly(m, [[8, 6], [19, 6], [19, 12], [15, 18], [11, 16], [8, 11]], 'b'); rect(m, 3, 5, 2, 2, 'k'); rect(m, 7, 5, 2, 2, 'k'); line(m, 3, 11, 7, 11, 'k'); put(m, 3, 10, 'k'); put(m, 7, 10, 'k'); rect(m, 11, 9, 2, 2, 'k'); rect(m, 15, 9, 2, 2, 'k'); line(m, 12, 14, 16, 14, 'k'); put(m, 12, 15, 'k'); put(m, 16, 15, 'k'); put(m, 3, 3, 'W'); put(m, 10, 7, 'W'); },
  chain(m) { const link = (cx, cy, rot) => { ell(m, cx, cy, 6.2, 3.6, rot, 's'); ell(m, cx, cy, 3.6, 1.4, rot, ' '); }; link(5.5, 5.5, 0.785); link(14.5, 14.5, 0.785); ell(m, 10, 10, 4.2, 1.7, -0.785, 'S'); put(m, 2, 4, 'W'); put(m, 3, 3, 'W'); put(m, 11, 13, 'W'); },
  beads(m) { [4, 10, 16].forEach((y, r) => { line(m, 0, y, 19, y, 'N', 1); [3, 8, 13, 17].forEach((x, i) => { disc(m, x + (r % 2), y, 2.3, (i + r) % 2 ? 'a' : 'b'); put(m, x + (r % 2) - 1, y - 1, 'W'); }); }); },
  target(m) { disc(m, 9, 11, 8, 'a'); disc(m, 9, 11, 6, 'W'); disc(m, 9, 11, 4, 'a'); disc(m, 9, 11, 2, 'W'); line(m, 10, 10, 18, 2, 'n'); poly(m, [[18, 2], [19, 6], [15, 2]], 'y'); poly(m, [[18, 2], [19, 1], [16, 1]], 'y'); },
  hourglass(m) { rect(m, 3, 0, 14, 2, 'n'); rect(m, 3, 18, 14, 2, 'n'); poly(m, [[4, 2], [16, 2], [11, 10], [16, 18], [4, 18], [9, 10]], 'p'); poly(m, [[6, 15], [14, 15], [10, 11]], 'y'); poly(m, [[6, 3], [14, 3], [10, 8]], 'y'); put(m, 6, 4, 'W'); },
  eclipse(m) { for (let i = 0; i < 12; i++) { const a = Math.PI / 6 * i; line(m, 10 + Math.cos(a) * 7, 10 + Math.sin(a) * 7, 10 + Math.cos(a) * 9.5, 10 + Math.sin(a) * 9.5, 'y', 1); } ring(m, 10, 10, 7.4, 1.6, 'y'); disc(m, 10, 10, 5.8, 'k'); put(m, 5, 8, 'W'); put(m, 6, 7, 'W'); },
  coin(m) { disc(m, 10, 10, 9, 'a'); disc(m, 10, 10, 6.4, 'b'); poly(m, [[10, 5], [14, 10], [10, 15], [6, 10]], 'a'); put(m, 9, 8, 'W'); put(m, 8, 9, 'W'); put(m, 4, 5, 'W'); put(m, 5, 4, 'W'); },
  drop(m) { poly(m, [[10, 0], [12.4, 5], [16, 10], [16.4, 14], [13.6, 18], [10, 19.6], [6.4, 18], [3.6, 14], [4, 10], [7.6, 5]], 'a'); poly(m, [[10, 10], [16.4, 14], [13.6, 18], [10, 19.6]], 'b'); line(m, 6, 11, 6, 14, 'W'); put(m, 8, 7, 'W'); },
  slick(m) { disc(m, 10, 11, 9, 'a'); ring(m, 10, 11, 6.6, 1.6, 'b'); ring(m, 10, 11, 4.2, 1.4, 'W'); disc(m, 10, 11, 1.6, 'k'); put(m, 5, 6, 'W'); put(m, 4, 8, 'W'); },
  topo(m) { disc(m, 10, 10, 9, 'a'); ring(m, 10, 10, 7, 1.3, 'b'); ring(m, 10, 11, 4.6, 1.3, 'y'); ring(m, 11, 11, 2.4, 1.2, 'W'); put(m, 5, 5, 'W'); put(m, 4, 7, 'W'); },
  // ── gothic / cute set ──
  heart(m) { disc(m, 6, 7, 4.6, 'a'); disc(m, 14, 7, 4.6, 'a'); poly(m, [[1.4, 8.4], [18.6, 8.4], [10, 19]], 'a'); poly(m, [[10, 10], [18.6, 8.4], [10, 19]], 'b'); put(m, 5, 4, 'W'); put(m, 4, 5, 'W'); put(m, 4, 6, 'W'); put(m, 6, 4, 'W'); },
  skull(m) { disc(m, 10, 8, 7.6, 'o'); rect(m, 5, 12, 10, 6, 'o'); disc(m, 7, 9, 2.1, 'k'); disc(m, 13, 9, 2.1, 'k'); poly(m, [[10, 11], [11.4, 13.4], [8.6, 13.4]], 'k'); [7, 9, 11, 13].forEach(x => rect(m, x, 15, 1, 3, 'k')); put(m, 6, 4, 'W'); put(m, 7, 3, 'W'); put(m, 6, 8, 'a'); },
  bat(m) { poly(m, [[8, 8], [0, 2], [2, 9], [0, 14], [5, 12], [8, 17]], 'a'); poly(m, [[12, 8], [20, 2], [18, 9], [20, 14], [15, 12], [12, 17]], 'a'); poly(m, [[7, 9], [4, 7], [3, 11], [5, 13]], 'b'); poly(m, [[13, 9], [16, 7], [17, 11], [15, 13]], 'b'); ell(m, 10, 11, 3.2, 4.6, 0, 'a'); poly(m, [[7.2, 6], [7.8, 1], [9.4, 5]], 'a'); poly(m, [[12.8, 6], [12.2, 1], [10.6, 5]], 'a'); put(m, 9, 10, 'W'); put(m, 11, 10, 'W'); put(m, 9, 13, 'W'); put(m, 11, 13, 'W'); },
  cauldron(m) { disc(m, 10, 12, 7.8, 's'); rect(m, 0, 0, 20, 8, ' '); rect(m, 2, 5, 16, 3, 'S'); ell(m, 10, 5.6, 7.4, 1.8, 0, 'a'); rect(m, 4, 18, 3, 2, 'S'); rect(m, 13, 18, 3, 2, 'S'); disc(m, 8, 2, 1.4, 'a'); disc(m, 12, 1, 1, 'b'); put(m, 6, 11, 'W'); put(m, 5, 12, 'W'); put(m, 6, 5, 'W'); put(m, 9, 5, 'W'); put(m, 13, 6, 'W'); },
  potion(m) { rect(m, 8, 1, 4, 5, 'p'); rect(m, 7, 0, 6, 2, 'n'); disc(m, 10, 13, 6.6, 'p'); clr(m, (x, y) => y < 6 && (x < 8 || x > 11)); disc(m, 10, 13, 6.6, 'p'); rect(m, 8, 1, 4, 5, 'p'); for (let y = 12; y < 20; y++) for (let x = 0; x < 20; x++) if ((x - 10) ** 2 + (y - 13) ** 2 <= 5.2 ** 2) m[y][x] = 'a'; put(m, 6, 11, 'W'); put(m, 6, 12, 'W'); put(m, 9, 3, 'W'); disc(m, 11, 14, 1, 'W'); },
  hat(m) { poly(m, [[11, 0], [15, 10], [5, 10], [8, 5]], 'a'); poly(m, [[11, 0], [15, 2], [13, 4]], 'a'); ell(m, 10, 13.5, 9.4, 3.2, 0, 'b'); rect(m, 6, 8, 8, 2, 'y'); put(m, 9, 8, 'k'); put(m, 10, 8, 'k'); put(m, 8, 4, 'W'); put(m, 7, 6, 'W'); line(m, 3, 12, 6, 11, 'W'); put(m, 17, 14, 'W'); },
  orb(m) { disc(m, 10, 9, 7.8, 'p'); disc(m, 10, 9, 3.6, 'a'); disc(m, 10, 9, 1.8, 'b'); rect(m, 5, 16, 10, 3, 'n'); rect(m, 7, 15, 6, 1, 'N'); put(m, 6, 5, 'W'); put(m, 5, 6, 'W'); put(m, 6, 6, 'W'); put(m, 15, 13, 'W'); },
  ghost(m) { disc(m, 10, 8, 7.6, 'W'); rect(m, 2, 8, 16, 10, 'W'); rect(m, 5, 17, 2, 2, ' '); rect(m, 9, 17, 2, 2, ' '); rect(m, 13, 17, 2, 2, ' '); disc(m, 7, 8, 1.6, 'k'); disc(m, 13, 8, 1.6, 'k'); rect(m, 9, 11, 2, 2, 'k'); rect(m, 4, 11, 2, 1, 'a'); rect(m, 14, 11, 2, 1, 'a'); },
  cat(m) { poly(m, [[2, 1], [8, 5], [2, 9]], 'a'); poly(m, [[18, 1], [12, 5], [18, 9]], 'a'); disc(m, 10, 11, 8, 'a'); poly(m, [[3.5, 3], [6, 5], [3.5, 6]], 'b'); poly(m, [[16.5, 3], [14, 5], [16.5, 6]], 'b'); rect(m, 5, 9, 3, 3, 'y'); rect(m, 12, 9, 3, 3, 'y'); rect(m, 6, 9, 1, 3, 'k'); rect(m, 13, 9, 1, 3, 'k'); put(m, 10, 13, 'r'); line(m, 1, 13, 4, 13, 'W'); line(m, 16, 13, 19, 13, 'W'); put(m, 6, 5, 'W'); },
  candle(m) { rect(m, 6, 7, 8, 11, 'o'); rect(m, 4, 17, 12, 2, 'y'); ell(m, 10, 7, 4, 1.2, 0, 'W'); rect(m, 10, 3, 1, 3, 'k'); poly(m, [[10.5, 0], [13, 3], [10.5, 5], [8, 3]], 'y'); put(m, 10, 3, 'a'); put(m, 8, 10, 'a'); put(m, 8, 11, 'a'); },
  shroom(m) { poly(m, [[1, 11], [3, 4], [10, 1], [17, 4], [19, 11]], 'r'); rect(m, 7, 11, 6, 7, 'o'); rect(m, 5, 17, 10, 2, 'o'); disc(m, 6, 6, 1.4, 'W'); disc(m, 13, 5, 1.6, 'W'); disc(m, 15, 9, 1, 'W'); disc(m, 9, 8, 1, 'W'); },
  rose(m) { disc(m, 10, 7, 6.4, 'a'); ring(m, 10, 7, 4, 1.2, 'b'); ring(m, 10, 7, 2, 1.2, 'b'); poly(m, [[10, 13], [10, 19], [11, 19], [11, 13]], 'N'); ell(m, 14, 16, 3.2, 1.5, -0.5, 'y'); ell(m, 6, 15, 3, 1.4, 0.5, 'y'); put(m, 6, 4, 'W'); put(m, 7, 3, 'W'); },
  coffin(m) { poly(m, [[7, 0], [13, 0], [18, 6], [14, 19], [6, 19], [2, 6]], 'n'); poly(m, [[8, 3], [12, 3], [15, 7], [12, 16], [8, 16], [5, 7]], 'N'); rect(m, 9, 5, 2, 8, 'y'); rect(m, 7, 7, 6, 2, 'y'); put(m, 4, 5, 'W'); },
  dagger(m) { poly(m, [[18, 0], [20, 2], [9, 13], [7, 11]], 's'); line(m, 15, 3, 18, 1, 'W'); poly(m, [[3, 8], [8, 5], [15, 12], [12, 15]], 'y'); line(m, 6, 12, 8, 14, 'n', 2); line(m, 3, 17, 7, 13, 'a', 2); disc(m, 2.5, 17.5, 1.8, 'y'); },
  eye(m) { for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const X = x + .5 - 10, Y = y + .5 - 10; if (X * X + (Y + 4.7) ** 2 <= 10.7 ** 2 && X * X + (Y - 4.7) ** 2 <= 10.7 ** 2) m[y][x] = 'W'; } disc(m, 10, 10, 4.6, 'a'); disc(m, 10, 10, 2.2, 'k'); put(m, 8, 8, 'W'); put(m, 9, 7, 'W'); line(m, 2, 10, 4, 8, 'W'); },
  book(m) { rect(m, 3, 1, 15, 18, 'a'); rect(m, 3, 1, 3, 18, 'b'); rect(m, 17, 2, 2, 16, 'o'); rect(m, 4, 18, 14, 1, 'o'); poly(m, [[11, 5], [12.4, 8.6], [16, 9], [13, 11.4], [14, 15], [11, 13], [8, 15], [9, 11.4], [6, 9], [9.6, 8.6]], 'y'); rect(m, 15, 9, 3, 2, 'y'); put(m, 8, 3, 'W'); },
  heartdark(m) { S.heart(m); for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (m[y][x] === 'b') m[y][x] = 'a'; },
  lantern(m) { ring(m, 10, 3.2, 3, 1, 's'); rect(m, 6, 4, 8, 2, 'N'); poly(m, [[4, 6], [16, 6], [17, 12], [14, 17], [6, 17], [3, 12]], 'a'); rect(m, 8, 8, 4, 7, 'y'); rect(m, 9, 9, 2, 3, 'W'); line(m, 7, 6, 7, 16, 'k'); line(m, 12, 6, 12, 16, 'k'); rect(m, 5, 17, 10, 2, 'N'); put(m, 5, 8, 'W'); put(m, 4, 10, 'W'); },
};
S.sparkgem = S.star;

// ── renderer ─────────────────────────────────────────────────────────────────
function bake(grid, c1, c2) {
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {   // drop orphan pixels (no neighbour at all)
    if (grid[y][x] === ' ' || 'Wk'.includes(grid[y][x])) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => (grid[y + dy] || [])[x + dx] && grid[y + dy][x + dx] !== ' ').length;
    if (!n) grid[y][x] = ' ';
  }
  const base = { a: ramp(hex(c1)), b: ramp(hex(c2)) };
  for (const k of Object.keys(FIXED)) base[k] = ramp(hex(FIXED[k]));
  const lab = Array.from({ length: G }, () => Array(G).fill(-1)), bb = [];   // connected pieces of one letter → own bbox
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const ch = grid[y][x]; if (ch === ' ' || lab[y][x] >= 0) continue;
    const id = bb.length, box = [x, y, x, y]; bb.push(box); const st = [[x, y]]; lab[y][x] = id;
    while (st.length) { const [cx, cy] = st.pop(); box[0] = Math.min(box[0], cx); box[1] = Math.min(box[1], cy); box[2] = Math.max(box[2], cx); box[3] = Math.max(box[3], cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx >= 0 && ny >= 0 && nx < G && ny < G && grid[ny][nx] === ch && lab[ny][nx] < 0) { lab[ny][nx] = id; st.push([nx, ny]); } } }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= G || y >= G) ? ' ' : grid[y][x];
  const px = Array.from({ length: N }, () => Array(N).fill(null));
  const colorOf = (ch, x, y) => {
    if (ch === 'W') return [255, 255, 255];
    if (ch === 'k') return [38, 24, 58];
    const flat = ch === ch.toUpperCase(), key = ch.toLowerCase(), r = base[key];
    if (!r) return [255, 0, 255];
    if (flat) return r[2];
    const b = bb[lab[y][x]], w = b[2] - b[0] + 1, h = b[3] - b[1] + 1;
    if (Math.min(w, h) <= 2) return r[2];                               // thin strokes stay flat
    const t = ((x + .5 - b[0]) / w + (y + .5 - b[1]) / h) / 2;            // 0 = top-left, 1 = bottom-right
    return t < 0.27 ? r[1] : t > 0.74 ? r[3] : r[2];
  };
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (grid[y][x] !== ' ') px[y + OFF][x + OFF] = colorOf(grid[y][x], x, y);
  return px;
}
function finish(px, tier) {
  const out = Array.from({ length: N }, () => Array(N).fill(null));
  const f = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? null : px[y][x];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (px[y][x]) { out[y][x] = [...px[y][x], 255]; continue; }
    if (f(x - 1, y) || f(x + 1, y) || f(x, y - 1) || f(x, y + 1)) out[y][x] = [...INK, 255];
  }
  const solid = out.map(r => r.map(v => !!v));
  for (let y = 1; y < N; y++) for (let x = 1; x < N; x++) if (!out[y][x] && solid[y - 1][x - 1]) out[y][x] = [10, 4, 20, 60];
  // rarity sparkles (outlined 3x3 plus) in the free corners
  const spark = (cx, cy) => { for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < N && y < N && (!out[y][x] || out[y][x][3] < 255 || (out[y][x][0] === INK[0] && out[y][x][1] === INK[1]))) out[y][x] = dx || dy ? [255, 246, 196, 255] : [255, 255, 255, 255]; } };
  if (tier === 'silver' || tier === 'gold' || tier === 'legend') spark(21, 2);
  if (tier === 'gold' || tier === 'legend') spark(2, 21);
  if (tier === 'legend') spark(2, 3);
  return out;
}

/** Builds the NxN rgba pixel list for a sprite. */
function sprite(kind, c1, c2, tier) {
  const fn = S[kind]; if (!fn) return null;
  const m = mk(); fn(m);
  return finish(bake(m, c1, c2), tier);
}

module.exports = { sprite, N, kinds: () => Object.keys(S) };
