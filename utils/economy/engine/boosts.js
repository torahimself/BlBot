'use strict';
// Boost potions: inventory, activation and the active multiplier.
//
// Rules (from the spec):
//   • A potion is earned (drop / event), never bought, and is consumed when used.
//   • Typing Boost doubles eligible TEXT coins, Voice Boost doubles VOICE coins.
//   • A potion's duration (3–6 h) is rolled when the potion is created.
//   • Two boosts of the same type never run together (no stacking).
//   • Boosted coins still count toward the weekly and 30-day caps — the caps are
//     applied in activity.js AFTER the multiplier.

const settings = require('./settings');
const dbx = require('./dbx');

const TYPES = {
  text:  { key: 'text',  label: 'Typing Boost', emoji: '⌨️', short: 'Typing' },
  voice: { key: 'voice', label: 'Voice Boost',  emoji: '🎧', short: 'Voice'  },
};

// Weighted pick of a potion duration in hours.
function rollHours(rng = settings.rng) {
  const rows = settings.potions.durations;
  const total = rows.reduce((a, r) => a + r[1], 0);
  let x = rng() * total;
  for (const [hours, weight] of rows) {
    if (x < weight) return hours;
    x -= weight;
  }
  return rows[rows.length - 1][0];
}

async function activeBoosts(userId, now = Date.now()) {
  return dbx.all(
    'SELECT type, multiplier, startedAt, expiresAt FROM boosts WHERE userId = ? AND expiresAt > ? ORDER BY type',
    [userId, now]
  );
}

// Multiplier that applies to `source` ('text' | 'voice') right now (1 = none).
async function multiplier(userId, source, now = Date.now()) {
  const row = await dbx.get(
    'SELECT multiplier FROM boosts WHERE userId = ? AND type = ? AND expiresAt > ?',
    [userId, source, now]
  );
  if (!row) return 1;
  const m = Number(row.multiplier);
  return m > 0 ? m : 1;
}

async function inventory(userId) {
  return dbx.all('SELECT id, type, hours FROM potions WHERE userId = ? ORDER BY type, hours, id', [userId]);
}

async function grantPotion(userId, type, hours, source = 'grant', now = Date.now()) {
  if (!TYPES[type]) throw new Error(`Unknown potion type: ${type}`);
  await dbx.atomic(dbx.bundleSql({ userId, potions: [{ type, hours, source }], now }));
}

/**
 * Consumes one potion and starts its boost, atomically.
 * Returns { ok:true, type, hours, multiplier, expiresAt } or { ok:false, reason, ... }.
 *   reason: 'missing'          — the potion isn't (or is no longer) theirs
 *           'same-type-active' — a boost of that type is already running
 *           'other-active'     — only when allowConcurrentTypes is false
 */
async function activate(userId, potionId, now = Date.now()) {
  return dbx.exclusive('u:' + userId, async () => {
    const potion = await dbx.get('SELECT id, type, hours FROM potions WHERE id = ? AND userId = ?', [potionId, userId]);
    if (!potion) return { ok: false, reason: 'missing' };

    const running = await activeBoosts(userId, now);
    const same = running.find(b => b.type === potion.type);
    if (same) return { ok: false, reason: 'same-type-active', type: potion.type, expiresAt: same.expiresAt };
    if (!settings.potions.allowConcurrentTypes && running.length) {
      return { ok: false, reason: 'other-active', type: running[0].type, expiresAt: running[0].expiresAt };
    }

    const mult = settings.potions.multiplier;
    const expiresAt = now + potion.hours * 60 * 60 * 1000;
    const u = dbx.lit(userId);

    // The DELETE and the INSERT are one transaction, and the INSERT only
    // happens if the DELETE really removed the potion — so a potion can never
    // be used twice or start a boost without being consumed.
    await dbx.atomic(
      `DELETE FROM potions WHERE id = ${dbx.lit(potion.id)} AND userId = ${u};\n` +
      `INSERT OR REPLACE INTO boosts (userId, type, multiplier, startedAt, expiresAt) ` +
      `SELECT ${u}, ${dbx.lit(potion.type)}, ${dbx.lit(mult)}, ${dbx.lit(now)}, ${dbx.lit(expiresAt)} WHERE changes() > 0;`
    );

    const row = await dbx.get(
      'SELECT expiresAt FROM boosts WHERE userId = ? AND type = ? AND expiresAt = ?',
      [userId, potion.type, expiresAt]
    );
    if (!row) return { ok: false, reason: 'missing' };
    return { ok: true, type: potion.type, hours: potion.hours, multiplier: mult, expiresAt };
  });
}

module.exports = { TYPES, rollHours, activeBoosts, multiplier, inventory, grantPotion, activate };
