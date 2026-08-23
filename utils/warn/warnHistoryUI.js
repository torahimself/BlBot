'use strict';

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../../config.js');
const {
  getActiveWarnings, getWarningById, isWarningActive,
  editWarning, removeWarning, sendLog,
} = require('./warnManager.js');

function hasAccess(member) {
  const isAdmin = member.permissions.has('Administrator');
  const hasStaffRole = (config.warn.staffRoleIds || []).some(id => member.roles.cache.has(id));
  return isAdmin || hasStaffRole;
}

// ── Active-only history list view ─────────────────────────────────────────────
// Removed and expired warnings intentionally do NOT appear here — they stay
// fully recorded in the log channel, but the interactive view only ever
// shows what's currently active, per spec.
async function buildHistoryPayload(targetUser) {
  const active = await getActiveWarnings(targetUser.id);

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('User Warning History')
    .setDescription(`**User:** <@${targetUser.id}>\n**User ID:** \`${targetUser.id}\`\n**Current Warnings:** \`${active.length}\``)
    .setTimestamp();

  if (active.length === 0) {
    embed.addFields({ name: 'No active warnings', value: 'This user has no active warnings.' });
    return { embeds: [embed], components: [] };
  }

  const sorted = active.sort((a, b) => b.issuedAt - a.issuedAt);

  for (const w of sorted.slice(0, 24)) {
    embed.addFields({
      name: `Warning #${w.warnNumberAtIssue} (ID ${w.id})`,
      value:
        `Reason: ${w.reason}\nIssued by: <@${w.issuedBy}>\nDate: <t:${Math.floor(w.issuedAt / 1000)}:d>\n` +
        `Evidence: ${w.evidenceUrl ? `[View](${w.evidenceUrl})` : 'No evidence provided.'}\n` +
        `Punishment: ${w.punishmentType && w.punishmentType !== 'none' ? `${w.punishmentType}${w.punishmentReversed ? ' (reversed)' : ''}` : 'None'}`,
      inline: false,
    });
  }
  if (sorted.length > 24) {
    embed.setFooter({ text: `Showing 24 of ${sorted.length} active warnings (most recent first).` });
  }

  const options = sorted.slice(0, 24).map(w => ({
    label: `Warning #${w.warnNumberAtIssue} — ID ${w.id}`,
    description: `${w.reason}`.slice(0, 90),
    value: String(w.id),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`warnhist_select_${targetUser.id}`)
    .setPlaceholder('Select a warning to manage...')
    .addOptions(options);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

// ── Single-warning detail view ────────────────────────────────────────────────
function buildDetailPayload(targetUserId, warning) {
  const status = isWarningActive(warning) ? '🟢 Active' : (warning.removed ? '🗑️ Removed' : '⚪ Expired');

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`Warning #${warning.warnNumberAtIssue} (ID ${warning.id})`)
    .setDescription(
      `**User:** <@${targetUserId}>\n**Reason:** ${warning.reason}\n**Issued by:** <@${warning.issuedBy}>\n` +
      `**Date:** <t:${Math.floor(warning.issuedAt / 1000)}:f>\n**Status:** ${status}\n` +
      `**Evidence:** ${warning.evidenceUrl ? `[View](${warning.evidenceUrl})` : 'No evidence provided.'}` +
      (warning.punishmentType && warning.punishmentType !== 'none'
        ? `\n**Punishment:** ${warning.punishmentType}${warning.punishmentReversed ? ' (reversed)' : ''}`
        : '')
    )
    .setTimestamp();

  const buttons = [
    new ButtonBuilder().setCustomId(`warnhist_edit_${targetUserId}_${warning.id}`).setLabel('Edit Warning').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`warnhist_remove_${targetUserId}_${warning.id}`).setLabel('Remove Warning').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`warnhist_back_${targetUserId}`).setLabel('Back to List').setStyle(ButtonStyle.Secondary),
  ];

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

// ── Interaction routing ───────────────────────────────────────────────────────

async function handleSelectMenu(interaction) {
  if (!interaction.customId.startsWith('warnhist_select_')) return false;

  if (!hasAccess(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', flags: 64 });
    return true;
  }

  const targetUserId = interaction.customId.slice('warnhist_select_'.length);
  const warningId = parseInt(interaction.values[0], 10);
  const warning = await getWarningById(warningId);

  if (!warning) {
    await interaction.update({ content: '❌ That warning no longer exists.', embeds: [], components: [] });
    return true;
  }

  await interaction.update(buildDetailPayload(targetUserId, warning));
  return true;
}

async function handleButton(interaction) {
  if (!interaction.customId.startsWith('warnhist_')) return false;

  if (!hasAccess(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', flags: 64 });
    return true;
  }

  // warnhist_back_<userId>
  if (interaction.customId.startsWith('warnhist_back_')) {
    const targetUserId = interaction.customId.slice('warnhist_back_'.length);
    const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
      await interaction.update({ content: '❌ Could not reload — user not found.', embeds: [], components: [] });
      return true;
    }
    await interaction.update(await buildHistoryPayload(targetUser));
    return true;
  }

  // warnhist_edit_<userId>_<warningId>
  if (interaction.customId.startsWith('warnhist_edit_')) {
    const [, , targetUserId, warningIdStr] = interaction.customId.split('_');
    const warning = await getWarningById(parseInt(warningIdStr, 10));
    if (!warning) {
      await interaction.reply({ content: '❌ That warning no longer exists.', flags: 64 });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`warnhist_editmodal_${targetUserId}_${warning.id}`)
      .setTitle(`Edit Warning #${warning.warnNumberAtIssue}`);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph)
      .setValue(warning.reason).setRequired(true);

    const dateInput = new TextInputBuilder()
      .setCustomId('date').setLabel('Date issued (YYYY-MM-DD, leave as-is to skip)').setStyle(TextInputStyle.Short)
      .setValue(new Date(warning.issuedAt).toISOString().slice(0, 10)).setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(dateInput),
    );

    await interaction.showModal(modal);
    return true;
  }

  // warnhist_remove_<userId>_<warningId> — opens a modal asking for the
  // removal reason, per spec (this was previously a bare confirm button
  // with no way to actually enter a reason).
  if (interaction.customId.startsWith('warnhist_remove_')) {
    const [, , targetUserId, warningIdStr] = interaction.customId.split('_');
    const warning = await getWarningById(parseInt(warningIdStr, 10));
    if (!warning) {
      await interaction.reply({ content: '❌ That warning no longer exists.', flags: 64 });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`warnhist_removemodal_${targetUserId}_${warning.id}`)
      .setTitle(`Remove Warning #${warning.warnNumberAtIssue}`);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason').setLabel('Removal reason').setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Why is this warning being removed?').setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

async function handleModal(interaction) {
  if (!interaction.customId.startsWith('warnhist_')) return false;

  if (!hasAccess(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', flags: 64 });
    return true;
  }

  // ── Edit modal ──────────────────────────────────────────────────────────
  if (interaction.customId.startsWith('warnhist_editmodal_')) {
    const parts = interaction.customId.split('_');
    const targetUserId = parts[2];
    const warningId = parseInt(parts[3], 10);

    const before = await getWarningById(warningId);
    if (!before) {
      await interaction.reply({ content: '❌ That warning no longer exists.', flags: 64 });
      return true;
    }

    const newReason = interaction.fields.getTextInputValue('reason');
    const newDate = interaction.fields.getTextInputValue('date');

    let reasonResult = null, dateResult = null;
    if (newReason !== before.reason) {
      reasonResult = await editWarning(warningId, interaction.user, 'reason', newReason);
    }
    const beforeDateStr = new Date(before.issuedAt).toISOString().slice(0, 10);
    if (newDate !== beforeDateStr) {
      dateResult = await editWarning(warningId, interaction.user, 'date', newDate);
      if (!dateResult.success) {
        await interaction.reply({ content: `❌ ${dateResult.message}`, flags: 64 });
        return true;
      }
    }

    const after = await getWarningById(warningId);

    if (reasonResult || dateResult) {
      const fields = [
        { name: 'User', value: `<@${targetUserId}> (${targetUserId})`, inline: false },
        { name: 'Edited by', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
        { name: 'Warning ID / #', value: `${warningId} (#${before.warnNumberAtIssue})`, inline: true },
      ];
      if (reasonResult) fields.push(
        { name: 'Old reason', value: reasonResult.oldValue, inline: false },
        { name: 'New reason', value: reasonResult.newValue, inline: false },
      );
      if (dateResult) fields.push(
        { name: 'Old date', value: beforeDateStr, inline: true },
        { name: 'New date', value: newDate, inline: true },
      );
      fields.push({ name: 'Now active?', value: isWarningActive(after) ? 'Yes' : 'No', inline: true });
      await sendLog(interaction.client, { title: '✏️ Warning Edited', color: 0x3498DB, fields });
    }

    // If the edit made it no longer active (e.g. backdated past expiry),
    // it drops out of the active-only list — go back to the refreshed list
    // rather than showing a detail view for a warning that's no longer shown there.
    const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (targetUser) {
      await interaction.update(await buildHistoryPayload(targetUser));
    } else {
      await interaction.update({ content: '✅ Warning updated.', embeds: [], components: [] });
    }
    return true;
  }

  // ── Remove modal (reason required) ─────────────────────────────────────
  if (interaction.customId.startsWith('warnhist_removemodal_')) {
    const parts = interaction.customId.split('_');
    const targetUserId = parts[2];
    const warningId = parseInt(parts[3], 10);
    const reason = interaction.fields.getTextInputValue('reason');

    const result = await removeWarning(interaction.client, interaction.guild, warningId, interaction.user, reason);
    if (!result.success) {
      await interaction.reply({ content: `❌ ${result.message}`, flags: 64 });
      return true;
    }

    const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
    const payload = targetUser ? await buildHistoryPayload(targetUser) : { content: '✅ Warning removed.', embeds: [], components: [] };
    await interaction.update(payload);
    return true;
  }

  return false;
}

module.exports = {
  hasAccess,
  buildHistoryPayload,
  handleSelectMenu,
  handleButton,
  handleModal,
};
