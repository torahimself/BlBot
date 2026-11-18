'use strict';
// BlBot's own icon set — pixel art drawn by code (see ./pixel.js), so it is original (no stock emoji).
// Every icon is a 24x24 sprite: dark outline, drop shadow, light/mid/dark shading; rarity adds sparkles.
//
//   • On the picture cards a title's `emoji` can be "ico:<name>"; render.js's emoji() paints it from here.
//   • In plain Discord text (embeds, menus) a custom picture cannot be shown unless it is a real Discord emoji:
//     run `node dev/make-icons.js`, upload the PNGs from assets/icons/ as emojis (Server Settings → Emoji, or the
//     bot's Developer Portal → Emoji), then paste their ids into assets/icons/emoji-ids.json. Until then the text
//     simply has no emoji for that title (never a stock one).

const fs = require('fs');
const path = require('path');

const PREFIX = 'ico:';
const isIcon = (e) => typeof e === 'string' && e.startsWith(PREFIX);
const nameOf = (e) => String(e).slice(PREFIX.length);

const ICONS = {
  // name:       [sprite,     main,      accent,    rarity]
  // seasonal shop titles
  leafwalk:  ['leaf',     '#ff9f2e', '#c2410c', 'bronze'],
  harvest:   ['moon',     '#ffd98a', '#b45309', 'silver'],
  emberkeep: ['flame',    '#ff6a2b', '#b91c1c', 'gold'],
  sovereign: ['crown',    '#fbbf24', '#7c2d12', 'legend'],
  // streak badges
  st_spark:  ['star',     '#ffd166', '#f59e0b', 'bronze'],
  st_flame:  ['flame',    '#ff9f1c', '#d00000', 'bronze'],
  st_comet:  ['comet',    '#6ec8ff', '#4f46e5', 'silver'],
  st_moon:   ['crescent', '#a5b4fc', '#4338ca', 'silver'],
  st_bolt:   ['bolt',     '#ffe14d', '#d97706', 'gold'],
  st_ring:   ['ring',     '#34d399', '#065f46', 'gold'],
  st_wings:  ['wings',    '#fff1d6', '#f59e0b', 'legend'],
  st_sun:    ['sun',      '#ff9a1f', '#dc2626', 'legend'],
  // game badges
  g_medal:   ['medal',    '#ef4444', '#2563eb', 'bronze'],
  g_star:    ['star',     '#7cc4ff', '#1d4ed8', 'silver'],
  g_arena:   ['arena',    '#c4b5fd', '#7c3aed', 'gold'],
  g_trophy:  ['trophy',   '#fde68a', '#b45309', 'legend'],
  g_party:   ['confetti', '#ff6fb5', '#38bdf8', 'bronze'],
  g_pad:     ['pad',      '#34d399', '#047857', 'silver'],
  g_flag:    ['flag',     '#f43f5e', '#9f1239', 'silver'],
  g_compass: ['compass',  '#67e8f9', '#0e7490', 'silver'],
  g_quill:   ['quill',    '#c084fc', '#6b21a8', 'silver'],
  g_wheel:   ['wheel',    '#fdba74', '#c2410c', 'silver'],
  g_masks:   ['masks',    '#f472b6', '#7c3aed', 'silver'],
  g_bolt:    ['bolt',     '#7df9a8', '#0d9488', 'silver'],
  g_chain:   ['chain',    '#a7f3d0', '#0f766e', 'silver'],
  g_beads:   ['beads',    '#38bdf8', '#f472b6', 'silver'],
  g_target:  ['target',   '#ef4444', '#9f1239', 'gold'],
  // shop colours / backgrounds (menu icons)
  s_copper:  ['coin',     '#e08a4e', '#2a8c80', 'silver'],
  s_ink:     ['drop',     '#e11d48', '#4c0519', 'silver'],
  s_slick:   ['slick',    '#a855f7', '#14b8a6', 'silver'],
  s_lantern: ['lantern',  '#fb923c', '#9a3412', 'silver'],
  s_veins:   ['leaf',     '#2dd4bf', '#115e59', 'silver'],
  s_eclipse: ['eclipse',  '#fbbf24', '#451a03', 'gold'],
  s_glass:   ['gem',      '#f472b6', '#4338ca', 'silver'],
  s_topo:    ['topo',     '#f5d78a', '#92400e', 'silver'],
  s_season:  ['leaf',     '#ffb347', '#b45309', 'gold'],
  // gothic / cute extras — not used by the bot yet, ready for titles, badges and shop items
  x_heart:   ['heart',    '#ff5fa2', '#c01a63', 'bronze'],
  x_heartd:  ['heartdark', '#4a3560', '#ff5fa2', 'bronze'],
  x_skull:   ['skull',    '#f3e8d2', '#7c3aed', 'silver'],
  x_bat:     ['bat',      '#7c3aed', '#c084fc', 'silver'],
  x_cauldron:['cauldron', '#4ade80', '#166534', 'silver'],
  x_potion:  ['potion',   '#e879f9', '#7e22ce', 'bronze'],
  x_hat:     ['hat',      '#8b5cf6', '#5b21b6', 'silver'],
  x_orb:     ['orb',      '#c084fc', '#4c1d95', 'gold'],
  x_ghost:   ['ghost',    '#ffffff', '#f472b6', 'bronze'],
  x_cat:     ['cat',      '#4b3a63', '#f472b6', 'silver'],
  x_candle:  ['candle',   '#f3e8d2', '#fb923c', 'bronze'],
  x_shroom:  ['shroom',   '#ef4444', '#fff', 'bronze'],
  x_rose:    ['rose',     '#e11d48', '#9f1239', 'silver'],
  x_coffin:  ['coffin',   '#a0602a', '#5b3416', 'silver'],
  x_dagger:  ['dagger',   '#c4cfe2', '#be123c', 'gold'],
  x_eye:     ['eye',      '#a855f7', '#4c1d95', 'gold'],
  x_book:    ['book',     '#7c3aed', '#4c1d95', 'gold'],
};
const names = () => Object.keys(ICONS);
const has = (e) => isIcon(e) && !!ICONS[nameOf(e)];

