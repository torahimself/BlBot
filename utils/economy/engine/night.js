'use strict';
// Night activity roles — two Discord roles for the TOP 5 night owls of the week:
//   • voice role  → most eligible voice minutes inside the night window
//   • chat role   → most eligible typed characters inside the night window
//
// Counting: activity.js adds the credited (already filtered/capped) units to
// night_totals in the same transaction as the coins, whenever the Riyadh clock
// is inside the night window (default 00:00–06:00).
//
// Ranking: once a new Sunday-week starts, the top N of the LAST COMPLETED week
// (≥ the minimum units) are the holders. Ties: more units, then lower userId.
// The ranking is recomputed from night_totals every sync, so it is always the
// same answer and a failed Discord call is simply retried next cycle.
//
// Discord sync uses night_holders as "who currently has the role". It never
// fetches the member list (30k+ members): only individual members. Completely
// silent — no DMs, no messages, no mentions.

const settings = require('./settings');
const time = require('./time');
const dbx = require('./dbx');

const CATEGORIES = ['voice', 'text'];   // 'text' = the chat role

function cfg() { return settings.nightRoles; }

// Is `now` inside the night window (Asia/Riyadh)? Handles windows that wrap midnight.
function inWindow(now, c = cfg()) {
  if (!c || !c.enabled) return false;
  const h = time.localHour(now);
  return c.startHour <= c.endHour
    ? h >= c.startHour && h < c.endHour
    : h >= c.startHour || h < c.endHour;
}

// SQL added to the credit transaction ('' outside the window).
function sqlFor(userId, source, units, now) {
  units = Math.floor(units);
  if (!(units > 0) || !CATEGORIES.includes(source) || !inWindow(now)) return '';
  return `INSERT INTO night_totals (userId, week, source, units) VALUES (${dbx.lit(userId)}, ${dbx.lit(time.weekStartKey(now))}, ${dbx.lit(source)}, ${units}) ` +
    `ON CONFLICT(userId, week, source) DO UPDATE SET units = units + ${units};`;
}

// Top members of one category for a week (array of userIds, best first).
async function rank(category, week) {
  const c = cfg();
  const rows = await dbx.all(
    `SELECT userId FROM night_totals WHERE week = ? AND source = ? AND units >= ?
      ORDER BY units DESC, userId ASC LIMIT ?`,
    [week, category, Math.max(1, c[category].minUnits), c.top]
  );
  return rows.map(r => r.userId);
}

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[Night] ' + msg);
}

function findGuild(client, roleId) {
  if (!client || !client.guilds) return null;
  return client.guilds.cache.find(g => g.roles && g.roles.cache && g.roles.cache.has(roleId)) || null;
}

async function fetchMember(guild, userId) {
  try { return await guild.members.fetch(userId); }
  catch (err) {
    if (err && (err.code === 10007 || err.code === 10013)) return null;   // left the server
    throw err;
  }
}

async function reconcile(client, category, desired) {
  const roleId = cfg()[category].roleId;
  const guild = findGuild(client, roleId);
  if (!guild) { warnOnce('guild:' + category, `No guild with the ${category} night role (${roleId}) — skipping.`); return; }
  const want = new Set(desired);
  const rows = await dbx.all('SELECT userId FROM night_holders WHERE category = ?', [category]);
  const have = new Set(rows.map(r => r.userId));

  // Remove from those who dropped out.
  for (const id of have) {
    if (want.has(id)) continue;
    try {
      const m = await fetchMember(guild, id);
      if (m && m.roles.cache.has(roleId)) await m.roles.remove(roleId, 'Night roles: left the top ' + cfg().top);
      await dbx.run('DELETE FROM night_holders WHERE category = ? AND userId = ?', [category, id]);
    } catch (err) {
      warnOnce(`rm:${category}:${id}`, `Could not remove the ${category} role from ${id}: ${err.message} (will retry)`);
    }
  }

  // Add to new ones.
  for (const id of want) {
    try {
      const m = await fetchMember(guild, id);
      if (!m) continue;                                  // left the server → dropped
      if (!m.roles.cache.has(roleId)) await m.roles.add(roleId, 'Night roles: top ' + cfg().top);
      await dbx.run(
        'INSERT OR IGNORE INTO night_holders (category, userId, since) VALUES (?, ?, ?)',
        [category, id, time.weekStartKey(Date.now())]
      );
    } catch (err) {
      warnOnce(`add:${category}:${id}`, `Could not give the ${category} role to ${id}: ${err.message} (will retry)`);
    }
  }

  // Safety sweep over CACHED members only: nobody outside the top N keeps the role.
  const role = guild.roles.cache.get(roleId);
  if (role && role.members) {
    for (const m of role.members.values()) {
      if (want.has(m.id)) continue;
      try {
        await m.roles.remove(roleId, 'Night roles: not in the top ' + cfg().top);
        await dbx.run('DELETE FROM night_holders WHERE category = ? AND userId = ?', [category, m.id]);
      } catch (err) {
        warnOnce(`sweep:${category}:${m.id}`, `Could not remove the ${category} role from ${m.id}: ${err.message} (will retry)`);
      }
    }
  }
}

/**
 * Safe to call as often as you like. Keeps night_state.lastWeek = the last
 * completed week, then makes Discord match that week's ranking.
 * @returns {Promise<{week:string, voice:string[], text:string[]}|null>}
 */
async function syncIfDue(client, now = Date.now()) {
  const c = cfg();
  if (!c || !c.enabled) return null;
  return dbx.exclusive('night', async () => {
    const week = time.addDays(time.weekStartKey(now), -7);
    await dbx.run(
      'INSERT INTO night_state (id, lastWeek) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET lastWeek = excluded.lastWeek',
      [week]
    );
    const result = { week };
    for (const cat of CATEGORIES) {
      result[cat] = await rank(cat, week);
      await reconcile(client, cat, result[cat]);
    }
    return result;
  });
}

async function pruneOld(now = Date.now()) {
  const cutoff = time.addDays(time.weekStartKey(now), -70);
  const r = await dbx.run('DELETE FROM night_totals WHERE week < ?', [cutoff]);
  return r.changes;
}

module.exports = { inWindow, sqlFor, rank, syncIfDue, pruneOld, CATEGORIES };
