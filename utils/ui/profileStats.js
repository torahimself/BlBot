'use strict';
// Everything the profile card shows beyond coins / voice / typing: level, ranks, streak, games, boost.
// Pure reads — never writes. gather() never throws (a failure just leaves a field out).

const dbx = require('../economy/engine/dbx');
const streaks = require('../economy/engine/streaks');
const boosts = require('../economy/engine/boosts');
const gameStats = require('../games/stats');
const time = require('../economy/engine/time');
const blocklist = require('../blocklist');

// XP → level. XP comes from what the member really does; the numbers are easy to tune here.
const XP = { perVoiceMinute: 2, perChars: 1 / 20, perGame: 15, perStreakDay: 40 };
const cumXp = (n) => Math.round(60 * Math.pow(n, 1.7));          // XP needed to REACH level n (level 1 = 60 XP)
const MAX_LEVEL = 200;

function xpOf({ voiceMinutes = 0, chars = 0, plays = 0, days = 0 }) {
  return Math.floor(voiceMinutes * XP.perVoiceMinute + chars * XP.perChars + plays * XP.perGame + days * XP.perStreakDay);
}
function levelOf(xp) {
  let n = 0;
  while (n < MAX_LEVEL && cumXp(n + 1) <= xp) n++;
  const base = cumXp(n), top = cumXp(n + 1);
  return { level: n, xp, into: xp - base, need: n >= MAX_LEVEL ? 0 : top - base, frac: n >= MAX_LEVEL ? 1 : (xp - base) / (top - base) };
}

async function rank(sql, params) {
  try { const r = await dbx.get(sql, params); return r ? r.n + 1 : null; } catch (_) { return null; }
}

/** base = { balance, chars, voiceMinutes } from views.profileData */
async function gather(userId, base, now = Date.now()) {
  const out = { plays: 0, wins: 0, streak: { current: 0, best: 0, total: 0, doneToday: false }, boost: null, ranks: {}, level: levelOf(0) };
  try {
    const rows = await gameStats.forUser(userId);
    out.plays = rows.reduce((a, r) => a + r.plays, 0);
    out.wins = rows.reduce((a, r) => a + r.wins, 0);
  } catch (_) { /* no stats yet */ }
  try { out.streak = await streaks.get(userId, now); } catch (_) { /* keep zeros */ }
  try {
    const active = await boosts.activeBoosts(userId, now);
    if (active.length) {
      const b = active.sort((a, c) => c.expiresAt - a.expiresAt)[0];
      out.boost = { type: b.type, multiplier: Number(b.multiplier) || 2, msLeft: b.expiresAt - now, count: active.length };
    }
  } catch (_) { /* none */ }
  out.level = levelOf(xpOf({ voiceMinutes: base.voiceMinutes, chars: base.chars, plays: out.plays, days: out.streak.total }));

  const ex = blocklist.sqlExclude();
  if (base.balance > 0) out.ranks.coins = await rank(`SELECT COUNT(*) AS n FROM users WHERE balance > ?${ex}`, [base.balance]);
  if (base.voiceMinutes > 0) out.ranks.voice = await rank(`SELECT COUNT(*) AS n FROM act_totals WHERE voiceMinutes > ?${ex}`, [base.voiceMinutes]);
  if (base.chars > 0) out.ranks.text = await rank(`SELECT COUNT(*) AS n FROM act_totals WHERE chars > ?${ex}`, [base.chars]);
  if (out.streak.current > 0) out.ranks.streak = await streaks.rankOf(out.streak.current, now);
  return out;
}

module.exports = { gather, xpOf, levelOf, cumXp, XP, MAX_LEVEL };
