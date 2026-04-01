const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const allowedChannels = ['1464140979148689550'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buyrole')
        .setDescription('Purchase a custom role (60000 coins)'),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.reply({ content: `❌ This command can only be used in <#1464140979148689550>.`, flags: 64 });
        }

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

        const colorInput = new TextInputBuilder()
            .setCustomId('roleColor')
            .setLabel('Color (hex code, e.g., #FF0000)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('#00FF00');

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(colorInput)
        );

        await interaction.showModal(modal);
    }
};
