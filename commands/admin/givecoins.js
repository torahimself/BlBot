const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { updateBalance } = require('../../utils/economy/shopManager.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('givecoins')
        .setDescription('Give coins to a user (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('user').setDescription('User to give coins to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount of coins to give').setRequired(true).setMinValue(1)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        await updateBalance(targetUser.id, amount);
        await interaction.editReply(`✅ Successfully gave **${amount}** coins to ${targetUser.tag}.`);
    }
};
