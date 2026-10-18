const { SlashCommandBuilder } = require('discord.js');
const { removeMemberFromRole, getActiveRoleForOwner } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removemember')
        .setDescription('Remove a member from your custom role')
        .addUserOption(option => option.setName('user').setDescription('User to remove').setRequired(true)),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
        }
        const targetUser = interaction.options.getUser('user');
        const userId = interaction.user.id;

        // Runs inside this function's own try/catch (it used to run inside a
        // database callback where errors were never caught and the command
        // could hang on "thinking…").
        try {
            const row = await getActiveRoleForOwner(userId);
            if (!row) {
                return interaction.editReply('You do not own any custom role.');
            }
            const result = await removeMemberFromRole(interaction, row.roleId, targetUser);
            await interaction.editReply(result.message);
        } catch (err) {
            console.error('[removemember] Failed:', err);
            await interaction.editReply('❌ Something went wrong. Please try again.').catch(() => {});
        }
    }
};
