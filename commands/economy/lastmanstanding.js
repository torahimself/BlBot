const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createGame, getGame, deleteGame, isInGame, refundGame, MAX_PLAYERS, MIN_PLAYERS, runLMS } = require('../../utils/economy/gameManager.js');
const { getBalance, updateBalance, spendCoins } = require('../../utils/economy/shopManager.js');

const ALLOWED_CHANNELS = ['1415933682748751923', '1432459732358140106', '1357267422369026198'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lastmanstanding')
    .setDescription('Start a last man standing dice game')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    if (!ALLOWED_CHANNELS.includes(interaction.channelId)) {
      return interaction.editReply('❌ This command can only be used in the designated channels.');
    }

    const hostId = interaction.user.id;
    const bet = interaction.options.getInteger('bet');

    if (isInGame(hostId)) return interaction.editReply('❌ You are already in a game.');

    // Take the host's stake atomically (only succeeds if they can afford it).
    if (!(await spendCoins(hostId, bet))) {
      const balance = await getBalance(hostId);
      return interaction.editReply(`❌ You only have ${balance} coins.`);
    }

    const game = createGame('lms', hostId, bet);
    game.channelId = interaction.channelId;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`lms_join_${game.id}`).setLabel('Join Game').setStyle(ButtonStyle.Primary),
    );

    let msg;
    try {
      msg = await interaction.editReply({
        content: `🎲 **Last Man Standing** — <@${hostId}> started a game!\nBet: **${bet}** coins/player | Players (1/${MAX_PLAYERS}): <@${hostId}>\n\nGame starts in **30 seconds**!`,
        components: [row],
      });
    } catch (err) {
      // Couldn't even post the lobby — give the host their stake back and free them up.
      console.error('[Games] Last Man Standing lobby post failed:', err);
      await refundGame(game, interaction.client, 'Could not open the lobby');
      return;
    }

    game.messageId = msg.id;

    game._lobbyTimeout = setTimeout(async () => {
      try {
        const g = getGame(game.id);
        if (!g || g.status !== 'lobby') return;

        // Close the lobby right now. Everything below awaits (message fetch/edit,
        // a short sleep), and anyone who joined in that window used to be added
        // after the pot was already fixed — paying in but not counted.
        g.status = 'starting';

        const channel = interaction.client.channels.cache.get(g.channelId);
        const origMsg = await channel?.messages.fetch(g.messageId).catch(() => null);

        if (g.players.length < MIN_PLAYERS) {
          await updateBalance(hostId, bet);
          if (origMsg) await origMsg.edit({ content: '❌ **Last Man Standing** cancelled — not enough players.', components: [] }).catch(() => {});
          deleteGame(g.id);
          return;
        }

        if (origMsg) await origMsg.edit({ content: `🎲 **Last Man Standing** — Lobby closed! Starting with **${g.players.length}** players...`, components: [] });
        await runLMS(g, interaction.client);
      } catch (err) {
        console.error('[Games] Last Man Standing lobby crashed:', err);
        await refundGame(game, interaction.client, 'Last Man Standing hit an error');
      }
    }, 30000);
  },
};
