const commandHandler = require('../handlers/commandHandler');
const { createCustomRole, editRole, extendRole, getBalance, ROLE_PRICE } = require('../utils/economy/shopManager.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // Slash commands
        if (interaction.isChatInputCommand()) {
            // Always defer reply immediately to avoid timeout
            try {
                await interaction.deferReply();
            } catch (error) {
                console.error('Error deferring reply:', error);
                return;
            }

            const command = commandHandler.commands.get(interaction.commandName);
            if (!command) {
                await interaction.editReply('❌ Command not found!');
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing command ${interaction.commandName}:`, error);
                await interaction.editReply('❌ There was an error executing this command!');
            }
            return;
        }

        // Modals
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'buyRoleModal') {
                const roleName = interaction.fields.getTextInputValue('roleName');
                const iconUrl = interaction.fields.getTextInputValue('roleIcon');
                let attachment = null;
                if (iconUrl && iconUrl.trim() !== '') {
                    attachment = { url: iconUrl };
                }
                const userId = interaction.user.id;
                const balance = await getBalance(userId);
                if (balance < ROLE_PRICE) {
                    await interaction.reply({ content: `❌ You need ${ROLE_PRICE} coins. You have ${balance}.`, ephemeral: true });
                    return;
                }
                const result = await createCustomRole(interaction, roleName, attachment);
                if (result.success) {
                    await interaction.reply({ content: `✅ Role ${result.role.name} created!`, ephemeral: true });
                } else {
                    await interaction.reply({ content: result.message, ephemeral: true });
                }
                return;
            }
            if (interaction.customId.startsWith('editRoleModal_')) {
                const roleId = interaction.customId.split('_')[1];
                const newName = interaction.fields.getTextInputValue('newName');
                const newIcon = interaction.fields.getTextInputValue('newIcon');
                let attachment = null;
                if (newIcon && newIcon.trim() !== '') attachment = { url: newIcon };
                const result = await editRole(interaction, roleId, newName || null, attachment);
                await interaction.reply({ content: result.message, ephemeral: true });
                return;
            }
        }

        // Buttons (role extension)
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('extend_role_')) {
                const roleId = interaction.customId.split('_')[2];
                const userId = interaction.user.id;
                const result = await extendRole(roleId, userId);
                await interaction.reply({ content: result.message, ephemeral: true });
                return;
            }
        }
    },
};
