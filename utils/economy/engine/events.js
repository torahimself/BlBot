'use strict';
// Seasonal community events (Halloween first, Christmas later).
//
// SCORING   Each member earns up to 100 Candy 🍬: ≤30 from eligible voice,
//           ≤30 from eligible typing and ≤40 from party games. Points come from the SAME filtered,
//           capped activity that earns coins — so spam and idle voice earn
//           nothing here either.
// COMMUNITY Everyone's points add up. Bronze / Silver / Gold are targets for
//           that total.
// REWARDS   Nothing is paid while the event runs. When it ends, the community's
//           final total fixes which tiers were reached. Every member who has at
//           least `qualifyAt` points then receives the rewards of EVERY tier
//           reached (cumulative) — including someone who only got to 50 points
//           on the last day. Each member is paid exactly once (claim guard).
// ENDING    The event stops counting by itself at its end time; the developer
//           is messaged with the results.

const settings = require('./settings');
const dbx = require('./dbx');
const time = require('./time');
const boosts = require('./boosts');
const notify = require('./notify');

function current() {
  return settings.events.list[settings.events.current] || null;
}

function window(ev) {
  const startAt = Date.parse(ev.startAt);
  return { startAt, endAt: startAt + ev.durationDays * 24 * 60 * 60 * 1000 };
}

// 'none' | 'upcoming' | 'active' | 'ended'
function phase(now = Date.now(), ev = current()) {
  if (!ev) return 'none';
  const { startAt, endAt } = window(ev);
  if (now < startAt) return 'upcoming';
  if (now < endAt) return 'active';
  return 'ended';
}

// Whole points only, so what a member sees is exactly what qualifies them.
function pointsOf(ev, { textChars = 0, voiceMinutes = 0, games = 0 } = {}) {
  const p = ev.points;
  const voice = Math.min(p.voiceMax, Math.floor(voiceMinutes / p.voiceMinutesPerPoint));
  const text = Math.min(p.textMax, Math.floor(textChars / p.textCharsPerPoint));
  const g = Math.min(p.gamesMax || 0, Math.floor(games) * (p.pointsPerGame || 0));
  return { voice, text, games: g, total: voice + text + g };
}

// SQL that records activity for the event (empty string when no event is running).
// activity.js adds it to the same transaction that pays the coins.
function progressSql(userId, delta, now, ev = current()) {
  if (!ev || phase(now, ev) !== 'active') return '';
  const t = Math.max(0, Math.floor(delta.textChars || 0));
  const v = Math.max(0, Math.floor(delta.voiceMinutes || 0));
  const g = Math.max(0, Math.floor(delta.games || 0));
  if (t + v + g === 0) return '';
  return `INSERT INTO event_points (eventId, userId, textChars, voiceMinutes, games) VALUES (${dbx.lit(ev.id)}, ${dbx.lit(userId)}, ${t}, ${v}, ${g}) ` +
    `ON CONFLICT(eventId, userId) DO UPDATE SET textChars = textChars + ${t}, voiceMinutes = voiceMinutes + ${v}, games = games + ${g};`;
}

/**
 * Records that these members finished a party game (counts toward the games
 * part of the event score). Does nothing outside the event window. The games
 * module only calls this for real, finished games with enough players.
 */
async function recordGames(userIds, now = Date.now(), credited = null) {   // `credited` (optional array) receives the ids that got the point
  const ev = current();
  if (!ev || phase(now, ev) !== 'active') return 0;
  const perDay = ev.points.gamesPerDayMax || 0;
  await dbx.run(`CREATE TABLE IF NOT EXISTS event_game_days (
    eventId TEXT NOT NULL, userId TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (eventId, userId, day))`);
  const day = time.dayKey(now);
  let n = 0;
  for (const id of new Set(userIds)) {
    await dbx.exclusive('u:' + id, async () => {
      if (perDay > 0) {
        const row = await dbx.get('SELECT n FROM event_game_days WHERE eventId = ? AND userId = ? AND day = ?', [ev.id, id, day]);
        if (row && row.n >= perDay) return;          // today's quota of counted games is used up
      }
      await dbx.atomic(
        `INSERT INTO event_game_days (eventId, userId, day, n) VALUES (${dbx.lit(ev.id)}, ${dbx.lit(id)}, ${dbx.lit(day)}, 1) ` +
        `ON CONFLICT(eventId, userId, day) DO UPDATE SET n = n + 1;\n` + progressSql(id, { games: 1 }, now, ev));
      n++;
      if (credited) credited.push(id);
    });
  }
  return n;
}

