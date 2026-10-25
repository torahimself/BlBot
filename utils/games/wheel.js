'use strict';
// Spinning-wheel GIF made at runtime.
//   • Preferred: @napi-rs/canvas — named segments + the players' avatars (Fizbo look).
//   • Fallback (module missing on the host): the original pure-JS numbered wheel.
//
//   render({ slots: [{ num, colorIdx }, …], selected: <index into slots> })
//     → { buffer, spinMs, frames, width, height }
//
// The wheel has one coloured segment per slot with a big number, a fixed gold
// pointer on top, and a decelerating spin that stops EXACTLY on the selected
// segment. Results are cached by (slot list, selected) so a repeat is instant.
// Everything uses one 16-colour global palette: 0 background, 1 gold, 2 white,
// 3 dark lines, 4–15 the twelve player colours.

const SIZE = 224;
const CX = SIZE / 2, CY = SIZE / 2;
const R = 100;            // outer radius (rim included)
const R_SEG = 95;         // coloured part
const FRAMES = 22;
const LAST_DELAY_CS = 300;

// Player colours (index 0–11 → palette 4–15). Dark enough for white digits.
const COLORS = [
  [200, 40, 50],   // 🔴 أحمر
  [40, 90, 200],   // 🔵 أزرق
  [30, 140, 70],   // 🟢 أخضر
  [220, 120, 20],  // 🟠 برتقالي
  [130, 60, 190],  // 🟣 بنفسجي
  [120, 75, 40],   // 🟤 بني
  [200, 70, 140],  // 🩷 وردي
  [30, 150, 170],  // 🩵 سماوي
  [170, 140, 10],  // 🟡 أصفر
  [110, 110, 120], // 🩶 رمادي
  [100, 150, 30],  // 🍏 ليموني
  [60, 60, 150],   // 🔷 نيلي
];
const PALETTE = [
  [24, 20, 36], [245, 190, 60], [255, 255, 255], [20, 16, 28],
  ...COLORS,
];

// With avatars the palette grows to 232 colours: the 16 above + a 6×6×6 cube.
const png = require('./png.js');
const AV_PALETTE = PALETTE.slice();
for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) AV_PALETTE.push([r * 51, g * 51, b * 51]);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const AV_SEG = 26;          // small avatar on each segment (diameter, px)
const AV_HUB = 48;          // big avatar in the centre
const AV_SEG_R = 80;        // distance of the small avatars from the centre

// avatar (circleAvatar result) → palette indices (255 = outside the circle), light ordered dither.
function avatarIndices(av) {
  const out = new Uint8Array(av.size * av.size).fill(255);
  for (let y = 0; y < av.size; y++) {
    for (let x = 0; x < av.size; x++) {
      const o = y * av.size + x;
      if (!av.mask[o]) continue;
      const t = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 2.2;
      const q = (v) => Math.max(0, Math.min(5, Math.round((v + t) / 51)));
      out[o] = 16 + q(av.rgb[o * 3]) * 36 + q(av.rgb[o * 3 + 1]) * 6 + q(av.rgb[o * 3 + 2]);
    }
  }
  return out;
}

const FONT = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

// ── pixel geometry (computed once) ──────────────────────────────────────────
const NPIX = SIZE * SIZE;
const RAD = new Float32Array(NPIX);
const ANG = new Float32Array(NPIX);          // clockwise from the top, 0..2π
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
    const i = y * SIZE + x;
    RAD[i] = Math.sqrt(dx * dx + dy * dy);
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += 2 * Math.PI;
    ANG[i] = a;
  }
}
const TWO_PI = 2 * Math.PI;

