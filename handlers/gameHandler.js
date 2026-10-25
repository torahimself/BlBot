const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getDuel, deleteDuel, setDuelTimeout } = require('../utils/economy/duelManager.js');
const { getGame, deleteGame, doRRTurn, payWinner, refundGame, winText, noteText, potText, MAX_PLAYERS } = require('../utils/economy/gameManager.js');
const { getBalance } = require('../utils/economy/shopManager.js');
const { isBet, takeStakes, refundStakes, canBet, settleBet, betLabel } = require('../utils/economy/stakes.js');

// Takes the bet from BOTH duel players atomically (each deduction only
// succeeds if that player can afford it right now). If either can't pay, any
// coins already taken are returned and `{ ok: false, brokeId }` says who.
// A free duel (amount 0) takes nothing and is always ok.
async function takeDuelStakes(duel) {
  return takeStakes([duel.initiatorId, duel.targetId], duel.amount);
}

// Pays a finished DUEL. winnerId null = tie/refund. Free duel moves no coins.
async function settleDuel(duel, winnerId) {
  const stakes = { [duel.initiatorId]: duel.amount, [duel.targetId]: duel.amount };
  const payouts = winnerId
    ? { [winnerId]: duel.amount * 2 }
    : { [duel.initiatorId]: duel.amount, [duel.targetId]: duel.amount };
  let res;
  try {
    res = await settleBet({ kind: 'pot', stakes, payouts });
  } catch (err) {
    // Nothing was paid out — give both stakes back rather than lose them.
    await refundStakes([duel.initiatorId, duel.targetId], duel.amount);
    throw err;
  }
  res.prize = res.free || !winnerId ? 0 : (res.payouts[winnerId] || 0);
  return res;
}

const duelWinText = (duel, res) => (isBet(duel.amount) ? ` wins **${res.prize}** coins!` : ' wins!');

async function cancelDuelNoFunds(interaction, duel, brokeId, label) {
  deleteDuel(duel.id);
  const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
  if (msg) {
    await msg.edit({ content: `❌ ${label} cancelled — <@${brokeId}> no longer has enough coins. Nobody was charged.`, components: [] }).catch(() => {});
  }
  return interaction.reply({ content: `❌ ${label} cancelled — <@${brokeId}> no longer has enough coins.`, flags: 64 });
}

// Shared "Join Game" logic for the lobby games (Last Man Standing, Russian
// Roulette, Hot Potato). The stake is taken atomically FIRST; everything is
// then re-checked, because the lobby can change while the payment is in
// flight (double-click, lobby closing, lobby filling up). If the join can't
// go ahead after all, the stake is handed straight back.
async function handleLobbyJoin(interaction, gameId, title) {
  const game = getGame(gameId);
  const uid = interaction.user.id;

  if (!game || game.status !== 'lobby') return interaction.reply({ content: '❌ This game is no longer accepting players.', flags: 64 });
  if (game.players.includes(uid)) return interaction.reply({ content: '❌ You already joined.', flags: 64 });
  if (game.players.length >= MAX_PLAYERS) return interaction.reply({ content: '❌ The lobby is full.', flags: 64 });

  if (isBet(game.betAmount)) {
    const cap = await canBet([uid], game.betAmount);
    if (!cap.ok) return interaction.reply({ content: '❌ You reached the weekly betting profit limit, so you can only join free games until it resets.', flags: 64 });
  }
  const taken = await takeStakes([uid], game.betAmount);
  if (!taken.ok) return interaction.reply({ content: `❌ You need **${game.betAmount}** coins to join.`, flags: 64 });

  if (!getGame(game.id) || game.status !== 'lobby' || game.players.includes(uid) || game.players.length >= MAX_PLAYERS) {
    await refundStakes([uid], game.betAmount);
    return interaction.reply({ content: '❌ Could not join (the lobby closed, filled up, or you were already in). You were not charged.', flags: 64 });
  }
  game.players.push(uid);

  const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
  const playerList = game.players.map(p => `<@${p}>`).join(', ');
  if (msg) await msg.edit({ content: `${title} — ${betLabel(game.betAmount)}\nPlayers (${game.players.length}/${MAX_PLAYERS}): ${playerList}\n\nGame starts soon!`, components: msg.components });

  return interaction.reply({ content: '✅ You joined!', flags: 64 });
}

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
    `🃏 **Blackjack Duel** — ${isBet(duel.amount) ? `Bet: **${duel.amount}** coins each` : 'Free game'}`,
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
  // Resolve exactly once, and remove the duel BEFORE paying out so its
  // expiry timer can never fire a refund on top of the payout.
  if (duel.resolving) return;
  duel.resolving = true;
  deleteDuel(duel.id);

  const iId = duel.initiatorId;
  const tId = duel.targetId;
  const iVal = handValue(duel.hands[iId]);
  const tVal = handValue(duel.hands[tId]);
  const iBust = duel.busted[iId];
  const tBust = duel.busted[tId];
  const iCards = duel.hands[iId].map(c => c.display).join(' ');
  const tCards = duel.hands[tId].map(c => c.display).join(' ');

  let winnerId = null;
  let why;
  if (iBust && tBust) why = 'Both players busted!';
  else if (iBust) { winnerId = tId; why = `<@${iId}> busted!`; }
  else if (tBust) { winnerId = iId; why = `<@${tId}> busted!`; }
  else if (iVal > tVal) { winnerId = iId; why = `**${iVal}** vs **${tVal}**`; }
  else if (tVal > iVal) { winnerId = tId; why = `**${tVal}** vs **${iVal}**`; }
  else why = `Tie! Both had **${iVal}**.`;

  const res = await settleDuel(duel, winnerId);
  let resultLine;
  if (winnerId) {
    resultLine = `${why} <@${winnerId}>${duelWinText(duel, res)}${res.note}`;
  } else {
    resultLine = `${why}${isBet(duel.amount) ? ' Bets refunded.' : ''}`;
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
}

