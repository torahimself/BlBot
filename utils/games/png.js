'use strict';
// Minimal PNG decoder (built-in zlib only): 8-bit greyscale / RGB / palette /
// grey+alpha / RGBA, non-interlaced, all five filters. Anything else returns
// null so callers can fall back. Also: circular downscale for avatars.

const zlib = require('zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @returns {{width:number,height:number,rgba:Uint8Array}|null} */
function decodePng(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) return null;
    let pos = 8, width = 0, height = 0, depth = 0, ctype = -1, interlace = 0;
    let plte = null, trns = null;
    const idat = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      const data = buf.subarray(pos + 8, pos + 8 + len);
      pos += 12 + len;
      if (type === 'IHDR') {
        width = data.readUInt32BE(0); height = data.readUInt32BE(4);
        depth = data[8]; ctype = data[9]; interlace = data[12];
      } else if (type === 'PLTE') plte = data;
      else if (type === 'tRNS') trns = data;
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
    }
    if (depth !== 8 || interlace !== 0 || !(ctype in CHANNELS) || !width || !height) return null;
    if (width > 4096 || height > 4096) return null;
    if (ctype === 3 && !plte) return null;
    const ch = CHANNELS[ctype];
    const stride = width * ch;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    if (raw.length < (stride + 1) * height) return null;

    const px = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const ft = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const row = y * stride, prev = row - stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? px[row + x - ch] : 0;
        const b = y > 0 ? px[prev + x] : 0;
        const c = x >= ch && y > 0 ? px[prev + x - ch] : 0;
        let v = raw[src + x];
        if (ft === 1) v += a;
        else if (ft === 2) v += b;
        else if (ft === 3) v += (a + b) >> 1;
        else if (ft === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        } else if (ft !== 0) return null;
        px[row + x] = v & 255;
      }
    }

    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      let r, g, b, a = 255;
      const o = i * ch;
      if (ctype === 0) { r = g = b = px[o]; }
      else if (ctype === 2) { r = px[o]; g = px[o + 1]; b = px[o + 2]; }
      else if (ctype === 3) {
        const k = px[o];
        r = plte[k * 3] || 0; g = plte[k * 3 + 1] || 0; b = plte[k * 3 + 2] || 0;
        if (trns && k < trns.length) a = trns[k];
      } else if (ctype === 4) { r = g = b = px[o]; a = px[o + 1]; }
      else { r = px[o]; g = px[o + 1]; b = px[o + 2]; a = px[o + 3]; }
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
    }
    return { width, height, rgba };
  } catch (_) { return null; }
}

/**
 * Box-filter downscale to a square `size`×`size` (centre-cropped) with a circular
 * mask. Returns { size, rgb: Uint8Array(size*size*3), mask: Uint8Array(size*size) } —
 * mask 1 = inside the circle. Transparent pixels are blended onto `bg`.
 */
function circleAvatar(img, size, bg = [60, 60, 70]) {
  const side = Math.min(img.width, img.height);
  const ox = Math.floor((img.width - side) / 2), oy = Math.floor((img.height - side) / 2);
  const rgb = new Uint8Array(size * size * 3);
  const mask = new Uint8Array(size * size);
  const scale = side / size;
  const rad = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - rad, dy = y + 0.5 - rad;
      if (dx * dx + dy * dy > rad * rad) continue;
      const x0 = Math.floor(ox + x * scale), x1 = Math.max(x0 + 1, Math.floor(ox + (x + 1) * scale));
      const y0 = Math.floor(oy + y * scale), y1 = Math.max(y0 + 1, Math.floor(oy + (y + 1) * scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.rgba[i + 3] / 255;
          r += img.rgba[i] * a + bg[0] * (1 - a);
          g += img.rgba[i + 1] * a + bg[1] * (1 - a);
          b += img.rgba[i + 2] * a + bg[2] * (1 - a);
          n++;
        }
      }
      if (!n) continue;
      const o = (y * size + x);
      rgb[o * 3] = Math.round(r / n); rgb[o * 3 + 1] = Math.round(g / n); rgb[o * 3 + 2] = Math.round(b / n);
      mask[o] = 1;
    }
  }
  return { size, rgb, mask };
}

module.exports = { decodePng, circleAvatar };
