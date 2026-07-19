'use strict';

const db = require('./database.js');
const config = require('../../config.js');

// ── Duration parsing ──────────────────────────────────────────────────────────
// Accepts combos like "1d", "3h", "45m", "1d12h30m". Returns milliseconds,
// or null if the string is empty/unparseable (treated as "no auto-unjail").
function parseDuration(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const regex = /(\d+)\s*(d|h|m)/g;
  let totalMs = 0;
  let matched = false;
  let m;
  while ((m = regex.exec(trimmed)) !== null) {
    matched = true;
    const value = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'd') totalMs += value * 24 * 60 * 60 * 1000;
    else if (unit === 'h') totalMs += value * 60 * 60 * 1000;
    else if (unit === 'm') totalMs += value * 60 * 1000;
  }

  if (!matched || totalMs <= 0) return null;
  return totalMs;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : '0m';
}

// ── DB helpers (promisified) ──────────────────────────────────────────────────
function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) { err ? reject(err) : resolve(this); });
  });
}

async function getJailRecord(userId) {
  return dbGet('SELECT * FROM jailed_users WHERE userId = ?', [userId]);
}

async function getAllJailRecords() {
  return dbAll('SELECT * FROM jailed_users');
}

// ── Log embed helper ──────────────────────────────────────────────────────────
async function sendLog(client, { title, color, fields, evidenceAttachment }) {
  const channel = client.channels.cache.get(config.jail.logChannelId);
  if (!channel) {
    console.error(`[Jail] Log channel not found: ${config.jail.logChannelId}`);
    return;
  }

  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();

  const payload = { embeds: [embed] };

  // Evidence attachments are already hosted on Discord's CDN (uploaded as
  // part of the slash command itself) — forward the same URL as a file
  // source rather than re-downloading/re-uploading, discord.js resolves a
  // URL string directly.
  if (evidenceAttachment) {
    payload.files = [{ attachment: evidenceAttachment.url, name: evidenceAttachment.name }];
  }

  await channel.send(payload).catch(err => console.error('[Jail] Failed to send log:', err.message));
}