// ─── Hot Potato helpers ───────────────────────────────────────────────────────

async function startHotPotato(game, client) {
  const channel = client.channels.cache.get(game.channelId);
  if (!channel) return refundGame(game, client);

  game.status = 'active';
  game.exploded = false;
  // Remember everyone who paid in (the first round only) so a crash can refund them all.
  if (!game.allPlayers.length) game.allPlayers = [...game.players];
  game.potatoHolder = game.players[Math.floor(Math.random() * game.players.length)];

  const explodeIn = Math.floor(Math.random() * 25000) + 20000;
  const pot = game._totalPot;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hp_pass_${game.id}`).setLabel('Pass 🥔').setStyle(ButtonStyle.Primary),
  );

  const msg = await channel.messages.fetch(game.messageId).catch(() => null);
  if (msg) {
    await msg.edit({
      content: `🥔 **Hot Potato!**${potText(game, pot)}\n<@${game.potatoHolder}> is holding the potato — pass it before it explodes!\nRemaining: ${game.players.map(p => `<@${p}>`).join(', ')}`,
      components: [row],
    });
  }

  game.potatoTimeout = setTimeout(async () => {
    try {
      const g = getGame(game.id);
      if (!g || g.exploded) return;

      g.exploded = true;

      const loserId = g.potatoHolder;
      g.players = g.players.filter(p => p !== loserId);

      const ch = client.channels.cache.get(g.channelId);
      if (!ch) return refundGame(g, client);

      if (g.players.length === 1) {
        const winnerId = g.players[0];
        const res = await payWinner(g, winnerId, g._totalPot);
        const finalMsg = await ch.messages.fetch(g.messageId).catch(() => null);
        if (finalMsg) {
          await finalMsg.edit({
            content: `💥 **BOOM!** <@${loserId}> was holding the potato and is eliminated!\n\n🏆 <@${winnerId}> is the last one standing and${winText(g, res, g._totalPot)}${noteText(res)}`,
            components: [],
          });
        }
        deleteGame(g.id);
        return;
      }

      const elimMsg = await ch.messages.fetch(g.messageId).catch(() => null);
      if (elimMsg) {
        await elimMsg.edit({
          content: `💥 **BOOM!** <@${loserId}> was holding the potato and is eliminated!\nRemaining: ${g.players.map(p => `<@${p}>`).join(', ')}\n\n🥔 Picking a new holder...`,
          components: [],
        });
      }

      await new Promise(r => setTimeout(r, 2500));
      await startHotPotato(g, client);
    } catch (err) {
      // Without this, a failed message edit left the game stuck forever with
      // everyone's stake gone and everyone blocked by "already in a game".
      console.error('[Games] Hot Potato crashed:', err);
      await refundGame(game, client, 'Hot Potato hit an error');
    }
  }, explodeIn);
}

// ─── Russian Roulette: resolve one shot ───────────────────────────────────────
// Called by the button handler once the click has been validated.
async function handleRRShot(interaction, game, targetId) {
  // Clear AFK timeout since shooter acted
  if (game.rrTurnTimeout) { clearTimeout(game.rrTurnTimeout); game.rrTurnTimeout = null; }

  const pot = game.betAmount * game.players.length;
  const isSelf = targetId === game.rrShooter;
  const shot = Math.random() < (game.rrBullets / 6);

  if (shot) {
    // 💥 HIT — target is eliminated
    game.rrActive = game.rrActive.filter(p => p !== targetId);

    if (game.rrActive.length === 1) {
      const winnerId = game.rrActive[0];
      const res = await payWinner(game, winnerId, pot);

      const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
      const finalContent = [
        `🔫 **Russian Roulette — Game Over!**`,
        ``,
        `💥 **BANG!** <@${game.rrShooter}> ${isSelf ? 'shot themselves' : `shot <@${targetId}>`} — and it connected!`,
        ``,
        `🏆 <@${winnerId}> is the last survivor and${winText(game, res, pot)}${noteText(res)}`,
      ].join('\n');
      if (msg) await msg.edit({ content: finalContent, components: [] });
      deleteGame(game.id);
      return interaction.reply({ content: isSelf ? '💀 You shot yourself — eliminated!' : `💥 You eliminated <@${targetId}>! But you're alone now, game over.`, flags: 64 });
    }

    // New random turn — reset bullets
    await doRRTurn(game, interaction.client, `💥 **BANG!** <@${game.rrShooter}> ${isSelf ? 'shot themselves' : `shot <@${targetId}>`} — eliminated!`);
    return interaction.reply({ content: isSelf ? '💀 You shot yourself and were eliminated!' : `💥 <@${targetId}> was eliminated!`, flags: 64 });
  }

  // *click* — miss
  if (!isSelf) {
    // Shooting someone else and missing → new random turn (reset bullets)
    await doRRTurn(game, interaction.client, `*click* — <@${game.rrShooter}> shot at <@${targetId}> and missed!`);
    return interaction.reply({ content: `*click* — empty! <@${targetId}> survived.`, flags: 64 });
  }

  // Shooting yourself and surviving → increment bullets, keep same shooter
  game.rrBullets = Math.min(game.rrBullets + 1, 5);
  const guild = interaction.client.guilds.cache.get(game.guildId);
  const bullets = game.rrBullets;

  // Rebuild shoot buttons for same shooter
  const buttons = [];
  for (const pid of game.rrActive) {
    let label = pid;
    if (guild) {
      try {
        const member = await guild.members.fetch(pid);
        label = (member.nickname || member.user.username).slice(0, 20);
      } catch (_) {}
    }
    const isSelfBtn = pid === game.rrShooter;
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rr_shoot_${game.id}_${pid}`)
        .setLabel(isSelfBtn ? `🎯 ${label} (me)` : label)
        .setStyle(isSelfBtn ? ButtonStyle.Danger : ButtonStyle.Secondary),
    );
  }
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }

  const survivors = game.rrActive.map(p => `<@${p}>`).join(', ');
  const content = [
    `🔫 **Russian Roulette**${potText(game, pot)}`,
    `Survivors: ${survivors}`,
    ``,
    `*click* — <@${game.rrShooter}> shot themselves and survived! Chamber loaded: **${bullets}/6**`,
    ``,
    `<@${game.rrShooter}> — pick again! *(${15}s to decide)*`,
  ].join('\n');

  const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
  if (msg) await msg.edit({ content, components: rows });

  // Reset 15s AFK timer for same shooter
  const client = interaction.client;
  if (game.rrTurnTimeout) clearTimeout(game.rrTurnTimeout);
  game.rrTurnTimeout = setTimeout(async () => {
    try {
      const g = getGame(game.id);
      if (!g || g.status !== 'active' || g.rrShooter !== game.rrShooter) return;
      const afkId = g.rrShooter;
      g.rrActive = g.rrActive.filter(p => p !== afkId);
      if (g.rrActive.length === 1) {
        const winnerId = g.rrActive[0];
        const res = await payWinner(g, winnerId, pot);
        const afkMsg = await interaction.channel.messages.fetch(g.messageId).catch(() => null);
        if (afkMsg) await afkMsg.edit({ content: `🔫 **Russian Roulette — Game Over!**\n\n⏱️ <@${afkId}> didn't respond and is eliminated!\n\n🏆 <@${winnerId}>${winText(g, res, pot)}${noteText(res)}`, components: [] });
        deleteGame(g.id);
        return;
      }
      await doRRTurn(g, client, `⏱️ <@${afkId}> took too long and has been kicked!`);
    } catch (err) {
      console.error('[Games] Russian Roulette AFK handler crashed:', err);
      await refundGame(game, client, 'Russian Roulette hit an error');
    }
  }, 15000);

  return interaction.reply({ content: `😅 *click* — empty! You survived. Bullet count raised to **${bullets}/6**.`, flags: 64 });
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

    const targetBalance = isBet(duel.amount) ? await getBalance(duel.targetId) : 0;
    if (isBet(duel.amount) && duel.amount > targetBalance) {
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
    // A second click while the first is still being processed must not flip (and pay out) again.
    if (duel.resolving) return interaction.reply({ content: '⏳ Already flipping…', flags: 64 });
    duel.resolving = true;

    duel.initiatorSide = isHeads ? 'Heads' : 'Tails';

    // Both stakes are taken only if BOTH players can still afford it right now.
    const stakes = await takeDuelStakes(duel);
    if (!stakes.ok) return cancelDuelNoFunds(interaction, duel, stakes.brokeId, 'Coin flip');

    const flip = Math.random() < 0.5;
    const flipResult = flip ? 'Heads' : 'Tails';
    const initiatorWins = duel.initiatorSide === flipResult;
    const winnerId = initiatorWins ? duel.initiatorId : duel.targetId;

    deleteDuel(duel.id);
    const res = await settleDuel(duel, winnerId);

    const result = [
      `🪙 <@${duel.initiatorId}> called **${duel.initiatorSide}** — the coin landed on **${flipResult}**!`,
      `🏆 <@${winnerId}>${duelWinText(duel, res)}${res.note}`,
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
      // Once Accept has been pressed the stakes are being taken — declining now
      // would delete the duel out from under the payment and lose both stakes.
      if (duel.started) return interaction.reply({ content: '⏳ This game already started.', flags: 64 });
      deleteDuel(duel.id);
      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: `❌ <@${duel.targetId}> declined the blackjack duel.`, components: [] });
      return interaction.reply({ content: '✅ You declined.', flags: 64 });
    }

    // A second click on Accept must not start (and charge) the game twice.
    if (duel.started) return interaction.reply({ content: '⏳ This game already started.', flags: 64 });
    duel.started = true;

    // Take both stakes atomically — only if BOTH players can still afford it.
    const stakes = await takeDuelStakes(duel);
    if (!stakes.ok) return cancelDuelNoFunds(interaction, duel, stakes.brokeId, 'Blackjack duel');

    // The stakes are now held by the game. It used to share the 3-minute
    // accept timer, so a game that simply took longer than that silently
    // deleted itself and swallowed both players' coins. Give it a longer
    // clock, and refund both stakes if it STILL times out.
    const client = interaction.client;
    setDuelTimeout(duel, 15 * 60 * 1000);
    duel.onExpire = async (d) => {
      await refundStakes([d.initiatorId, d.targetId], d.amount);
      const ch = client.channels.cache.get(d.channelId);
      const m = ch ? await ch.messages.fetch(d.messageId).catch(() => null) : null;
      if (m) await m.edit({ content: isBet(d.amount) ? '⏱️ **Blackjack duel** timed out — both stakes have been refunded.' : '⏱️ **Blackjack duel** timed out.', components: [] }).catch(() => {});
    };

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
    return handleLobbyJoin(interaction, id.slice('lms_join_'.length), '🎲 **Last Man Standing**');
  }

  // ── Russian Roulette: Join ────────────────────────────────────────────────
  if (id.startsWith('rr_join_')) {
    return handleLobbyJoin(interaction, id.slice('rr_join_'.length), '🔫 **Russian Roulette**');
  }

  // ── Russian Roulette: Shoot ───────────────────────────────────────────────
  if (id.startsWith('rr_shoot_')) {
    const rest = id.slice('rr_shoot_'.length);
    const underscoreIdx = rest.indexOf('_');
    const gameId = rest.slice(0, underscoreIdx);
    const targetId = rest.slice(underscoreIdx + 1);

    const game = getGame(gameId);
    if (!game || game.status !== 'active') return interaction.reply({ content: '❌ This game is no longer active.', flags: 64 });
    if (interaction.user.id !== game.rrShooter) {
      return interaction.reply({ content: `❌ It's not your turn! <@${game.rrShooter}> is currently shooting.`, flags: 64 });
    }
    if (!game.rrActive.includes(targetId)) {
      return interaction.reply({ content: '❌ That player is no longer in the game.', flags: 64 });
    }
    // Double-clicking a shoot button used to fire two shots in one turn.
    if (game.busy) return interaction.reply({ content: '⏳ Hold on — the last shot is still being resolved.', flags: 64 });
    game.busy = true;

    try {
      return await handleRRShot(interaction, game, targetId);
    } catch (err) {
      console.error('[Games] Russian Roulette shot crashed:', err);
      await refundGame(game, interaction.client, 'Russian Roulette hit an error');
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ The game hit an error — all bets were refunded.', flags: 64 }).catch(() => {});
      }
      return;
    } finally {
      game.busy = false;
    }
  }

  // ── Hot Potato: Join ──────────────────────────────────────────────────────
  if (id.startsWith('hp_join_')) {
    return handleLobbyJoin(interaction, id.slice('hp_join_'.length), '🥔 **Hot Potato**');
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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hp_pass_${game.id}`).setLabel('Pass 🥔').setStyle(ButtonStyle.Primary),
    );

    const msg = await interaction.channel.messages.fetch(game.messageId).catch(() => null);
    if (msg) {
      await msg.edit({
        content: `🥔 **Hot Potato!**${potText(game, game._totalPot)}\n<@${game.potatoHolder}> now has the potato!\nRemaining: ${game.players.map(p => `<@${p}>`).join(', ')}`,
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

    // Only the right player may submit each number (the modal is only ever
    // shown to them, but never trust the id alone).
    if (role === 'target' && interaction.user.id !== duel.targetId) {
      return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });
    }
    if (role === 'initiator' && interaction.user.id !== duel.initiatorId) {
      return interaction.reply({ content: '❌ This duel is not for you.', flags: 64 });
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
      if (duel.targetNumber == null) {
        return interaction.reply({ content: '❌ Waiting for the other player to pick their number first.', flags: 64 });
      }
      // Submitting twice must not reveal (and pay out) twice.
      if (duel.resolving) return interaction.reply({ content: '⏳ Already revealing…', flags: 64 });
      duel.resolving = true;

      duel.initiatorNumber = raw;
      const botNumber = Math.floor(Math.random() * 10) + 1;
      const iDiff = Math.abs(duel.initiatorNumber - botNumber);
      const tDiff = Math.abs(duel.targetNumber - botNumber);

      let winnerId = null;
      if (iDiff < tDiff) winnerId = duel.initiatorId;
      else if (tDiff < iDiff) winnerId = duel.targetId;

      // On a tie nothing was ever taken, so there is nothing to refund. When
      // there IS a winner, both stakes are taken now — atomically, and only
      // if both players can still afford it (a free duel takes nothing).
      let res = null;
      if (winnerId) {
        const stakes = await takeDuelStakes(duel);
        if (!stakes.ok) return cancelDuelNoFunds(interaction, duel, stakes.brokeId, 'Number duel');
        deleteDuel(duel.id);
        res = await settleDuel(duel, winnerId);
      } else {
        deleteDuel(duel.id);
      }

      const header = `🎯 Bot picked **${botNumber}**!\n<@${duel.initiatorId}> guessed **${duel.initiatorNumber}** (off by ${iDiff})\n<@${duel.targetId}> guessed **${duel.targetNumber}** (off by ${tDiff})\n\n`;
      const resultText = winnerId
        ? `${header}🏆 <@${winnerId}>${duelWinText(duel, res)}${res.note}`
        : `${header}🤝 Tie!${isBet(duel.amount) ? ' Bets refunded.' : ''}`;

      const msg = await interaction.channel.messages.fetch(duel.messageId).catch(() => null);
      if (msg) await msg.edit({ content: resultText, components: [] });
      return interaction.reply({ content: '✅ Numbers revealed!', flags: 64 });
    }
  }
}

module.exports = { handleButton, handleModal, startHotPotato };
