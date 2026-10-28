const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createDuel, isInDuel } = require('../../utils/economy/duelManager.js');
const { getBalance } = require('../../utils/economy/shopManager.js');
const { isBet, canBet, capRefusal } = require('../../utils/economy/stakes.js');

const GAME_CHANNELS = require('../../utils/gameChannels.js');
const ALLOWED_CHANNELS = GAME_CHANNELS.IDS;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Challenge someone to a coin flip duel')
    .addUserOption(o => o.setName('user').setDescription('User to challenge').setRequired(true))
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet (leave empty to play for free)').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    if (!ALLOWED_CHANNELS.includes(interaction.channelId)) {
      return interaction.editReply(`❌ Games can only be played in ${GAME_CHANNELS.mention}.`);
    }

    const initiator = interaction.user;
    const target = interaction.options.getUser('user');
    const bet = interaction.options.getInteger('bet') || 0; // 0 = free game

    if (target.id === initiator.id) return interaction.editReply('❌ You cannot challenge yourself.');
    if (target.bot) return interaction.editReply('❌ You cannot challenge a bot.');
    if (isInDuel(initiator.id)) return interaction.editReply('❌ You are already in a duel.');
    if (isInDuel(target.id)) return interaction.editReply(`❌ <@${target.id}> is already in a duel.`);

    if (isBet(bet)) {
      const balance = await getBalance(initiator.id);
      if (bet > balance) return interaction.editReply(`❌ You only have ${balance} coins.`);

      const targetBalance = await getBalance(target.id);
      if (bet > targetBalance) return interaction.editReply(`❌ <@${target.id}> only has ${targetBalance} coins.`);

      // Anyone already at the weekly net-profit cap can only play for free.
      const cap = await canBet([initiator.id, target.id], bet);
      if (!cap.ok) return interaction.editReply(capRefusal(cap.userId, cap.userId !== initiator.id));
    }

    // initiatorSide will be set after target accepts
    const duel = createDuel('coinflip', initiator.id, target.id, bet, { initiatorSide: null });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`coinflip_accept_${duel.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`coinflip_decline_${duel.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({
      content: `🪙 <@${initiator.id}> challenges <@${target.id}> to a **Coin Flip** ${isBet(bet) ? `for **${bet}** coins` : '(free game, no bet)'}!\n<@${target.id}>, do you accept?`,
      components: [row],
    });

    duel.messageId = msg.id;
    duel.channelId = interaction.channelId;
  },
};
