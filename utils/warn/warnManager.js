'use strict';

const db = require('./database.js');
const config = require('../../config.js');
const { EmbedBuilder } = require('discord.js');
const { jailUser, unjailUser, getJailRecord } = require('../jail/jailManager.js');

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
// Always computed live from timestamps, never a stored counter — editing or
// removing a warning must immediately affect the count.
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

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ── Punishment execution ──────────────────────────────────────────────────────
// Returns metadata that gets stored ON the warning row, so a later removal
// can determine exactly what this specific warning caused and whether it's
// still active — without accidentally touching an unrelated punishment.
async function applyPunishment(client, guild, member, punishment, warnCount, warnReason) {
  if (!punishment) return { punishmentType: 'none' };

  const reason = `${warnCount}${ordinalSuffix(warnCount)} warning: ${warnReason}`;

  try {
    if (punishment.type === 'timeout') {
      await member.timeout(punishment.ms, reason);
      return { punishmentType: 'timeout', punishmentAppliedAt: Date.now(), punishmentMs: punishment.ms };
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
      if (!result.success) return { punishmentType: 'jail', punishmentAppliedAt: null, jailFailed: true };
      // Store the JAIL RECORD's own jailedAt (authoritative), not our own
      // clock read, so reversal can precisely match "is this the SAME jail
      // instance" rather than a later, unrelated one.
      const jailRecord = await getJailRecord(member.id);
      return { punishmentType: 'jail', punishmentAppliedAt: jailRecord ? jailRecord.jailedAt : Date.now() };
    }

    if (punishment.type === 'ban') {
      await member.ban({ reason: punishment.reason });
      return { punishmentType: 'ban', punishmentAppliedAt: Date.now() };
    }
  } catch (err) {
    console.error(`[Warn] Failed to apply punishment (${punishment.type}) to ${member.id}:`, err.message);
    return { punishmentType: 'none', error: err.message };
  }

  return { punishmentType: 'none' };
}

function describePunishment(applied, punishment) {
  if (!applied || applied.punishmentType === 'none') return applied?.error ? `⚠️ Failed to apply: ${applied.error}` : 'None';
  if (applied.punishmentType === 'timeout') return `Timeout (${Math.round(applied.punishmentMs / 3600000)}h)`;
  if (applied.punishmentType === 'jail') return `Jailed 1 day${applied.jailFailed ? ' (⚠️ jail application failed)' : ''}`;
  if (applied.punishmentType === 'ban') return `Permanent ban ("${punishment.reason}")`;
  return 'None';
}

