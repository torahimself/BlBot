const { SlashCommandBuilder } = require('discord.js');
const { addMemberToRole, getActiveRoleForOwner } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addmember')
        .setDescription('Add a member to your custom role (cost 1000 coins)')
        .addUserOption(option => option.setName('user').setDescription('User to add').setRequired(true)),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
        }
        const targetUser = interaction.options.getUser('user');
        const userId = interaction.user.id;

        // The lookup and the action now run inside this function's own
        // try/catch. Before, they ran inside a database callback, where any
        // error (e.g. Discord refusing the role change) was never caught, so
        // the command just hung on "thinking…" and the coins were still taken.
        try {
            const row = await getActiveRoleForOwner(userId);
            if (!row) {
                return interaction.editReply('You do not own any custom role.');
            }
            const result = await addMemberToRole(interaction, row.roleId, targetUser);
            await interaction.editReply(result.message);
        } catch (err) {
            console.error('[addmember] Failed:', err);
            await interaction.editReply('❌ Something went wrong. You were not charged — please try again.').catch(() => {});
        }
    }
};
