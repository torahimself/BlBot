'use strict';
// Shared lobby / stake / settlement machinery for the Arabic party games.
//
//   create()  → posts a lobby (join / leave / start buttons)
//   the game's start(session) runs once enough players have joined
//   session.finish({ winners, active, summary })  → pays the pot, credits the event, posts results
//   session.abort(reason)                         → refunds everyone and closes
//
// Bets are optional. A free game never touches a balance. For a real bet every
// player's stake is taken when they join and written to the party_stakes table;
// if the bot restarts mid-game init() hands those stakes back.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');
const dbx = require('../economy/engine/dbx.js');
const events = require('../economy/engine/events.js');
const { spendCoins, updateBalance, getBalance } = require('../economy/shopManager.js');
const stakes = require('../economy/stakes.js');
const gameManager = require('../economy/gameManager.js');
const gameStats = require('./stats.js');

const sessions = new Map();     // id → Session
const byChannel = new Map();    // channelId → id
const byUser = new Map();       // userId → id

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shortId = () => Math.random().toString(36).slice(2, 8);

class Session {
  constructor({ type, def, channel, host, hostName, bet }) {
    this.id = shortId();
    this.type = type;
    this.def = def;               // the game module
    this.channel = channel;
    this.channelId = channel.id;
    this.hostId = host;
    this.starterId = host;        // who typed the trigger (the host can change if he leaves the lobby)
    this.bet = bet || 0;
    this.players = new Map();     // userId → { id, name, active, paid }
    this.status = 'lobby';        // lobby | starting | running | done
    this.message = null;          // lobby message
    this.createdAt = Date.now();
    this.startedAt = null;
    this.timers = new Set();
    this.joining = new Set();     // userIds with a join in progress
    this.options = {};
    this.data = {};
  }

