const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { updateBalance, getBalance } = require('../../utils/economy/shopManager.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removecoins')
        .setDescription('Remove coins from a user (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('user').setDescription('User to remove coins from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount of coins to remove').setRequired(true).setMinValue(1)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const balance = await getBalance(targetUser.id);
        if (balance < amount) {
            return interaction.editReply(`❌ User ${targetUser.tag} only has ${balance} coins. Cannot remove ${amount}.`);
        }
        await updateBalance(targetUser.id, -amount);
        await interaction.editReply(`✅ Successfully removed **${amount}** coins from ${targetUser.tag}.`);
    }
};
