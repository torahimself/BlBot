const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { purchaseRole, getBalance, ROLE_PRICE } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1464140979148689550']; // only shop channel

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buyrole')
        .setDescription('Purchase a custom role (12000 coins)'),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1464140979148689550>.`);
        }
        const userId = interaction.user.id;
        const balance = await getBalance(userId);
        if (balance < ROLE_PRICE) {
            return interaction.editReply(`❌ You need ${ROLE_PRICE} coins. You have ${balance}.`);
        }
        // Show modal to get name and icon
        const modal = new ModalBuilder()
            .setCustomId('buyRoleModal')
            .setTitle('Create Custom Role');
        const nameInput = new TextInputBuilder()
            .setCustomId('roleName')
            .setLabel('Role Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);
        const iconInput = new TextInputBuilder()
            .setCustomId('roleIcon')
            .setLabel('Icon URL (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(iconInput)
        );
        await interaction.showModal(modal);
    }
};
