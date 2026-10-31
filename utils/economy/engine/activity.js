'use strict';
// The one place where activity (typing / voice) turns into coins.
//
// Every credit goes through credit(), which, for ONE member at a time:
//   1. checks the weekly cap, the rolling 30-day cap and the weekly unit ceiling
//   2. applies an active boost potion to the coins (boosted coins still count
//      toward the caps — the caps are checked AFTER the multiplier)
//   3. writes balance + daily bucket + lifetime counters + event points in ONE
//      transaction
//   4. then checks milestones and rolls for a random drop
//
// Two separate limits, on purpose:
//   • COIN caps (weekly + rolling 30 days) limit how many COINS an activity pays.
//     Once a cap is reached the activity still counts for milestones and event
//     points (it just pays 0), so using a boost potion never costs progress.
//   • The weekly UNIT ceiling (characters / minutes) limits how much activity
//     counts at all, so spam or 24/7 idling can't be turned into titles, event
//     points or drop rolls. Beyond it nothing counts.
// Random-drop rolls only happen while the coin cap still has room.

const settings = require('./settings');
const time = require('./time');
const dbx = require('./dbx');
const boosts = require('./boosts');
const drops = require('./drops');
const milestones = require('./milestones');
const events = require('./events');
const night = require('./night');
const { TextGate } = require('./textFilter');

const gate = new TextGate();

const SOURCES = {
  text:  { cfg: () => settings.text,  ceiling: (c) => c.weeklyCharCeiling,   totalsCol: 'chars' },
  voice: { cfg: () => settings.voice, ceiling: (c) => c.weeklyMinuteCeiling, totalsCol: 'voiceMinutes' },
};

// Coins earned this week / in the rolling 30 days / units credited this week.
async function usage(userId, source, keys) {
  return dbx.get(
    `SELECT COALESCE(SUM(CASE WHEN day >= ? THEN coins ELSE 0 END), 0) AS weekCoins,
            COALESCE(SUM(CASE WHEN day >= ? THEN units ELSE 0 END), 0) AS weekUnits,
            COALESCE(SUM(coins), 0) AS rollCoins
       FROM act_daily
      WHERE userId = ? AND source = ? AND day >= ?`,
    [keys.weekStart, keys.weekStart, userId, source, keys.rollingStart]
  );
}

async function creditLocked(userId, source, units, now, client, rng) {
  const def = SOURCES[source];
  const cfg = def.cfg();
  const keys = time.windowKeys(now);

  const used = await usage(userId, source, keys);
  const coinRoom = Math.max(0, Math.min(cfg.weeklyCoinCap - used.weekCoins, cfg.rolling30CoinCap - used.rollCoins));
  const unitRoom = def.ceiling(cfg) - used.weekUnits;
  if (unitRoom <= 0) {
    return { counted: false, coins: 0, units: 0, reason: 'unit-ceiling' };
  }

  const credited = Math.min(units, unitRoom);

  // Base coins before any boost.
  let base;
  if (source === 'text') {
    base = credited * cfg.coinsPerChar;
  } else {
    const hourly = cfg.coinsPerHourMin + rng() * (cfg.coinsPerHourMax - cfg.coinsPerHourMin);
    base = (credited * hourly) / 60;
  }

  const mult = await boosts.multiplier(userId, source, now);
  let pay = 0;
  if (coinRoom > 0) {
    const want = base * mult;
    pay = Math.floor(want);
    if (rng() < want - pay) pay += 1;          // unbiased rounding: 1.4 coins pays 1 or 2
    pay = Math.max(0, Math.min(pay, coinRoom)); // the caps always win
  }

  // Lifetime counters and the drop-roll carry.
  const t = (await dbx.get('SELECT chars, voiceMinutes, dropCharCarry FROM act_totals WHERE userId = ?', [userId]))
    || { chars: 0, voiceMinutes: 0, dropCharCarry: 0 };
  const total = t[def.totalsCol] + credited;

  let rolls;
  let totalsSql;
  const u = dbx.lit(userId);
  if (source === 'text') {
    const sum = t.dropCharCarry + credited;
    rolls = Math.floor(sum / settings.drops.charsPerRoll);
    const carry = sum - rolls * settings.drops.charsPerRoll;
    totalsSql = `INSERT INTO act_totals (userId, chars, dropCharCarry) VALUES (${u}, ${credited}, ${carry}) ` +
      `ON CONFLICT(userId) DO UPDATE SET chars = chars + ${credited}, dropCharCarry = ${carry};`;
  } else {
    rolls = credited;
    totalsSql = `INSERT INTO act_totals (userId, voiceMinutes) VALUES (${u}, ${credited}) ` +
      `ON CONFLICT(userId) DO UPDATE SET voiceMinutes = voiceMinutes + ${credited};`;
  }

  if (coinRoom <= 0) rolls = 0;   // no drop rolls once the coin cap is reached

  const progress = events.progressSql(
    userId,
    source === 'text' ? { textChars: credited } : { voiceMinutes: credited },
    now
  );

  await dbx.atomic([
    `INSERT INTO users (userId, balance) VALUES (${u}, ${pay}) ON CONFLICT(userId) DO UPDATE SET balance = balance + ${pay};`,
    `INSERT INTO act_daily (userId, day, source, coins, units) VALUES (${u}, ${dbx.lit(keys.today)}, ${dbx.lit(source)}, ${pay}, ${credited}) ` +
      `ON CONFLICT(userId, day, source) DO UPDATE SET coins = coins + ${pay}, units = units + ${credited};`,
    totalsSql,
    progress,
    night.sqlFor(userId, source, credited, now),
  ].filter(Boolean).join('\n'));

  // Everything above is saved. These follow-ups can fail without losing coins.
  if (progress) {
    try { await events.checkFirstTo100(userId, now, client); }
    catch (err) { console.error('[Economy] first-to-100 check failed:', err); }
  }
  let granted = [];
  let drop = null;
  try { granted = await milestones.checkLocked(userId, source, total, { now, client }); }
  catch (err) { console.error('[Economy] milestone check failed:', err); }
  try { drop = await drops.attemptLocked(userId, source, rolls, { now, client, rng }); }
  catch (err) { console.error('[Economy] drop roll failed:', err); }

  return { counted: true, coins: pay, units: credited, multiplier: mult, capped: coinRoom <= 0, milestones: granted, drop };
}

