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
    potatoHolder: null,
    potatoTimeout: null,
    _lobbyTimeout: null,
  };
  games.set(id, game);
  return game;
}

function getGame(id) { return games.get(id); }
function deleteGame(id) { games.delete(id); }

function isInGame(userId) {
  for (const g of games.values()) {
    if (g.players.includes(userId)) return true;
  }
  return false;
}

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
    await channel.send(`**Round ${game.round}**\n${lines.join('\n')}\n\n💀 <@${eliminated}> rolled lowest and is eliminated!`);

    active = active.filter(p => p !== eliminated);
    if (active.length > 1) await new Promise(r => setTimeout(r, 3000));
  }

  const winnerId = active[0];
  await updateBalance(winnerId, pot);
  await channel.send(`🏆 <@${winnerId}> wins **${pot}** coins!`);
  deleteGame(game.id);
}

async function runRussianRoulette(game, client) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return deleteGame(game.id);

  let active = [...game.players];
  const pot = game.betAmount * active.length;
  game.status = 'active';

  await channel.send(`🔫 **Russian Roulette** begins! **${active.length}** players — last survivor wins **${pot}** coins!`);
  await new Promise(r => setTimeout(r, 2000));

  while (active.length > 1) {
    game.round++;
    await channel.send(`🔫 Round ${game.round} — spinning the chamber...`);
    await new Promise(r => setTimeout(r, 2500));

    const victimIdx = Math.floor(Math.random() * active.length);
    const victimId = active[victimIdx];

    await channel.send(`💥 **BANG!** <@${victimId}> has been eliminated!`);
    active.splice(victimIdx, 1);

    if (active.length > 1) await new Promise(r => setTimeout(r, 2500));
  }

  const winnerId = active[0];
  await updateBalance(winnerId, pot);
  await channel.send(`🏆 <@${winnerId}> is the last survivor and wins **${pot}** coins!`);
  deleteGame(game.id);
}

module.exports = {
  createGame, getGame, deleteGame, isInGame,
  runLMS, runRussianRoulette,
  games, MAX_PLAYERS, MIN_PLAYERS,
};
