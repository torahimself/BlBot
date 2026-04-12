const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createDuel, isInDuel } = require('../../utils/economy/duelManager.js');
const { getBalance } = require('../../utils/economy/shopManager.js');

const ALLOWED_CHANNELS = ['1415933682748751923', '1432459732358140106', '1357267422369026198'];

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const faces = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const face of faces) {
      const value = face === 'A' ? 11 : ['J', 'Q', 'K'].includes(face) ? 10 : parseInt(face);
      deck.push({ display: `${face}${suit}`, value });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Challenge someone to a blackjack duel')
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

    const duel = createDuel('blackjack', initiator.id, target.id, bet, {
      deck: createDeck(),
      hands: {},
      standing: {},
      busted: {},
    });
    duel.hands[initiator.id] = [];
    duel.hands[target.id] = [];
    duel.standing[initiator.id] = false;
    duel.standing[target.id] = false;
    duel.busted[initiator.id] = false;
    duel.busted[target.id] = false;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj_accept_${duel.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bj_decline_${duel.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({
      content: `🃏 <@${initiator.id}> challenges <@${target.id}> to **Blackjack** for **${bet}** coins!\n<@${target.id}>, do you accept?`,
      components: [row],
    });

    duel.messageId = msg.id;
    duel.channelId = interaction.channelId;
  },
};
