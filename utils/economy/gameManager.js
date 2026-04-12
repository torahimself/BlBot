const { updateBalance } = require('./shopManager.js');

const games = new Map();
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

function createGame(type, hostId, betAmount) {
  const id = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const game = {
    id, type, hostId, betAmount,
    players: [hostId],
    status: 'lobby',
    messageId: null, channelId: null,
    round: 0,
    // Russian Roulette
    rrActive: [],
    rrCurrentIdx: 0,
    rrBullets: 1,       // starts at 1/6, increments on survive, resets on death
    // Hot Potato
    potatoHolder: null,
    potatoTimeout: null,
    exploded: false,
    _lobbyTimeout: null,
  };
  games.set(id, game);
  return game;
}

function getGame(id) { return games.get(id); }

function deleteGame(id) {
  const g = games.get(id);
  if (g) {
    if (g.potatoTimeout) clearTimeout(g.potatoTimeout);
    if (g._lobbyTimeout) clearTimeout(g._lobbyTimeout);
    games.delete(id);
  }
}

function isInGame(userId) {
  for (const g of games.values()) {
    if (g.players.includes(userId)) return true;
  }
  return false;
}

// Last Man Standing — auto-runs
async function runLMS(game, client) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return deleteGame(game.id);

  let active = [...game.players];
  const pot = game.betAmount * active.length;
  game.status = 'active';

  await channel.send(`🎲 **Last Man Standing** begins! **${active.length}** players — pot: **${pot}** coins`);
  await new Promise(r => setTimeout(r, 2000));

  while (active.length > 1) {
    game.round++;
    const rolls = {};
    for (const pid of active) rolls[pid] = Math.floor(Math.random() * 6) + 1;

    const minRoll = Math.min(...Object.values(rolls));
    const losers = active.filter(pid => rolls[pid] === minRoll);
    const eliminated = losers[Math.floor(Math.random() * losers.length)];

    const lines = active.map(pid => `<@${pid}>: 🎲 **${rolls[pid]}**`);
    await channel.send(`**Round ${game.round}**\n${lines.join('\n')}\n\n💀 <@${eliminated}> rolled the lowest and is eliminated!`);

    active = active.filter(p => p !== eliminated);
    if (active.length > 1) await new Promise(r => setTimeout(r, 3000));
  }

  const winnerId = active[0];
  await updateBalance(winnerId, pot);
  await channel.send(`🏆 <@${winnerId}> is the last one standing and wins **${pot}** coins!`);
  deleteGame(game.id);
}

// Russian Roulette — sets up first turn
async function startRussianRoulette(game, client) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return deleteGame(game.id);

  game.status = 'active';
  game.rrActive = [...game.players];
  game.rrCurrentIdx = 0;
  game.rrBullets = 1;

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const pot = game.betAmount * game.players.length;
  const currentPlayer = game.rrActive[0];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr_pull_${game.id}`)
      .setLabel('Pull Trigger 🔫')
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await channel.messages.fetch(game.messageId).catch(() => null);
  const content = [
    `🔫 **Russian Roulette** — Pot: **${pot}** coins`,
    `Players: ${game.rrActive.map(p => `<@${p}>`).join(' → ')}`,
    ``,
    `<@${currentPlayer}>, it's your turn — pull the trigger!`,
  ].join('\n');

  if (msg) await msg.edit({ content, components: [row] });
  else {
    const sent = await channel.send({ content, components: [row] });
    game.messageId = sent.id;
  }
}

module.exports = {
  createGame, getGame, deleteGame, isInGame,
  runLMS, startRussianRoulette,
  games, MAX_PLAYERS, MIN_PLAYERS,
};
