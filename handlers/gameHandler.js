const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getDuel, deleteDuel } = require('../utils/economy/duelManager.js');
const { getGame, deleteGame } = require('../utils/economy/gameManager.js');
const { getBalance, updateBalance } = require('../utils/economy/shopManager.js');

// ─── Blackjack helpers ────────────────────────────────────────────────────────

function handValue(hand) {
  let total = hand.reduce((sum, c) => sum + c.value, 0);
  let aces = hand.filter(c => c.display[0] === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function drawCard(duel) { return duel.deck.pop(); }

function buildBJPublicContent(duel) {
  const iId = duel.initiatorId;
  const tId = duel.targetId;
  const iStatus = duel.busted[iId] ? '💀 Bust' : duel.standing[iId] ? '🛑 Stand' : '🃏 Playing';
  const tStatus = duel.busted[tId] ? '💀 Bust' : duel.standing[tId] ? '🛑 Stand' : '🃏 Playing';
  const iCards = duel.hands[iId].length;
  const tCards = duel.hands[tId].length;
  return [
    `🃏 **Blackjack Duel** — Bet: **${duel.amount}** coins each`,
    `<@${iId}>: 🂠 ${iCards} card${iCards !== 1 ? 's' : ''} — ${iStatus}`,
    `<@${tId}>: 🂠 ${tCards} card${tCards !== 1 ? 's' : ''} — ${tStatus}`,
  ].join('\n');
}

function buildBJPrivateContent(duel, playerId) {
  const hand = duel.hands[playerId];
  const val = handValue(hand);
  const cards = hand.map(c => c.display).join(' ');
  const busted = duel.busted[playerId];
  const standing = duel.standing[playerId];
  const status = busted ? '💀 You busted!' : standing ? '🛑 You are standing.' : `Your total: **${val}**`;
  return `🃏 Your hand: **${cards}**\n${status}`;
}

function buildBJRows(duel) {
  const rows = [];
  for (const playerId of [duel.initiatorId, duel.targetId]) {
    if (!duel.standing[playerId] && !duel.busted[playerId]) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${duel.id}_${playerId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${duel.id}_${playerId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
      ));
    }
  }
  return rows;
}

async function resolveBJ(duel, channel) {
  const iId = duel.initiatorId;
  const tId = duel.targetId;
  const iVal = handValue(duel.hands[iId]);
  const tVal = handValue(duel.hands[tId]);
  const iBust = duel.busted[iId];
  const tBust = duel.busted[tId];
  const iCards = duel.hands[iId].map(c => c.display).join(' ');
  const tCards = duel.hands[tId].map(c => c.display).join(' ');

  let resultLine;
  if (iBust && tBust) {
    await updateBalance(iId, duel.amount);
    await updateBalance(tId, duel.amount);
    resultLine = 'Both players busted! Bets refunded.';
  } else if (iBust) {
    await updateBalance(tId, duel.amount * 2);
    resultLine = `<@${iId}> busted! <@${tId}> wins **${duel.amount * 2}** coins!`;
  } else if (tBust) {
    await updateBalance(iId, duel.amount * 2);
    resultLine = `<@${tId}> busted! <@${iId}> wins **${duel.amount * 2}** coins!`;
  } else if (iVal > tVal) {
    await updateBalance(iId, duel.amount * 2);
    resultLine = `<@${iId}> wins! **${iVal}** vs **${tVal}** — wins **${duel.amount * 2}** coins!`;
  } else if (tVal > iVal) {
    await updateBalance(tId, duel.amount * 2);
    resultLine = `<@${tId}> wins! **${tVal}** vs **${iVal}** — wins **${duel.amount * 2}** coins!`;
  } else {
    await updateBalance(iId, duel.amount);
    await updateBalance(tId, duel.amount);
    resultLine = `Tie! Both had **${iVal}**. Bets refunded.`;
  }

  const finalContent = [
    `🃏 **Blackjack Duel — Results**`,
    `<@${iId}>: ${iCards} **(${iVal})**${iBust ? ' 💀 Bust' : ''}`,
    `<@${tId}>: ${tCards} **(${tVal})**${tBust ? ' 💀 Bust' : ''}`,
    ``,
    `✅ ${resultLine}`,
  ].join('\n');

  const msg = await channel.messages.fetch(duel.messageId).catch(() => null);
  if (msg) await msg.edit({ content: finalContent, components: [] });
  else await channel.send(finalContent);
  deleteDuel(duel.id);
}

// ─── Hot Potato helpers ───────────────────────────────────────────────────────

// Starts (or restarts after an elimination) the potato timer for remaining players
async function startHotPotato(game, client) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return deleteGame(game.id);

  game.status = 'active';
  game.exploded = false;

  // Pick random holder from remaining players
  game.potatoHolder = game.players[Math.floor(Math.random() * game.players.length)];

  // Hidden timer: 20–45 seconds
  const explodeIn = Math.floor(Math.random() * 25000) + 20000;
  const pot = game.betAmount * game.players.length; // original pot (all players paid in at start)

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hp_pass_${game.id}`).setLabel('Pass 🥔').setStyle(ButtonStyle.Primary),
  );

  const msg = await channel.messages.fetch(game.messageId).catch(() => null);
  if (msg) {
    await msg.edit({
      content: `🥔 **Hot Potato!** Pot: **${pot}** coins\n<@${game.potatoHolder}> is holding the potato — pass it before it explodes!\nRemaining: ${game.players.map(p => `<@${p}>`).join(', ')}`,
      components: [row],
    });
  }

  // Set explosion timer
  game.potatoTimeout = setTimeout(async () => {
    const g = getGame(game.id);
    if (!g || g.exploded) return; // already resolved

    g.exploded = true; // lock immediately

    const loserId = g.potatoHolder;
    g.players = g.players.filter(p => p !== loserId); // eliminate from players list

    const ch = client.channels.cache.get(g.channelId);
    if (!ch) return deleteGame(g.id);

    // If only 1 player left — that player wins the full pot
    if (g.players.length === 1) {
      const winnerId = g.players[0];
      const fullPot = g.betAmount * (g.players.length + 1 + (g._eliminated || 0)); // total everyone paid
      // Simpler: just pay out the remaining tracked pot
      await updateBalance(winnerId, g._totalPot);

      const finalMsg = await ch.messages.fetch(g.messageId).catch(() => null);
      if (finalMsg) {
        await finalMsg.edit({
          content: `💥 **BOOM!** <@${loserId}> was holding the potato and is eliminated!\n\n🏆 <@${winnerId}> is the last one standing and wins **${g._totalPot}** coins!`,
          components: [],
        });
      }
      deleteGame(g.id);
      return;
    }

    // More than 1 player left — announce elimination and restart
    const elimMsg = await ch.messages.fetch(g.messageId).catch(() => null);
    if (elimMsg) {
      await elimMsg.edit({
        content: `💥 **BOOM!** <@${loserId}> was holding the potato and is eliminated!\nRemaining: ${g.players.map(p => `<@${p}>`).join(', ')}\n\n🥔 Picking a new holder...`,
        components: [],
      });
    }

    // Short pause then restart
    await new Promise(r => setTimeout(r, 2500));
    await startHotPotato(g, client);
  }, explodeIn);
}

// ─── Main button handler ──────────────────────────────────────────────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  // ── Coin Flip: Accept / Decline ───────────────────────────────────────────
  if (id.startsWith('coinflip_accept_') || id.startsWith('coinflip_decline_')) {
    const isAccept = id.startsWith('coinflip_accept_');
    const duelId = id.slice(isAccept ? 'coinflip_accept_'.length : 'coinflip_decline_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.targetId) return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });

    if (!isAccept) {
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the coin flip.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    const targetBalance = await getBalance(duel.targetId);
    if (duel.amount > targetBalance) {
      deleteDuel(duel.id);
      return interaction.reply({ content: '❌ You no longer have enough coins.', flags: 64 });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`coinflip_heads_${duel.id}`).setLabel('Heads').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`coinflip_tails_${duel.id}`).setLabel('Tails').setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
    if (msg) await msg.edit({
      content: `🪙 <@${duel.targetId}> accepted! <@${duel.initiatorId}>, choose your side:`,
      components: [row],
    });

    return interaction.reply({ content: '✅ You accepted! Waiting for the challenger to pick.', flags: 64 });
  }

  // ── Coin Flip: Pick Heads / Tails ─────────────────────────────────────────
  if (id.startsWith('coinflip_heads_') || id.startsWith('coinflip_tails_')) {
    const isHeads = id.startsWith('coinflip_heads_');
    const duelId = id.slice(isHeads ? 'coinflip_heads_'.length : 'coinflip_tails_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.initiatorId) return interaction.reply({ content: '❌ Only the challenger picks the side.', flags: 64 });

    duel.initiatorSide = isHeads ? 'Heads' : 'Tails';

    await updateBalance(duel.initiatorId, -duel.amount);
    await updateBalance(duel.targetId, -duel.amount);

    const flip = Math.random() < 0.5;
    const flipResult = flip ? 'Heads' : 'Tails';
    const initiatorWins = duel.initiatorSide === flipResult;
    const winnerId = initiatorWins ? duel.initiatorId : duel.targetId;
    const prize = duel.amount * 2;

    await updateBalance(winnerId, prize);
    deleteDuel(duel.id);

    const result = [
      `🪙 <@${duel.initiatorId}> called **${duel.initiatorSide}** — the coin landed on **${flipResult}**!`,
      `🏆 <@${winnerId}> wins **${prize}** coins!`,
    ].join('\n');

    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
    if (msg) await msg.edit({ content: result, components: [] });
    return interaction.reply({ content: '✅ Flipped!', flags: 64 });
  }

  // ── Number Duel: Accept / Decline ─────────────────────────────────────────
  if (id.startsWith('numberduel_accept_') || id.startsWith('numberduel_decline_')) {
    const isAccept = id.startsWith('numberduel_accept_');
    const duelId = id.slice(isAccept ? 'numberduel_accept_'.length : 'numberduel_decline_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.targetId) return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });

    if (!isAccept) {
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the number duel.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    const modal = new ModalBuilder()
      .setCustomId(`numberduel_pick_${duel.id}_target`)
      .setTitle('Pick Your Number')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('number').setLabel('Pick a number (1–10)').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(2)
      ));

    return interaction.showModal(modal);
  }

  if (id.startsWith('numberduel_initpick_')) {
    const duelId = id.slice('numberduel_initpick_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.initiatorId) return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });

    const modal = new ModalBuilder()
      .setCustomId(`numberduel_pick_${duel.id}_initiator`)
      .setTitle('Pick Your Number')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('number').setLabel('Pick a number (1–10)').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(2)
      ));

    return interaction.showModal(modal);
  }

  // ── Blackjack: Accept / Decline ───────────────────────────────────────────
  if (id.startsWith('bj_accept_') || id.startsWith('bj_decline_')) {
    const isAccept = id.startsWith('bj_accept_');
    const duelId = id.slice(isAccept ? 'bj_accept_'.length : 'bj_decline_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.targetId) return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });

    if (!isAccept) {
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the blackjack duel.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    const targetBalance = await getBalance(duel.targetId);
    if (duel.amount > targetBalance) {
      deleteDuel(duel.id);
      return interaction.reply({ content: '❌ You no longer have enough coins.', flags: 64 });
    }

    await updateBalance(duel.initiatorId, -duel.amount);
    await updateBalance(duel.targetId, -duel.amount);

    duel.hands[duel.initiatorId].push(drawCard(duel), drawCard(duel));
    duel.hands[duel.targetId].push(drawCard(duel), drawCard(duel));

    const publicContent = buildBJPublicContent(duel);
    const rows = buildBJRows(duel);
    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
    if (msg) await msg.edit({ content: publicContent, components: rows });

    await interaction.reply({ content: buildBJPrivateContent(duel, duel.targetId), flags: 64 });

    try {
      const initiator = await interaction.client.users.fetch(duel.initiatorId);
      await initiator.send(buildBJPrivateContent(duel, duel.initiatorId) + `\n\n*(Use Hit/Stand buttons in <#${duel.channelId}>)*`);
    } catch (_) {}

    return;
  }

  // ── Blackjack: Hit / Stand ────────────────────────────────────────────────
  if (id.startsWith('bj_hit_') || id.startsWith('bj_stand_')) {
    const isHit = id.startsWith('bj_hit_');
    const rest = id.slice(isHit ? 'bj_hit_'.length : 'bj_stand_'.length);
    const underscoreIdx = rest.indexOf('_');
    const duelId = rest.slice(0, underscoreIdx);
    const playerId = rest.slice(underscoreIdx + 1);

    const duel = getDuel(duelId);
    if (!duel) return interaction.reply({ content: '❌ Game expired.', flags: 64 });
    if (interaction.user.id !== playerId) return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });
    if (duel.standing[playerId] || duel.busted[playerId]) return interaction.reply({ content: '❌ You already finished your turn.', flags: 64 });

    if (isHit) {
      duel.hands[playerId].push(drawCard(duel));
      if (handValue(duel.hands[playerId]) > 21) duel.busted[playerId] = true;
    } else {
      duel.standing[playerId] = true;
    }

    const bothDone = (duel.standing[duel.initiatorId] || duel.busted[duel.initiatorId]) &&
                     (duel.standing[duel.targetId] || duel.busted[duel.targetId]);

    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
    if (msg) await msg.edit({ content: buildBJPublicContent(duel), components: buildBJRows(duel) });

    await interaction.reply({ content: buildBJPrivateContent(duel, playerId), flags: 64 });

    if (bothDone) await resolveBJ(duel, interaction.channel);
    return;
  }

  // ── Last Man Standing: Join ───────────────────────────────────────────────
  if (id.startsWith('lms_join_')) {
    const gameId = id.slice('lms_join_'.length);
    const game = getGame(gameId);
    const { MAX_PLAYERS } = require('../utils/economy/gameManager.js');

    if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
    if (game.players.includes(interaction.user.id)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
    if (game.players.length >= MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

    const balance = await getBalance(interaction.user.id);
    if (game.betAmount > balance) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

    await updateBalance(interaction.user.id, -game.betAmount);
    game.players.push(interaction.user.id);

    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    const playerList = game.players.map(p => `<@${p}>`).join(', ');
    if (msg) await msg.edit({ content: `🎲 **Last Man Standing** — Bet: **${game.betAmount}** coins/player\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

    return interaction.reply({ content: '✅ You joined!', flags: 64 });
  }

  // ── Russian Roulette: Join ────────────────────────────────────────────────
  if (id.startsWith('rr_join_')) {
    const gameId = id.slice('rr_join_'.length);
    const game = getGame(gameId);
    const { MAX_PLAYERS } = require('../utils/economy/gameManager.js');

    if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
    if (game.players.includes(interaction.user.id)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
    if (game.players.length >= MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

    const balance = await getBalance(interaction.user.id);
    if (game.betAmount > balance) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

    await updateBalance(interaction.user.id, -game.betAmount);
    game.players.push(interaction.user.id);

    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    const playerList = game.players.map(p => `<@${p}>`).join(', ');
    if (msg) await msg.edit({ content: `🔫 **Russian Roulette** — Bet: **${game.betAmount}** coins/player\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

    return interaction.reply({ content: '✅ You joined!', flags: 64 });
  }

  // ── Russian Roulette: Pull Trigger ────────────────────────────────────────
  if (id.startsWith('rr_pull_')) {
    const gameId = id.slice('rr_pull_'.length);
    const game = getGame(gameId);

    if (!game || game.status !== 'active') return interaction.reply({ content: '❌ This game is no longer active.', flags: 64 });

    const currentPlayer = game.rrActive[game.rrCurrentIdx];
    if (interaction.user.id !== currentPlayer) {
      return interaction.reply({ content: `❌ It's not your turn! Waiting for <@${currentPlayer}>.`, flags: 64 });
    }

    const pot = game.betAmount * game.players.length;

    // rrBullets = how many bullets are loaded (1 to 6)
    // Chance of dying = rrBullets / 6
    const shot = Math.random() < (game.rrBullets / 6);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rr_pull_${game.id}`)
        .setLabel('Pull Trigger 🔫')
        .setStyle(ButtonStyle.Danger),
    );

    if (shot) {
      // 💥 BANG — player is eliminated
      game.rrActive.splice(game.rrCurrentIdx, 1);

      // Reset bullet count after a death
      game.rrBullets = 1;

      // Check if game is over
      if (game.rrActive.length === 1) {
        const winnerId = game.rrActive[0];
        await updateBalance(winnerId, pot);

        const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
        const finalContent = [
          `🔫 **Russian Roulette — Game Over!**`,
          ``,
          `💥 **BANG!** <@${currentPlayer}> pulled the trigger... and it fired!`,
          ``,
          `🏆 <@${winnerId}> is the last survivor and wins **${pot}** coins!`,
        ].join('\n');
        if (msg) await msg.edit({ content: finalContent, components: [] });
        deleteGame(game.id);
        return interaction.reply({ content: '💀 BANG! You have been eliminated.', flags: 64 });
      }

      // Wrap index if needed after removal
      if (game.rrCurrentIdx >= game.rrActive.length) game.rrCurrentIdx = 0;
      const nextPlayer = game.rrActive[game.rrCurrentIdx];

      const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
      const content = [
        `🔫 **Russian Roulette** — Pot: **${pot}** coins`,
        `Survivors: ${game.rrActive.map(p => `<@${p}>`).join(' → ')}`,
        ``,
        `💥 **BANG!** <@${currentPlayer}> pulled the trigger and is eliminated!`,
        `*(Chamber reset — 1 bullet back in)*`,
        ``,
        `<@${nextPlayer}>, it's your turn — pull the trigger!`,
      ].join('\n');
      if (msg) await msg.edit({ content, components: [row] });

      return interaction.reply({ content: '💀 BANG! You have been eliminated.', flags: 64 });

    } else {
      // *click* — empty, survive
      // Increase bullet count (max 5 so there's always some RNG left)
      game.rrBullets = Math.min(game.rrBullets + 1, 5);

      // Move to next player in order
      game.rrCurrentIdx = (game.rrCurrentIdx + 1) % game.rrActive.length;
      const nextPlayer = game.rrActive[game.rrCurrentIdx];

      const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
      const content = [
        `🔫 **Russian Roulette** — Pot: **${pot}** coins`,
        `Survivors: ${game.rrActive.map(p => `<@${p}>`).join(' → ')}`,
        ``,
        `*click* — Empty barrel. <@${currentPlayer}> survives... for now.`,
        ``,
        `<@${nextPlayer}>, it's your turn — pull the trigger!`,
      ].join('\n');
      if (msg) await msg.edit({ content, components: [row] });

      return interaction.reply({ content: '😅 Empty barrel — you survived!', flags: 64 });
    }
  }

  // ── Hot Potato: Join ──────────────────────────────────────────────────────
  if (id.startsWith('hp_join_')) {
    const gameId = id.slice('hp_join_'.length);
    const game = getGame(gameId);
    const { MAX_PLAYERS } = require('../utils/economy/gameManager.js');

    if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
    if (game.players.includes(interaction.user.id)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
    if (game.players.length >= MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

    const balance = await getBalance(interaction.user.id);
    if (game.betAmount > balance) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

    await updateBalance(interaction.user.id, -game.betAmount);
    game.players.push(interaction.user.id);

    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    const playerList = game.players.map(p => `<@${p}>`).join(', ');
    if (msg) await msg.edit({ content: `🥔 **Hot Potato** — Bet: **${game.betAmount}** coins/player\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

    return interaction.reply({ content: '✅ You joined!', flags: 64 });
  }

  // ── Hot Potato: Pass ──────────────────────────────────────────────────────
  if (id.startsWith('hp_pass_')) {
    const gameId = id.slice('hp_pass_'.length);
    const game = getGame(gameId);

    if (!game || game.status !== 'active' || game.exploded) {
      return interaction.reply({ content: '💥 The potato already exploded!', flags: 64 });
    }
    if (interaction.user.id !== game.potatoHolder) {
      return interaction.reply({ content: '❌ You are not holding the potato!', flags: 64 });
    }

    const others = game.players.filter(p => p !== game.potatoHolder);
    game.potatoHolder = others[Math.floor(Math.random() * others.length)];

    const pot = game._totalPot;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hp_pass_${game.id}`).setLabel('Pass 🥔').setStyle(ButtonStyle.Primary),
    );

    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    if (msg) {
      await msg.edit({
        content: `🥔 **Hot Potato!** Pot: **${pot}** coins\n<@${game.potatoHolder}> now has the potato!\nRemaining: ${game.players.map(p => `<@${p}>`).join(', ')}`,
        components: [row],
      });
    }

    return interaction.reply({ content: `✅ You passed the potato to <@${game.potatoHolder}>!`, flags: 64 });
  }
}

// ─── Modal handler ────────────────────────────────────────────────────────────

async function handleModal(interaction) {
  const id = interaction.customId;

  if (id.startsWith('numberduel_pick_')) {
    const rest = id.slice('numberduel_pick_'.length);
    const underscoreIdx = rest.lastIndexOf('_');
    const duelId = rest.slice(0, underscoreIdx);
    const role = rest.slice(underscoreIdx + 1);

    const duel = getDuel(duelId);
    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });

    const raw = parseInt(interaction.fields.getTextInputValue('number'), 10);
    if (isNaN(raw) || raw < 1 || raw > 10) {
      return interaction.reply({ content: '❌ Please enter a number between 1 and 10.', flags: 64 });
    }

    if (role === 'target') {
      duel.targetNumber = raw;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`numberduel_initpick_${duel.id}`).setLabel('Pick your number').setStyle(ButtonStyle.Primary),
      );

      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `🔢 <@${duel.targetId}> has submitted their number! <@${duel.initiatorId}>, click below to pick yours!`, components: [row] });
      return interaction.reply({ content: '✅ Your number is locked in!', flags: 64 });
    }

    if (role === 'initiator') {
      duel.initiatorNumber = raw;

      const botNumber = Math.floor(Math.random() * 10) + 1;
      const iDiff = Math.abs(duel.initiatorNumber - botNumber);
      const tDiff = Math.abs(duel.targetNumber - botNumber);

      let resultText;
      if (iDiff < tDiff) {
        await updateBalance(duel.initiatorId, -duel.amount);
        await updateBalance(duel.targetId, -duel.amount);
        await updateBalance(duel.initiatorId, duel.amount * 2);
        resultText = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (off by ${iDiff})\n<@${duel.targetId}> guessed **${duel.targetNumber}** (off by ${tDiff})\n\n🏆 <@${duel.initiatorId}> wins **${duel.amount * 2}** coins!`;
      } else if (tDiff < iDiff) {
        await updateBalance(duel.initiatorId, -duel.amount);
        await updateBalance(duel.targetId, -duel.amount);
        await updateBalance(duel.targetId, duel.amount * 2);
        resultText = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (off by ${iDiff})\n<@${duel.targetId}> guessed **${duel.targetNumber}** (off by ${tDiff})\n\n🏆 <@${duel.targetId}> wins **${duel.amount * 2}** coins!`;
      } else {
        resultText = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (off by ${iDiff})\n<@${duel.targetId}> guessed **${duel.targetNumber}** (off by ${tDiff})\n\n🤝 Tie! Bets refunded.`;
      }

      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: resultText, components: [] });
      deleteDuel(duel.id);
      return interaction.reply({ content: '✅ Numbers revealed!', flags: 64 });
    }
  }
}

module.exports = { handleButton, handleModal, startHotPotato };