/** One frame as palette indices. `rot` = clockwise rotation in radians. */
function frameIndices(slots, rot, avatars) {
  const n = slots.length;
  const seg = TWO_PI / n;
  const out = new Uint8Array(NPIX);
  const s = n <= 6 ? 4 : 3;                       // digit scale
  const rc = 0.62 * R_SEG;                        // digit radius
  const texts = slots.map(sl => String(sl.num).split('').map(Number));
  for (let i = 0; i < NPIX; i++) {
    const r = RAD[i];
    const x = i % SIZE, y = (i / SIZE) | 0;
    let c = 0;
    if (r <= R) {
      if (r > R_SEG) c = 1;                                           // gold rim
      else if (r < 11) c = r < 8 ? 3 : 1;                             // hub
      else {
        let phi = (ANG[i] - rot) % TWO_PI; if (phi < 0) phi += TWO_PI;
        const f = phi / seg;
        let k = Math.floor(f); if (k >= n) k = n - 1;
        const edge = Math.min(f - k, k + 1 - f) * seg * r;             // distance to the nearest divider
        if (edge < 1.1) c = 3;
        else {
          c = 4 + slots[k].colorIdx;
          if (r > rc - 18 && r < rc + 18) {
            const ck = (k + 0.5) * seg;
            const px = r * Math.sin(phi), py = -r * Math.cos(phi);
            const dx = px - rc * Math.sin(ck), dy = py + rc * Math.cos(ck);
            const along = dx * Math.sin(ck) - dy * Math.cos(ck);       // outward
            const across = dx * Math.cos(ck) + dy * Math.sin(ck);      // to the right
            const L = texts[k].length;
            const w = (L * 4 - 1) * s, h = 5 * s;
            const ix = Math.floor((across + w / 2) / s);
            const iy = Math.floor((-along + h / 2) / s);
            if (iy >= 0 && iy < 5 && ix >= 0 && ix < L * 4 - 1) {
              const cc = ix % 4;
              if (cc < 3 && FONT[texts[k][(ix / 4) | 0]][iy][cc] === '1') c = 2;
            }
          }
        }
      }
    }
    out[i] = c;
  }
  if (avatars && avatars.some(Boolean)) overlayAvatars(out, slots, rot, avatars);
  // Fixed pointer (triangle, apex down) — drawn last so avatars never cover it.
  for (let y = 2; y <= 28; y++) {
    const half = 12 * (1 - (y - 2) / 27);
    for (let x = 0; x < SIZE; x++) if (Math.abs(x + 0.5 - CX) <= half) out[y * SIZE + x] = 1;
  }
  return out;
}

function blit(out, ind, size, cx, cy) {
  const x0 = Math.round(cx - size / 2), y0 = Math.round(cy - size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = ind[y * size + x];
      if (v === 255) continue;
      const X = x0 + x, Y = y0 + y;
      if (X >= 0 && X < SIZE && Y >= 0 && Y < SIZE) out[Y * SIZE + X] = v;
    }
  }
}

function ring(out, cx, cy, rad, color) {
  for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
    for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= rad) out[y * SIZE + x] = color;
    }
  }
}

// avatars[k] = { seg: Uint8Array(AV_SEG²), hub: Uint8Array(AV_HUB²) } | null
function overlayAvatars(out, slots, rot, avatars) {
  const n = slots.length, seg = TWO_PI / n;
  for (let k = 0; k < n; k++) {
    if (!avatars[k]) continue;
    const a = rot + (k + 0.5) * seg;
    const cx = CX + AV_SEG_R * Math.sin(a), cy = CY - AV_SEG_R * Math.cos(a);
    ring(out, cx, cy, AV_SEG / 2 + 1.5, 2);
    blit(out, avatars[k].seg, AV_SEG, cx, cy);
  }
  let under = Math.floor((((-rot) % TWO_PI) + TWO_PI) % TWO_PI / seg);
  if (under >= n) under = n - 1;
  ring(out, CX, CY, AV_HUB / 2 + 3, 1);          // gold ring
  ring(out, CX, CY, AV_HUB / 2 + 1, 2);          // white ring
  if (avatars[under]) blit(out, avatars[under].hub, AV_HUB, CX, CY);
}

