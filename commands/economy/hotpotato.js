const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createGame, getGame, deleteGame, isInGame, refundGame, MAX_PLAYERS, MIN_PLAYERS } = require('../../utils/economy/gameManager.js');
const { getBalance } = require('../../utils/economy/shopManager.js');
const { isBet, takeStakes, refundStakes, canBet, betLabel, capRefusal } = require('../../utils/economy/stakes.js');

const GAME_CHANNELS = require('../../utils/gameChannels.js');
const ALLOWED_CHANNELS = GAME_CHANNELS.IDS;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hotpotato')
    .setDescription('Start a hot potato game — last survivor wins the pot')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet (leave empty to play for free)').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    if (!ALLOWED_CHANNELS.includes(interaction.channelId)) {
      return interaction.editReply(`❌ Games can only be played in ${GAME_CHANNELS.mention}.`);
    }

    const hostId = interaction.user.id;
    const bet = interaction.options.getInteger('bet') || 0; // 0 = free game

    if (isInGame(hostId)) return interaction.editReply('❌ You are already in a game.');

    if (isBet(bet)) {
      const cap = await canBet([hostId], bet);
      if (!cap.ok) return interaction.editReply(capRefusal(hostId, false));
    }

    // Take the host's stake atomically (only succeeds if they can afford it).
    // A free game takes nothing.
    if (!(await takeStakes([hostId], bet)).ok) {
      const balance = await getBalance(hostId);
      return interaction.editReply(`❌ You only have ${balance} coins.`);
    }

    const game = createGame('hotpotato', hostId, bet);
    game.channelId = interaction.channelId;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hp_join_${game.id}`).setLabel('Join Game 🥔').setStyle(ButtonStyle.Primary),
    );

    let msg;
    try {
      msg = await interaction.editReply({
        content: `🥔 **Hot Potato** — <@${hostId}> started a game!\n${betLabel(bet)} | Players (1/${MAX_PLAYERS}): <@${hostId}>\n\nGame starts in **30 seconds**!`,
        components: [row],
      });
    } catch (err) {
      // Couldn't even post the lobby — give the host their stake back and free them up.
      console.error('[Games] Hot Potato lobby post failed:', err);
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
          await refundStakes([hostId], bet);
          if (origMsg) await origMsg.edit({ content: '❌ **Hot Potato** cancelled — not enough players joined.', components: [] }).catch(() => {});
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
      } catch (err) {
        console.error('[Games] Hot Potato lobby crashed:', err);
        await refundGame(game, interaction.client, 'Hot Potato hit an error');
      }
    }, 30000);
  },
};