/**
 * Credits eligible activity to one member.
 * @param {string} userId
 * @param {'text'|'voice'} source
 * @param {number} units   characters (text) or minutes (voice)
 * @param {{now?:number, client?:object, rng?:Function}} [opts]
 */
async function credit(userId, source, units, opts = {}) {
  if (!SOURCES[source]) throw new Error(`Unknown activity source: ${source}`);
  if (require('../../blocklist.js').isBlocked(userId)) return { counted: false, coins: 0, units: 0, reason: 'nothing' };
  units = Math.floor(units);
  if (!(units > 0)) return { counted: false, coins: 0, units: 0, reason: 'nothing' };
  const now = opts.now ?? Date.now();
  const rng = opts.rng || settings.rng;
  return dbx.exclusive('u:' + userId, () => creditLocked(userId, source, units, now, opts.client || null, rng));
}

// ── Discord glue ─────────────────────────────────────────────────────────────

/** Called for every guild message that is not handled elsewhere. Never throws. */
async function onMessage(message, client = null) {
  try {
    if (!message || !message.author || message.author.bot || message.webhookId || message.system || !message.guild) return null;
    const content = message.content;
    if (!content || content.startsWith('/')) return null;

    const excluded = settings.text.excludedChannelIds;
    if (excluded.includes(message.channelId) || (message.channel && excluded.includes(message.channel.parentId))) return null;

    const now = Date.now();
    const chars = gate.evaluate(message.author.id, content, now);
    if (!chars) return null;
    return await credit(message.author.id, 'text', chars, { now, client: client || message.client });
  } catch (err) {
    console.error('[Economy] text credit failed:', err);
    return null;
  }
}

// Weekly usage for the inventory screen.
async function weeklyUsage(userId, now = Date.now()) {
  const keys = time.windowKeys(now);
  const out = {};
  for (const source of Object.keys(SOURCES)) {
    const u = await usage(userId, source, keys);
    const cfg = SOURCES[source].cfg();
    out[source] = {
      weekCoins: u.weekCoins, weeklyCap: cfg.weeklyCoinCap,
      rollCoins: u.rollCoins, rollingCap: cfg.rolling30CoinCap,
    };
  }
  out.resetAt = time.nextWeekResetTs(now);
  return out;
}

// Housekeeping: daily buckets older than 35 days are no longer needed.
async function pruneOld(now = Date.now()) {
  const cutoff = time.addDays(time.dayKey(now), -35);
  const r = await dbx.run('DELETE FROM act_daily WHERE day < ?', [cutoff]);
  await night.pruneOld(now);
  return r.changes;
}

module.exports = { credit, onMessage, weeklyUsage, pruneOld, usage, gate };
