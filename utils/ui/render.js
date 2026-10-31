'use strict';
// Drawing toolkit for the picture cards (/profile, /inventory).
//   • @napi-rs/canvas is OPTIONAL. Without it available() is false and the bot keeps using its text embeds.
//   • The Arabic + Latin font (Cairo, OFL) and the emoji images (Twemoji, CC-BY 4.0) ship inside assets/, so the
//     cards look the same on any host — no system fonts needed.
//   • Everything here is pure drawing: no database, no Discord.

const fs = require('fs');
const path = require('path');

// The folder is «assets», but a misspelt «assests» upload also works.
const ASSETS = ['assets', 'assests']
  .map(n => path.join(__dirname, '..', '..', n))
  .find(d => { try { return require('fs').existsSync(path.join(d, 'fonts')); } catch (_) { return false; } })
  || path.join(__dirname, '..', '..', 'assets');
const FAMILY = 'BLCairo';

let mod;                    // undefined = not tried, null = unavailable
let fontsOk = false;
function canvas() {
  if (mod !== undefined) return mod;
  try { mod = process.env.BL_UI_FORCE_NONE ? null : require('@napi-rs/canvas'); } catch (_) { mod = null; }
  if (mod && !fontsOk) {
    try {
      const a = mod.GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cairo-Regular.ttf'), FAMILY);
      const b = mod.GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cairo-Bold.ttf'), FAMILY);
      fontsOk = !!(a && b);
    } catch (_) { fontsOk = false; }
    if (!fontsOk) console.warn('[UI] could not load assets/fonts — Arabic text may look wrong. Make sure the assets/ folder was uploaded.');
  }
  return mod;
}
const available = () => !!canvas();

// ── emoji (Twemoji SVG → Image, cached) ──────────────────────────────────────
const emojiCache = new Map();
const cpsOf = (e) => [...String(e)].filter(c => c.codePointAt(0) !== 0xfe0f).map(c => c.codePointAt(0).toString(16)).join('-');
async function emoji(e) {
  const key = cpsOf(e);
  if (!key) return null;
  if (emojiCache.has(key)) return emojiCache.get(key);
  let img = null;
  try {
    const file = path.join(ASSETS, 'emoji', key + '.svg');
    if (fs.existsSync(file)) img = await canvas().loadImage(fs.readFileSync(file));
  } catch (_) { img = null; }
  emojiCache.set(key, img);
  return img;
}

// ── avatar download (short timeout; null = draw initials instead) ────────────
async function loadAvatar(url, fetchImpl = globalThis.fetch) {
  if (!url || !canvas() || typeof fetchImpl !== 'function') return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res || !res.ok) return null;
    return await canvas().loadImage(Buffer.from(await res.arrayBuffer()));
  } catch (_) { return null; } finally { clearTimeout(timer); }
}

// ── small helpers ────────────────────────────────────────────────────────────
const ARABIC = /[؀-ۿݐ-ݿ]/;
const isArabic = (s) => { const a = (String(s).match(/[؀-ۿݐ-ݿ]/g) || []).length; const l = (String(s).match(/\p{L}/gu) || []).length; return l > 0 && a / l > 0.5; };
// Cairo has no emoji: an emoji typed in a name / about-me would show as an empty box, so it is left out.
// (The card's own icons are drawn as pictures by drawEmoji().)
const PICTO = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/gu;
const plain = (str) => String(str == null ? '' : str).replace(PICTO, '').replace(/[ \t]{2,}/g, ' ').trim();
const font = (size, bold) => `${bold ? 'bold ' : ''}${Math.round(size)}px ${FAMILY}`;

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
/** Readable text colour on top of a fill. */
function onColor(hex) { const [r, g, b] = hexToRgb(hex); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#12141f' : '#ffffff'; }

function rr(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}
function fillRR(g, x, y, w, h, r, fill, stroke, lw = 2) {
  rr(g, x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}

/**
 * Draws one line of text. opts: size, bold, color, align ('left'|'right'|'center'), maxW (shrinks, then «…»),
 * minSize, baseline ('alphabetic'|'middle'|'top'). Returns the drawn width.
 */
function text(g, str, x, y, o = {}) {
  str = plain(str);
  let size = o.size || 24;
  const min = o.minSize || Math.max(12, size * 0.6);
  g.textBaseline = o.baseline || 'alphabetic';
  g.direction = isArabic(str) ? 'rtl' : 'ltr';
  g.font = font(size, o.bold);
  let w = g.measureText(str).width;
  if (o.maxW) {
    while (w > o.maxW && size > min) { size -= 1; g.font = font(size, o.bold); w = g.measureText(str).width; }
    if (w > o.maxW) {
      const chars = [...str];
      while (chars.length > 1 && g.measureText(chars.join('') + '…').width > o.maxW) chars.pop();
      str = chars.join('').trimEnd() + '…'; w = g.measureText(str).width;
    }
  }
  const align = o.align || 'left';
  g.textAlign = 'left';
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  g.fillStyle = o.color || '#fff';
  g.fillText(str, left, y);
  g.direction = 'ltr';
  return w;
}
function measure(g, str, size, bold) { str = plain(str); g.direction = isArabic(str) ? 'rtl' : 'ltr'; g.font = font(size, bold); const w = g.measureText(String(str)).width; g.direction = 'ltr'; return w; }

/** Word-wraps to at most maxLines lines (the last one gets «…»). */
function wrap(g, str, maxW, size, maxLines, bold) {
  const words = plain(str).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (measure(g, t, size, bold) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && measure(g, last + '…', size, bold) > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last.trimEnd() + '…';
  }
  return lines;
}

function drawEmoji(g, img, x, y, size) { if (img) g.drawImage(img, x, y, size, size); }

function bar(g, x, y, w, h, frac, color, track) {
  frac = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  fillRR(g, x, y, w, h, h / 2, track);
  if (frac > 0) {
    const fw = Math.max(h, w * frac);
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, mix(color, '#ffffff', 0.18)); grad.addColorStop(1, color);
    fillRR(g, x, y, Math.min(w, fw), h, h / 2, grad);
  }
}

/** A pill with an optional emoji and a label. Returns its width (0 when it does not fit in maxRight). */
function chip(g, { x, y, h = 40, label, img, size = 20, fill, stroke, color, bold = true, maxRight, draw = true }) {
  const pad = 14, ico = img ? h - 16 : 0;
  const tw = measure(g, label, size, bold);
  const w = pad + (ico ? ico + 8 : 0) + tw + pad;
  if (maxRight != null && x + w > maxRight) return 0;
  if (draw) {
    fillRR(g, x, y, w, h, h / 2, fill, stroke, 2);
    let cx = x + pad;
    if (ico) { drawEmoji(g, img, cx, y + 8, ico); cx += ico + 8; }
    text(g, label, cx, y + h / 2, { size, bold, color, baseline: 'middle' });
  }
  return w;
}

/** Avatar inside a shape ('circle' | 'rounded' | 'hex') with a ring; without an image: the initial. */
function avatar(g, img, cx, cy, size, { shape = 'circle', ring = '#fff', ringW = 6, bg = '#2b2f4a', label = '?', labelColor = '#ffffffcc' } = {}) {
  const r = size / 2;
  const path = () => {
    g.beginPath();
    if (shape === 'rounded') { rr(g, cx - r, cy - r, size, size, size * 0.24); }
    else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const px = cx + Math.cos(a) * r * 1.04, py = cy + Math.sin(a) * r * 1.04; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); }
    else g.arc(cx, cy, r, 0, Math.PI * 2);
  };
  g.save();
  path(); g.fillStyle = bg; g.fill();
  g.save(); path(); g.clip();
  if (img) g.drawImage(img, cx - r, cy - r, size, size);
  else text(g, [...String(label)][0] || '?', cx, cy + size * 0.02, { size: size * 0.5, bold: true, color: labelColor, align: 'center', baseline: 'middle' });
  g.restore();
  path(); g.strokeStyle = ring; g.lineWidth = ringW; g.stroke();
  g.restore();
}

