const { SlashCommandBuilder } = require('discord.js');
const { removeWarning, sendLog } = require('../../utils/warn/warnManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnremove')
        .setDescription('Manually remove a warning (staff only) — get the ID from /userhistory')
        .addIntegerOption(option => option.setName('id').setDescription('Warning ID (shown in /userhistory)').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Why this warning is being removed').setRequired(false)),
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
        const reason = interaction.options.getString('reason');

        const result = await removeWarning(id, interaction.user, reason);
        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        await sendLog(interaction.client, {
            title: '🗑️ Warning Manually Removed',
            color: 0xE74C3C,
            fields: [
                { name: 'User', value: `<@${result.warning.userId}> (${result.warning.userId})`, inline: false },
                { name: 'Removed by', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                { name: 'Warning ID', value: `${id}`, inline: true },
                { name: 'Original reason', value: result.warning.reason, inline: false },
                { name: 'Removal reason', value: reason || '*(none given)*', inline: false },
                { name: 'Active warnings after removal', value: `${result.activeCountAfter}`, inline: true },
            ],
        });

        await interaction.editReply(`✅ Warning ${id} removed. Active warnings now: **${result.activeCountAfter}**`);
    }
};
