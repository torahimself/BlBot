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
async function sendLog(client, { title, color, fields, imageUrl }) {
  const channel = client.channels.cache.get(config.warn.logChannelId);
  if (!channel) {
    console.error(`[Warn] Log channel not found: ${config.warn.logChannelId}`);
    return;
  }
  const embed = new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setTimestamp();
  if (imageUrl) embed.setImage(imageUrl);
  await channel.send({ embeds: [embed] }).catch(err => console.error('[Warn] Failed to send log:', err.message));
}

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Discord embeds only support ONE inline image total, so this only applies
// when a SINGLE warning is being shown (DMs, single-warning logs, the
// detail view) — never in the multi-warning list view. For actual images,
// this renders the evidence directly in the embed body via setImage(),
// per spec: no "click to view" link for images. Non-image evidence (video,
// etc.) has no embed-native inline preview, so it falls back to a link —
// same real limitation encountered with video attachments elsewhere in
// this bot; there's no Discord embed field that can inline video.
function applyEvidenceToEmbed(embed, warning) {
  if (!warning.evidenceUrl) {
    embed.addFields({ name: 'Evidence', value: 'No evidence provided.', inline: false });
    return embed;
  }
  if (warning.evidenceContentType && warning.evidenceContentType.startsWith('image/')) {
    embed.setImage(warning.evidenceUrl);
    embed.addFields({ name: 'Evidence', value: 'Image shown above.', inline: false });
  } else {
    embed.addFields({ name: 'Evidence', value: `[${warning.evidenceName || 'View file'}](${warning.evidenceUrl})`, inline: false });
  }
  return embed;
}

function formatMs(ms) {
  const days = ms / 86400000;
  if (Number.isInteger(days) && days >= 1) return `${days}-day`;
  const hours = ms / 3600000;
  return Number.isInteger(hours) ? `${hours}-hour` : `${(ms / 60000).toFixed(0)}-minute`;
}

// ── DM notifications ──────────────────────────────────────────────────────────
// Sent to the WARNED USER only — never to the staff member who issued it.
// Wrapped defensively: a user with DMs closed must never break the flow.
async function dmUser(client, userId, embed) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.warn(`[Warn] Could not DM user ${userId} (DMs likely closed): ${err.message}`);
    return false;
  }
}

async function sendWarningDM(client, member, warning, activeCount) {
  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('⚠️ You have received a warning')
    .addFields(
      { name: 'Reason', value: warning.reason, inline: false },
      { name: 'Warning count', value: `${activeCount}`, inline: true },
      { name: 'Date/time', value: `<t:${Math.floor(warning.issuedAt / 1000)}:f>`, inline: true },
    )
    .setTimestamp();
  applyEvidenceToEmbed(embed, warning);
  await dmUser(client, member.id, embed);
}

async function sendPunishmentDM(client, userId, punishmentType, punishment, activeCount, warnReason) {
  let title, description;

  if (punishmentType === 'timeout') {
    title = '⏱️ You have received a timeout';
    description = `You have reached **${activeCount}** warnings, so you have received a **${formatMs(punishment.ms)}** timeout.`;
  } else if (punishmentType === 'jail') {
    title = '🔒 You have been jailed';
    description = `You have reached **${activeCount}** warnings, so you have been **jailed (${formatMs(punishment.ms)})**.`;
  } else if (punishmentType === 'ban') {
    title = '🔨 You have been banned';
    description = `You have reached **${activeCount}** warnings, so you have been **permanently banned** from the server.`;
  } else {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xC0392B)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: 'Punishment type', value: punishmentType, inline: true },
      { name: 'Trigger', value: `Reaching ${activeCount} active warnings`, inline: true },
      { name: 'Underlying warning reason', value: warnReason, inline: false },
    )
    .setTimestamp();
  await dmUser(client, userId, embed);
}

