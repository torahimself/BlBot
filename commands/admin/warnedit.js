const { SlashCommandBuilder } = require('discord.js');
const { editWarning, getWarningById, isWarningActive, sendLog } = require('../../utils/warn/warnManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnedit')
        .setDescription('Edit a warning\'s reason or date (staff only) — get the ID from /userhistory')
        .addIntegerOption(option => option.setName('id').setDescription('Warning ID (shown in /userhistory)').setRequired(true))
        .addStringOption(option => option.setName('field').setDescription('What to edit').setRequired(true)
            .addChoices({ name: 'reason', value: 'reason' }, { name: 'date', value: 'date' }))
        .addStringOption(option => option.setName('value').setDescription('New reason text, or new date as YYYY-MM-DD').setRequired(true)),
    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has('Administrator');
        const hasStaffRole = (config.warn.staffRoleIds || []).some(id => interaction.member.roles.cache.has(id));
        if (!isAdmin && !hasStaffRole) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        if (interaction.channelId !== config.warn.commandChannelId) {
            return interaction.editReply(`❌ This command can only be used in <#${config.warn.commandChannelId}>.`);
        }

        const id = interaction.options.getInteger('id');
        const field = interaction.options.getString('field');
        const value = interaction.options.getString('value');

        const before = await getWarningById(id);
        if (!before) {
            return interaction.editReply(`❌ No warning found with ID ${id}.`);
        }

        const result = await editWarning(id, interaction.user, field, value);
        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        const after = await getWarningById(id);

        await sendLog(interaction.client, {
            title: '✏️ Warning Edited',
            color: 0x3498DB,
            fields: [
                { name: 'User', value: `<@${before.userId}> (${before.userId})`, inline: false },
                { name: 'Edited by', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                { name: 'Warning ID', value: `${id}`, inline: true },
                { name: 'Field changed', value: field, inline: true },
                { name: 'Old value', value: String(result.oldValue).slice(0, 1000), inline: false },
                { name: 'New value', value: String(result.newValue).slice(0, 1000), inline: false },
                { name: 'Now active?', value: isWarningActive(after) ? 'Yes' : 'No', inline: true },
            ],
        });

        await interaction.editReply(`✅ Warning ${id} updated. Field \`${field}\` changed.`);
    }
};
