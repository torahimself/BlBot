const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createGame, getGame, deleteGame, isInGame, MAX_PLAYERS, MIN_PLAYERS } = require('../../utils/economy/gameManager.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');

const ALLOWED_CHANNELS = ['1415933682748751923', '1432459732358140106', '1357267422369026198'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hotpotato')
    .setDescription('Start a hot potato game — last survivor wins the pot')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    if (!ALLOWED_CHANNELS.includes(interaction.channelId)) {
      return interaction.editReply('❌ This command can only be used in the designated channels.');
    }

    const hostId = interaction.user.id;
    const bet = interaction.options.getInteger('bet');

    if (isInGame(hostId)) return interaction.editReply('❌ You are already in a game.');

    const balance = await getBalance(hostId);
    if (bet > balance) return interaction.editReply(`❌ You only have ${balance} coins.`);

    await updateBalance(hostId, -bet);

    const game = createGame('hotpotato', hostId, bet);
    game.channelId = interaction.channelId;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hp_join_${game.id}`).setLabel('Join Game 🥔').setStyle(ButtonStyle.Primary),
    );

    const msg = await interaction.editReply({
      content: `🥔 **Hot Potato** — <@${hostId}> started a game!\nBet: **${bet}** coins/player | Players (1/${MAX_PLAYERS}): <@${hostId}>\n\nGame starts in **30 seconds**!`,
      components: [row],
    });

    game.messageId = msg.id;

    game._lobbyTimeout = setTimeout(async () => {
      const g = getGame(game.id);
      if (!g || g.status !== 'lobby') return;

      const channel = interaction.client.channels.cache.get(g.channelId);
      const origMsg = await channel?.messages.fetch(g.messageId).catch(() => null);

      if (g.players.length < MIN_PLAYERS) {
        await updateBalance(hostId, bet);
        if (origMsg) await origMsg.edit({ content: '❌ **Hot Potato** cancelled — not enough players joined.', components: [] });
        deleteGame(g.id);
        return;
      }

      // Store total pot so it stays correct even as players get eliminated
      g._totalPot = g.betAmount * g.players.length;

      if (origMsg) await origMsg.edit({ content: `🥔 **Hot Potato** — Lobby closed! Starting with **${g.players.length}** players...`, components: [] });
      await new Promise(r => setTimeout(r, 1500));

      // Import here to avoid circular dependency
      const { startHotPotato } = require('../../handlers/gameHandler.js');
      await startHotPotato(g, interaction.client);
    }, 30000);
  },
};
