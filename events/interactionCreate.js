const commandHandler = require('../handlers/commandHandler');
const { createCustomRole, editRole, extendRole, getBalance, ROLE_PRICE, updateBalance } = require('../utils/economy/shopManager.js');
const { activeTrades, getTrade, cancelTrade } = require('../utils/economy/tradeManager.js');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// Commands that show a modal should NOT be deferred
const MODAL_COMMANDS = ['buyrole', 'editrole'];

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // ---------- SLASH COMMANDS ----------
        if (interaction.isChatInputCommand()) {
            if (!MODAL_COMMANDS.includes(interaction.commandName)) {
                try {
                    await interaction.deferReply();
                } catch (error) {
                    console.error('Error deferring reply:', error);
                    return;
                }
            }

            const command = commandHandler.commands.get(interaction.commandName);
            if (!command) {
                if (!MODAL_COMMANDS.includes(interaction.commandName)) {
                    await interaction.editReply('❌ Command not found!');
                } else {
                    await interaction.reply({ content: '❌ Command not found!', ephemeral: true });
                }
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing command ${interaction.commandName}:`, error);
                if (!MODAL_COMMANDS.includes(interaction.commandName)) {
                    await interaction.editReply('❌ There was an error executing this command!');
                } else {
                    await interaction.reply({ content: '❌ There was an error executing this command!', ephemeral: true });
                }
            }
            return;
        }

        // ---------- BUTTONS ----------
        if (interaction.isButton()) {
            // Trade: Accept button
            if (interaction.customId.startsWith('trade_accept_')) {
                const initiatorId = interaction.customId.split('_')[2];
                // Find the trade with this initiator and target = current user
                let trade = null;
                for (const t of activeTrades.values()) {
                    if (t.initiatorId === initiatorId && t.targetId === interaction.user.id && !t.targetOffer) {
                        trade = t;
                        break;
                    }
                }
                if (!trade) {
                    return interaction.reply({ content: '❌ This trade request is no longer valid.', ephemeral: true });
                }
                // Show modal for target to enter their offer
                const modal = new ModalBuilder()
                    .setCustomId(`trade_offer_${trade.id}`)
                    .setTitle('Trade Offer')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('offer')
                                .setLabel('How many coins do you offer?')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setMinLength(1)
                        )
                    );
                await interaction.showModal(modal);
                return;
            }

            // Trade: Decline button
            if (interaction.customId.startsWith('trade_decline_')) {
                const initiatorId = interaction.customId.split('_')[2];
                let trade = null;
                for (const t of activeTrades.values()) {
                    if (t.initiatorId === initiatorId && t.targetId === interaction.user.id) {
                        trade = t;
                        break;
                    }
                }
                if (trade) {
                    cancelTrade(trade.id, `${interaction.user.tag} declined the trade.`);
                    await interaction.reply({ content: '✅ You declined the trade.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Trade no longer exists.', ephemeral: true });
                }
                return;
            }

            // Trade: Confirm button
            if (interaction.customId.startsWith('trade_confirm_')) {
                const tradeId = interaction.customId.split('_')[2];
                const trade = getTrade(tradeId);
                if (!trade) {
                    return interaction.reply({ content: '❌ Trade no longer exists.', ephemeral: true });
                }
                const userId = interaction.user.id;
                if (userId !== trade.initiatorId && userId !== trade.targetId) {
                    return interaction.reply({ content: '❌ You are not part of this trade.', ephemeral: true });
                }

                const confirmed = trade.confirm(userId);
                if (confirmed) {
                    // Execute trade: transfer coins
                    await updateBalance(trade.initiatorId, -trade.initiatorOffer);
                    await updateBalance(trade.targetId, trade.initiatorOffer);
                    await updateBalance(trade.targetId, -trade.targetOffer);
                    await updateBalance(trade.initiatorId, trade.targetOffer);

                    const initiatorUser = await interaction.client.users.fetch(trade.initiatorId);
                    const targetUser = await interaction.client.users.fetch(trade.targetId);
                    const successMsg = `✅ Trade completed!\n${initiatorUser.tag} gave ${trade.initiatorOffer} coins to ${targetUser.tag}\n${targetUser.tag} gave ${trade.targetOffer} coins to ${initiatorUser.tag}`;
                    await initiatorUser.send(successMsg).catch(console.error);
                    await targetUser.send(successMsg).catch(console.error);
                    await interaction.reply({ content: successMsg, ephemeral: true });
                } else {
                    await interaction.reply({ content: '✅ You confirmed. Waiting for the other user...', ephemeral: true });
                }
                return;
            }
        }

        // ---------- MODALS ----------
        if (interaction.isModalSubmit()) {
            // Trade offer modal
            if (interaction.customId.startsWith('trade_offer_')) {
                const tradeId = interaction.customId.split('_')[2];
                const trade = getTrade(tradeId);
                if (!trade) {
                    return interaction.reply({ content: '❌ Trade no longer exists.', ephemeral: true });
                }
                const targetOffer = parseInt(interaction.fields.getTextInputValue('offer'), 10);
                if (isNaN(targetOffer) || targetOffer < 0) {
                    return interaction.reply({ content: '❌ Invalid amount. Please enter a positive number.', ephemeral: true });
                }
                const targetBalance = await getBalance(interaction.user.id);
                if (targetOffer > targetBalance) {
                    return interaction.reply({ content: `❌ You only have ${targetBalance} coins. Cannot offer ${targetOffer}.`, ephemeral: true });
                }
                trade.setTargetOffer(targetOffer);

                // Send confirm buttons to both users
                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`trade_confirm_${trade.id}`)
                            .setLabel('Confirm Trade')
                            .setStyle(ButtonStyle.Success)
                    );

                const initiatorUser = await interaction.client.users.fetch(trade.initiatorId);
                const targetUser = await interaction.client.users.fetch(trade.targetId);
                const tradeSummary = `**Trade Summary**\n${initiatorUser.tag} offers: ${trade.initiatorOffer}\n${targetUser.tag} offers: ${trade.targetOffer}\n\nClick Confirm to finalize.`;
                await initiatorUser.send({ content: tradeSummary, components: [confirmRow] }).catch(console.error);
                await targetUser.send({ content: tradeSummary, components: [confirmRow] }).catch(console.error);

                await interaction.reply({ content: '✅ Your offer has been recorded. Both users must now click "Confirm Trade".', ephemeral: true });
                return;
            }

            // Buy role modal
            if (interaction.customId === 'buyRoleModal') {
                const roleName = interaction.fields.getTextInputValue('roleName');
                const iconUrl = interaction.fields.getTextInputValue('roleIcon');
                let attachment = null;
                if (iconUrl && iconUrl.trim() !== '') attachment = { url: iconUrl };
                const isAdmin = interaction.member.permissions.has('Administrator');
                const result = await createCustomRole(interaction, roleName, attachment, isAdmin);
                if (result.success) {
                    await interaction.reply({ content: `✅ Role ${result.role.name} created!`, ephemeral: true });
                } else {
                    await interaction.reply({ content: result.message, ephemeral: true });
                }
                return;
            }

            // Edit role modal
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
    },
};