// ── Issue a warning ───────────────────────────────────────────────────────────
async function addWarning(client, guild, member, issuedBy, reason) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + config.warn.expirationMs;

  const activeBefore = await getActiveWarnings(member.id);
  const warnNumberAtIssue = activeBefore.length + 1;

  const insertResult = await dbRun(
    `INSERT INTO warnings (userId, guildId, issuedBy, reason, issuedAt, expiresAt, warnNumberAtIssue)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [member.id, guild.id, issuedBy.id, reason, issuedAt, expiresAt, warnNumberAtIssue]
  );

  // Punishment is always based on the active count AFTER the new warning
  // is added — this only happens here, on genuine NEW warnings. Removing a
  // warning later never re-triggers this, even if the resulting count
  // happens to land on a punishment tier (e.g. 3 → 2 after a removal does
  // NOT apply the 2nd-warning punishment retroactively).
  const activeAfter = await getActiveWarnings(member.id);
  const activeCount = activeAfter.length;

  const punishment = config.warn.punishments[activeCount] || null;
  const applied = await applyPunishment(client, guild, member, punishment, activeCount, reason);

  await dbRun(
    'UPDATE warnings SET punishmentType = ?, punishmentAppliedAt = ?, punishmentMs = ? WHERE id = ?',
    [applied.punishmentType, applied.punishmentAppliedAt || null, applied.punishmentMs || null, insertResult.lastID]
  );

  await sendLog(client, {
    title: '⚠️ Warning Issued',
    color: 0xE67E22,
    fields: [
      { name: 'User', value: `<@${member.id}> (${member.id})`, inline: false },
      { name: 'Staff', value: `<@${issuedBy.id}> (${issuedBy.id})`, inline: false },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Warning #', value: `${activeCount} (active)`, inline: true },
      { name: 'Punishment', value: describePunishment(applied, punishment), inline: true },
      { name: 'Warning ID', value: `${insertResult.lastID}`, inline: true },
    ],
  });

  return { warningId: insertResult.lastID, activeCount, punishment, applied };
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

// ── Punishment reversal ───────────────────────────────────────────────────────
// Only reverses a punishment that is (a) directly caused by THIS warning,
// and (b) still currently active. Never touches a punishment that already
// ended naturally, and never touches an unrelated punishment (e.g. a
// different, later timeout/jail applied for another reason).
async function reversePunishmentIfActive(client, guild, warning) {
  if (!warning.punishmentType || warning.punishmentType === 'none') {
    return { hadPunishment: false, wasActive: false, actionTaken: 'none' };
  }
  if (warning.punishmentReversed) {
    return { hadPunishment: true, wasActive: false, actionTaken: 'already reversed previously' };
  }

  const member = guild.members.cache.get(warning.userId) || await guild.members.fetch(warning.userId).catch(() => null);

  if (warning.punishmentType === 'timeout') {
    if (!member) return { hadPunishment: true, wasActive: false, actionTaken: 'user not in server, nothing to reverse' };

    const expectedUntil = warning.punishmentAppliedAt + warning.punishmentMs;
    const currentUntil = member.communicationDisabledUntilTimestamp;

    // Only reverse if the CURRENT active timeout is the exact one this
    // warning caused (matches expected expiry) — if it's different, a
    // separate timeout was applied later for another reason; leave it alone.
    const isThisTimeoutStillActive = currentUntil && Math.abs(currentUntil - expectedUntil) < 5000 && currentUntil > Date.now();

    if (!isThisTimeoutStillActive) {
      return { hadPunishment: true, wasActive: false, actionTaken: 'timeout already ended or was superseded, nothing to reverse' };
    }

    await member.timeout(null, 'Associated warning was removed');
    return { hadPunishment: true, wasActive: true, actionTaken: 'timeout removed' };
  }

  if (warning.punishmentType === 'jail') {
    const jailRecord = await getJailRecord(warning.userId);
    // Match on jailedAt to confirm it's the SAME jail instance this warning
    // caused — if the user was unjailed and re-jailed since for another
    // reason, jailedAt won't match, and we leave that unrelated jail alone.
    const isThisJailStillActive = jailRecord && Math.abs(jailRecord.jailedAt - warning.punishmentAppliedAt) < 5000;

    if (!isThisJailStillActive) {
      return { hadPunishment: true, wasActive: false, actionTaken: 'jail already ended (or was a different jail), nothing to reverse' };
    }

    const result = await unjailUser(client, guild, warning.userId, client.user, 'Associated warning was removed', null, false);
    return { hadPunishment: true, wasActive: true, actionTaken: result.success ? 'user unjailed' : `unjail failed: ${result.message}` };
  }

  if (warning.punishmentType === 'ban') {
    const punishmentConfig = config.warn.punishments[10]; // the ban tier's configured reason
    const existingBan = await guild.bans.fetch(warning.userId).catch(() => null);

    if (!existingBan || existingBan.reason !== punishmentConfig.reason) {
      return { hadPunishment: true, wasActive: false, actionTaken: 'user is not currently banned under this warning system\'s ban reason, nothing to reverse' };
    }

    try {
      await guild.bans.remove(warning.userId, 'Associated warning was removed');
      return { hadPunishment: true, wasActive: true, actionTaken: 'ban lifted' };
    } catch (err) {
      return { hadPunishment: true, wasActive: true, actionTaken: `failed to lift ban: ${err.message}` };
    }
  }

  return { hadPunishment: false, wasActive: false, actionTaken: 'none' };
}

// ── Manually remove a warning (soft delete, audited, reverses punishment) ────
async function removeWarning(client, guild, warningId, removedBy, reason) {
  const warning = await getWarningById(warningId);
  if (!warning) return { success: false, message: 'Warning not found.' };
  if (warning.removed) return { success: false, message: 'This warning was already removed.' };

  const activeBefore = await getActiveWarnings(warning.userId);

  await dbRun(
    'UPDATE warnings SET removed = 1, removedBy = ?, removedReason = ?, removedAt = ? WHERE id = ?',
    [removedBy.id, reason || null, Date.now(), warningId]
  );

  // Removing a warning NEVER triggers a new punishment, even if the
  // resulting count lands on a punishment tier — punishments only ever
  // apply on genuine new warnings via addWarning().
  const reversal = await reversePunishmentIfActive(client, guild, warning);
  if (reversal.wasActive) {
    await dbRun('UPDATE warnings SET punishmentReversed = 1, punishmentReversedAt = ?, punishmentReversedBy = ? WHERE id = ?',
      [Date.now(), removedBy.id, warningId]);
  }

  const activeAfter = await getActiveWarnings(warning.userId);

  const logFields = [
    { name: 'User', value: `<@${warning.userId}> (${warning.userId})`, inline: false },
    { name: 'Removed by', value: `<@${removedBy.id}> (${removedBy.id})`, inline: false },
    { name: 'Warning ID / #', value: `${warningId} (was warning #${warning.warnNumberAtIssue})`, inline: true },
    { name: 'Original reason', value: warning.reason, inline: false },
    { name: 'Removal reason', value: reason || '*(none given)*', inline: false },
    { name: 'Warning count', value: `${activeBefore.length} → ${activeAfter.length}`, inline: true },
  ];

  if (reversal.hadPunishment) {
    logFields.push(
      { name: 'Original punishment', value: warning.punishmentType, inline: true },
      { name: 'Punishment status', value: reversal.wasActive ? 'Active — reversed' : 'Already inactive', inline: true },
      { name: 'Action taken', value: reversal.actionTaken, inline: false },
    );
  }

  await sendLog(client, {
    title: reversal.wasActive ? '🗑️ Warning Removed + Punishment Reversed' : '🗑️ Warning Manually Removed',
    color: 0xE74C3C,
    fields: logFields,
  });

  return { success: true, warning, activeCountBefore: activeBefore.length, activeCountAfter: activeAfter.length, reversal };
}

// ── Periodic expiration check ─────────────────────────────────────────────────
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
