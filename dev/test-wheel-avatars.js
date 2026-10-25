'use strict';
// Pure-JS wheel with avatars + PNG decoder.   Run: node dev/test-wheel-avatars.js
process.env.BL_ECONOMY_DB = ':memory:';
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const png = require('../utils/games/png.js');
const wheel = require('../utils/games/wheel.js');
wheel._setCanvasForTest(null);          // force the pure-JS engine (no @napi-rs/canvas)

let passed = 0, failed = 0;
const ok = (c, n, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

// ── PNG encoder (test only) ─────────────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function makePng(w, h, ctype, pix, { filters = [0], depth = 8, interlace = 0, plte = null, trns = null } = {}) {
  const ch = CH[ctype], stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) { const v = pix(x, y); for (let c = 0; c < ch; c++) row[x * ch + c] = v[c]; }
    rows.push(row);
  }
  for (let y = 0; y < h; y++) {
    const ft = filters[y % filters.length];
    raw[y * (stride + 1)] = ft;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? rows[y][x - ch] : 0, b = y ? rows[y - 1][x] : 0, c = x >= ch && y ? rows[y - 1][x - ch] : 0;
      let pred = 0;
      if (ft === 1) pred = a; else if (ft === 2) pred = b; else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); }
      raw[y * (stride + 1) + 1 + x] = (rows[y][x] - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = ctype; ihdr[12] = interlace;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (plte) parts.push(chunk('PLTE', Buffer.from(plte)));
  if (trns) parts.push(chunk('tRNS', Buffer.from(trns)));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ── PNG decoder ─────────────────────────────────────────────────────────────
console.log('\nPNG decoder');
const grad = (x, y) => [(x * 7 + y * 3) & 255, (x * 2 + y * 9) & 255, (x * 5 + y * 5) & 255, 200 + ((x + y) & 31)];
for (const [ct, label] of [[2, 'RGB'], [6, 'RGBA'], [0, 'grey'], [4, 'grey+alpha']]) {
  const p = makePng(20, 17, ct, (x, y) => { const g = grad(x, y); return ct === 0 ? [g[0]] : ct === 4 ? [g[0], g[3]] : ct === 2 ? g.slice(0, 3) : g; }, { filters: [0, 1, 2, 3, 4] });
  const d = png.decodePng(p);
  let good = !!d && d.width === 20 && d.height === 17;
  if (good) for (let y = 0; y < 17 && good; y++) for (let x = 0; x < 20; x++) {
    const g = grad(x, y), i = (y * 20 + x) * 4;
    const exp = ct === 0 || ct === 4 ? [g[0], g[0], g[0]] : g.slice(0, 3);
    const alpha = ct === 4 || ct === 6 ? g[3] : 255;
    if (d.rgba[i] !== exp[0] || d.rgba[i + 1] !== exp[1] || d.rgba[i + 2] !== exp[2] || d.rgba[i + 3] !== alpha) { good = false; break; }
  }
  ok(good, `${label}: every pixel decodes exactly (filters 0–4 mixed)`);
}
{
  const p = makePng(4, 4, 3, (x, y) => [(x + y) % 3], { plte: [255, 0, 0, 0, 255, 0, 0, 0, 255], trns: [255, 128] });
  const d = png.decodePng(p);
  ok(d && d.rgba[0] === 255 && d.rgba[1] === 0 && d.rgba[4] === 0 && d.rgba[5] === 255 && d.rgba[7] === 128 && d.rgba[11] === 255, 'palette PNG with tRNS');
}
ok(png.decodePng(makePng(8, 8, 2, () => [1, 2, 3], { interlace: 1 })) === null, 'interlaced PNG → null (fallback)');
ok(png.decodePng(Buffer.from('not a png at all, definitely not')) === null, 'garbage → null, no throw');
ok(png.decodePng(null) === null, 'null → null');
{
  const p = makePng(64, 64, 2, () => [200, 30, 30]);
  const c = png.circleAvatar(png.decodePng(p), 20);
  ok(c.mask[0] === 0 && c.mask[10 * 20 + 10] === 1 && c.rgb[(10 * 20 + 10) * 3] === 200, 'circle avatar: corners masked, centre keeps colour');
}

// ── Wheel with avatars ──────────────────────────────────────────────────────
console.log('\nWheel GIF with avatars (pure JS engine)');
const AVCOL = [[255, 255, 0], [0, 255, 255], [255, 0, 255], [0, 255, 0], [255, 102, 0], [153, 255, 0], [255, 0, 102], [0, 153, 255], [204, 0, 255], [255, 204, 102], [102, 255, 204], [255, 153, 153]];
const urlOf = (i) => `https://cdn.test/avatars/${i}.png`;
const files = new Map();
for (let i = 0; i < 12; i++) files.set(urlOf(i), makePng(64, 64, 2, () => AVCOL[i]));
const okFetch = async (url) => files.has(url) ? ({ ok: true, status: 200, arrayBuffer: async () => { const b = files.get(url); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }) : ({ ok: false, status: 404 });
const mkSlots = (n, withUrl = true) => Array.from({ length: n }, (_, i) => ({ num: i + 1, colorIdx: i, name: 'p' + i, avatarUrl: withUrl ? urlOf(i) : null }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wheel-'));
const havePy = (() => { try { execFileSync('python3', ['-I', '-c', 'import PIL']); return true; } catch (_) { return false; } })();
function inspect(buf, name) {
  const f = path.join(tmp, name + '.gif');
  fs.writeFileSync(f, buf);
  if (!havePy) return null;
  const code = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); n = im.n_frames
im.seek(n - 1); rgb = im.convert('RGB')
im.seek(0); first = im.convert('RGB')
print(json.dumps({'frames': n, 'hub': rgb.getpixel((112, 112)), 'under': rgb.getpixel((112, 70)), 'hub0': first.getpixel((112, 112))}))`;
  return JSON.parse(execFileSync('python3', ['-I', '-c', code, f]).toString());
}
const near = (a, b, t = 40) => Math.abs(a[0] - b[0]) < t && Math.abs(a[1] - b[1]) < t && Math.abs(a[2] - b[2]) < t;
const segRgb = (idx) => wheel.COLORS[idx];

(async () => {
  for (const [n, sel] of [[3, 0], [5, 3], [8, 7], [12, 5], [12, 11]]) {
    const t0 = Date.now();
    const g = await wheel.render({ slots: mkSlots(n), selected: sel }, { fetch: okFetch });
    const ms = Date.now() - t0;
    ok(g.engine === 'pure' && g.avatars === true, `${n} players: pure engine used avatars`);
    ok(g.buffer.subarray(0, 6).toString() === 'GIF89a', `${n} players: GIF89a header`);
    ok(ms < 1500, `${n} players: generated in ${ms} ms (< 1.5 s)`);
    if (n === 12) ok(g.buffer.length < 250 * 1024, `12 players: ${(g.buffer.length / 1024).toFixed(0)} KB (< 250 KB)`);
    const info = inspect(g.buffer, `w${n}_${sel}`);
    if (info) {
      ok(info.frames === g.frames, `${n}/${sel}: PIL opens it, ${info.frames} frames`);
      ok(near(info.hub, AVCOL[sel]), `${n}/${sel}: final centre avatar is the selected player's`, JSON.stringify(info.hub));
      ok(near(info.under, segRgb(sel), 12), `${n}/${sel}: segment under the pointer is the selected player's`, JSON.stringify(info.under));
      ok(sel === 0 || !near(info.hub0, AVCOL[sel]), `${n}/${sel}: the centre cycles (frame 0 shows another player)`, JSON.stringify(info.hub0));
    } else console.log('  (python3/PIL not available — pixel checks skipped)');
  }

  // Noisy photo-like avatars: size and speed.
  const noisy = makePng(64, 64, 2, (x, y) => [(x * 4 + (x * y) % 37) & 255, (y * 4 + (x * 13) % 41) & 255, ((x + y) * 2 + (y * 7) % 29) & 255]);
  const nf = async () => ({ ok: true, status: 200, arrayBuffer: async () => noisy.buffer.slice(noisy.byteOffset, noisy.byteOffset + noisy.length) });
  const slots = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, colorIdx: i, name: 'x', avatarUrl: `https://cdn.test/noisy/${i}.png` }));
  const t1 = Date.now();
  const gn = await wheel.render({ slots, selected: 4 }, { fetch: nf });
  ok(gn.avatars && gn.buffer.length < 250 * 1024 && Date.now() - t1 < 1500, `12 noisy photo avatars: ${(gn.buffer.length / 1024).toFixed(0)} KB, ${Date.now() - t1} ms`);

  // Cache: same input → same buffer instantly.
  const a = await wheel.render({ slots: mkSlots(6), selected: 2 }, { fetch: okFetch });
  const t2 = Date.now();
  const b = await wheel.render({ slots: mkSlots(6), selected: 2 }, { fetch: okFetch });
  ok(a.buffer === b.buffer && Date.now() - t2 < 50, 'second render of the same wheel comes from the cache');

  // Fallbacks never throw.
  const bad = await wheel.render({ slots: mkSlots(4).map((s, i) => ({ ...s, avatarUrl: 'https://cdn.test/missing/' + i })), selected: 1 }, { fetch: okFetch });
  ok(bad.engine === 'pure' && bad.avatars === false && bad.buffer.subarray(0, 6).toString() === 'GIF89a', '404 avatars → plain numbered wheel');
  const boom = await wheel.render({ slots: mkSlots(4).map((s, i) => ({ ...s, avatarUrl: 'https://cdn.test/boom/' + i })), selected: 2 }, { fetch: async () => { throw new Error('network down'); } });
  ok(boom.avatars === false && boom.buffer.length > 1000, 'fetch throwing → plain wheel, no exception');
  const hang = Date.now();
  const slow = await wheel.render({ slots: mkSlots(3).map((s, i) => ({ ...s, avatarUrl: 'https://cdn.test/slow/' + i })), selected: 0 },
    { fetch: (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  ok(slow.avatars === false && Date.now() - hang < 4500, `hanging fetch aborts after ~3 s (${Date.now() - hang} ms)`);
  const nopng = await wheel.render({ slots: mkSlots(3).map((s, i) => ({ ...s, avatarUrl: 'https://cdn.test/txt/' + i })), selected: 0 },
    { fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from('<html>no png</html>')).buffer }) });
  ok(nopng.avatars === false, 'non-PNG response (e.g. webp/html) → plain wheel');
  const mixed = await wheel.render({ slots: mkSlots(4).map((s, i) => ({ ...s, avatarUrl: i % 2 ? null : urlOf(i) })), selected: 0 }, { fetch: okFetch });
  ok(mixed.avatars === true, 'some players without an avatar still render the rest');
  const plain = await wheel.render({ slots: mkSlots(4, false), selected: 1 });
  ok(plain.engine === 'pure' && plain.avatars === false, 'no avatar URLs at all → original numbered wheel');

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
