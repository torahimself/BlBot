'use strict';
// The /profile picture.
//   header   avatar · name · featured title · about-me · coins
//   tiles    time in voice · characters typed
//   progress next voice title · next typing title        (layout "full")
//   shelf    every title earned (milestone titles, gold-framed event titles)

const R = require('./render');
const themes = require('./themes');
const settings = require('../economy/engine/settings');
const fmt = require('../economy/engine/format');
const views = require('../economy/engine/views');

const W = 1000;
const hexOfNum = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
const GOLD = '#f5c518';
const GAME_COLOR = '#2dd4bf';

/** Everything the card shows, as plain data (also used by the tests). */
function model(data, prefs) {
  const owned = data.titles
    .map((t) => ({ id: t.titleId, earnedAt: t.earnedAt, info: views.titleInfo(t.titleId) }))
    .filter((x) => x.info);
  const titles = owned.map((x) => ({
    id: x.id, name: x.info.name, emoji: x.info.emoji, kind: x.info.kind,
    rank: x.info.kind === 'event' ? 100 + x.earnedAt / 1e13 : x.info.kind === 'game' ? 0.5 + x.earnedAt / 1e14 : x.info.n,
    color: x.info.kind === 'event' ? GOLD : x.info.kind === 'game' ? GAME_COLOR : hexOfNum(fmt.tierStyle(x.info.n || 1).color),
    sub: x.info.kind === 'event' ? `${x.info.event.name} · ${x.info.tier.label}`
      : x.info.kind === 'game' ? `Game badge · ${x.info.hint}`
      : `${(settings.milestones[x.info.track] || {}).label || 'Title'} ${x.info.n ? fmt.roman(x.info.n) : ''}`.trim(),
  })).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

  const featured = titles.find(t => t.id === prefs.featured) || titles[0] || null;

  const tracks = ['voice', 'text'].map((key) => {
    const def = settings.milestones[key];
    const total = key === 'voice' ? data.voiceMinutes : data.chars;
    const done = def.tiers.filter(t => total >= t.threshold).length;
    const next = def.tiers[done] || null;
    const prev = done ? def.tiers[done - 1].threshold : 0;
    return {
      key, label: def.label, icon: def.icon, total, done, count: def.tiers.length, next,
      frac: next ? (total - prev) / (next.threshold - prev) : 1,
      valueText: fmt.trackValueText(key, total), nextText: next ? fmt.trackValueText(key, next.threshold) : '',
    };
  });
  return { coins: data.balance, chars: data.chars, voiceMinutes: data.voiceMinutes, titles, featured, tracks };
}

/** Flows the title chips into at most two rows; what does not fit becomes «+N more». */
async function layoutShelf(g, titles, P, L, Rr) {
  const ch = 42, maxRows = 2, gapX = 10, gapY = 10;
  const items = [];
  for (const t of titles) {
    const img = await R.emoji(t.emoji);
    const spec = { h: ch, label: t.name, img, size: 20, fill: R.rgba(t.color, 0.16), stroke: t.kind === 'event' ? GOLD : R.rgba(t.color, 0.75), color: P.text };
    items.push({ spec, w: R.chip(g, { ...spec, x: 0, y: 0, draw: false }) });
  }
  const placed = []; let x = L, row = 0;
  for (const it of items) {
    if (x + it.w > Rr && x > L) { row++; x = L; }
    if (row >= maxRows) break;
    placed.push({ it, x, row }); x += it.w + gapX;
  }
  let more = null;
  if (placed.length < items.length) {
    const label = () => `+${items.length - placed.length} more`;
    const mw = () => R.measure(g, label(), 20, true) + 28;
    while (placed.length > 1) {
      const last = placed[placed.length - 1];
      if (last.row === maxRows - 1 && last.x + last.it.w + gapX + mw() <= Rr) break;
      placed.pop();
    }
    const last = placed[placed.length - 1];
    more = { x: last.x + last.it.w + gapX, row: last.row, label: label() };
  }
  const rows = placed.length ? Math.max(...placed.map(p => p.row), more ? more.row : 0) + 1 : 0;
  return { placed, more, rows, ch, gapY, height: rows ? rows * ch + (rows - 1) * gapY : 0 };
}

/**
 * @param {{name:string, avatar:object|null, data:object, prefs:object}} o   avatar = a loaded canvas Image or null
 * @returns {Promise<Buffer>} PNG
 */
