'use strict';

const db = require('./database.js');
const config = require('../../config.js');
const { EmbedBuilder } = require('discord.js');
const { jailUser } = require('../jail/jailManager.js');

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

// ── Queries ───────────────────────────────────────────────────────────────────
// "Active" = not manually removed AND not yet past its individual expiry.
// This is always computed live from timestamps, never a stored counter —
// per spec, editing/removing a warning must immediately affect the count.
async function getActiveWarnings(userId) {
  const now = Date.now();
  const all = await dbAll('SELECT * FROM warnings WHERE userId = ? AND removed = 0', [userId]);
  return all.filter(w => w.expiresAt > now);
}

async function getAllWarnings(userId) {
  return dbAll('SELECT * FROM warnings WHERE userId = ? ORDER BY issuedAt DESC', [userId]);
}

async function getWarningById(id) {
  return dbGet('SELECT * FROM warnings WHERE id = ?', [id]);
}

function isWarningActive(warning) {
  return warning.removed === 0 && warning.expiresAt > Date.now();
}

// ── Logging ───────────────────────────────────────────────────────────────────
async function sendLog(client, { title, color, fields }) {
  const channel = client.channels.cache.get(config.warn.logChannelId);
  if (!channel) {
    console.error(`[Warn] Log channel not found: ${config.warn.logChannelId}`);
    return;
  }
  const embed = new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setTimestamp();
  await channel.send({ embeds: [embed] }).catch(err => console.error('[Warn] Failed to send log:', err.message));
}

// ── Punishment execution ──────────────────────────────────────────────────────
async function applyPunishment(client, guild, member, punishment, warnCount, warnReason) {
  if (!punishment) return { applied: 'none' };

  const reason = `${warnCount}${ordinalSuffix(warnCount)} warning: ${warnReason}`;

  try {
    if (punishment.type === 'timeout') {
      await member.timeout(punishment.ms, reason);
      return { applied: 'timeout', ms: punishment.ms };
    }

    if (punishment.type === 'jail') {
      const result = await jailUser(client, guild, member, client.user, reason, punishment.ms, null);
      // Manual-action reminder: no Discord API lets one bot invoke another
      // bot's slash command, so the XP-level reset can't be automated.
      await sendLog(client, {
        title: '⚠️ Manual Action Needed',
        color: 0xF1C40F,
        fields: [
          { name: 'User', value: `<@${member.id}> (${member.id})`, inline: false },
          { name: 'Action needed', value: `Run \`/remove-xp\` on <@${config.warn.xpBotId}> for this user — the warning system can't trigger another bot's command automatically.`, inline: false },
        ],
      });
      return { applied: 'jail', jailSuccess: result.success };
    }

    if (punishment.type === 'ban') {
      await member.ban({ reason: punishment.reason });
      return { applied: 'ban', reason: punishment.reason };
    }
  } catch (err) {
    console.error(`[Warn] Failed to apply punishment (${punishment.type}) to ${member.id}:`, err.message);
    return { applied: 'failed', error: err.message };
  }

  return { applied: 'none' };
}

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ── Issue a warning ───────────────────────────────────────────────────────────
async function addWarning(client, guild, member, issuedBy, reason) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + config.warn.expirationMs;

  // Active count BEFORE this warning, so we know what number this one is.
  const activeBefore = await getActiveWarnings(member.id);
  const warnNumberAtIssue = activeBefore.length + 1;

  const insertResult = await dbRun(
    `INSERT INTO warnings (userId, guildId, issuedBy, reason, issuedAt, expiresAt, warnNumberAtIssue)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [member.id, guild.id, issuedBy.id, reason, issuedAt, expiresAt, warnNumberAtIssue]
  );

  // Recompute active count AFTER insert — punishment is always based on the
  // count after the new warning is added, per spec.
  const activeAfter = await getActiveWarnings(member.id);
  const activeCount = activeAfter.length;

  const punishment = config.warn.punishments[activeCount] || null;
  const punishmentResult = await applyPunishment(client, guild, member, punishment, activeCount, reason);

  await sendLog(client, {
    title: '⚠️ Warning Issued',
    color: 0xE67E22,
    fields: [
      { name: 'User', value: `<@${member.id}> (${member.id})`, inline: false },
      { name: 'Staff', value: `<@${issuedBy.id}> (${issuedBy.id})`, inline: false },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Warning #', value: `${activeCount} (active)`, inline: true },
      { name: 'Punishment', value: describePunishment(punishmentResult, punishment), inline: true },
      { name: 'Warning ID', value: `${insertResult.lastID}`, inline: true },
    ],
  });

  return { warningId: insertResult.lastID, activeCount, punishment, punishmentResult };
}

function describePunishment(result, punishment) {
  if (!punishment || result.applied === 'none') return 'None';
  if (result.applied === 'failed') return `⚠️ Failed to apply: ${result.error}`;
  if (result.applied === 'timeout') return `Timeout (${Math.round(punishment.ms / 3600000)}h)`;
  if (result.applied === 'jail') return `Jailed 1 day${result.jailSuccess ? '' : ' (⚠️ jail application failed)'}`;
  if (result.applied === 'ban') return `Permanent ban ("${punishment.reason}")`;
  return 'None';
}

// ── Edit a warning (audited) ──────────────────────────────────────────────────
async function editWarning(warningId, editedBy, field, newValue) {
  const warning = await getWarningById(warningId);
  if (!warning) return { success: false, message: 'Warning not found.' };

  let oldValue, updateQuery, updateParams;

  if (field === 'reason') {
    oldValue = warning.reason;
    updateQuery = 'UPDATE warnings SET reason = ? WHERE id = ?';
    updateParams = [newValue, warningId];
  } else if (field === 'date') {
    const newIssuedAt = new Date(newValue).getTime();
    if (isNaN(newIssuedAt)) return { success: false, message: 'Invalid date. Use format YYYY-MM-DD.' };
    oldValue = new Date(warning.issuedAt).toISOString();
    const newExpiresAt = newIssuedAt + config.warn.expirationMs;
    updateQuery = 'UPDATE warnings SET issuedAt = ?, expiresAt = ?, expiredLogged = 0 WHERE id = ?';
    updateParams = [newIssuedAt, newExpiresAt, warningId];
  } else {
    return { success: false, message: 'Field must be "reason" or "date".' };
  }

  await dbRun(updateQuery, updateParams);
  await dbRun(
    `INSERT INTO warning_edits (warningId, editedBy, editedAt, fieldChanged, oldValue, newValue)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [warningId, editedBy.id, Date.now(), field, String(oldValue), String(newValue)]
  );

  return { success: true, oldValue, newValue };
}

