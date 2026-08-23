'use strict';

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../../config.js');
const {
  getAllWarnings, getActiveWarnings, getWarningById, isWarningActive,
  editWarning, removeWarning, sendLog,
} = require('./warnManager.js');

function hasAccess(member) {
  const isAdmin = member.permissions.has('Administrator');
  const hasStaffRole = (config.warn.staffRoleIds || []).some(id => member.roles.cache.has(id));
  return isAdmin || hasStaffRole;
}

// ── Full history list view ────────────────────────────────────────────────────
async function buildHistoryPayload(targetUser) {
  const warnings = await getAllWarnings(targetUser.id);
  const activeCount = warnings.filter(w => isWarningActive(w)).length;

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('User Warning History')
    .setDescription(`**User:** <@${targetUser.id}>\n**User ID:** \`${targetUser.id}\`\n**Current Warnings:** \`${activeCount}\``)
    .setTimestamp();

  if (warnings.length === 0) {
    embed.addFields({ name: 'No warnings', value: 'This user has no warning history.' });
    return { embeds: [embed], components: [] };
  }

  for (const w of warnings.slice(0, 24)) {
    const status = w.removed ? '🗑️ Removed' : (isWarningActive(w) ? '🟢 Active' : '⚪ Expired');
    embed.addFields({
      name: `Warning #${w.warnNumberAtIssue} (ID ${w.id})`,
      value: `Reason: ${w.reason}\nIssued by: <@${w.issuedBy}>\nDate: <t:${Math.floor(w.issuedAt / 1000)}:d>\nStatus: ${status}`,
      inline: false,
    });
  }
  if (warnings.length > 24) {
    embed.setFooter({ text: `Showing 24 of ${warnings.length} total (most recent first). Select menu shows the same 24.` });
  }

  const options = warnings.slice(0, 24).map(w => ({
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

// ── Single-warning detail view (after selecting from the menu) ───────────────
function buildDetailPayload(targetUserId, warning) {
  const status = warning.removed ? '🗑️ Removed' : (isWarningActive(warning) ? '🟢 Active' : '⚪ Expired');

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`Warning #${warning.warnNumberAtIssue} (ID ${warning.id})`)
    .setDescription(
      `**User:** <@${targetUserId}>\n**Reason:** ${warning.reason}\n**Issued by:** <@${warning.issuedBy}>\n` +
      `**Date:** <t:${Math.floor(warning.issuedAt / 1000)}:f>\n**Status:** ${status}` +
      (warning.punishmentType && warning.punishmentType !== 'none' ? `\n**Punishment:** ${warning.punishmentType}${warning.punishmentReversed ? ' (reversed)' : ''}` : '')
    )
    .setTimestamp();

  const buttons = [
    new ButtonBuilder().setCustomId(`warnhist_edit_${targetUserId}_${warning.id}`).setLabel('Edit Warning').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`warnhist_remove_${targetUserId}_${warning.id}`).setLabel('Remove Warning').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`warnhist_back_${targetUserId}`).setLabel('Back to List').setStyle(ButtonStyle.Secondary),
  ];

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

function buildRemoveConfirmPayload(targetUserId, warning) {
  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('Confirm Removal')
    .setDescription(`Remove Warning #${warning.warnNumberAtIssue} (ID ${warning.id}) — "${warning.reason}"?\n\nIf this warning still has an **active** punishment tied to it, that punishment will also be reversed.`);

  const buttons = [
    new ButtonBuilder().setCustomId(`warnhist_removeconfirm_${targetUserId}_${warning.id}`).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`warnhist_removecancel_${targetUserId}_${warning.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
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

  // warnhist_remove_<userId>_<warningId>
  if (interaction.customId.startsWith('warnhist_remove_') && !interaction.customId.startsWith('warnhist_removeconfirm_') && !interaction.customId.startsWith('warnhist_removecancel_')) {
    const [, , targetUserId, warningIdStr] = interaction.customId.split('_');
    const warning = await getWarningById(parseInt(warningIdStr, 10));
    if (!warning) {
      await interaction.reply({ content: '❌ That warning no longer exists.', flags: 64 });
      return true;
    }
    await interaction.update(buildRemoveConfirmPayload(targetUserId, warning));
    return true;
  }

  // warnhist_removeconfirm_<userId>_<warningId>
  if (interaction.customId.startsWith('warnhist_removeconfirm_')) {
    const parts = interaction.customId.split('_');
    const targetUserId = parts[2];
    const warningId = parseInt(parts[3], 10);

    const result = await removeWarning(interaction.client, interaction.guild, warningId, interaction.user, null);
    if (!result.success) {
      await interaction.update({ content: `❌ ${result.message}`, embeds: [], components: [] });
      return true;
    }

    const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
    const payload = targetUser ? await buildHistoryPayload(targetUser) : { content: '✅ Warning removed.', embeds: [], components: [] };
    await interaction.update(payload);
    return true;
  }

  // warnhist_removecancel_<userId>_<warningId>
  if (interaction.customId.startsWith('warnhist_removecancel_')) {
    const parts = interaction.customId.split('_');
    const warningId = parseInt(parts[3], 10);
    const warning = await getWarningById(warningId);
    if (!warning) {
      await interaction.update({ content: '❌ That warning no longer exists.', embeds: [], components: [] });
      return true;
    }
    await interaction.update(buildDetailPayload(parts[2], warning));
    return true;
  }

  return false;
}

async function handleModal(interaction) {
  if (!interaction.customId.startsWith('warnhist_editmodal_')) return false;

  if (!hasAccess(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to use this.', flags: 64 });
    return true;
  }

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
      { name: 'Old date', value: reasonResult ? beforeDateStr : String(dateResult.oldValue), inline: true },
      { name: 'New date', value: newDate, inline: true },
    );
    fields.push({ name: 'Now active?', value: isWarningActive(after) ? 'Yes' : 'No', inline: true });

    await sendLog(interaction.client, { title: '✏️ Warning Edited', color: 0x3498DB, fields });
  }

  const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
  if (targetUser) {
    await interaction.update(buildDetailPayload(targetUserId, after));
  } else {
    await interaction.update({ content: '✅ Warning updated.', embeds: [], components: [] });
  }
  return true;
}

module.exports = {
  hasAccess,
  buildHistoryPayload,
  handleSelectMenu,
  handleButton,
  handleModal,
};
