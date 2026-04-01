const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../utils/economy/database.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editrole')
        .setDescription('Edit your custom role name, icon, or color'),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.reply({ content: `❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`, ephemeral: true });
        }
        const userId = interaction.user.id;
        db.get('SELECT roleId FROM purchased_roles WHERE ownerId = ?', [userId], async (err, row) => {
            if (err || !row) {
                return interaction.reply({ content: 'You do not own any custom role.', ephemeral: true });
            }
            const modal = new ModalBuilder()
                .setCustomId(`editRoleModal_${row.roleId}`)
                .setTitle('Edit Custom Role');
            const nameInput = new TextInputBuilder()
                .setCustomId('newName')
                .setLabel('New Name (leave blank to keep)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);
            const iconInput = new TextInputBuilder()
                .setCustomId('newIcon')
                .setLabel('New Icon URL (any image URL)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);
            const colorInput = new TextInputBuilder()
                .setCustomId('newColor')
                .setLabel('New Color (#RRGGBB, leave blank to keep)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);
            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(iconInput),
                new ActionRowBuilder().addComponents(colorInput)
            );
            await interaction.showModal(modal);
        });
    }
};