// ── Punishment execution ──────────────────────────────────────────────────────
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

      // The XP-level reset via another bot only applies to the specific
      // tier configured with resetXp:true (originally just the 8th
      // warning) — not to every jail-type punishment now that 2nd/4th/6th
      // also jail instead of timeout.
      if (punishment.resetXp) {
        await sendLog(client, {
          title: '⚠️ Manual Action Needed',
          color: 0xF1C40F,
          fields: [
            { name: 'User', value: `<@${member.id}> (${member.id})`, inline: false },
            { name: 'Action needed', value: `Run \`/remove-xp\` on <@${config.warn.xpBotId}> for this user — the warning system can't trigger another bot's command automatically.`, inline: false },
          ],
        });
      }

      if (!result.success) return { punishmentType: 'jail', punishmentAppliedAt: null, punishmentMs: punishment.ms, jailFailed: true };
      const jailRecord = await getJailRecord(member.id);
      return { punishmentType: 'jail', punishmentAppliedAt: jailRecord ? jailRecord.jailedAt : Date.now(), punishmentMs: punishment.ms };
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
  if (applied.punishmentType === 'jail') return `Jailed (${formatMs(applied.punishmentMs)})${applied.jailFailed ? ' (⚠️ jail application failed)' : ''}`;
  if (applied.punishmentType === 'ban') return `Permanent ban ("${punishment.reason}")`;
  return 'None';
}