// ── GIF89a encoder ──────────────────────────────────────────────────────────
function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const bytes = [];
  let cur = 0, nbits = 0;
  const emit = (code) => {
    cur |= code << nbits; nbits += codeSize;
    while (nbits >= 8) { bytes.push(cur & 255); cur >>>= 8; nbits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1; codeSize = minCode + 1; dict = new Map();
    } else {
      if (next >= (1 << codeSize)) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) bytes.push(cur & 255);
  return bytes;
}

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

// opts: { size, palette } — palette up to 256 colours (padded to a power of two).
function encodeGif(frames, delaysCs, opts = {}) {
  const size = opts.size || SIZE;
  const palette = opts.palette || PALETTE;
  let bits = 1;
  while ((1 << bits) < palette.length) bits++;
  const minCode = Math.max(2, bits);
  const b = [];
  const w16 = (v) => b.push(v & 255, (v >> 8) & 255);
  b.push(...Buffer.from('GIF89a'));
  w16(size); w16(size);
  b.push(0xF0 | (bits - 1), 0, 0);                      // global colour table
  for (let i = 0; i < (1 << bits); i++) { const c = palette[i] || [0, 0, 0]; b.push(c[0], c[1], c[2]); }
  for (let f = 0; f < frames.length; f++) {
    b.push(0x21, 0xF9, 4, 0x04); w16(delaysCs[f]); b.push(0, 0);   // graphic control (play once, no loop block)
    b.push(0x2C); w16(0); w16(0); w16(size); w16(size); b.push(0); // image descriptor
    b.push(minCode);                                                // LZW min code size
    b.push(...subBlocks(lzw(frames[f], minCode)));
  }
  b.push(0x3B);
  return Buffer.from(b);
}

// ── public API ──────────────────────────────────────────────────────────────
const cache = new Map();

function renderPure({ slots, selected, avatars }) {
  if (!Array.isArray(slots) || slots.length < 2 || slots.length > 12) throw new Error('wheel: need 2–12 slots');
  if (!(selected >= 0 && selected < slots.length)) throw new Error('wheel: bad selected index');
  const hasAv = Array.isArray(avatars) && avatars.some(Boolean);
  const key = slots.map((s, i) => `${s.num}.${s.colorIdx}.${hasAv && avatars[i] ? avatars[i].id : '-'}`).join(',') + '|' + selected;
  const hit = cache.get(key);
  if (hit) return hit;

  const n = slots.length;
  const seg = TWO_PI / n;
  const ck = (selected + 0.5) * seg;
  // Deterministic little offset inside the segment so it doesn't always stop dead-centre.
  const jitter = (((selected * 37 + n * 11) % 21) - 10) / 10 * 0.28 * seg;
  const finalRot = 3 * TWO_PI - ck + jitter;          // clockwise, ends with the segment under the pointer

  const frames = [];
  const delays = [];
  let spinCs = 0;
  for (let f = 0; f < FRAMES; f++) {
    const t = f / (FRAMES - 1);
    const rot = finalRot * (1 - Math.pow(1 - t, 3));
    frames.push(frameIndices(slots, rot, hasAv ? avatars : null));
    const d = f === FRAMES - 1 ? LAST_DELAY_CS : 6 + Math.round(22 * t * t);
    delays.push(d);
    if (f < FRAMES - 1) spinCs += d;
  }
  const result = { buffer: encodeGif(frames, delays, hasAv ? { palette: AV_PALETTE } : {}), spinMs: spinCs * 10, frames: FRAMES, width: SIZE, height: SIZE, finalRot, avatars: hasAv };
  if (cache.size > 300) cache.clear();
  cache.set(key, result);
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// Canvas wheel: names along the segments, avatar in the hub, pointer on the right.
// ═══════════════════════════════════════════════════════════════════════════
const path = require('path');

const CV = {
  SIZE: 340, C: 170, R: 150, HUB: 44,
  FRAMES: 26, TURNS: 2, LAST_DELAY_CS: 300,
  BG: [43, 45, 49],
  FONT_FILE: path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  FONT: 'BLWheel',
};

let canvasMod;             // undefined = not tried yet, null = unavailable, object = loaded
let warned = false;
let fontReady = false;

function loadCanvas() {
  if (canvasMod !== undefined) return canvasMod;
  if (process.env.BL_WHEEL_FORCE_PURE) { canvasMod = null; return null; }
  try {
    canvasMod = require('@napi-rs/canvas');
  } catch (err) {
    canvasMod = null;
    if (!warned) { warned = true; console.warn('[Wheel] @napi-rs/canvas is not installed — using the simple numbered wheel. Run `npm install` to get names + avatars.'); }
  }
  return canvasMod;
}

/** Tests: pass a module, or `false`/`null` to simulate "not installed", or `undefined` to reset. */
function _setCanvasForTest(mod) { canvasMod = mod === undefined ? undefined : (mod || null); fontReady = false; warned = false; }

function ensureFont(mod) {
  if (fontReady) return;
  try { mod.GlobalFonts.registerFromPath(CV.FONT_FILE, CV.FONT); } catch (_) { /* falls back to the system font */ }
  fontReady = true;
}

// ── avatars ────────────────────────────────────────────────────────────────
const avatarCache = new Map();    // url -> Image | null

async function fetchAvatar(mod, url, fetchImpl = globalThis.fetch) {
  if (!url) return null;
  if (avatarCache.has(url)) return avatarCache.get(url);
  let img = null;
  try {
    if (typeof fetchImpl !== 'function') throw new Error('no fetch');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await fetchImpl(url, { signal: ctl.signal });
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
      img = await mod.loadImage(Buffer.from(await res.arrayBuffer()));
    } finally { clearTimeout(timer); }
  } catch (_) { img = null; }
  if (avatarCache.size > 200) avatarCache.clear();
  avatarCache.set(url, img);
  return img;
}

