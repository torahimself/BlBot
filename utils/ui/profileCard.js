'use strict';
// The /profile picture (dashboard style).
//   header   avatar · name · three title chips · about-me · badge icons · level ring
//   ranks    wealth · voice · typing · streak (position among all members)
//   tiles    coins · voice (+ progress to the next title) · typing (+ progress) · games
//            streak · active days · titles earned · active boost          (layout "full"; "compact" stops after the first row)

const R = require('./render');
const themes = require('./themes');
const settings = require('../economy/engine/settings');
const fmt = require('../economy/engine/format');
const views = require('../economy/engine/views');

const W = 1100;
const hexOfNum = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
const GOLD = '#f5c518';
const GAME_COLOR = '#2dd4bf';
const STREAK_COLOR = '#ff8a1f';
const streaksMod = require('../economy/engine/streaks');
const backgrounds = require('./backgrounds');

/** Everything the card shows, as plain data (also used by the tests). */
function model(data, prefs) {
  const ex = data.extra || {};
  const owned = data.titles
    .map((t) => ({ id: t.titleId, earnedAt: t.earnedAt, info: views.titleInfo(t.titleId) }))
    .filter((x) => x.info);
  const colorOf = (x) => x.info.kind === 'event' ? GOLD : x.info.kind === 'game' ? GAME_COLOR : x.info.kind === 'streak' ? STREAK_COLOR : hexOfNum(fmt.tierStyle(x.info.n || 1).color);
  const rankOf = (x) => x.info.kind === 'event' ? 100 + x.earnedAt / 1e13 : x.info.kind === 'game' ? 0.5 + x.earnedAt / 1e14 : x.info.kind === 'streak' ? 0.3 + x.info.n / 1000 : (x.info.n || 0);
  const subOf = (x) => x.info.kind === 'event' ? `${x.info.event.name} · ${x.info.tier.label}`
    : x.info.kind === 'game' ? `Game badge · ${x.info.hint}`
    : x.info.kind === 'streak' ? `Streak badge · ${x.info.hint}`
    : `${(settings.milestones[x.info.track] || {}).label || 'Title'} ${x.info.n ? fmt.roman(x.info.n) : ''}`.trim();
  const titles = owned.map((x) => ({
    id: x.id, name: x.info.name, emoji: x.info.emoji, kind: x.info.kind, rank: rankOf(x), color: colorOf(x), sub: subOf(x),
  })).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

  // The chips next to the name: the ones the member picked (in the order picked, only titles they own), otherwise the best
  // three (an older single «featured» choice goes first). Everything else becomes a round badge icon.
  const picked = (prefs.chips || []).map(id => titles.find(t => t.id === id)).filter(Boolean);
  const feat = titles.find(t => t.id === prefs.featured);
  const chips = picked.length ? picked.slice(0, 3)
    : (feat ? [feat, ...titles.filter(t => t !== feat)] : titles).slice(0, 3);
  const featured = chips[0] || null;
  const badges = titles.filter(t => !chips.includes(t));

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

  const streak = ex.streak || { current: 0, best: 0, total: 0, doneToday: false };
  const nextBadge = streaksMod.MILESTONES.find(m => m.days > streak.current) || null;
  const level = ex.level || { level: 0, into: 0, need: 60, frac: 0 };
  return {
    coins: data.balance, chars: data.chars, voiceMinutes: data.voiceMinutes, titles, featured, chips, badges, tracks,
    level, ranks: ex.ranks || {}, streak, nextBadge, plays: ex.plays || 0, wins: ex.wins || 0, boost: ex.boost || null,
  };
}