async function getState(ev) {
  const { startAt, endAt } = window(ev);
  await dbx.run(
    "INSERT OR IGNORE INTO event_state (eventId, startAt, endAt, status) VALUES (?, ?, ?, 'scheduled')",
    [ev.id, startAt, endAt]
  );
  // Keep the stored schedule in step with settings.js until the event is being finalised.
  await dbx.run("UPDATE event_state SET startAt = ?, endAt = ? WHERE eventId = ? AND status = 'scheduled'", [startAt, endAt, ev.id]);
  return dbx.get('SELECT * FROM event_state WHERE eventId = ?', [ev.id]);
}

// Community totals, computed in SQL so it scales to thousands of members.
async function communityAgg(ev) {
  const p = ev.points;
  const num = (n) => Number(n);
  const row = await dbx.get(
    `SELECT COUNT(*) AS participants,
            COALESCE(SUM(pts), 0) AS total,
            COALESCE(SUM(CASE WHEN pts >= ${num(p.qualifyAt)} THEN 1 ELSE 0 END), 0) AS qualified
       FROM (SELECT MIN(${num(p.voiceMax)}, voiceMinutes / ${num(p.voiceMinutesPerPoint)})
                  + MIN(${num(p.textMax)},  textChars    / ${num(p.textCharsPerPoint)})
                  + MIN(${num(p.gamesMax || 0)}, games * ${num(p.pointsPerGame || 0)}) AS pts
               FROM event_points WHERE eventId = ?)`,
    [ev.id]
  );
  return { participants: row.participants, total: row.total, qualified: row.qualified };
}

async function summary(userId, now = Date.now()) {
  const ev = current();
  if (!ev) return null;
  const { startAt, endAt } = window(ev);
  const st = await getState(ev);
  const agg = await communityAgg(ev);

  let result = null;
  try { result = st.result ? JSON.parse(st.result) : null; } catch (_) { result = null; }

  const row = userId
    ? await dbx.get('SELECT textChars, voiceMinutes, games FROM event_points WHERE eventId = ? AND userId = ?', [ev.id, userId])
    : null;
  const pts = pointsOf(ev, row || {});
  const paid = userId
    ? await dbx.get('SELECT claimedAt FROM event_rewards WHERE eventId = ? AND userId = ?', [ev.id, userId])
    : null;

  const reachedKeys = result ? result.tiers : ev.tiers.filter(t => agg.total >= t.target).map(t => t.key);
  return {
    ev, startAt, endAt, now,
    phase: phase(now, ev),
    status: st.status,
    community: {
      ...agg,
      tiers: ev.tiers.map(t => ({ ...t, reached: reachedKeys.includes(t.key) })),
    },
    me: {
      textChars: row ? row.textChars : 0,
      voiceMinutes: row ? row.voiceMinutes : 0,
      gamesPlayed: row ? row.games : 0,
      ...pts,
      qualified: pts.total >= ev.points.qualifyAt,
    },
    rewarded: !!paid,
    result,
  };
}

// Pays ONE member the rewards of every reached tier, once.
async function grantTo(ev, userId, reached, now, rng) {
  const already = await dbx.get('SELECT 1 AS x FROM event_rewards WHERE eventId = ? AND userId = ?', [ev.id, userId]);
  if (already) return false;

  const potions = [];
  for (const t of reached) {
    for (let i = 0; i < (t.textPotions || 0); i++) potions.push({ type: 'text', hours: boosts.rollHours(rng), source: 'event' });
    for (let i = 0; i < (t.voicePotions || 0); i++) potions.push({ type: 'voice', hours: boosts.rollHours(rng), source: 'event' });
  }
  await dbx.atomic(dbx.bundleSql({
    userId,
    coins: reached.reduce((a, t) => a + (t.coins || 0), 0),
    potions,
    titles: reached.map(t => ({ id: t.title.id, category: 'event' })),
    claim: { table: 'event_rewards', cols: { eventId: ev.id, userId, claimedAt: now } },
    now,
  }));
  return true;
}

/**
 * Called every minute. Does nothing until the event's end time has passed, then
 * fixes the result, pays every qualifying member and announces it. Safe to call
 * again after a crash: the result is stored before anyone is paid and each
 * member is paid at most once, so it simply carries on.
 */
