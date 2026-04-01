const commandHandler = require('../handlers/commandHandler');
const shopManager = require('../utils/economy/shopManager.js'); // import entire module
const { activeTrades, getTrade, cancelTrade } = require('../utils/economy/tradeManager.js');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const MODAL_COMMANDS = ['buyrole', 'editrole'];
const processingBuyRole = new Set();

// Destructure needed functions
const { createCustomRole, editRole, extendRole, getBalance, ROLE_PRICE, updateBalance } = shopManager;

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
                    await interaction.reply({ content: '❌ Command not found!', flags: 64 });
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
                    try {
                        await interaction.reply({ content: '❌ There was an error executing this command!', flags: 64 });
                    } catch (replyError) {
                        console.error('Could not reply to interaction:', replyError);
                    }
                }
            }
            return;
        }

// ---------- BUTTONS ----------
if (interaction.isButton()) {
    if (interaction.customId.startsWith('trade_accept_')) {
        const tradeId = interaction.customId.split('_')[2];
        const trade = getTrade(tradeId);
        if (!trade) {
            return interaction.reply({ content: '❌ This trade request is no longer valid (maybe expired).', flags: 64 });
        }
        if (trade.targetId !== interaction.user.id) {
            return interaction.reply({ content: '❌ This trade is not for you.', flags: 64 });
        }
        if (trade.targetOffer !== null) {
            return interaction.reply({ content: '❌ You already set an offer for this trade.', flags: 64 });
        }

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

    if (interaction.customId.startsWith('trade_decline_')) {
        const tradeId = interaction.customId.split('_')[2];
        const trade = getTrade(tradeId);
        if (!trade) {
            return interaction.reply({ content: '❌ Trade no longer exists.', flags: 64 });
        }
        if (trade.targetId !== interaction.user.id) {
            return interaction.reply({ content: '❌ This trade is not for you.', flags: 64 });
        }
        cancelTrade(trade.id, `${interaction.user.tag} declined the trade.`);
        const channel = interaction.channel;
        const originalMsg = await channel.messages.fetch(trade.messageId).catch(() => null);
        if (originalMsg) {
            await originalMsg.edit({ content: `❌ Trade cancelled: ${interaction.user.tag} declined.`, components: [] });
        }
        await interaction.reply({ content: '✅ You declined the trade.', flags: 64 });
        return;
    }

    if (interaction.customId.startsWith('trade_confirm_')) {
        const tradeId = interaction.customId.split('_')[2];
        const trade = getTrade(tradeId);
        if (!trade) {
            return interaction.reply({ content: '❌ Trade no longer exists.', flags: 64 });
        }
        const userId = interaction.user.id;
        if (userId !== trade.initiatorId && userId !== trade.targetId) {
            return interaction.reply({ content: '❌ You are not part of this trade.', flags: 64 });
        }

        const confirmed = trade.confirm(userId);
        if (confirmed) {
            await updateBalance(trade.initiatorId, -trade.initiatorOffer);
            await updateBalance(trade.targetId, trade.initiatorOffer);
            await updateBalance(trade.targetId, -trade.targetOffer);
            await updateBalance(trade.initiatorId, trade.targetOffer);

            const initiatorUser = await interaction.client.users.fetch(trade.initiatorId);
            const targetUser = await interaction.client.users.fetch(trade.targetId);
            const successMsg = `✅ Trade completed!\n${initiatorUser.tag} gave ${trade.initiatorOffer} coins to ${targetUser.tag}\n${targetUser.tag} gave ${trade.targetOffer} coins to ${initiatorUser.tag}`;

            const channel = interaction.channel;
            const originalMsg = await channel.messages.fetch(trade.messageId).catch(() => null);
            if (originalMsg) {
                await originalMsg.edit({ content: successMsg, components: [] });
            } else {
                await channel.send(successMsg);
            }
            await interaction.reply({ content: '✅ Trade completed!', flags: 64 });
        } else {
            await interaction.reply({ content: '✅ You confirmed. Waiting for the other user...', flags: 64 });
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
        return interaction.reply({ content: '❌ Trade no longer exists.', flags: 64 });
    }
    const targetOffer = parseInt(interaction.fields.getTextInputValue('offer'), 10);
    if (isNaN(targetOffer) || targetOffer < 0) {
        return interaction.reply({ content: '❌ Invalid amount. Please enter a positive number.', flags: 64 });
    }
    const targetBalance = await getBalance(interaction.user.id);
    if (targetOffer > targetBalance) {
        return interaction.reply({ content: `❌ You only have ${targetBalance} coins. Cannot offer ${targetOffer}.`, flags: 64 });
    }
    trade.setTargetOffer(targetOffer);

    // Update the original message to show both offers
    const channel = interaction.channel;
    const originalMsg = await channel.messages.fetch(trade.messageId).catch(() => null);
    if (originalMsg) {
        const initiatorUser = await interaction.client.users.fetch(trade.initiatorId);
        const targetUser = await interaction.client.users.fetch(trade.targetId);
        const tradeSummary = `**Trade Summary**\n${initiatorUser.tag} offers: ${trade.initiatorOffer}\n${targetUser.tag} offers: ${trade.targetOffer}\n\nBoth users must now click "Confirm Trade" below.`;
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`trade_confirm_${trade.id}`)
                    .setLabel('Confirm Trade')
                    .setStyle(ButtonStyle.Success)
            );
        await originalMsg.edit({ content: tradeSummary, components: [confirmRow] });
    }

    await interaction.reply({ content: '✅ Your offer has been recorded. Both users must now click "Confirm Trade".', flags: 64 });
    return;
}

            // Buy role modal
            if (interaction.customId === 'buyRoleModal') {
                const userId = interaction.user.id;

                if (processingBuyRole.has(userId)) {
                    await interaction.reply({ content: '❌ Your role is already being created. Please wait.', flags: 64 });
                    return;
                }
                processingBuyRole.add(userId);

                try {
                    const roleName = interaction.fields.getTextInputValue('roleName');
                    let iconUrl = interaction.fields.getTextInputValue('roleIcon');
                    let colorHex = interaction.fields.getTextInputValue('roleColor');

                    let attachment = null;
                    if (iconUrl && iconUrl.trim() !== '') {
                        attachment = { url: iconUrl };
                    }

                    if (colorHex && colorHex.trim() !== '') {
                        const hexRegex = /^#([0-9A-Fa-f]{6})$/;
                        if (!hexRegex.test(colorHex)) {
                            await interaction.reply({ content: '❌ Invalid color format. Use #RRGGBB (e.g., #FF0000).', flags: 64 });
                            return;
                        }
                    } else {
                        colorHex = '#00FF00';
                    }

                    // Check if user already owns a role
                    const db = require('../utils/economy/database.js');
                    const existingRole = await new Promise((resolve) => {
                        db.get('SELECT roleId FROM purchased_roles WHERE ownerId = ?', [userId], (err, row) => {
                            resolve(row);
                        });
                    });
                    if (existingRole) {
                        await interaction.reply({ content: '❌ You already own a custom role. Use /myrole to manage it.', flags: 64 });
                        return;
                    }

                    const isAdmin = interaction.member.permissions.has('Administrator');
                    const balance = await getBalance(userId);
                    if (!isAdmin && balance < ROLE_PRICE) {
                        await interaction.reply({ content: `❌ You need ${ROLE_PRICE} coins. You have ${balance}.`, flags: 64 });
                        return;
                    }

                    const result = await createCustomRole(interaction, roleName, attachment, colorHex, isAdmin);
                    if (result.success) {
                        await interaction.reply({ content: `✅ Role ${result.role.name} created!`, flags: 64 });
                    } else {
                        await interaction.reply({ content: result.message, flags: 64 });
                    }
                } catch (error) {
                    console.error('Error in buyRoleModal:', error);
                    try {
                        await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 });
                    } catch (replyError) {
                        console.error('Could not reply to modal:', replyError);
                    }
                } finally {
                    processingBuyRole.delete(userId);
                }
                return;
            }

            // Edit role modal
            if (interaction.customId.startsWith('editRoleModal_')) {
                const roleId = interaction.customId.split('_')[1];
                const newName = interaction.fields.getTextInputValue('newName');
                const newIcon = interaction.fields.getTextInputValue('newIcon');
                const newColor = interaction.fields.getTextInputValue('newColor');
                let attachment = null;
                if (newIcon && newIcon.trim() !== '') {
                    attachment = { url: newIcon };
                }
                let colorHex = null;
                if (newColor && newColor.trim() !== '') {
                    const hexRegex = /^#([0-9A-Fa-f]{6})$/;
                    if (!hexRegex.test(newColor)) {
                        await interaction.reply({ content: '❌ Invalid color format. Use #RRGGBB.', flags: 64 });
                        return;
                    }
                    colorHex = newColor;
                }
                const result = await editRole(interaction, roleId, newName || null, attachment, colorHex);
                await interaction.reply({ content: result.message, flags: 64 });
                return;
            }
        }
    },
};
