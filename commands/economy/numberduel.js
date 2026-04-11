const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createDuel, isInDuel } = require('../../utils/economy/duelManager.js');
const { getBalance } = require('../../utils/economy/shopManager.js');

const ALLOWED_CHANNELS = ['1415933682748751923'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('numberduel')
    .setDescription('Challenge someone to a number guessing duel')
    .addUserOption(o => o.setName('user').setDescription('User to challenge').setRequired(true))
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    if (!ALLOWED_CHANNELS.includes(interaction.channelId)) {
      return interaction.editReply(`❌ This command can only be used in <#1415933682748751923>.`);
    }

    const initiator = interaction.user;
    const target = interaction.options.getUser('user');
    const bet = interaction.options.getInteger('bet');

    if (target.id === initiator.id) return interaction.editReply('❌ You cannot challenge yourself.');
    if (target.bot) return interaction.editReply('❌ You cannot challenge a bot.');
    if (isInDuel(initiator.id)) return interaction.editReply('❌ You are already in a duel.');
    if (isInDuel(target.id)) return interaction.editReply(`❌ <@${target.id}> is already in a duel.`);

    const balance = await getBalance(initiator.id);
    if (bet > balance) return interaction.editReply(`❌ You only have ${balance} coins.`);

    const targetBalance = await getBalance(target.id);
    if (bet > targetBalance) return interaction.editReply(`❌ <@${target.id}> only has ${targetBalance} coins.`);

    const duel = createDuel('numberduel', initiator.id, target.id, bet, {
      initiatorNumber: null,
      targetNumber: null,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`numberduel_accept_${duel.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`numberduel_decline_${duel.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({
      content: `🔢 <@${initiator.id}> challenges <@${target.id}> to a **Number Duel** for **${bet}** coins!\nBoth players secretly pick a number 1–10. Closest to the bot's number wins!\n<@${target.id}>, do you accept?`,
      components: [row],
    });

    duel.messageId = msg.id;
    duel.channelId = interaction.channelId;
  },
};
