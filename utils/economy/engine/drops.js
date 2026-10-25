'use strict';
// Random drops: a small surprise for GENUINE activity.
//
// A roll happens per eligible voice minute and per `charsPerRoll` credited
// characters — never per raw message — so spam can't buy extra chances. The
// roll, the reward and the weekly counter are all decided and saved here on the
// server, in one transaction. Failed rolls are not stored anywhere.

const settings = require('./settings');
const time = require('./time');
const dbx = require('./dbx');
const boosts = require('./boosts');
const notify = require('./notify');

function pickWeighted(rows, rng) {
  const total = rows.reduce((a, r) => a + r.weight, 0);
  let x = rng() * total;
  for (const r of rows) {
    if (x < r.weight) return r;
    x -= r.weight;
  }
  return rows[rows.length - 1];
}

async function getDmPref(userId) {
  const row = await dbx.get('SELECT dm FROM drop_prefs WHERE userId = ?', [userId]);
  return row ? row.dm !== 0 : true;
}

async function setDmPref(userId, on) {
  await dbx.run(
    'INSERT INTO drop_prefs (userId, dm) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET dm = excluded.dm',
    [userId, on ? 1 : 0]
  );
}

function describe(drop) {
  if (drop.kind === 'potion') {
    const t = boosts.TYPES[drop.type];
    return `a **${t.emoji} ${t.label}** (${drop.hours}h, ×${settings.potions.multiplier})`;
  }
  return `**${drop.amount.toLocaleString('en-US')}** coins`;
}

/**
 * Rolls for a drop. The CALLER must already hold the per-user lock
 * (dbx.exclusive('u:' + userId)); activity.js does.
 * @returns {Promise<null|{kind:'potion',type,hours}|{kind:'coins',amount}>}
 */
async function attemptLocked(userId, source, rolls, { now = Date.now(), client = null, rng = settings.rng } = {}) {
  if (!(rolls > 0)) return null;

  // One draw covers all `rolls` chances: P(at least one hit) = 1 - (1 - p)^rolls.
  const p = 1 - Math.pow(1 - settings.drops.chancePerRoll, rolls);
  if (!(rng() < p)) return null;

  const week = time.weekStartKey(now);
  const row = await dbx.get('SELECT count FROM drop_weekly WHERE userId = ? AND week = ?', [userId, week]);
  if ((row ? row.count : 0) >= settings.drops.maxPerWeek) return null;

  const outcome = pickWeighted(settings.drops.table, rng);
  let drop;
  let reward;
  if (outcome.kind === 'potion') {
    const type = settings.potions.dropMatchesActivity ? source : (rng() < 0.5 ? 'text' : 'voice');
    const hours = boosts.rollHours(rng);
    drop = { kind: 'potion', type, hours };
    reward = dbx.bundleSql({ userId, potions: [{ type, hours, source: 'drop' }], now });
  } else {
    drop = { kind: 'coins', amount: outcome.amount };
    reward = dbx.bundleSql({ userId, coins: outcome.amount, now });
  }

  const u = dbx.lit(userId);
  await dbx.atomic([
    reward,
    `INSERT INTO drop_weekly (userId, week, count) VALUES (${u}, ${dbx.lit(week)}, 1) ` +
      `ON CONFLICT(userId, week) DO UPDATE SET count = count + 1;`,
    `INSERT INTO drop_log (userId, at, kind, detail) VALUES (${u}, ${dbx.lit(now)}, ${dbx.lit(drop.kind)}, ${dbx.lit(JSON.stringify(drop))});`,
  ].join('\n'));

  // The reward is saved. Tell the member (if they want to hear about it);
  // a failed DM changes nothing.
  getDmPref(userId).then((wants) => {
    if (!wants) return;
    const text = drop.kind === 'potion'
      ? `🎁 **Lucky find!** You discovered ${describe(drop)}. Open **/inventory** to activate it.`
      : `🎁 **Lucky find!** You found ${describe(drop)}!`;
    return notify.dm(client, userId, `${text}\n-# Turn these messages off with /drop`, {
      cooldownKey: 'drop', cooldownMs: settings.drops.dmCooldownMs, now,
    });
  }).catch(() => {});

  return drop;
}

module.exports = { attemptLocked, getDmPref, setDmPref, describe, pickWeighted };