// ── backgrounds ──────────────────────────────────────────────────────────────
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function background(g, W, H, theme, accent) {
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bg[0]); grad.addColorStop(1, theme.bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.85, H * 0.1, 10, W * 0.85, H * 0.1, W * 0.7);
  glow.addColorStop(0, rgba(accent, theme.dark ? 0.28 : 0.22)); glow.addColorStop(1, rgba(accent, 0));
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const rnd = seeded(7);
  g.save();
  g.strokeStyle = rgba(theme.dark ? '#ffffff' : '#000000', 0.06); g.fillStyle = rgba(theme.dark ? '#ffffff' : '#000000', 0.07); g.lineWidth = 2;
  switch (theme.pattern) {
    case 'grid':
      for (let x = 0; x < W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      break;
    case 'waves':
      for (let k = 0; k < 7; k++) { g.beginPath(); for (let x = 0; x <= W; x += 8) { const y = H * (0.2 + k * 0.12) + Math.sin(x / 70 + k) * 16; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
      break;
    case 'stars':
      for (let i = 0; i < 70; i++) { const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 2.6; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      break;
    case 'web':    // cobweb corner (Halloween)
      for (let a = 0; a <= 6; a++) { const ang = (a / 6) * (Math.PI / 2); g.beginPath(); g.moveTo(W, 0); g.lineTo(W - Math.cos(ang) * 420, Math.sin(ang) * 420); g.stroke(); }
      for (let r = 70; r <= 420; r += 70) { g.beginPath(); for (let a = 0; a <= 6; a++) { const ang = (a / 6) * (Math.PI / 2); const px = W - Math.cos(ang) * r * (a % 2 ? 0.93 : 1), py = Math.sin(ang) * r * (a % 2 ? 0.93 : 1); if (a) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); }
      break;
    case 'diag':
      for (let x = -H; x < W; x += 36) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
      break;
    case 'hex': {
      const s = 34, h = s * Math.sqrt(3);
      for (let row = -1; row < H / h + 1; row++) for (let col = -1; col < W / (s * 3) + 1; col++) {
        const cx = col * s * 3 + (row % 2 ? s * 1.5 : 0), cy = row * h / 2 * 1;
        g.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; const px = cx + Math.cos(a) * s, py = cy + Math.sin(a) * s; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.stroke();
      }
      break;
    }
    default:       // 'dots'
      for (let x = 24; x < W; x += 36) for (let y = 24; y < H; y += 36) { g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}

function newCanvas(W, H) { const c = canvas().createCanvas(W, H); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; return { c, g }; }
function toPng(c) { return c.toBuffer('image/png'); }

module.exports = {
  available, canvas, FAMILY, plain, emoji, cpsOf, loadAvatar, isArabic, font, hexToRgb, rgba, mix, onColor,
  rr, fillRR, text, measure, wrap, drawEmoji, bar, chip, avatar, background, newCanvas, toPng,
};