// ── Issue a warning ───────────────────────────────────────────────────────────
async function addWarning(client, guild, member, issuedBy, reason, evidence = null) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + config.warn.expirationMs;

  const activeBefore = await getActiveWarnings(member.id);
  const warnNumberAtIssue = activeBefore.length + 1;

  const insertResult = await dbRun(
    `INSERT INTO warnings (userId, guildId, issuedBy, reason, issuedAt, expiresAt, warnNumberAtIssue, evidenceUrl, evidenceName, evidenceContentType)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [member.id, guild.id, issuedBy.id, reason, issuedAt, expiresAt, warnNumberAtIssue,
     evidence ? evidence.url : null, evidence ? evidence.name : null, evidence ? evidence.contentType : null]
  );

  const activeAfter = await getActiveWarnings(member.id);
  const activeCount = activeAfter.length;

  const punishment = config.warn.punishments[activeCount] || null;
  const applied = await applyPunishment(client, guild, member, punishment, activeCount, reason);

  await dbRun(
    'UPDATE warnings SET punishmentType = ?, punishmentAppliedAt = ?, punishmentMs = ? WHERE id = ?',
    [applied.punishmentType, applied.punishmentAppliedAt || null, applied.punishmentMs || null, insertResult.lastID]
  );

  const warningRow = await getWarningById(insertResult.lastID);

  // DM the WARNED USER (never the staff member who issued it).
  await sendWarningDM(client, member, warningRow, activeCount);
  if (punishment && applied.punishmentType !== 'none' && !applied.error) {
    await sendPunishmentDM(client, member.id, applied.punishmentType, punishment, activeCount, reason);
  }

  const isImageEvidence = evidence && evidence.contentType && evidence.contentType.startsWith('image/');

  await sendLog(client, {
    title: '⚠️ Warning Issued',
    color: 0xE67E22,
    fields: [
      { name: 'User', value: `<@${member.id}> (${member.id})`, inline: false },
      { name: 'Staff', value: `<@${issuedBy.id}> (${issuedBy.id})`, inline: false },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Evidence', value: !evidence ? 'No evidence provided.' : (isImageEvidence ? 'Image shown below.' : `[${evidence.name}](${evidence.url})`), inline: false },
      { name: 'Warning #', value: `${activeCount} (active)`, inline: true },
      { name: 'Punishment', value: describePunishment(applied, punishment), inline: true },
      { name: 'Warning ID', value: `${insertResult.lastID}`, inline: true },
    ],
    imageUrl: isImageEvidence ? evidence.url : null,
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

// ── Punishment reversal, keyed off RESULTING ACTIVE COUNT ────────────────────
// Fixed model: reversal is triggered by the user's active count dropping
// below a tier they'd previously reached — NOT by which specific warning
// record was touched. So removing warning #1 (which itself caused no
// punishment) can still correctly reverse warning #2's timeout, as long as
// the resulting active count (1) is now below warning #2's tier (2).
async function reverseSingleWarningPunishment(client, guild, warning) {
  if (!warning.punishmentType || warning.punishmentType === 'none') {
    return { hadPunishment: false, wasActive: false, actionTaken: 'none' };
  }

  const member = guild.members.cache.get(warning.userId) || await guild.members.fetch(warning.userId).catch(() => null);

  if (warning.punishmentType === 'timeout') {
    if (!member) return { hadPunishment: true, wasActive: false, actionTaken: 'user not in server, nothing to reverse' };
    const expectedUntil = warning.punishmentAppliedAt + warning.punishmentMs;
    const currentUntil = member.communicationDisabledUntilTimestamp;
    const stillActive = currentUntil && Math.abs(currentUntil - expectedUntil) < 5000 && currentUntil > Date.now();
    if (!stillActive) return { hadPunishment: true, wasActive: false, actionTaken: 'timeout already ended or was superseded, nothing to reverse' };
    await member.timeout(null, 'Active warning count dropped below this punishment\'s threshold');
    return { hadPunishment: true, wasActive: true, actionTaken: 'timeout removed' };
  }

  if (warning.punishmentType === 'jail') {
    const jailRecord = await getJailRecord(warning.userId);
    const stillActive = jailRecord && Math.abs(jailRecord.jailedAt - warning.punishmentAppliedAt) < 5000;
    if (!stillActive) return { hadPunishment: true, wasActive: false, actionTaken: 'jail already ended (or a different jail), nothing to reverse' };
    const result = await unjailUser(client, guild, warning.userId, client.user, 'Active warning count dropped below this punishment\'s threshold', null, false);
    return { hadPunishment: true, wasActive: true, actionTaken: result.success ? 'user unjailed' : `unjail failed: ${result.message}` };
  }

  if (warning.punishmentType === 'ban') {
    const punishmentConfig = config.warn.punishments[10];
    const existingBan = await guild.bans.fetch(warning.userId).catch(() => null);
    if (!existingBan || existingBan.reason !== punishmentConfig.reason) {
      return { hadPunishment: true, wasActive: false, actionTaken: 'user not currently banned under this system\'s ban reason, nothing to reverse' };
    }
    try {
      await guild.bans.remove(warning.userId, 'Active warning count dropped below this punishment\'s threshold');
      return { hadPunishment: true, wasActive: true, actionTaken: 'ban lifted' };
    } catch (err) {
      return { hadPunishment: true, wasActive: true, actionTaken: `failed to lift ban: ${err.message}` };
    }
  }

  return { hadPunishment: false, wasActive: false, actionTaken: 'none' };
}

// Call this after ANY active-count-reducing event (manual removal OR
// natural expiration). Finds every not-yet-reversed punishment whose
// triggering tier is now above the user's new active count, and reverses
// each one that's genuinely still active.
async function reversePunishmentsAboveCount(client, guild, userId, newActiveCount) {
  // NOTE: deliberately NOT filtering "removed = 0" here. When staff removes
  // the exact warning that caused a punishment, that row gets removed=1
  // BEFORE this runs — filtering on removed=0 would exclude the very
  // warning whose punishment we need to find and reverse. Eligibility for
  // reversal depends only on the tier vs. the new active count, never on
  // whether the triggering warning record itself is still "active".
  const candidates = await dbAll(
    `SELECT * FROM warnings WHERE userId = ? AND punishmentType IS NOT NULL
     AND punishmentType != 'none' AND punishmentReversed = 0 AND warnNumberAtIssue > ?`,
    [userId, newActiveCount]
  );

  const results = [];
  for (const warning of candidates) {
    const reversal = await reverseSingleWarningPunishment(client, guild, warning);
    if (reversal.wasActive) {
      await dbRun('UPDATE warnings SET punishmentReversed = 1, punishmentReversedAt = ?, punishmentReversedBy = ? WHERE id = ?',
        [Date.now(), 'system', warning.id]);
    }
    results.push({ warning, reversal });
  }
  return results;
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

  const activeAfter = await getActiveWarnings(warning.userId);

  // Threshold-based reversal — may reverse THIS warning's own punishment,
  // or a DIFFERENT warning's punishment, whichever tier is now unmet.
  const reversals = await reversePunishmentsAboveCount(client, guild, warning.userId, activeAfter.length);
  // Mark who performed the removal-triggered reversal (system function used
  // 'system' as a placeholder above; overwrite with the actual staff member).
  for (const { warning: w, reversal } of reversals) {
    if (reversal.wasActive) {
      await dbRun('UPDATE warnings SET punishmentReversedBy = ? WHERE id = ?', [removedBy.id, w.id]);
    }
  }

  const isImageEvidence = warning.evidenceContentType && warning.evidenceContentType.startsWith('image/');

  const logFields = [
    { name: 'User', value: `<@${warning.userId}> (${warning.userId})`, inline: false },
    { name: 'Removed by', value: `<@${removedBy.id}> (${removedBy.id})`, inline: false },
    { name: 'Warning ID / #', value: `${warningId} (was warning #${warning.warnNumberAtIssue})`, inline: true },
    { name: 'Original reason', value: warning.reason, inline: false },
    { name: 'Original evidence', value: !warning.evidenceUrl ? 'No evidence provided.' : (isImageEvidence ? 'Image shown below.' : `[${warning.evidenceName}](${warning.evidenceUrl})`), inline: false },
    { name: 'Removal reason', value: reason || '*(none given)*', inline: false },
    { name: 'Warning count', value: `${activeBefore.length} → ${activeAfter.length}`, inline: true },
  ];

  const activeReversals = reversals.filter(r => r.reversal.wasActive);
  if (activeReversals.length > 0) {
    for (const { warning: w, reversal } of activeReversals) {
      logFields.push({
        name: `Punishment reverted (from Warning #${w.warnNumberAtIssue})`,
        value: `Type: ${w.punishmentType}\nAction: ${reversal.actionTaken}`,
        inline: false,
      });
    }
  }

  await sendLog(client, {
    title: activeReversals.length > 0 ? '🗑️ Warning Removed + Punishment Reverted' : '🗑️ Warning Manually Removed',
    color: 0xE74C3C,
    fields: logFields,
    imageUrl: isImageEvidence ? warning.evidenceUrl : null,
  });

  return { success: true, warning, activeCountBefore: activeBefore.length, activeCountAfter: activeAfter.length, reversals };
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

    const guild = client.guilds.cache.get(warning.guildId);
    let reversals = [];
    if (guild) {
      reversals = await reversePunishmentsAboveCount(client, guild, warning.userId, activeAfter.length);
    }

    const logFields = [
      { name: 'User', value: `<@${warning.userId}> (${warning.userId})`, inline: false },
      { name: 'Warning ID', value: `${warning.id}`, inline: true },
      { name: 'Issued', value: `<t:${Math.floor(warning.issuedAt / 1000)}:f>`, inline: true },
      { name: 'Expired', value: `<t:${Math.floor(warning.expiresAt / 1000)}:f>`, inline: true },
      { name: 'Active warnings remaining', value: `${activeAfter.length}`, inline: false },
    ];

    const activeReversals = reversals.filter(r => r.reversal.wasActive);
    for (const { warning: w, reversal } of activeReversals) {
      logFields.push({
        name: `Punishment reverted (from Warning #${w.warnNumberAtIssue})`,
        value: `Type: ${w.punishmentType}\nAction: ${reversal.actionTaken}`,
        inline: false,
      });
    }

    await sendLog(client, {
      title: '⏳ Warning Expired Automatically' + (activeReversals.length > 0 ? ' + Punishment Reverted' : ''),
      color: 0x95A5A6,
      fields: logFields,
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
  applyEvidenceToEmbed,
};
