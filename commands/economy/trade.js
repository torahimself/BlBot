const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { activeTrades, createTrade, cancelTrade } = require('../../utils/economy/tradeManager.js');
const { getBalance } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Trade coins with another user')
        .addUserOption(option => option.setName('user').setDescription('User to trade with').setRequired(true))
        .addIntegerOption(option => option.setName('offer').setDescription('Amount of coins you offer').setRequired(true).setMinValue(0)),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
        }

        const initiator = interaction.user;
        const target = interaction.options.getUser('user');
        if (target.id === initiator.id) {
            return interaction.editReply('❌ You cannot trade with yourself.');
        }

        const initiatorOffer = interaction.options.getInteger('offer');
        const initiatorBalance = await getBalance(initiator.id);
        if (initiatorOffer > initiatorBalance) {
            return interaction.editReply(`❌ You only have ${initiatorBalance} coins. Cannot offer ${initiatorOffer}.`);
        }

        // Check if either user is already in a trade
        let activeTradeExists = false;
        for (const trade of activeTrades.values()) {
            if (trade.initiatorId === initiator.id || trade.targetId === initiator.id ||
                trade.initiatorId === target.id || trade.targetId === target.id) {
                activeTradeExists = true;
                break;
            }
        }
        if (activeTradeExists) {
            return interaction.editReply('❌ One of the users is already in a trade. Please wait for the current trade to finish.');
        }

        const trade = createTrade(initiator.id, target.id, initiatorOffer);
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`trade_accept_${initiator.id}`)
                    .setLabel('Accept Trade')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`trade_decline_${initiator.id}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger)
            );

        // Send message in the channel, mentioning both users
        const msg = await interaction.editReply({
            content: `${initiator.tag} wants to trade with ${target.tag}. They offer **${initiatorOffer}** coins.\n${target}, do you accept?`,
            components: [row]
        });

        // Store the message ID so we can later update/delete it if needed (optional)
        // Not necessary for functionality but useful for cleanup
        trade.channelId = interaction.channelId;
        trade.messageId = msg.id;
    }
};
