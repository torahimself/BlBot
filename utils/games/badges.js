'use strict';
// Game badges — titles earned by playing the party games. They are stored in the
// same `titles` table as every other title (category 'game', id "gb_<key>"), so
// they show on the profile card and can be picked as the featured title.
//
// Everything is computed from game_stats (plays / wins per game), so a badge can
// never be lost and can never be given twice. To add or rename one, edit BADGES.

const dbx = require('../economy/engine/dbx.js');
const stats = require('./stats.js');

// kind: 'wins' (wins in one game) · 'totalWins' · 'totalPlays' · 'special' (awarded by the game itself)
const BADGES = [
  { key: 'first_win',   name: 'First Blood',      emoji: '🏅', kind: 'totalWins',  n: 1,   hint: 'Win your first party game' },
  { key: 'wins_10',     name: 'Rising Player',    emoji: '⭐', kind: 'totalWins',  n: 10,  hint: 'Win 10 party games' },
  { key: 'wins_50',     name: 'Arena Regular',    emoji: '🏟️', kind: 'totalWins',  n: 50,  hint: 'Win 50 party games' },
  { key: 'wins_150',    name: 'Server Champion',  emoji: '🏆', kind: 'totalWins',  n: 150, hint: 'Win 150 party games' },
  { key: 'plays_25',    name: 'Party Animal',     emoji: '🎉', kind: 'totalPlays', n: 25,  hint: 'Play 25 party games' },
  { key: 'plays_100',   name: 'Game Night Legend', emoji: '🎮', kind: 'totalPlays', n: 100, hint: 'Play 100 party games' },
  { key: 'guess_10',    name: 'Flag Hunter',      emoji: '🚩', kind: 'wins', game: 'guess',      n: 10, hint: 'Win 10 flag / capital games' },
  { key: 'geo_10',      name: 'Street Scout',     emoji: '🧭', kind: 'wins', game: 'geo',        n: 10, hint: 'Win 10 geo games' },
  { key: 'cat_10',      name: 'Word Wizard',      emoji: '🔤', kind: 'wins', game: 'categories', n: 10, hint: 'Win 10 Insan-Haywan games' },
  { key: 'roulette_10', name: 'Wheel Survivor',   emoji: '🎡', kind: 'wins', game: 'roulette',   n: 10, hint: 'Win 10 roulette games' },
  { key: 'mafia_10',    name: 'Mafia Mastermind', emoji: '🎭', kind: 'wins', game: 'mafia',      n: 10, hint: 'Win 10 mafia games' },
  { key: 'typing_10',   name: 'Speed Demon',      emoji: '⚡', kind: 'wins', game: 'typing',     n: 10, hint: 'Win 10 typing races' },
  { key: 'chain_10',    name: 'Chain Master',     emoji: '🔗', kind: 'wins', game: 'chain',      n: 10, hint: 'Win 10 word chains' },
  { key: 'math_10',     name: 'Human Calculator', emoji: '🧮', kind: 'wins', game: 'math',       n: 10, hint: 'Win 10 math races' },
  { key: 'pinpoint',    name: 'Pinpoint',         emoji: '🎯', kind: 'special', hint: 'Name the exact country in a geo round' },
];

const idOf = (key) => `gb_${key}`;
const byId = new Map(BADGES.map(b => [idOf(b.key), b]));
const info = (titleId) => byId.get(titleId) || null;

async function owned(userId) {
  const rows = await dbx.all("SELECT titleId FROM titles WHERE userId = ? AND titleId LIKE 'gb\\_%' ESCAPE '\\'", [userId]);
  return new Set(rows.map(r => r.titleId));
}

/** Inserts the badge if it is new. → true only for the call that really gave it. */
async function grant(userId, key, now = Date.now()) {
  const r = await dbx.run(
    "INSERT OR IGNORE INTO titles (userId, titleId, category, earnedAt) VALUES (?, ?, 'game', ?)",
    [userId, idOf(key), now]
  );
  return !!(r && r.changes);
}

/** Every badge the member's stats now qualify for and does not have yet. → [badge] newly given */
async function check(userId, now = Date.now()) {
  const rows = await stats.forUser(userId);
  const have = await owned(userId);
  const wins = (g) => rows.filter(r => r.game === g).reduce((a, r) => a + r.wins, 0);
  const totalWins = rows.reduce((a, r) => a + r.wins, 0);
  const totalPlays = rows.reduce((a, r) => a + r.plays, 0);
  const fresh = [];
  for (const b of BADGES) {
    if (have.has(idOf(b.key))) continue;
    const ok = b.kind === 'wins' ? wins(b.game) >= b.n
      : b.kind === 'totalWins' ? totalWins >= b.n
      : b.kind === 'totalPlays' ? totalPlays >= b.n : false;
    if (ok && await grant(userId, b.key, now)) fresh.push(b);
  }
  return fresh;
}

module.exports = { BADGES, idOf, info, grant, check, owned };
