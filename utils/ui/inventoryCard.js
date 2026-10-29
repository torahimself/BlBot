'use strict';
// The /inventory picture: coins · potions (owned + running boost with a countdown bar) · this week's earnings.
// The "activate a potion" menu stays a real Discord menu under the picture.

const R = require('./render');
const themes = require('./themes');
const fmt = require('../economy/engine/format');
const settings = require('../economy/engine/settings');
const boosts = require('../economy/engine/boosts');
const views = require('../economy/engine/views');

const W = 1000, H = 640;

const leftText = (ms) => {
  const m = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
};

/** Plain data the card shows (also used by the tests). */
function model(st) {
  const potionRows = ['text', 'voice'].map((type) => {
    const t = boosts.TYPES[type];
    const owned = views.groupPotions(st.potions, type);
    const run = st.active.find(b => b.type === type) || null;
    return {
      type, label: t.label, emoji: t.emoji, owned, count: owned.reduce((a, [, n]) => a + n, 0),
      run: run ? { multiplier: run.multiplier, left: Math.max(0, run.expiresAt - st.now), total: Math.max(1, run.expiresAt - run.startedAt), leftText: leftText(run.expiresAt - st.now) } : null,
    };
  });
  const u = st.usage;
  const week = [
    { icon: '⌨️', label: 'Typing coins', value: u.text.weekCoins, cap: u.text.weeklyCap },
    { icon: '🎧', label: 'Voice coins', value: u.voice.weekCoins, cap: u.voice.weeklyCap },
    { icon: '🎲', label: 'Betting profit', value: Math.max(0, st.net), cap: settings.betting.weeklyNetProfitCap },
  ];
  return { coins: st.balance, potionRows, week, resetIn: leftText(u.resetAt - st.now), multiplier: settings.potions.multiplier };
}

async function render({ name, avatar, state, prefs }) {
  const m = model(state);
  const theme = themes.themeOf(prefs.theme);
  const accent = themes.accentOf(prefs);
  const P = themes.palette(theme, accent);
  const { c, g } = R.newCanvas(W, H);
  R.background(g, W, H, theme, accent);
  const PAD = 26;
  R.fillRR(g, PAD, PAD, W - PAD * 2, H - PAD * 2, 34, P.panel, P.faint, 2);
  const L = PAD + 34, Rr = W - PAD - 34;

  // header
  const AV = 96, cy = PAD + 34 + AV / 2;
  R.avatar(g, avatar, L + AV / 2, cy, AV, { shape: prefs.shape, ring: accent, ringW: 5, bg: P.track, label: name, labelColor: P.sub });
  R.text(g, 'Inventory', L + AV + 26, cy - 8, { size: 46, bold: true, color: P.text });
  R.text(g, name, L + AV + 26, cy + 30, { size: 24, color: P.sub, maxW: 380 });
  const cbW = 270, cbH = 84, cbX = Rr - cbW, cbY = cy - cbH / 2;
  R.fillRR(g, cbX, cbY, cbW, cbH, 22, R.rgba(accent, 0.16), R.rgba(accent, 0.55), 2);
  R.drawEmoji(g, await R.emoji('💰'), cbX + 16, cbY + 18, 48);
  R.text(g, fmt.num(m.coins), cbX + cbW - 18, cbY + cbH / 2 + 2, { size: 38, bold: true, color: P.text, align: 'right', baseline: 'middle', maxW: cbW - 90, minSize: 20 });

  // left: potions
  const top = cy + AV / 2 + 30;
  const colGap = 24, lw = 500, rx = L + lw + colGap, rw = Rr - rx;
  R.text(g, `POTIONS · ×${m.multiplier} COINS`, L + 4, top, { size: 18, bold: true, color: P.sub, baseline: 'middle' });
  let y = top + 20;
  const ph = 168;
  for (const p of m.potionRows) {
    R.fillRR(g, L, y, lw, ph, 24, P.tile, p.run ? accent : P.faint, p.run ? 3 : 2);
    R.drawEmoji(g, await R.emoji(p.emoji), L + 20, y + 20, 60);
    R.text(g, p.label, L + 94, y + 38, { size: 28, bold: true, color: P.text, baseline: 'middle' });
    // owned
    if (p.owned.length) {
      let x = L + 94;
      for (const [h, n] of p.owned.slice(0, 4)) {
        const w = R.chip(g, { x, y: y + 62, h: 38, label: `${n} × ${h}h`, size: 19, fill: R.rgba(accent, 0.18), stroke: R.rgba(accent, 0.6), color: P.text, maxRight: L + lw - 14 });
        if (!w) break; x += w + 8;
      }
    } else R.text(g, 'None owned', L + 94, y + 81, { size: 21, color: P.sub, baseline: 'middle' });
    // running boost
    if (p.run) {
      R.chip(g, { x: L + lw - 150, y: y + 18, h: 34, label: `ACTIVE ×${p.run.multiplier}`, size: 17, fill: accent, color: R.onColor(accent) });
      R.bar(g, L + 20, y + 124, lw - 40 - 120, 14, p.run.left / p.run.total, accent, P.track);
      R.text(g, `${p.run.leftText} left`, L + lw - 20, y + 131, { size: 21, bold: true, color: P.text, align: 'right', baseline: 'middle' });
    } else {
      R.text(g, p.count ? 'Ready — activate it from the menu below.' : 'Potions come from drops and events.', L + 20, y + 131, { size: 19, color: P.sub, baseline: 'middle', maxW: lw - 40 });
    }
    y += ph + 16;
  }

  // right: this week
  R.text(g, 'THIS WEEK', rx + 4, top, { size: 18, bold: true, color: P.sub, baseline: 'middle' });
  const wy = top + 20, wh = ph * 2 + 16;
  R.fillRR(g, rx, wy, rw, wh, 24, P.tile, P.faint, 2);
  let ry = wy + 22;
  for (const w of m.week) {
    const frac = w.cap > 0 ? w.value / w.cap : 0;
    R.drawEmoji(g, await R.emoji(w.icon), rx + 20, ry, 36);
    const val = `${fmt.num(w.value)} / ${fmt.num(w.cap)}`;
    const vw = R.measure(g, val, 20, frac >= 1);
    R.text(g, w.label, rx + 66, ry + 18, { size: 22, bold: true, color: P.text, baseline: 'middle', maxW: rw - 66 - 20 - vw - 12 });
    R.text(g, val, rx + rw - 20, ry + 18, { size: 20, color: frac >= 1 ? accent : P.sub, bold: frac >= 1, align: 'right', baseline: 'middle' });
    R.bar(g, rx + 20, ry + 48, rw - 40, 14, frac, accent, P.track);
    ry += 92;
  }
  R.drawEmoji(g, await R.emoji('⏳'), rx + 20, wy + wh - 52, 30);
  R.text(g, `Resets in ${m.resetIn}`, rx + 60, wy + wh - 37, { size: 20, color: P.sub, baseline: 'middle' });

  R.text(g, 'A potion is used up when you activate it · they cannot be bought', W / 2, H - PAD - 22, { size: 17, color: P.sub, align: 'center', baseline: 'middle' });
  return R.toPng(c);
}

module.exports = { render, model, W, H };
