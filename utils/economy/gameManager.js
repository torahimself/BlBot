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
    messageId: null, channelId: null, guildId: null,
    round: 0,
    // Russian Roulette
    rrActive: [],        // surviving player IDs
    rrShooter: null,     // current shooter ID (random each round)
    rrBullets: 1,        // bullet count, increments on miss, resets on kill
    rrTurnTimeout: null, // 15s AFK timeout for current shooter
    // Hot Potato
    potatoHolder: null,
    potatoTimeout: null,
    exploded: false,
    _lobbyTimeout: null,
    _totalPot: 0,
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
    if (g.rrTurnTimeout) clearTimeout(g.rrTurnTimeout);
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

// Russian Roulette — picks a random shooter and shows shoot buttons
// Called at game start and after each death/AFK kick
async function doRRTurn(game, client, extraLine = null) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return deleteGame(game.id);

  // Pick a random shooter from survivors
  game.rrShooter = game.rrActive[Math.floor(Math.random() * game.rrActive.length)];
  game.rrBullets = 1; // reset on every new turn assignment

  const pot = game.betAmount * game.players.length;
  const guild = client.guilds.cache.get(game.guildId);

  // Build buttons — one per survivor (including self)
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const buttons = [];
  for (const pid of game.rrActive) {
    let label = pid; // fallback to ID
    if (guild) {
      try {
        const member = await guild.members.fetch(pid);
        label = (member.nickname || member.user.username).slice(0, 20);
      } catch (_) {}
    }
    const isSelf = pid === game.rrShooter;
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rr_shoot_${game.id}_${pid}`)
        .setLabel(isSelf ? `🎯 ${label} (me)` : label)
        .setStyle(isSelf ? ButtonStyle.Danger : ButtonStyle.Secondary),
    );
  }

  // Discord allows max 5 per row, max 5 rows
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }

  const survivors = game.rrActive.map(p => `<@${p}>`).join(', ');
  const lines = [
    `🔫 **Russian Roulette** — Pot: **${pot}** coins`,
    `Survivors: ${survivors}`,
    ``,
  ];
  if (extraLine) lines.push(extraLine, ``);
  lines.push(`<@${game.rrShooter}> — pick who to shoot! *(1/${6} chance — 15s to decide)*`);

  const msg = await channel.messages.fetch(game.messageId).catch(() => null);
  if (msg) await msg.edit({ content: lines.join('\n'), components: rows });

  // 15 second AFK timeout — auto-eliminate the shooter if they don't act
  if (game.rrTurnTimeout) clearTimeout(game.rrTurnTimeout);
  game.rrTurnTimeout = setTimeout(async () => {
    const g = getGame(game.id);
    if (!g || g.status !== 'active') return;
    if (g.rrShooter !== game.rrShooter) return; // turn already moved on

    const afkId = g.rrShooter;
    g.rrActive = g.rrActive.filter(p => p !== afkId);

    if (g.rrActive.length === 1) {
      const winnerId = g.rrActive[0];
      await updateBalance(winnerId, pot);
      const afkMsg = await channel.messages.fetch(g.messageId).catch(() => null);
      if (afkMsg) await afkMsg.edit({
        content: `🔫 **Russian Roulette — Game Over!**\n\n⏱️ <@${afkId}> didn't respond in time and is eliminated!\n\n🏆 <@${winnerId}> wins **${pot}** coins!`,
        components: [],
      });
      deleteGame(g.id);
      return;
    }

    await doRRTurn(g, client, `⏱️ <@${afkId}> took too long and has been kicked from the game!`);
  }, 15000);
}

async function startRussianRoulette(game, client) {
  game.status = 'active';
  game.rrActive = [...game.players];
  await doRRTurn(game, client);
}

module.exports = {
  createGame, getGame, deleteGame, isInGame,
  runLMS, startRussianRoulette, doRRTurn,
  games, MAX_PLAYERS, MIN_PLAYERS,
};