async function render({ name, avatar, data, prefs }) {
  const m = model(data, prefs);
  const theme = themes.themeOf(prefs.theme);
  const accent = themes.accentOf(prefs);
  const P = themes.palette(theme, accent);
  const compact = prefs.layout === 'compact';
  const PAD = 26;
  const L = PAD + 34, Rr = W - PAD - 34;                // content left / right edges

  // The height follows the content, so nothing is cut off and nothing is wasted.
  const AV = 176, avCy = PAD + 34 + AV / 2 + 6;
  const tilesY = avCy + AV / 2 + 38, tileH = 112;
  const progY = tilesY + tileH + 26;
  const shelfLabelY = compact ? progY : progY + 2 * (76 + 14) + 14;
  const probe = R.newCanvas(10, 10).g;
  const shelf = await layoutShelf(probe, m.titles, P, L, Rr);
  const shelfBodyH = m.titles.length ? shelf.height : 40;
  const H = shelfLabelY + 24 + shelfBodyH + 34 + PAD;

  const { c, g } = R.newCanvas(W, H);
  R.background(g, W, H, theme, accent);
  R.fillRR(g, PAD, PAD, W - PAD * 2, H - PAD * 2, 34, P.panel, P.faint, 2);

  // ── header ──
  const avCx = L + AV / 2;
  R.avatar(g, avatar, avCx, avCy, AV, { shape: prefs.shape, ring: accent, ringW: 7, bg: P.track, label: name, labelColor: P.sub });
  const tx = L + AV + 34;
  const coinW = 270, nameMaxR = Rr - coinW - 24;
  R.text(g, name, tx, avCy - 38, { size: 50, bold: true, color: P.text, maxW: nameMaxR - tx, minSize: 26 });

  // featured title chip (+ where it came from, underneath)
  const cy = avCy - 14;
  let aboutY = cy + 66;
  if (m.featured) {
    const img = await R.emoji(m.featured.emoji);
    R.chip(g, { x: tx, y: cy, h: 46, label: m.featured.name, img, size: 24, fill: R.rgba(accent, 0.2), stroke: accent, color: P.text, maxRight: nameMaxR });
    R.text(g, m.featured.sub, tx + 6, cy + 66, { size: 18, color: P.sub, baseline: 'middle', maxW: nameMaxR - tx });
    aboutY = cy + 106;
  } else {
    R.text(g, 'No titles yet — chat and hang out in voice!', tx, cy + 23, { size: 21, color: P.sub, baseline: 'middle', maxW: nameMaxR - tx });
  }
  if (prefs.about) {
    const lines = R.wrap(g, prefs.about, Rr - tx, 23, 2);
    lines.forEach((ln, i) => R.text(g, ln, tx, aboutY + i * 30, { size: 23, color: P.text, maxW: Rr - tx }));
  }

  // coins box (top right)
  const cbX = Rr - coinW, cbY = PAD + 38, cbH = 128;
  R.fillRR(g, cbX, cbY, coinW, cbH, 24, R.rgba(accent, 0.16), R.rgba(accent, 0.55), 2);
  R.drawEmoji(g, await R.emoji('💰'), cbX + 18, cbY + 14, 40);
  R.text(g, 'COINS', cbX + 70, cbY + 34, { size: 19, bold: true, color: P.sub, baseline: 'middle' });
  R.text(g, fmt.num(m.coins), cbX + coinW - 20, cbY + 96, { size: 46, bold: true, color: P.text, align: 'right', maxW: coinW - 40, minSize: 24 });

  // ── tiles ──
  const gap = 22, tw = (Rr - L - gap) / 2;
  const tiles = [
    { icon: '🎧', label: 'TIME IN VOICE', value: fmt.minutesText(m.voiceMinutes) },
    { icon: '⌨️', label: 'CHARACTERS TYPED', value: fmt.num(m.chars) },
  ];
  for (let i = 0; i < 2; i++) {
    const x = L + i * (tw + gap);
    R.fillRR(g, x, tilesY, tw, tileH, 24, P.tile, P.faint, 2);
    R.drawEmoji(g, await R.emoji(tiles[i].icon), x + 22, tilesY + 28, 56);
    R.text(g, tiles[i].label, x + 96, tilesY + 38, { size: 18, bold: true, color: P.sub, baseline: 'middle' });
    R.text(g, tiles[i].value, x + 96, tilesY + 84, { size: 42, bold: true, color: P.text, maxW: tw - 120, minSize: 22 });
  }

  // ── progress (full layout) ──
  let y = progY;
  if (!compact) {
    for (const t of m.tracks) {
      const rowH = 76, valW = 270;
      R.fillRR(g, L, y, Rr - L, rowH, 20, P.tile, P.faint, 2);
      R.drawEmoji(g, await R.emoji(t.next ? t.next.emoji : '🏆'), L + 18, y + 16, 44);
      const head = t.next ? `Next ${t.label.toLowerCase()} title: ${t.next.name}` : `${t.label} track complete`;
      R.text(g, head, L + 76, y + 28, { size: 22, bold: true, color: P.text, baseline: 'middle', maxW: Rr - L - 76 - 90 });
      R.text(g, `${t.done}/${t.count}`, Rr - 20, y + 28, { size: 20, bold: true, color: accent, align: 'right', baseline: 'middle' });
      R.bar(g, L + 76, y + 46, Rr - L - 76 - valW - 16, 14, t.frac, accent, P.track);
      R.text(g, t.next ? `${t.valueText} / ${t.nextText}` : t.valueText, Rr - 20, y + 53, { size: 19, color: P.sub, align: 'right', baseline: 'middle', maxW: valW });
      y += rowH + 14;
    }
  }

  // ── titles shelf ──
  R.text(g, `TITLES · ${m.titles.length}`, L + 4, shelfLabelY + 6, { size: 18, bold: true, color: P.sub, baseline: 'middle' });
  const sy = shelfLabelY + 24;
  if (!m.titles.length) {
    R.text(g, 'Titles you earn from milestones and events appear here.', L + 4, sy + 22, { size: 20, color: P.sub, baseline: 'middle' });
  } else {
    for (const p of shelf.placed) R.chip(g, { ...p.it.spec, x: p.x, y: sy + p.row * (shelf.ch + shelf.gapY) });
    if (shelf.more) R.chip(g, { x: shelf.more.x, y: sy + shelf.more.row * (shelf.ch + shelf.gapY), h: shelf.ch, label: shelf.more.label, size: 20, fill: P.faint, stroke: null, color: P.sub });
  }
  return R.toPng(c);
}

module.exports = { render, model, layoutShelf, W };
