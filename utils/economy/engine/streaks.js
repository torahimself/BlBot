'use strict';
// Daily streaks. A "streak day" is a Riyadh calendar day (midnight → midnight) on which the member did ANYTHING
// with the bot: sent one message, sat in a voice channel, or ran one command. One is enough.
//
//   touch(userId)  → call from messageCreate / interactionCreate / the voice sampler (cheap: one DB write per member per day)
//   get(userId)    → { current, best, total, doneToday }   (current is 0 once a day was missed)
//
// Streak badges (titles with id "st_<days>") are granted the moment the streak reaches the number; never lost.

const dbx = require('./dbx');
const time = require('./time');

const MILESTONES = [
  { days: 3,   key: 'st_3',   name: 'Warming Up',        emoji: '🔥' },
  { days: 7,   key: 'st_7',   name: 'On Fire',           emoji: '🔥' },
  { days: 14,  key: 'st_14',  name: 'Fortnight Flame',   emoji: '🌟' },
  { days: 30,  key: 'st_30',  name: 'Monthly Devotion',  emoji: '🌙' },
  { days: 60,  key: 'st_60',  name: 'Unbroken',          emoji: '⚡' },
  { days: 100, key: 'st_100', name: 'Centurion',         emoji: '💯' },
  { days: 200, key: 'st_200', name: 'Eternal Flame',     emoji: '👑' },
  { days: 365, key: 'st_365', name: 'A Full Year',       emoji: '🏆' },
];
const byKey = new Map(MILESTONES.map(m => [m.key, m]));
const info = (titleId) => byKey.get(titleId) || null;

let ready = null;
function ensure() {
  if (!ready) {
    ready = dbx.run(`CREATE TABLE IF NOT EXISTS streaks (
      userId TEXT PRIMARY KEY, current INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, lastDay TEXT
    )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const seen = new Map();   // userId → day already counted (in memory: most calls cost nothing)

/** Counts today for the member. Returns { current, best, gained:[milestones] } on the first touch of the day, else null. Never throws. */
async function touch(userId, now = Date.now()) {
  try {
    if (!userId) return null;
    if (require('../../blocklist.js').isBlocked(userId)) return null;
    const day = time.dayKey(now);
    if (seen.get(userId) === day) return null;
    if (seen.size > 60000) seen.clear();
    seen.set(userId, day);
    await ensure();
    return await dbx.exclusive('streak:' + userId, async () => {
      const row = await dbx.get('SELECT current, best, total, lastDay FROM streaks WHERE userId = ?', [userId]);
      if (row && row.lastDay === day) return null;
      const current = row && row.lastDay === time.addDays(day, -1) ? row.current + 1 : 1;
      const best = Math.max(row ? row.best : 0, current);
      await dbx.run(
        `INSERT INTO streaks (userId, current, best, total, lastDay) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET current = excluded.current, best = excluded.best, total = excluded.total, lastDay = excluded.lastDay`,
        [userId, current, best, (row ? row.total : 0) + 1, day]
      );
      const gained = [];
      for (const m of MILESTONES) {
        if (current < m.days) continue;
        const r = await dbx.run("INSERT OR IGNORE INTO titles (userId, titleId, category, earnedAt) VALUES (?, ?, 'streak', ?)", [userId, m.key, now]);
        if (r && r.changes) gained.push(m);
      }
      return { current, best, gained };
    });
  } catch (err) {
    seen.delete(userId);
    console.error('[Streak] touch failed:', err.message);
    return null;
  }
}

async function get(userId, now = Date.now()) {
  await ensure();
  const day = time.dayKey(now);
  const row = await dbx.get('SELECT current, best, total, lastDay FROM streaks WHERE userId = ?', [userId]);
  if (!row) return { current: 0, best: 0, total: 0, doneToday: false };
  const alive = row.lastDay === day || row.lastDay === time.addDays(day, -1);
  return { current: alive ? row.current : 0, best: row.best, total: row.total, doneToday: row.lastDay === day };
}

/** Members whose streak is still alive and longer than `n` (for the rank). */
async function rankOf(current, now = Date.now()) {
  if (!(current > 0)) return null;
  await ensure();
  const day = time.dayKey(now);
  const r = await dbx.get(
    `SELECT COUNT(*) AS n FROM streaks WHERE lastDay >= ? AND current > ?${require('../../blocklist.js').sqlExclude()}`,
    [time.addDays(day, -1), current]
  );
  return (r ? r.n : 0) + 1;
}

module.exports = { touch, get, rankOf, info, MILESTONES, ensure, _forget: () => seen.clear() };