async function finalizeIfDue(client, now = Date.now(), { rng = settings.rng } = {}) {
  const ev = current();
  if (!ev) return null;
  if (now < window(ev).endAt) return null;

  return dbx.exclusive('event:' + ev.id, async () => {
    const st = await getState(ev);
    if (st.status === 'finished') return null;

    let result = null;
    try { result = st.result ? JSON.parse(st.result) : null; } catch (_) { result = null; }
    if (!result) {
      const agg = await communityAgg(ev);
      result = {
        total: agg.total,
        participants: agg.participants,
        qualified: agg.qualified,
        tiers: ev.tiers.filter(t => agg.total >= t.target).map(t => t.key),
        finalizedAt: now,
      };
      await dbx.run("UPDATE event_state SET status = 'finalizing', result = ? WHERE eventId = ?", [JSON.stringify(result), ev.id]);
    }

    const reached = ev.tiers.filter(t => result.tiers.includes(t.key));
    if (reached.length) {
      const rows = await dbx.all('SELECT userId, textChars, voiceMinutes, games FROM event_points WHERE eventId = ?', [ev.id]);
      for (const r of rows) {
        if (pointsOf(ev, r).total < ev.points.qualifyAt) continue;
        await grantTo(ev, r.userId, reached, now, rng);
      }
    }

    const paid = await dbx.get('SELECT COUNT(*) AS n FROM event_rewards WHERE eventId = ?', [ev.id]);
    result.rewarded = paid.n;
    await dbx.run("UPDATE event_state SET status = 'finished', result = ? WHERE eventId = ?", [JSON.stringify(result), ev.id]);

    await announce(client, ev, result).catch(err => console.error('[Event] announce failed:', err.message));
    return result;
  });
}

async function announce(client, ev, result) {
  const tierLine = ev.tiers
    .map(t => `${t.emoji} ${t.label}: ${result.tiers.includes(t.key) ? '✅ reached' : '❌ not reached'} (${t.target.toLocaleString('en-US')})`)
    .join('\n');
  const summaryText =
    `${ev.emoji} **${ev.name} — final results**\n` +
    `Community total: **${Math.floor(result.total).toLocaleString('en-US')}** 🍬 Candy from **${result.participants.toLocaleString('en-US')}** members\n` +
    `${tierLine}\n\n` +
    (result.tiers.length
      ? `**${result.rewarded.toLocaleString('en-US')}** members with ${ev.points.qualifyAt}+ Candy have received the rewards for every tier reached. Check **/inventory** and **/profile**!`
      : 'No tier was reached this time, so no rewards were paid. Thank you for taking part!');

  if (client && ev.announceChannelId) {
    const ch = await client.channels.fetch(ev.announceChannelId).catch(() => null);
    if (ch && ch.isTextBased()) await ch.send(summaryText).catch(() => {});
  }

  await notify.notifyDeveloper(client,
    `${summaryText}\n\n` +
    `🛠️ **The event has ended and every reward has been paid.**\n` +
    `You can now remove the event from GitHub:\n` +
    `• delete \`commands/economy/event.js\` (removes /event)\n` +
    `• in \`utils/economy/engine/settings.js\` set \`events.current\` to \`null\` (or delete the \`${ev.id}\` block)\n` +
    `Then re-register the slash commands and restart.\n` +
    `✅ This is safe: coins, potions and titles already given are stored in the database, and the titles are described in \`eventTitles\`, so nothing members earned is touched.`);
}

// Keeps one live progress message up to date (only if progressChannelId is set).
async function updateProgressMessage(client, now = Date.now()) {
  const ev = current();
  if (!client || !ev || !ev.progressChannelId) return;
  const ph = phase(now, ev);
  if (ph === 'upcoming' || ph === 'none') return;

  const ch = await client.channels.fetch(ev.progressChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const st = await getState(ev);
  const { communityEmbed } = require('./views');
  const payload = { content: '', embeds: [communityEmbed(await summary(null, now))] };

  if (st.progressMessageId) {
    const msg = await ch.messages.fetch(st.progressMessageId).catch(() => null);
    if (msg) { await msg.edit(payload).catch(() => {}); return; }
  }
  const sent = await ch.send(payload).catch(() => null);
  if (sent) await dbx.run('UPDATE event_state SET progressChannelId = ?, progressMessageId = ? WHERE eventId = ?', [ch.id, sent.id, ev.id]);
}

module.exports = {
  current, window, phase, pointsOf, progressSql, recordGames, communityAgg, summary,
  finalizeIfDue, updateProgressMessage, getState,
};
