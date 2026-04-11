const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createGame, getGame, deleteGame, isInGame, MAX_PLAYERS, MIN_PLAYERS } = require('../../utils/economy/gameManager.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');

const ALLOWED_CHANNELS = ['1415933682748751923', '1432459732358140106', '1357267422369026198'];

async function startHotPotato(game, client) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return deleteGame(game.id);

  game.status = 'active';
  const pot = game.betAmount * game.players.length;

  // Pick a random starting holder
  game.potatoHolder = game.players[Math.floor(Math.random() * game.players.length)];

  // Hidden timer: 15-40 seconds
  const explodeIn = Math.floor(Math.random() * 26000) + 15000;

  const buildPotatoMessage = () => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`hp_pass_${game.id}`)
        .setLabel('Pass 🥔')
        .setStyle(ButtonStyle.Primary),
    );
    return {
      content: `🥔 **Hot Potato!** Pot: **${pot}** coins\n<@${game.potatoHolder}> is holding the potato! Pass it before it explodes!\nPlayers: ${game.players.map(p => `<@${p}>`).join(', ')}`,
      components: [row],
    };
  };

  // Edit lobby message to show potato
  const origMsg = await channel.messages.fetch(game.messageId).catch(() => null);
  if (origMsg) await origMsg.edit(buildPotatoMessage());

  game.buildPotatoMessage = buildPotatoMessage;
  game.channel = channel;

  // Set the explosion timer
  game.potatoTimeout = setTimeout(async () => {
    const g = getGame(game.id);
    if (!g) return;

    const loserId = g.potatoHolder;
    const survivors = g.players.filter(p => p !== loserId);
    const share = survivors.length > 0 ? Math.floor(pot / survivors.length) : 0;

    for (const pid of survivors) {
      await updateBalance(pid, share);
    }

    const msg = await channel.messages.fetch(g.messageId).catch(() => null);
    if (msg) {
      await msg.edit({
        content: `💥 **BOOM!** <@${loserId}> was holding the potato and loses!\n${survivors.length > 0 ? `Survivors each receive **${share}** coins!` : ''}`,
        components: [],
      });
    }

    deleteGame(g.id);
  }, explodeIn);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hotpotato')
    .setDescription('Start a hot potato game')
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
        if (origMsg) await origMsg.edit({ content: '❌ **Hot Potato** cancelled — not enough players.', components: [] });
        deleteGame(g.id);
        return;
      }

      if (origMsg) await origMsg.edit({ content: `🥔 **Hot Potato** — Lobby closed! Starting with **${g.players.length}** players...`, components: [] });
      await startHotPotato(g, interaction.client);
    }, 30000);
  },

  startHotPotato,
};
