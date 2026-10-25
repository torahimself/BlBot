'use strict';
// Plays / wins per member per party game. Table is created on first use.

const dbx = require('../economy/engine/dbx.js');

let ready = null;
function ensure() {
  if (!ready) {
    ready = dbx.run(`CREATE TABLE IF NOT EXISTS game_stats (
      userId TEXT, game TEXT, plays INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, lastPlayedAt INTEGER,
      PRIMARY KEY (userId, game)
    )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** Counts one finished game for every player in `played` and a win for `winners`. */
async function record(game, played = [], winners = [], now = Date.now()) {
  await ensure();
  const win = new Set(winners);
  for (const id of new Set([...played, ...winners])) {
    await dbx.run(
      `INSERT INTO game_stats (userId, game, plays, wins, lastPlayedAt) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(userId, game) DO UPDATE SET plays = plays + 1, wins = wins + excluded.wins, lastPlayedAt = excluded.lastPlayedAt`,
      [id, game, win.has(id) ? 1 : 0, now]
    );
  }
}

async function forUser(userId) {
  await ensure();
  return dbx.all('SELECT game, plays, wins FROM game_stats WHERE userId = ? ORDER BY game', [userId]);
}

module.exports = { record, forUser, ensure };