// ── the painter: a pixel sprite scaled up with no smoothing ───────────────────────────────────────────────
const pixel = require('./pixel.js');
let cv = null;
const lib = () => cv || (cv = require('@napi-rs/canvas'));
const small = new Map();
const pathMod = require('path');
const SRC_DIR = pathMod.join(__dirname, '..', '..', 'assets', 'icons', 'src');
/** A 32x32 pack sprite (assets/icons/src/<name>.png) with rarity sparkles, or null if there is none. */
let packRaw = null;
function fromPack(name, tier) {
  if (!packRaw) { try { packRaw = JSON.parse(fs.readFileSync(pathMod.join(SRC_DIR, 'pack.json'), 'utf8')); } catch { packRaw = {}; } }
  if (!packRaw[name]) return null;
  const cv = lib(), c = cv.createCanvas(32, 32), g = c.getContext('2d');
  const im = g.createImageData(32, 32); im.data.set(Buffer.from(packRaw[name], 'base64')); g.putImageData(im, 0, 0);
  const spark = (cx, cy) => { g.fillStyle = '#fff6c4'; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillRect(cx + dx, cy + dy, 1, 1); g.fillStyle = '#ffffff'; g.fillRect(cx, cy, 1, 1); };
  if (tier === 'silver' || tier === 'gold' || tier === 'legend') spark(29, 3);
  if (tier === 'gold' || tier === 'legend') spark(3, 29);
  if (tier === 'legend') spark(3, 4);
  return c;
}
function sprite(name) {
  if (small.has(name)) return small.get(name);
  const def = ICONS[name]; let c = null;
  if (def) {
    c = fromPack(name, def[3]);
    if (!c) {
      const px = pixel.sprite(def[0], def[1], def[2], def[3]);
      if (px) { c = lib().createCanvas(pixel.N, pixel.N); const g = c.getContext('2d'); const im = g.createImageData(pixel.N, pixel.N); for (let y = 0; y < pixel.N; y++) for (let x = 0; x < pixel.N; x++) { const p = px[y][x]; if (!p) continue; const i = (y * pixel.N + x) * 4; im.data[i] = p[0]; im.data[i + 1] = p[1]; im.data[i + 2] = p[2]; im.data[i + 3] = p[3]; } g.putImageData(im, 0, 0); }
    }
  }
  small.set(name, c); return c;
}
/** Paints icon `name` onto canvas context g inside the square (x, y, size), crisp (nearest-neighbour). */
function paint(g, name, x, y, size) {
  const c = sprite(name); if (!c) return false;
  const was = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
  g.drawImage(c, x, y, size, size);
  g.imageSmoothingEnabled = was;
  return true;
}

// ── Discord side: a real custom emoji, if the owner uploaded one and listed its id ─
let idMap = null;
function ids() {
  if (idMap) return idMap;
  idMap = {};
  for (const dir of ['assets', 'assests']) {
    try { idMap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', dir, 'icons', 'emoji-ids.json'), 'utf8')); break; } catch (_) { /* try the other spelling */ }
  }
  return idMap;
}
/** For plain Discord text: "<:name:id>" when mapped, '' when not. Stock emoji pass through unchanged. */
function text(e) {
  if (!isIcon(e)) return e || '';
  const id = ids()[nameOf(e)];
  return id ? `<:bl_${nameOf(e).replace(/[^a-z0-9_]/gi, '_')}:${id}>` : '';
}
/** For a select-menu / button .setEmoji(): { id, name } when mapped, undefined when not (so nothing is shown). */
function component(e) {
  if (!isIcon(e)) return e || undefined;
  const id = ids()[nameOf(e)];
  return id ? { id: String(id), name: `bl_${nameOf(e).replace(/[^a-z0-9_]/gi, '_')}` } : undefined;
}
const _resetIds = () => { idMap = null; };

module.exports = { isIcon, nameOf, has, names, paint, text, component, ICONS, PREFIX, _resetIds };
