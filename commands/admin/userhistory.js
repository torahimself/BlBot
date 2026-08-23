const { SlashCommandBuilder } = require('discord.js');
const { hasAccess, buildHistoryPayload } = require('../../utils/warn/warnHistoryUI.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userhistory')
        .setDescription('View and manage a user\'s warning history (staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to look up').setRequired(true)),
    async execute(interaction) {
        if (!hasAccess(interaction.member)) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        if (interaction.channelId !== config.warn.commandChannelId) {
            return interaction.editReply(`❌ This command can only be used in <#${config.warn.commandChannelId}>.`);
        }

        const targetUser = interaction.options.getUser('user');
        const payload = await buildHistoryPayload(targetUser);

        await interaction.editReply(payload);
    }
};