// ── Jail a user ────────────────────────────────────────────────────────────────
async function jailUser(client, guild, member, jailedBy, reason, durationMs, evidenceAttachment) {
  const existing = await getJailRecord(member.id);
  if (existing) {
    return { success: false, message: 'This user is already jailed. Use `/unjail` first if you want to re-jail them.' };
  }

  // Save every role except @everyone and Discord-managed roles (booster
  // role, bot integration roles, etc.) — those can't be manually assigned
  // back by the bot anyway, so saving them would just cause errors on unjail.
  const previousRoles = member.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .map(r => r.id);

  const jailedAt = Date.now();
  const releaseAt = durationMs ? jailedAt + durationMs : null;

  await dbRun(
    `INSERT INTO jailed_users (userId, guildId, jailedBy, reason, jailedAt, releaseAt, previousRoles)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [member.id, guild.id, jailedBy.id, reason, jailedAt, releaseAt, JSON.stringify(previousRoles)]
  );

  try {
    await member.roles.set([config.jail.jailRoleId], `Jailed by ${jailedBy.tag}: ${reason}`);
  } catch (err) {
    // Roll back the DB record if we couldn't actually apply the jail role,
    // so we don't end up with a "jailed" record that doesn't match reality.
    await dbRun('DELETE FROM jailed_users WHERE userId = ?', [member.id]);
    return { success: false, message: `Failed to apply jail role: ${err.message}` };
  }

  const durationLabel = durationMs ? formatDuration(durationMs) : 'Permanent (no auto-unjail)';

  await sendLog(client, {
    title: '🔒 User Jailed',
    color: 0xE74C3C,
    fields: [
      { name: 'Moderator', value: `<@${jailedBy.id}> (${jailedBy.id})`, inline: false },
      { name: 'Jailed User', value: `<@${member.id}> (${member.id})`, inline: false },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Duration', value: durationLabel, inline: false },
      { name: 'Roles Saved', value: `${previousRoles.length} role(s)`, inline: false },
    ],
    evidenceAttachment,
  });

  return { success: true, previousRoleCount: previousRoles.length, releaseAt };
}

// ── Unjail a user ──────────────────────────────────────────────────────────────
async function unjailUser(client, guild, userId, unjailedBy, reason, evidenceAttachment, isAuto = false) {
  const record = await getJailRecord(userId);
  if (!record) {
    return { success: false, message: 'This user is not currently jailed.' };
  }

  await dbRun('DELETE FROM jailed_users WHERE userId = ?', [userId]);

  let previousRoles = [];
  try {
    previousRoles = JSON.parse(record.previousRoles || '[]');
  } catch { /* ignore malformed data, restore with no roles rather than crash */ }

  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);

  if (member) {
    // Only restore roles that still exist in the guild (a role may have
    // been deleted while the user was jailed).
    const validRoles = previousRoles.filter(id => guild.roles.cache.has(id));
    try {
      await member.roles.set(validRoles, `Unjailed by ${isAuto ? 'System (auto)' : unjailedBy.tag}: ${reason}`);
    } catch (err) {
      console.error(`[Jail] Failed to restore roles for ${userId}:`, err.message);
    }
  }
  // If member isn't in the guild, there's nothing to restore right now —
  // the record is already deleted, so if they rejoin later they will NOT
  // be re-jailed (correct: they were properly unjailed).

  await sendLog(client, {
    title: isAuto ? '🔓 User Auto-Unjailed (Time Expired)' : '🔓 User Unjailed',
    color: 0x2ECC71,
    fields: [
      { name: 'Moderator', value: isAuto ? 'System (automatic)' : `<@${unjailedBy.id}> (${unjailedBy.id})`, inline: false },
      { name: 'Unjailed User', value: `<@${userId}> (${userId})`, inline: false },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Roles Restored', value: member ? `${previousRoles.length} role(s)` : 'User not in server — nothing to restore', inline: false },
    ],
    evidenceAttachment,
  });

  return { success: true };
}

// ── Rejoin handling ──────────────────────────────────────────────────────────
// Called from the guildMemberAdd event. If the rejoining user has an active
// jail record, immediately re-apply the jail role so leaving/rejoining can't
// be used to escape it.
async function handleRejoin(client, member) {
  const record = await getJailRecord(member.id);
  if (!record) return;

  try {
    await member.roles.set([config.jail.jailRoleId], 'Re-jailed on rejoin (jail record still active)');
    await sendLog(client, {
      title: '🔁 Jailed User Rejoined — Re-Jailed',
      color: 0xE67E22,
      fields: [
        { name: 'User', value: `<@${member.id}> (${member.id})`, inline: false },
        { name: 'Original Reason', value: record.reason, inline: false },
        { name: 'Note', value: 'This user left and rejoined while still jailed. Jail role has been automatically re-applied.', inline: false },
      ],
    });
  } catch (err) {
    console.error(`[Jail] Failed to re-jail rejoining user ${member.id}:`, err.message);
  }
}

// ── Periodic background check ─────────────────────────────────────────────────
// Runs every config.jail.checkIntervalMs. Two jobs:
//   1. Auto-unjail anyone whose releaseAt has passed.
//   2. For jailed users still in the guild, verify their role state hasn't
//      drifted (e.g. someone manually restored a role outside /unjail) and
//      re-enforce if needed.
// Users who are jailed but NOT currently in the guild are left alone here —
// handleRejoin() takes care of them the moment they come back.
async function runPeriodicCheck(client) {
  const records = await getAllJailRecords();
  if (records.length === 0) return;

  const now = Date.now();
  let autoUnjailed = 0;
  let reenforced = 0;

  for (const record of records) {
    const guild = client.guilds.cache.get(record.guildId);
    if (!guild) continue;

    // 1. Expired sentence → auto-unjail
    if (record.releaseAt && now >= record.releaseAt) {
      try {
        await unjailUser(client, guild, record.userId, client.user, 'Jail time expired', null, true);
        autoUnjailed++;
      } catch (err) {
        console.error(`[Jail] Auto-unjail failed for ${record.userId}:`, err.message);
      }
      // Small delay to stay well clear of rate limits during bulk expiry.
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    // 2. Still jailed, still in guild → verify role state hasn't drifted
    const member = guild.members.cache.get(record.userId);
    if (!member) continue; // not currently in server — handled on rejoin

    const hasJailRole = member.roles.cache.has(config.jail.jailRoleId);
    const hasExtraRoles = member.roles.cache.some(r => r.id !== guild.id && r.id !== config.jail.jailRoleId);

    if (!hasJailRole || hasExtraRoles) {
      try {
        await member.roles.set([config.jail.jailRoleId], 'Jail state re-enforced (drift detected)');
        reenforced++;
      } catch (err) {
        console.error(`[Jail] Failed to re-enforce jail state for ${record.userId}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }

  if (autoUnjailed > 0 || reenforced > 0) {
    console.log(`[Jail] Periodic check: ${autoUnjailed} auto-unjailed, ${reenforced} re-enforced (of ${records.length} total jailed)`);
  }
}

function startPeriodicCheck(client) {
  setInterval(() => {
    runPeriodicCheck(client).catch(err => console.error('[Jail] Periodic check error:', err.message));
  }, config.jail.checkIntervalMs);
  console.log(`🔒 Jail system periodic check started (every ${config.jail.checkIntervalMs / 60000} min)`);
}

module.exports = {
  parseDuration,
  formatDuration,
  jailUser,
  unjailUser,
  handleRejoin,
  runPeriodicCheck,
  startPeriodicCheck,
  getJailRecord,
  getAllJailRecords,
};
