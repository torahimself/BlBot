const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getDuel, deleteDuel } = require('../utils/economy/duelManager.js');
const { getGame, deleteGame } = require('../utils/economy/gameManager.js');
const { getBalance, updateBalance } = require('../utils/economy/shopManager.js');

// ─── Blackjack helpers ────────────────────────────────────────────────────────

function handValue(hand) {
  let total = hand.reduce((sum, c) => sum + c.value, 0);
  let aces = hand.filter(c => c.display.startsWith('A')).length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function formatHand(hand) {
  return hand.map(c => c.display).join(' ') + ` (${handValue(hand)})`;
}

function drawCard(duel) {
  return duel.deck.pop();
}

function buildBJContent(duel, client) {
  const iId = duel.initiatorId;
  const tId = duel.targetId;
  const iDone = duel.standing[iId] || duel.busted[iId];
  const tDone = duel.standing[tId] || duel.busted[tId];

  const iStatus = duel.busted[iId] ? '💀 BUST' : duel.standing[iId] ? '🛑 Stand' : '🃏 Playing';
  const tStatus = duel.busted[tId] ? '💀 BUST' : duel.standing[tId] ? '🛑 Stand' : '🃏 Playing';

  return [
    `🃏 **Blackjack Duel** — Bet: **${duel.amount}** coins each`,
    `<@${iId}>: ${formatHand(duel.hands[iId])} — ${iStatus}`,
    `<@${tId}>: ${formatHand(duel.hands[tId])} — ${tStatus}`,
  ].join('\n');
}

function buildBJRows(duel) {
  const rows = [];
  for (const playerId of [duel.initiatorId, duel.targetId]) {
    if (!duel.standing[playerId] && !duel.busted[playerId]) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${duel.id}_${playerId}`).setLabel(`Hit`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${duel.id}_${playerId}`).setLabel(`Stand`).setStyle(ButtonStyle.Secondary),
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

  let resultLine;
  if (iBust && tBust) {
    // Both bust — refund
    await updateBalance(iId, duel.amount);
    await updateBalance(tId, duel.amount);
    resultLine = `Both players busted! Bets refunded.`;
  } else if (iBust) {
    await updateBalance(tId, duel.amount * 2);
    resultLine = `<@${iId}> busted! <@${tId}> wins **${duel.amount * 2}** coins!`;
  } else if (tBust) {
    await updateBalance(iId, duel.amount * 2);
    resultLine = `<@${tId}> busted! <@${iId}> wins **${duel.amount * 2}** coins!`;
  } else if (iVal > tVal) {
    await updateBalance(iId, duel.amount * 2);
    resultLine = `<@${iId}> wins with **${iVal}** vs **${tVal}** — wins **${duel.amount * 2}** coins!`;
  } else if (tVal > iVal) {
    await updateBalance(tId, duel.amount * 2);
    resultLine = `<@${tId}> wins with **${tVal}** vs **${iVal}** — wins **${duel.amount * 2}** coins!`;
  } else {
    await updateBalance(iId, duel.amount);
    await updateBalance(tId, duel.amount);
    resultLine = `Tie! Both had **${iVal}**. Bets refunded.`;
  }

  const msg = await channel.messages.fetch(duel.messageId).catch(() => null);
  const finalContent = buildBJContent(duel, null) + `\n\n✅ ${resultLine}`;
  if (msg) await msg.edit({ content: finalContent, components: [] });
  else await channel.send(finalContent);

  deleteDuel(duel.id);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  // ── Coin Flip ──────────────────────────────────────────────────────────────
  if (id.startsWith('coinflip_accept_') || id.startsWith('coinflip_decline_')) {
    const action = id.startsWith('coinflip_accept_') ? 'accept' : 'decline';
    const duelId = id.slice(action === 'accept' ? 'coinflip_accept_'.length : 'coinflip_decline_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.targetId) return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });

    if (action === 'decline') {
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the coin flip.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    // Accept — deduct from target and flip
    const targetBalance = await getBalance(duel.targetId);
    if (duel.amount > targetBalance) {
      deleteDuel(duel.id);
      return interaction.reply({ content: `❌ You no longer have enough coins.`, flags: 64 });
    }

    await updateBalance(duel.initiatorId, -duel.amount);
    await updateBalance(duel.targetId, -duel.amount);

    const flip = Math.random() < 0.5;
    const winnerId = flip ? duel.initiatorId : duel.targetId;
    const prize = duel.amount * 2;
    await updateBalance(winnerId, prize);

    deleteDuel(duel.id);

    const result = `🪙 The coin landed on **${flip ? 'Heads' : 'Tails'}**!\n<@${winnerId}> wins **${prize}** coins!`;
    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
    if (msg) await msg.edit({ content: result, components: [] });
    return interaction.reply({ content: '✅ Flipped!', flags: 64 });
  }

  // ── Number Duel ────────────────────────────────────────────────────────────
  if (id.startsWith('numberduel_accept_') || id.startsWith('numberduel_decline_')) {
    const action = id.startsWith('numberduel_accept_') ? 'accept' : 'decline';
    const duelId = id.slice(action === 'accept' ? 'numberduel_accept_'.length : 'numberduel_decline_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.targetId) return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });

    if (action === 'decline') {
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the number duel.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    // Show modal for target to pick their number
    const modal = new ModalBuilder()
      .setCustomId(`numberduel_pick_${duel.id}_target`)
      .setTitle('Pick Your Number')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('number').setLabel('Pick a number (1–10)').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(2)
      ));

    return interaction.showModal(modal);
  }

  if (id.startsWith('numberduel_initpick_')) {
    // Initiator's pick button (shown after target submits)
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

  // ── Blackjack ──────────────────────────────────────────────────────────────
  if (id.startsWith('bj_accept_') || id.startsWith('bj_decline_')) {
    const action = id.startsWith('bj_accept_') ? 'accept' : 'decline';
    const duelId = id.slice(action === 'accept' ? 'bj_accept_'.length : 'bj_decline_'.length);
    const duel = getDuel(duelId);

    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });
    if (interaction.user.id !== duel.targetId) return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });

    if (action === 'decline') {
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the blackjack duel.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    // Deduct bets
    const targetBalance = await getBalance(duel.targetId);
    if (duel.amount > targetBalance) {
      deleteDuel(duel.id);
      return interaction.reply({ content: '❌ You no longer have enough coins.', flags: 64 });
    }

    await updateBalance(duel.initiatorId, -duel.amount);
    await updateBalance(duel.targetId, -duel.amount);

    // Deal 2 cards each
    duel.hands[duel.initiatorId].push(drawCard(duel), drawCard(duel));
    duel.hands[duel.targetId].push(drawCard(duel), drawCard(duel));

    const content = buildBJContent(duel);
    const rows = buildBJRows(duel);

    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
    if (msg) await msg.edit({ content, components: rows });

    return interaction.reply({ content: '✅ Game started! Both players can now hit or stand.', flags: 64 });
  }

  if (id.startsWith('bj_hit_') || id.startsWith('bj_stand_')) {
    const action = id.startsWith('bj_hit_') ? 'hit' : 'stand';
    const rest = id.slice(action === 'hit' ? 'bj_hit_'.length : 'bj_stand_'.length);
    const underscoreIdx = rest.indexOf('_');
    const duelId = rest.slice(0, underscoreIdx);
    const playerId = rest.slice(underscoreIdx + 1);

    const duel = getDuel(duelId);
    if (!duel) return interaction.reply({ content: '❌ Game expired.', flags: 64 });
    if (interaction.user.id !== playerId) return interaction.reply({ content: '❌ This button is not for you.', flags: 64 });
    if (duel.standing[playerId] || duel.busted[playerId]) return interaction.reply({ content: '❌ You already finished your turn.', flags: 64 });

    if (action === 'hit') {
      const card = drawCard(duel);
      duel.hands[playerId].push(card);
      const val = handValue(duel.hands[playerId]);
      if (val > 21) duel.busted[playerId] = true;
    } else {
      duel.standing[playerId] = true;
    }

    const bothDone = (duel.standing[duel.initiatorId] || duel.busted[duel.initiatorId]) &&
                     (duel.standing[duel.targetId] || duel.busted[duel.targetId]);

    const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);

    if (bothDone) {
      await interaction.deferUpdate().catch(() => {});
      await resolveBJ(duel, interaction.channel);
      return;
    }

    const content = buildBJContent(duel);
    const rows = buildBJRows(duel);
    if (msg) await msg.edit({ content, components: rows });
    return interaction.reply({ content: `✅ You chose to ${action}.`, flags: 64 });
  }

  // ── Last Man Standing — Join ───────────────────────────────────────────────
  if (id.startsWith('lms_join_')) {
    const gameId = id.slice('lms_join_'.length);
    const game = getGame(gameId);

    if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
    if (game.players.includes(interaction.user.id)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
    if (game.players.length >= require('../utils/economy/gameManager.js').MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

    const balance = await getBalance(interaction.user.id);
    if (game.betAmount > balance) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

    await updateBalance(interaction.user.id, -game.betAmount);
    game.players.push(interaction.user.id);

    const { MAX_PLAYERS } = require('../utils/economy/gameManager.js');
    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    const playerList = game.players.map(p => `<@${p}>`).join(', ');
    if (msg) await msg.edit({ content: `🎲 **Last Man Standing** — Bet: **${game.betAmount}** coins/player\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

    return interaction.reply({ content: '✅ You joined the game!', flags: 64 });
  }

  // ── Russian Roulette — Join ────────────────────────────────────────────────
  if (id.startsWith('rr_join_')) {
    const gameId = id.slice('rr_join_'.length);
    const game = getGame(gameId);

    if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
    if (game.players.includes(interaction.user.id)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
    if (game.players.length >= require('../utils/economy/gameManager.js').MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

    const balance = await getBalance(interaction.user.id);
    if (game.betAmount > balance) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

    await updateBalance(interaction.user.id, -game.betAmount);
    game.players.push(interaction.user.id);

    const { MAX_PLAYERS } = require('../utils/economy/gameManager.js');
    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    const playerList = game.players.map(p => `<@${p}>`).join(', ');
    if (msg) await msg.edit({ content: `🔫 **Russian Roulette** — Bet: **${game.betAmount}** coins/player\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

    return interaction.reply({ content: '✅ You joined the game!', flags: 64 });
  }

  // ── Hot Potato — Join ─────────────────────────────────────────────────────
  if (id.startsWith('hp_join_')) {
    const gameId = id.slice('hp_join_'.length);
    const game = getGame(gameId);

    if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
    if (game.players.includes(interaction.user.id)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
    if (game.players.length >= require('../utils/economy/gameManager.js').MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

    const balance = await getBalance(interaction.user.id);
    if (game.betAmount > balance) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

    await updateBalance(interaction.user.id, -game.betAmount);
    game.players.push(interaction.user.id);

    const { MAX_PLAYERS } = require('../utils/economy/gameManager.js');
    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    const playerList = game.players.map(p => `<@${p}>`).join(', ');
    if (msg) await msg.edit({ content: `🥔 **Hot Potato** — Bet: **${game.betAmount}** coins/player\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

    return interaction.reply({ content: '✅ You joined the game!', flags: 64 });
  }

  // ── Hot Potato — Pass ─────────────────────────────────────────────────────
  if (id.startsWith('hp_pass_')) {
    const gameId = id.slice('hp_pass_'.length);
    const game = getGame(gameId);

    if (!game || game.status !== 'active') return interaction.reply({ content: '❌ This game is no longer active.', flags: 64 });
    if (interaction.user.id !== game.potatoHolder) return interaction.reply({ content: '❌ You are not holding the potato!', flags: 64 });

    // Pass to a random other player
    const others = game.players.filter(p => p !== game.potatoHolder);
    game.potatoHolder = others[Math.floor(Math.random() * others.length)];

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hp_pass_${game.id}`).setLabel('Pass 🥔').setStyle(ButtonStyle.Primary),
    );

    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    if (msg) {
      await msg.edit({
        content: `🥔 **Hot Potato!** Pot: **${game.betAmount * game.players.length}** coins\n<@${game.potatoHolder}> now has the potato!\nPlayers: ${game.players.map(p => `<@${p}>`).join(', ')}`,
        components: [row],
      });
    }

    return interaction.reply({ content: `✅ You passed the potato to <@${game.potatoHolder}>!`, flags: 64 });
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;

  // ── Number Duel — Pick number ──────────────────────────────────────────────
  if (id.startsWith('numberduel_pick_')) {
    const rest = id.slice('numberduel_pick_'.length);
    const underscoreIdx = rest.lastIndexOf('_');
    const duelId = rest.slice(0, underscoreIdx);
    const role = rest.slice(underscoreIdx + 1); // 'target' or 'initiator'

    const duel = getDuel(duelId);
    if (!duel) return interaction.reply({ content: '❌ This duel has expired.', flags: 64 });

    const raw = parseInt(interaction.fields.getTextInputValue('number'), 10);
    if (isNaN(raw) || raw < 1 || raw > 10) {
      return interaction.reply({ content: '❌ Please enter a number between 1 and 10.', flags: 64 });
    }

    if (role === 'target') {
      duel.targetNumber = raw;

      // Ask initiator to pick
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`numberduel_initpick_${duel.id}`).setLabel('Pick your number').setStyle(ButtonStyle.Primary),
      );

      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `🔢 <@${duel.targetId}> has submitted their number!\n<@${duel.initiatorId}>, click below to pick yours!`, components: [row] });

      return interaction.reply({ content: '✅ Your number is locked in!', flags: 64 });
    }

    if (role === 'initiator') {
      duel.initiatorNumber = raw;

      // Both submitted — resolve
      const target = duel.targetNumber;
      const botNumber = Math.floor(Math.random() * 10) + 1;

      const iDiff = Math.abs(duel.initiatorNumber - botNumber);
      const tDiff = Math.abs(target - botNumber);

      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);

      let resultText;
      if (iDiff < tDiff) {
        await updateBalance(duel.initiatorId, -duel.amount);
        await updateBalance(duel.targetId, -duel.amount);
        await updateBalance(duel.initiatorId, duel.amount * 2);
        resultText = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (diff: ${iDiff})\n<@${duel.targetId}> guessed **${target}** (diff: ${tDiff})\n\n🏆 <@${duel.initiatorId}> wins **${duel.amount * 2}** coins!`;
      } else if (tDiff < iDiff) {
        await updateBalance(duel.initiatorId, -duel.amount);
        await updateBalance(duel.targetId, -duel.amount);
        await updateBalance(duel.targetId, duel.amount * 2);
        resultText = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (diff: ${iDiff})\n<@${duel.targetId}> guessed **${target}** (diff: ${tDiff})\n\n🏆 <@${duel.targetId}> wins **${duel.amount * 2}** coins!`;
      } else {
        resultText = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (diff: ${iDiff})\n<@${duel.targetId}> guessed **${target}** (diff: ${tDiff})\n\n🤝 Tie! Bets refunded.`;
      }

      if (msg) await msg.edit({ content: resultText, components: [] });
      deleteDuel(duel.id);
      return interaction.reply({ content: '✅ Numbers revealed!', flags: 64 });
    }
  }
}

module.exports = { handleButton, handleModal };
