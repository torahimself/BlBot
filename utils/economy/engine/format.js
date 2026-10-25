'use strict';
// Small pure helpers shared by the profile, inventory and event screens.

const settings = require('./settings');

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const roman = (n) => ROMAN[n - 1] || String(n);

const num = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US');

// Badge + rarity name + embed colour for a milestone tier (1–10).
function tierStyle(tier) {
  for (const t of settings.tierBadges) if (tier <= t.upTo) return t;
  return settings.tierBadges[settings.tierBadges.length - 1];
}

// ▰▰▰▱▱▱  (fraction 0–1)
function bar(fraction, width = 10) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(f * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

// 5400 minutes → "90h", 95 → "1h 35m"
function minutesText(min) {
  min = Math.max(0, Math.floor(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Discord relative timestamp helpers (rendered in each viewer's own timezone).
const tsFull = (ms) => `<t:${Math.floor(ms / 1000)}:F>`;
const tsRel = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const tsDate = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;

function trackValueText(track, value) {
  return track === 'voice' ? minutesText(value) : `${num(value)} chars`;
}

module.exports = { roman, num, tierStyle, bar, minutesText, tsFull, tsRel, tsDate, trackValueText };
