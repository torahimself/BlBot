const { SlashCommandBuilder } = require('discord.js');
const { removeMemberFromRole } = require('../../utils/economy/shopManager.js');
const db = require('../../utils/economy/database.js');
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
        db.get('SELECT roleId FROM purchased_roles WHERE ownerId = ?', [userId], async (err, row) => {
            if (err || !row) {
                return interaction.editReply('You do not own any custom role.');
            }
            const result = await removeMemberFromRole(interaction, row.roleId, targetUser);
            await interaction.editReply(result.message);
        });
    }
};