// ── helpers ────────────────────────────────────────────────────────────────
const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]/gu;
const cleanName = (n) => String(n || '').replace(EMOJI_RE, '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim() || 'لاعب';

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1) {
    chars.pop();
    const t = chars.join('').trimEnd() + '…';
    if (ctx.measureText(t).width <= maxW) return t;
  }
  return '…';
}

function drawFrame(mod, ctx, slots, rot, avatars) {
  const { SIZE: S, C, R, HUB } = CV;
  const n = slots.length;
  const seg = TWO_PI / n;
  ctx.fillStyle = rgbCss(CV.BG);
  ctx.fillRect(0, 0, S, S);

  // Segments (canvas angle 0 = 3 o'clock, clockwise): the pointer sits at angle 0.
  for (let k = 0; k < n; k++) {
    const a0 = rot + k * seg, a1 = a0 + seg;
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.arc(C, C, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = rgbCss(COLORS[slots[k].colorIdx % COLORS.length]);
    ctx.fill();
  }
  // Thin white separators + white rim.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (let k = 0; k < n; k++) {
    const a = rot + k * seg;
    ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(C + R * Math.cos(a), C + R * Math.sin(a)); ctx.stroke();
  }
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(C, C, R, 0, TWO_PI); ctx.stroke();

  // Labels "N- name", written along the radius.
  const fs = Math.max(12, Math.min(16, Math.floor(seg * 80 * 0.36)));
  ctx.font = `bold ${fs}px ${CV.FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const maxW = R - HUB - 14;
  for (let k = 0; k < n; k++) {
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rot + (k + 0.5) * seg);
    ctx.fillText(fitText(ctx, `${slots[k].num}- ${cleanName(slots[k].name)}`, maxW), R - 8, 1);
    ctx.restore();
  }

  // Hub with the avatar of the player under the pointer.
  let under = Math.floor((((-rot) % TWO_PI) + TWO_PI) % TWO_PI / seg);
  if (under >= n) under = n - 1;
  ctx.beginPath(); ctx.arc(C, C, HUB + 4, 0, TWO_PI); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(C, C, HUB, 0, TWO_PI); ctx.clip();
  const img = avatars[under];
  if (img) {
    ctx.drawImage(img, C - HUB, C - HUB, HUB * 2, HUB * 2);
  } else {
    ctx.fillStyle = rgbCss(COLORS[slots[under].colorIdx % COLORS.length]);
    ctx.fillRect(C - HUB, C - HUB, HUB * 2, HUB * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 40px ${CV.FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(Array.from(cleanName(slots[under].name))[0].toUpperCase(), C, C + 2);
  }
  ctx.restore();

  // Pointer on the right edge (pointing at the wheel).
  ctx.beginPath();
  ctx.moveTo(C + R - 12, C);
  ctx.lineTo(C + R + 14, C - 12);
  ctx.lineTo(C + R + 14, C + 12);
  ctx.closePath();
  ctx.fillStyle = '#d9dbe0';
  ctx.fill();
  ctx.strokeStyle = '#6b6f78';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ── palette (fixed colours + median cut for the avatar) ───────────────────
function medianCut(colorCounts, want) {
  // colorCounts: Map(rgbInt -> count)
  let boxes = [{ items: [...colorCounts.entries()].map(([k, n]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, n]) }];
  const range = (box) => {
    let mn = [255, 255, 255], mx = [0, 0, 0];
    for (const it of box.items) for (let c = 0; c < 3; c++) { if (it[c] < mn[c]) mn[c] = it[c]; if (it[c] > mx[c]) mx[c] = it[c]; }
    const r = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    box.axis = r[0] >= r[1] && r[0] >= r[2] ? 0 : (r[1] >= r[2] ? 1 : 2);
    box.score = Math.max(...r) * Math.sqrt(box.items.length);
  };
  boxes.forEach(range);
  while (boxes.length < want) {
    let bi = -1, best = 0;
    boxes.forEach((b, i) => { if (b.items.length > 1 && b.score > best) { best = b.score; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi];
    b.items.sort((p, q) => p[b.axis] - q[b.axis]);
    const total = b.items.reduce((a, it) => a + it[3], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.items.length - 1; i++) { acc += b.items[i][3]; if (acc >= total / 2) { cut = i + 1; break; } cut = i + 1; }
    const A = { items: b.items.slice(0, cut) }, B = { items: b.items.slice(cut) };
    range(A); range(B);
    boxes.splice(bi, 1, A, B);
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, w = 0;
    for (const it of b.items) { r += it[0] * it[3]; g += it[1] * it[3]; bl += it[2] * it[3]; w += it[3]; }
    return [Math.round(r / w), Math.round(g / w), Math.round(bl / w)];
  });
}

function quantizeFrames(rgbaFrames, pixelCount) {
  const fixed = [CV.BG, [255, 255, 255], [217, 219, 224], [107, 111, 120], ...COLORS];
  const counts = new Map();
  const stride = 3;
  for (let f = 0; f < rgbaFrames.length; f += 4) {
    const d = rgbaFrames[f];
    for (let i = 0; i < pixelCount; i += stride) {
      const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const extra = medianCut(counts, 256 - fixed.length);
  const palette = [...fixed, ...extra].slice(0, 256);

  const cache = new Map();
  const nearest = (key) => {
    const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; best = i; if (d === 0) break; }
    }
    return best;
  };
  const frames = rgbaFrames.map((d) => {
    const out = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      let v = cache.get(key);
      if (v === undefined) { v = nearest(key); cache.set(key, v); }
      out[i] = v;
    }
    return out;
  });
  return { palette, frames };
}

/**
 * slots: [{ num, colorIdx, name, avatarUrl }]   opts: { fetch }
 * Final rotation puts the selected segment's centre exactly at the pointer (angle 0, right side).
 */
async function renderCanvas(mod, { slots, selected }, opts = {}) {
  ensureFont(mod);
  const n = slots.length;
  const seg = TWO_PI / n;
  const avatars = await Promise.all(slots.map((sl) => fetchAvatar(mod, sl.avatarUrl, opts.fetch)));

  const jitter = (((selected * 37 + n * 11) % 21) - 10) / 10 * 0.2 * seg;      // never leaves the segment
  const finalRot = CV.TURNS * TWO_PI - (selected + 0.5) * seg + jitter;

  const canvas = mod.createCanvas(CV.SIZE, CV.SIZE);
  const ctx = canvas.getContext('2d');
  const rgba = [];
  const delays = [];
  let spinCs = 0;
  for (let f = 0; f < CV.FRAMES; f++) {
    const t = f / (CV.FRAMES - 1);
    const rot = finalRot * (1 - Math.pow(1 - t, 2.2));
    drawFrame(mod, ctx, slots, rot, avatars);
    rgba.push(Uint8ClampedArray.from(ctx.getImageData(0, 0, CV.SIZE, CV.SIZE).data));
    const d = f === CV.FRAMES - 1 ? CV.LAST_DELAY_CS : 5 + Math.round(18 * t * t);
    delays.push(d);
    if (f < CV.FRAMES - 1) spinCs += d;
  }
  const { palette, frames } = quantizeFrames(rgba, CV.SIZE * CV.SIZE);
  return {
    buffer: encodeGif(frames, delays, { size: CV.SIZE, palette }),
    spinMs: spinCs * 10, frames: CV.FRAMES, width: CV.SIZE, height: CV.SIZE, finalRot, engine: 'canvas', palette,
  };
}

// ── avatars for the pure-JS wheel (built-in fetch + PNG decoder) ────────────
const pureAvatarCache = new Map();     // url -> { at, data }   data = { id, seg, hub } | null
const AV_TTL_MS = 5 * 60 * 1000, AV_FAIL_TTL_MS = 60 * 1000;

async function loadPureAvatar(url, fetchImpl = globalThis.fetch) {
  if (!url) return null;
  const hit = pureAvatarCache.get(url);
  if (hit && Date.now() - hit.at < (hit.data ? AV_TTL_MS : AV_FAIL_TTL_MS)) return hit.data;
  let data = null;
  try {
    if (typeof fetchImpl !== 'function') throw new Error('no fetch');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    try {
      const res = await fetchImpl(url, { signal: ctl.signal });
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
      const img = png.decodePng(Buffer.from(await res.arrayBuffer()));
      if (img) {
        data = {
          id: url.replace(/[^A-Za-z0-9]/g, '').slice(-24),
          seg: avatarIndices(png.circleAvatar(img, AV_SEG)),
          hub: avatarIndices(png.circleAvatar(img, AV_HUB)),
        };
      }
    } finally { clearTimeout(timer); }
  } catch (_) { data = null; }
  if (pureAvatarCache.size > 300) pureAvatarCache.clear();
  pureAvatarCache.set(url, { at: Date.now(), data });
  return data;
}

// ── public API ──────────────────────────────────────────────────────────────
/** Async: canvas wheel when available, otherwise the pure-JS one. Never throws because of a missing module. */
async function render(args, opts = {}) {
  const { slots, selected } = args || {};
  if (!Array.isArray(slots) || slots.length < 2 || slots.length > 12) throw new Error('wheel: need 2–12 slots');
  if (!(selected >= 0 && selected < slots.length)) throw new Error('wheel: bad selected index');
  const mod = loadCanvas();
  if (mod) {
    try { return await renderCanvas(mod, { slots, selected }, opts); }
    catch (err) { console.error('[Wheel] canvas render failed, using the simple wheel:', err.message); }
  }
  let avatars = null;
  try { avatars = await Promise.all(slots.map((sl) => loadPureAvatar(sl.avatarUrl, opts.fetch))); } catch (_) { avatars = null; }
  return { ...renderPure({ slots, selected, avatars }), engine: 'pure' };
}

module.exports = {
  render, renderPure, renderCanvas, frameIndices, encodeGif, lzw, COLORS, PALETTE, SIZE, CX, CY, R_SEG, FRAMES,
  CANVAS: CV, loadCanvas, AV_PALETTE, AV_SEG, AV_HUB, AV_SEG_R, loadPureAvatar, _setCanvasForTest, cleanName,
};