// ── Manually remove a warning (soft delete, audited) ──────────────────────────
async function removeWarning(warningId, removedBy, reason) {
  const warning = await getWarningById(warningId);
  if (!warning) return { success: false, message: 'Warning not found.' };
  if (warning.removed) return { success: false, message: 'This warning was already removed.' };

  await dbRun(
    'UPDATE warnings SET removed = 1, removedBy = ?, removedReason = ?, removedAt = ? WHERE id = ?',
    [removedBy.id, reason || null, Date.now(), warningId]
  );

  const activeAfter = await getActiveWarnings(warning.userId);
  return { success: true, warning, activeCountAfter: activeAfter.length };
}

// ── Periodic expiration check ─────────────────────────────────────────────────
// Doesn't delete anything — expiry is already computed live from
// expiresAt. This just LOGS each expiration once (expiredLogged flag
// prevents re-logging the same expiry every cycle).
async function runExpirationCheck(client) {
  const now = Date.now();
  const newlyExpired = await dbAll(
    'SELECT * FROM warnings WHERE removed = 0 AND expiredLogged = 0 AND expiresAt <= ?',
    [now]
  );

  for (const warning of newlyExpired) {
    await dbRun('UPDATE warnings SET expiredLogged = 1 WHERE id = ?', [warning.id]);
    const activeAfter = await getActiveWarnings(warning.userId);

    await sendLog(client, {
      title: '⏳ Warning Expired',
      color: 0x95A5A6,
      fields: [
        { name: 'User', value: `<@${warning.userId}> (${warning.userId})`, inline: false },
        { name: 'Warning ID', value: `${warning.id}`, inline: true },
        { name: 'Issued', value: `<t:${Math.floor(warning.issuedAt / 1000)}:f>`, inline: true },
        { name: 'Expired', value: `<t:${Math.floor(warning.expiresAt / 1000)}:f>`, inline: true },
        { name: 'Active warnings remaining', value: `${activeAfter.length}`, inline: false },
      ],
    });
  }

  if (newlyExpired.length > 0) {
    console.log(`[Warn] Expiration check: ${newlyExpired.length} warning(s) newly expired and logged.`);
  }
}

function startExpirationCheck(client) {
  setInterval(() => {
    runExpirationCheck(client).catch(err => console.error('[Warn] Expiration check error:', err.message));
  }, config.warn.checkIntervalMs);
  console.log(`⚠️ Warning system expiration check started (every ${config.warn.checkIntervalMs / 60000} min)`);
}

module.exports = {
  addWarning,
  editWarning,
  removeWarning,
  getActiveWarnings,
  getAllWarnings,
  getWarningById,
  isWarningActive,
  runExpirationCheck,
  startExpirationCheck,
  sendLog,
};