const rankText = (n) => (n ? `#${fmt.num(n)}` : '—');
const leftText = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`; };

/** Four corner brackets, like a game HUD. */
function corners(g, x, y, w, h, len, color, lw) {
  g.save(); g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    g.beginPath(); g.moveTo(cx + dx * len, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * len); g.stroke();
  }
  g.restore();
}

/** The level ring on the right of the header. */
async function levelRing(g, cx, cy, r, lw, lv, accent, P) {
  g.save(); g.lineCap = 'round'; g.lineWidth = lw;
  g.strokeStyle = P.track; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  const frac = Math.max(0, Math.min(1, lv.frac || 0));
  if (frac > 0) {
    const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r); gr.addColorStop(0, R.mix(accent, '#ffffff', 0.35)); gr.addColorStop(1, accent);
    g.strokeStyle = gr; g.shadowColor = accent; g.shadowBlur = 14;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(frac, 0.015)); g.stroke();
  }
  g.restore();
  R.text(g, String(lv.level), cx, cy - 4, { size: 62, bold: true, color: P.text, align: 'center', baseline: 'middle', maxW: r * 1.5 });
  R.text(g, 'LEVEL', cx, cy + 38, { size: 17, bold: true, color: accent, align: 'center', baseline: 'middle' });
  R.text(g, lv.need ? `${fmt.num(lv.into)} / ${fmt.num(lv.need)} XP` : 'MAX', cx, cy + 60, { size: 15, color: P.sub, align: 'center', baseline: 'middle', maxW: r * 1.3, minSize: 11 });
}

/** One stat tile. spec: { icon, label, value, sub?, bar?: {frac, hint} } */
async function tile(g, x, y, w, h, spec, P, accent) {
  R.fillRR(g, x, y, w, h, 20, P.tile, P.faint, 2);
  g.save(); g.strokeStyle = R.rgba(accent, 0.85); g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x + 18, y + 1.5); g.lineTo(x + 46, y + 1.5); g.stroke(); g.restore();      // accent tab on the top edge
  R.drawEmoji(g, await R.emoji(spec.icon), x + w - 52, y + 16, 34);
  R.text(g, spec.label, x + 20, y + 30, { size: 16, bold: true, color: P.sub, baseline: 'middle', maxW: w - 84 });
  const hasLow = !!(spec.sub || spec.bar);
  R.text(g, spec.value, x + 20, y + (hasLow ? 76 : 92), { size: 38, bold: true, color: P.text, maxW: w - 40, minSize: 20 });
  if (spec.bar) {
    R.bar(g, x + 20, y + h - 28, w - 40 - (spec.bar.hint ? 62 : 0), 9, spec.bar.frac, accent, P.track);
    if (spec.bar.hint) R.text(g, spec.bar.hint, x + w - 20, y + h - 23, { size: 15, bold: true, color: P.sub, align: 'right', baseline: 'middle' });
  } else if (spec.sub) {
    R.text(g, spec.sub, x + 20, y + h - 22, { size: 16, color: P.sub, baseline: 'middle', maxW: w - 40 });
  }
}

/**
 * @param {{name:string, avatar:object|null, data:object, prefs:object}} o   avatar = a loaded canvas Image or null
 * @returns {Promise<Buffer>} PNG
 */
async function render({ name, avatar, data, prefs }) {
  const m = model(data, prefs);
  const theme = themes.themeOf(prefs.theme);
  const accent = themes.accentOf(prefs);
  const art = prefs.bg && backgrounds.byId(prefs.bg);
  const P = themes.palette(art ? { ...theme, dark: true } : theme, accent);        // pictures are always dark: keep the text white
  const compact = prefs.layout === 'compact';
  const PAD = 26, L = PAD + 32, Rr = W - PAD - 32;
  const H = compact ? 538 : 676;

  const { c, g } = R.newCanvas(W, H);
  if (!(art && await backgrounds.paint(g, W, H, prefs.bg, accent))) R.background(g, W, H, theme, accent);
  R.fillRR(g, PAD, PAD, W - PAD * 2, H - PAD * 2, 30, art ? 'rgba(6,6,18,0.34)' : P.panel, P.faint, 2);
  corners(g, PAD - 6, PAD - 6, W - PAD * 2 + 12, H - PAD * 2 + 12, 46, R.rgba(accent, 0.95), 4);

  // ── header ──
  const AV = 150, avCx = L + AV / 2 + 4, avCy = PAD + 36 + AV / 2;
  R.avatar(g, avatar, avCx, avCy, AV, { shape: prefs.shape, ring: accent, ringW: 6, bg: P.track, label: name, labelColor: P.sub });
  const ringR = 92, ringCx = Rr - ringR - 22, ringCy = avCy + 2;
  const tx = avCx + AV / 2 + 34, maxX = ringCx - ringR - 40;
  R.text(g, name, tx, avCy - 38, { size: 52, bold: true, color: P.text, maxW: maxX - tx, minSize: 26 });

  let cx = tx; const cyChip = avCy - 20;
  for (const t of m.chips) {
    const img = await R.emoji(t.emoji);
    const w = R.chip(g, { x: cx, y: cyChip, h: 42, label: t.name, img, size: 20, fill: R.rgba(t.color, 0.18), stroke: t.kind === 'event' ? GOLD : R.rgba(t.color, 0.8), color: P.text, maxRight: maxX });
    if (!w) break;
    cx += w + 10;
  }
  if (!m.chips.length) R.text(g, 'No titles yet — chat, hang out in voice and play!', tx, cyChip + 21, { size: 20, color: P.sub, baseline: 'middle', maxW: maxX - tx });

  let rowY = cyChip + 58;
  if (prefs.about) {
    R.text(g, prefs.about, tx, rowY + 14, { size: 22, color: P.text, baseline: 'middle', maxW: maxX - tx });
    rowY += 38;
  }
  // badge icons: every other title as a round icon (hover text does not exist in a picture, so the names live in Customize)
  let bx = tx; const bs = 50;
  const shown = [];
  for (const t of m.badges) {
    if (bx + bs > maxX - (m.badges.length > shown.length + 1 ? 56 : 0) && shown.length) break;
    if (bx + bs > maxX) break;
    g.save(); g.beginPath(); g.arc(bx + bs / 2, rowY + bs / 2, bs / 2, 0, Math.PI * 2); g.fillStyle = R.rgba(t.color, 0.16); g.fill(); g.strokeStyle = R.rgba(t.color, 0.85); g.lineWidth = 2.5; g.stroke(); g.restore();
    R.drawEmoji(g, await R.emoji(t.emoji), bx + 11, rowY + 11, bs - 22);
    shown.push(t); bx += bs + 10;
  }
  if (m.badges.length > shown.length) R.text(g, `+${m.badges.length - shown.length}`, bx + 4, rowY + bs / 2, { size: 22, bold: true, color: P.sub, baseline: 'middle' });
  await levelRing(g, ringCx, ringCy, ringR, 14, m.level, accent, P);

  // ── rank strip ──
  const ry = 272, rh = 74;
  R.fillRR(g, L, ry, Rr - L, rh, 20, P.tile, P.faint, 2);
  const cells = [
    { icon: '💰', label: 'WEALTH RANK', n: m.ranks.coins }, { icon: '🎧', label: 'VOICE RANK', n: m.ranks.voice },
    { icon: '⌨️', label: 'TYPING RANK', n: m.ranks.text }, { icon: '🔥', label: 'STREAK RANK', n: m.ranks.streak },
  ];
  const cw = (Rr - L) / cells.length;
  for (let i = 0; i < cells.length; i++) {
    const x = L + i * cw, mid = x + cw / 2;
    if (i) { g.strokeStyle = P.faint; g.lineWidth = 2; g.beginPath(); g.moveTo(x, ry + 14); g.lineTo(x, ry + rh - 14); g.stroke(); }
    R.text(g, cells[i].label, mid, ry + 22, { size: 15, bold: true, color: P.sub, align: 'center', baseline: 'middle' });
    const vw = R.measure(g, rankText(cells[i].n), 30, true);
    R.drawEmoji(g, await R.emoji(cells[i].icon), mid - (vw + 38) / 2, ry + 36, 30);
    R.text(g, rankText(cells[i].n), mid - (vw + 38) / 2 + 38, ry + 51, { size: 30, bold: true, color: P.text, baseline: 'middle' });
  }

  // ── tiles ──
  const gap = 16, tw = (Rr - L - gap * 3) / 4, th = 124, rowGap = 14;
  const [tv, tt] = m.tracks;
  const row1 = [
    { icon: '💰', label: 'COINS', value: fmt.num(m.coins) },
    { icon: '🎧', label: 'TIME IN VOICE', value: fmt.minutesText(m.voiceMinutes), bar: { frac: tv.frac, hint: `${tv.done}/${tv.count}` } },
    { icon: '⌨️', label: 'CHARACTERS TYPED', value: fmt.num(m.chars), bar: { frac: tt.frac, hint: `${tt.done}/${tt.count}` } },
    { icon: '🎮', label: 'GAMES PLAYED', value: fmt.num(m.plays), sub: `${fmt.num(m.wins)} wins` },
  ];
  const s = m.streak;
  const row2 = [
    { icon: '🔥', label: 'DAILY STREAK', value: `${s.current} ${s.current === 1 ? 'day' : 'days'}`, sub: m.nextBadge ? `Best ${s.best} · ${m.nextBadge.days - s.current}d to ${m.nextBadge.name}` : `Best ${s.best} · every badge earned` },
    { icon: '📅', label: 'DAYS ACTIVE', value: fmt.num(s.total), sub: s.doneToday ? 'Today counted' : 'Chat to count today' },
    { icon: '🏅', label: 'TITLES & BADGES', value: fmt.num(m.titles.length), sub: m.featured ? `Top: ${m.featured.name}` : 'None yet' },
    { icon: '⚡', label: 'ACTIVE BOOST', value: m.boost ? `×${m.boost.multiplier} ${m.boost.type === 'voice' ? 'Voice' : 'Typing'}` : 'None', sub: m.boost ? leftText(m.boost.msLeft) : 'Potions drop while you chat' },
  ];
  const rows = compact ? [row1] : [row1, row2];
  for (let r = 0; r < rows.length; r++) for (let i = 0; i < 4; i++) await tile(g, L + i * (tw + gap), 366 + r * (th + rowGap), tw, th, rows[r][i], P, accent);
  return R.toPng(c);
}

module.exports = { render, model, W };