  get ids() { return [...this.players.keys()]; }
  name(id) { const p = this.players.get(id); return p ? p.name : `<@${id}>`; }
  mention(id) { return `<@${id}>`; }
  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); Promise.resolve().then(fn).catch((e) => this.crash(e)); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  markActive(id) { const p = this.players.get(id); if (p) p.active = true; }

  // ── Lobby ────────────────────────────────────────────────────────────────
  lobbyPayload() {
    const d = this.def;
    const list = this.ids.map(id => `• ${this.mention(id)}`).join('\n') || '—';
    const left = this.players.size < d.min
      ? `⏳ نحتاج **${d.min - this.players.size}** لاعب/لاعبين إضافيين على الأقل`
      : (this.autoStartAt ? `🚀 تبدأ اللعبة <t:${Math.floor(this.autoStartAt / 1000)}:R>` : '✅ العدد كافٍ — اضغط ابدأ أو انتظر');
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${d.emoji} ${d.title}`)
      .setDescription(
        `${d.blurb}\n\n` +
        `${this.bet > 0 ? `💰 **الرهان:** ${this.bet} عملة لكل لاعب` : '🆓 **لعب مجاني** — بدون رهان'}\n` +
        `👥 **اللاعبون (${this.players.size}/${d.max}):**\n${list}\n\n${left}`
      )
      .setFooter({ text: `المضيف: ${this.name(this.hostId)}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pg:${this.id}:join`).setLabel('انضم').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pg:${this.id}:leave`).setLabel('غادر').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pg:${this.id}:start`).setLabel('ابدأ').setEmoji('▶️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pg:${this.id}:cancel`).setLabel('إلغاء').setStyle(ButtonStyle.Danger),
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
  }

  async refreshLobby() {
    if (!this.message || this.status !== 'lobby') return;
    await this.message.edit(this.lobbyPayload()).catch(() => {});
  }

  // Adds a player (taking their stake first). Returns { ok, error }.
  async addPlayer(userId, name) {
    if (this.status !== 'lobby') return { ok: false, error: 'اللعبة بدأت بالفعل.' };
    if (this.players.has(userId)) return { ok: false, error: 'أنت منضم بالفعل.' };
    if (this.players.size >= this.def.max) return { ok: false, error: 'اللوبي ممتلئ.' };
    if (byUser.has(userId) || gameManager.isInGame(userId)) return { ok: false, error: 'أنت في لعبة أخرى حاليًا.' };
    if (this.joining.has(userId)) return { ok: false, error: 'لحظة...' };
    this.joining.add(userId);
    try {
      if (this.bet > 0) {
        const cap = await stakes.canBet([userId], this.bet);
        if (!cap.ok) return { ok: false, error: stakes.capRefusal(userId, false).replace(/\*\*/g, '') };
        if (!(await spendCoins(userId, this.bet))) {
          const bal = await getBalance(userId);
          return { ok: false, error: `رصيدك ${bal} فقط، والرهان ${this.bet}.` };
        }
        try {
          await dbx.run('INSERT OR REPLACE INTO party_stakes (sessionId, userId, amount, createdAt) VALUES (?, ?, ?, ?)', [this.id, userId, this.bet, Date.now()]);
        } catch (err) {
          await updateBalance(userId, this.bet);
          console.error('[Party] could not record a stake:', err);
          return { ok: false, error: 'حدث خطأ، حاول مرة أخرى.' };
        }
      }
      if (this.status !== 'lobby') {           // closed while we were paying
        await this.refundOne(userId);
        return { ok: false, error: 'اللعبة بدأت بالفعل.' };
      }
      this.players.set(userId, { id: userId, name, active: false, paid: this.bet > 0 });
      byUser.set(userId, this.id);
      return { ok: true };
    } finally {
      this.joining.delete(userId);
    }
  }

  async refundOne(userId) {
    if (this.bet <= 0) return;
    const r = await dbx.run('DELETE FROM party_stakes WHERE sessionId = ? AND userId = ?', [this.id, userId]);
    if (r.changes > 0) await updateBalance(userId, this.bet);     // only if the ledger row really existed
  }

  async removePlayer(userId) {
    if (!this.players.has(userId) || this.status !== 'lobby') return false;
    this.players.delete(userId);
    byUser.delete(userId);
    await this.refundOne(userId);
    if (this.hostId === userId) {
      if (this.players.size === 0) { await this.abort('غادر المضيف ولم يبقَ أحد.'); return true; }
      this.hostId = this.ids[0];
    }
    this.checkAutoStart();
    return true;
  }

  checkAutoStart() {
    if (this.status !== 'lobby') return;
    if (this.autoStartTimer) { clearTimeout(this.autoStartTimer); this.timers.delete(this.autoStartTimer); this.autoStartTimer = null; this.autoStartAt = null; }
    const n = this.players.size;
    if (n < this.def.min) return;
    const wait = n >= this.def.max ? cfg.lobby.fullStartMs : cfg.lobby.autoStartMs;
    this.autoStartAt = Date.now() + wait;
    this.autoStartTimer = this.later(() => this.start(), wait);
  }

  async start() {
    if (this.status !== 'lobby') return;
    if (this.players.size < this.def.min) return;
    this.status = 'starting';
    this.clearTimers();
    this.startedAt = Date.now();
    this.later(() => this.abort('انتهى الوقت الأقصى للعبة.'), cfg.maxGameMs);
    if (this.message) await this.message.edit({
      embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(`${this.def.emoji} ${this.def.title}`)
        .setDescription(`🚀 **بدأت اللعبة!**\n👥 ${this.ids.map(i => this.mention(i)).join(' ')}\n${this.bet > 0 ? `💰 الجائزة: **${this.bet * this.players.size}** عملة` : '🆓 لعب مجاني'}`)],
      components: [], allowedMentions: { parse: [] },
    }).catch(() => {});
    this.status = 'running';
    try {
      await this.def.start(this);
    } catch (err) {
      await this.crash(err);
    }
  }

  async crash(err) {
    console.error(`[Party] ${this.type} ${this.id} crashed:`, err);
    await this.abort('حدث خطأ غير متوقع — تم إلغاء اللعبة وإرجاع الرهانات.');
  }

  // ── Ending ───────────────────────────────────────────────────────────────
  async release() {
    this.clearTimers();
    this.status = 'done';
    sessions.delete(this.id);
    if (byChannel.get(this.channelId) === this.id) byChannel.delete(this.channelId);
    for (const id of this.ids) if (byUser.get(id) === this.id) byUser.delete(id);
    if (this.def.cleanup) { try { this.def.cleanup(this); } catch (_) { /* ignore */ } }
  }

  /** Cancels the game and gives every stake back. Safe to call more than once. */
  async abort(reason = 'تم إلغاء اللعبة.') {
    if (this.status === 'done') return;
    const wasLobby = this.status === 'lobby';
    const ids = this.ids;
    await this.release();
    for (const id of ids) await this.refundOne(id).catch((e) => console.error('[Party] refund failed:', e));
    const text = `❌ **${this.def.title}** — ${reason}${this.bet > 0 ? '\n💸 تم إرجاع الرهانات.' : ''}`;
    if (wasLobby && this.message) await this.message.edit({ content: text, embeds: [], components: [] }).catch(() => {});
    else await this.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  /**
   * Ends a finished game.
   *   winners  userIds that win the pot (empty → everybody is refunded)
   *   active   userIds who really took part (count for the event)
   * Returns { settle, noteText }.
   */
  async finish({ winners = [], active = null } = {}) {
    if (this.status === 'done') return null;
    const ids = this.ids;
    const startedAt = this.startedAt || this.createdAt;
    await this.release();

    let noteText = '';
    let result = null;
    if (this.bet > 0) {
      if (!winners.length) {
        for (const id of ids) await this.refundOne(id);
        noteText = '\n💸 لا يوجد فائز — تم إرجاع الرهانات.';
      } else {
        const pot = this.bet * ids.length;
        const share = Math.floor(pot / winners.length);
        const payouts = {};
        winners.forEach((id, i) => { payouts[id] = share + (i === 0 ? pot - share * winners.length : 0); });
        const stakeMap = {};
        for (const id of ids) stakeMap[id] = this.bet;
        try {
          result = await stakes.settleBet({ kind: 'pot', stakes: stakeMap, payouts });
          await dbx.run('DELETE FROM party_stakes WHERE sessionId = ?', [this.id]);
          noteText = '\n' + winners.map(id => `💰 <@${id}> ربح **${(result.payouts[id] || 0) - this.bet}** عملة`).join('\n') + (result.note || '');
        } catch (err) {
          console.error('[Party] settle failed, refunding:', err);
          for (const id of ids) await this.refundOne(id);
          noteText = '\n⚠️ حدث خطأ أثناء توزيع الجائزة — تم إرجاع الرهانات.';
        }
      }
    }

    // Plays / wins per game (for stats). Never blocks or breaks the result.
    gameStats.record(this.type, (active || ids).filter(id => ids.includes(id)), winners).catch((e) => console.error('[Party] stats failed:', e));

    // Halloween event: a real, finished game earns each active player's "games" Candy. The result says what
    // happened, so nobody has to guess why a game did or did not count.
    try {
      const ev = events.current();
      if (ev && events.phase(Date.now(), ev) === 'active') {
        const took = Date.now() - startedAt;
        const real = ids.length >= cfg.eventCredit.minPlayers && took >= cfg.eventCredit.minDurationMs;
        const who = (active || this.ids).filter(id => ids.includes(id));
        if (!real) {
          noteText += `\n-# 🍬 لم تُحتسب هذه اللعبة في الفعالية — تحتاج ${cfg.eventCredit.minPlayers} لاعبين على الأقل ومدة ${Math.round(cfg.eventCredit.minDurationMs / 1000)} ثانية.`;
        } else if (who.length) {
          const got = [];
          await events.recordGames(who, Date.now(), got, this.channel && this.channel.client);
          const capped = who.filter(id => !got.includes(id));
          if (got.length) noteText += `\n🍬 +${ev.points.pointsPerGame} Candy: ${got.map(id => `<@${id}>`).join(' ')}`;
          if (capped.length) noteText += `\n-# ${capped.map(id => `<@${id}>`).join(' ')} وصلوا حد ${ev.points.gamesPerDayMax} ألعاب اليوم.`;
        } else {
          noteText += '\n-# 🍬 لم يشارك أحد فعليًا في هذه اللعبة فلم تُحتسب.';
        }
      }
    } catch (err) {
      console.error('[Party] event credit failed:', err);
    }
    return { result, noteText };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
async function create({ type, def, interaction, bet = 0, options = {} }) {
  const channel = interaction.channel;
  const hostId = interaction.user.id;
  if (byChannel.has(channel.id)) return { ok: false, error: 'توجد لعبة جارية في هذه القناة بالفعل.' };
  if (byUser.has(hostId) || gameManager.isInGame(hostId)) return { ok: false, error: 'أنت في لعبة أخرى حاليًا.' };

  const s = new Session({ type, def, channel, host: hostId, hostName: interaction.member?.displayName || interaction.user.username, bet });
  s.options = options;
  sessions.set(s.id, s);
  byChannel.set(channel.id, s.id);

  const joined = await s.addPlayer(hostId, interaction.member?.displayName || interaction.user.username);
  if (!joined.ok) {
    sessions.delete(s.id); byChannel.delete(channel.id);
    return { ok: false, error: joined.error };
  }
  try {
    s.message = await interaction.editReply(s.lobbyPayload());
  } catch (err) {
    console.error('[Party] could not post the lobby:', err);
    await s.abort('تعذّر فتح اللوبي.');
    return { ok: false, error: 'تعذّر فتح اللوبي.', silent: true };
  }
  s.later(() => s.abort('لم يكتمل العدد في الوقت المحدد.'), cfg.lobby.waitMs);
  return { ok: true, session: s };
}

// Hands back stakes of games that were running when the bot stopped.
async function init() {
  try {
    const rows = await dbx.all('SELECT sessionId, userId, amount FROM party_stakes');
    for (const r of rows) {
      if (sessions.has(r.sessionId)) continue;
      const del = await dbx.run('DELETE FROM party_stakes WHERE sessionId = ? AND userId = ?', [r.sessionId, r.userId]);
      if (del.changes > 0) { await updateBalance(r.userId, r.amount); console.log(`[Party] refunded ${r.amount} to ${r.userId} (game interrupted by a restart)`); }
    }
  } catch (err) {
    console.error('[Party] stake recovery failed:', err);
  }
}

const getSession = (id) => sessions.get(id);
const sessionInChannel = (channelId) => sessions.get(byChannel.get(channelId));

module.exports = { Session, create, init, getSession, sessionInChannel, sleep, sessions, byUser };
