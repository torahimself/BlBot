'use strict';
// Entry point of the Arabic party games.
//
//   messageCreate  → handleMessage(message)      (never throws)
//   interactionCreate (customId "pg:…") → handleInteraction(interaction)
//
// Trigger: <sign><word> [bet]   —   .علم   .عاصمة   .مافيا   .ريبليكا   .علم 500

const cfg = require('./config.js');
const { foldLetters } = require('./arabic.js');
const session = require('./session.js');
const dbx = require('../economy/engine/dbx.js');

const GAMES = {
  guess:      () => require('./guess.js'),
  capital:    () => require('./guess.js'),
  mafia:      () => require('./mafia.js'),
  categories: () => require('./categories.js'),
  roulette:   () => require('./roulette.js'),
  geo:        () => require('./geo.js'),
  typing:     () => require('./typing.js'),
  chain:      () => require('./chain.js'),
  math:       () => require('./math.js'),
};

const fold = (w) => foldLetters(String(w || '').toLowerCase()).replace(/\s+/g, '_');
const WORDS = new Map();
for (const [type, words] of Object.entries(cfg.trigger.words)) for (const w of words) WORDS.set(fold(w), type);

/** → { type, bet } | { error } | null (not a trigger) */
function parseTrigger(content) {
  const sign = cfg.trigger.sign;
  if (typeof content !== 'string' || !content.startsWith(sign)) return null;
  const parts = content.slice(sign.length).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  let type = WORDS.get(fold(parts[0]));
  let rest = parts.slice(1);
  if (!type && parts.length > 1) {                         // ".انسان حيوان"
    type = WORDS.get(fold(parts[0] + '_' + parts[1]));
    if (type) rest = parts.slice(2);
  }
  if (!type) return null;
  // ".انسان حيوان نبات جماد بلاد 200" — the category words are decoration.
  if (type === 'categories') while (rest.length && ['حيوان', 'نبات', 'جماد', 'بلاد'].includes(fold(rest[0]))) rest.shift();
  let bet = 0;
  if (rest.length) {
    if (!/^\d+$/.test(rest[0])) return { type, bet: 0 };
    bet = parseInt(rest[0], 10);
    if (bet < cfg.trigger.minBet) {
      return { type, error: `❌ أقل رهان هو **${cfg.trigger.minBet}** عملة (أو اتركه فارغًا للعب المجاني).` };
    }
  }
  return { type, bet };
}

const STOP_WORDS = new Set((cfg.trigger.stopWords || []).map(fold));
const HELP_WORDS = new Set((cfg.trigger.helpWords || []).map(fold));
function isHelpCommand(content) {
  const sign = cfg.trigger.sign;
  if (typeof content !== 'string' || !content.startsWith(sign)) return false;
  const parts = content.slice(sign.length).trim().split(/\s+/).filter(Boolean);
  return parts.length === 1 && HELP_WORDS.has(fold(parts[0]));
}

function helpEmbed() {
  const { EmbedBuilder } = require('discord.js');
  const sg = cfg.trigger.sign;
  const n = (d) => (d.min <= 1 ? `1–${d.max}` : `${d.min}–${d.max}`) + ' لاعبين';
  const line = (emoji, title, cmd, d, text) => `${emoji} **${title}** — \`${sg}${cmd}\` · ${n(d)}\n${text}`;
  return new EmbedBuilder().setColor(0x5865F2).setTitle('🎮 الألعاب')
    .setDescription([
      line('🌍', 'أعلام', 'علم', cfg.guess, 'خمّن الدولة من علمها، الأسرع يفوز.'),
      line('🏛️', 'عواصم', 'عاصمة', cfg.guess, 'خمّن الدولة من عاصمتها.'),
      line('📍', 'جيو', 'جيو', cfg.geo, 'صورة من مكان حقيقي — اكتب اسم الدولة، والأقرب يأخذ نقاط أكثر.'),
      line('🔤', 'ريبليكا', 'ريبليكا', cfg.categories, 'إنسان حيوان نبات جماد بلاد: حرف وخمس فئات، اكتب كلمة صحيحة بالحرف في 15 ثانية.'),
      line('⚡', 'أسرع كتابة', 'كتابة', cfg.typing, 'اكتب الجملة قبل الجميع.'),
      line('🧮', 'حساب سريع', 'حساب', cfg.math, 'مسائل حساب تصعب، أول إجابة صحيحة تفوز.'),
      line('🔗', 'سلسلة كلمات', 'سلسلة', cfg.chain, 'كلمة تبدأ بآخر حرف من التي قبلها، ومن يتأخر يخرج.'),
      line('🎡', 'روليت الطرد', 'روليت', cfg.roulette, 'العجلة تختار لاعبًا يطرد غيره، آخر من يبقى يفوز.'),
      line('🎭', 'مافيا', 'مافيا', cfg.mafia, 'المافيا تقتل ليلًا والمواطنون يصوّتون نهارًا.'),
    ].join('\n\n') + `\n\n💰 أضف رهانًا بعد الأمر: \`${sg}علم 500\` · ⏹️ \`${sg}توقف\` يوقف لعبتك`);
}

/** ".توقف" → true (the message is the stop command). */
function isStopCommand(content) {
  const sign = cfg.trigger.sign;
  if (typeof content !== 'string' || !content.startsWith(sign)) return false;
  const parts = content.slice(sign.length).trim().split(/\s+/).filter(Boolean);
  return parts.length === 1 && STOP_WORDS.has(fold(parts[0]));
}

/** Staff = Administrator / Manage Messages, or one of the bot's configured staff roles (jail / warn). */
function isStaff(message) {
  const m = message.member;
  if (!m) return false;
  const perms = m.permissions;
  if (perms && typeof perms.has === 'function' && (perms.has('ManageMessages') || perms.has('Administrator'))) return true;
  try {
    const config = require('../../config.js');
    const ids = [...((config.jail && config.jail.staffRoleIds) || []), ...((config.warn && config.warn.staffRoleIds) || [])];
    const roles = m.roles && m.roles.cache;
    if (roles && ids.some(id => roles.has(id))) return true;
  } catch (_) { /* config missing: permissions only */ }
  return false;
}

/** The host/starter of the game, or staff, may stop it at any time. */
function canStop(s, message) {
  if (s.hostId === message.author.id || s.starterId === message.author.id) return true;
  return isStaff(message);
}

/** Everything that is running in this channel and can be stopped (party sessions, slash lobby games, duels). */
function stoppables(channelId, s) {
  const out = [];
  if (s && s.status !== 'done') out.push({ kind: 'session', s, owner: s.starterId || s.hostId, hosts: [s.hostId, s.starterId] });
  try {
    const gm = require('../economy/gameManager.js');
    for (const g of gm.games.values()) if (g.channelId === channelId && !g.paidOut) out.push({ kind: 'game', g, owner: g.hostId, hosts: [g.hostId] });
    const dm = require('../economy/duelManager.js');
    for (const d of dm.duels.values()) if (d.channelId === channelId) out.push({ kind: 'duel', d, owner: d.initiatorId, hosts: [d.initiatorId] });
  } catch (_) { /* optional */ }
  return out;
}

async function stopOne(t, message) {
  const stoppedBy = `⏹️ أوقفها <@${message.author.id}>.`;
  if (t.kind === 'session') return t.s.abort(stoppedBy);
  const client = message.client;
  if (t.kind === 'game') {
    const gm = require('../economy/gameManager.js');
    const g = t.g;
    const ch = message.channel;
    const msg = g.messageId && ch.messages ? await ch.messages.fetch(g.messageId).catch(() => null) : null;
    // Hands every stake back once (paidOut guard), cancels the timers and frees the players.
    await gm.refundGame(g, client, `⏹️ أوقفها ${message.author.username}`);
    if (msg) await msg.edit({ components: [] }).catch(() => {});
    return;
  }
  const dm = require('../economy/duelManager.js');
  const stakes = require('../economy/stakes.js');
  const d = t.d;
  const msg = d.messageId && message.channel.messages ? await message.channel.messages.fetch(d.messageId).catch(() => null) : null;
  dm.deleteDuel(d.id);
  if (d.started && d.amount > 0) await stakes.refundStakes([d.initiatorId, d.targetId], d.amount).catch(e => console.error('[Stop] duel refund failed:', e));
  if (msg) await msg.edit({ content: `⏹️ تم إيقاف اللعبة.${d.started && d.amount > 0 ? ' 💸 تم إرجاع الرهانات.' : ''}`, components: [] }).catch(() => {});
}

/** Stops whatever game is running in this channel. Returns true when the message was a stop command. */
async function handleStop(message, s) {
  const list = stoppables(message.channel.id, s);
  if (!list.length) return true;                                    // nothing to stop: stay quiet
  const staff = isStaff(message);
  const mine = list.filter(t => staff || t.hosts.includes(message.author.id) || (t.kind === 'duel' && t.d.targetId === message.author.id));
  if (!mine.length) {
    const owner = list[0].owner;
    const note = await message.reply({ content: `⛔ فقط من بدأ اللعبة (<@${owner}>) أو المشرف يستطيع إيقافها.`, allowedMentions: { parse: [] } }).catch(() => null);
    if (note && typeof note.delete === 'function') setTimeout(() => note.delete().catch(() => {}), 6000);
    return true;
  }
  for (const t of mine) {
    try { await stopOne(t, message); } catch (e) { console.error('[Stop] failed:', e); }
  }
  return true;
}

const channelAllowed = (id) => !cfg.channels || !cfg.channels.length || cfg.channels.includes(id);

async function startFromMessage(message, trig) {
  const def = GAMES[trig.type]();
  if (def.precheck) {                                       // e.g. the street-photo game needs its API token
    const problem = def.precheck();
    if (problem) { await message.reply({ content: problem, allowedMentions: { parse: [] } }).catch(() => {}); return { ok: false, silent: true }; }
  }
  const adapter = {
    channel: message.channel,
    user: message.author,
    member: message.member,
    editReply: (payload) => message.channel.send(payload),
  };
  const options = trig.type === 'capital' ? { mode: 'capital' } : {};
  const r = await session.create({ type: def.type, def, interaction: adapter, bet: trig.bet, options });
  if (!r.ok && !r.silent) await message.reply({ content: r.error, allowedMentions: { parse: [] } }).catch(() => {});
  return r;
}

async function handleMessage(message) {
  try {
    if (!message || !message.author || message.author.bot || !message.guild) return false;

    // Answers for a running game in this channel.
    const s = session.sessionInChannel(message.channel.id);
    if (s && s.status === 'running' && s.def.onMessage) {
      try { s.def.onMessage(s, message); } catch (e) { console.error('[Party] onMessage failed:', e); }
    }

    if (isStopCommand(message.content)) return await handleStop(message, s);

    if (isHelpCommand(message.content)) {
      if (!channelAllowed(message.channel.id)) {
        const note = await message.reply({ content: `🎮 الألعاب فقط في: ${require('../gameChannels.js').IDS.map(id => `<#${id}>`).join(' • ')}`, allowedMentions: { parse: [] } }).catch(() => null);
        if (note) setTimeout(() => note.delete().catch(() => {}), 8000);
        return true;
      }
      await message.reply({ embeds: [helpEmbed()], allowedMentions: { parse: [] } }).catch(() => {});
      return true;
    }

    const trig = parseTrigger(message.content);
    if (!trig) return false;
    if (!channelAllowed(message.channel.id)) {
      // Tell them where games live (the notice removes itself so the channel stays clean).
      const note = await message.reply({ content: `🎮 الألعاب فقط في: ${require('../gameChannels.js').IDS.map(id => `<#${id}>`).join(' • ')}`, allowedMentions: { parse: [] } }).catch(() => null);
      if (note) setTimeout(() => note.delete().catch(() => {}), 8000);
      return true;
    }
    if (trig.error) { await message.reply({ content: trig.error, allowedMentions: { parse: [] } }).catch(() => {}); return true; }
    await startFromMessage(message, trig);
    return true;
  } catch (err) {
    console.error('[Party] message handler failed:', err);
    return false;
  }
}

async function handleInteraction(interaction) {
  try {
    const [, id, ...rest] = String(interaction.customId).split(':');
    const action = rest.join(':');
    const s = session.getSession(id);
    const reply = (content) => interaction.reply({ content, flags: 64 }).catch(() => {});
    if (!s || s.status === 'done') return reply('⌛ هذه اللعبة انتهت.');

    if (s.status === 'lobby' && ['join', 'leave', 'start', 'cancel'].includes(action)) {
      const uid = interaction.user.id;
      if (action === 'join') {
        const name = interaction.member?.displayName || interaction.user.username || uid;
        const r = await s.addPlayer(uid, name);
        if (!r.ok) return reply(`❌ ${r.error}`);
        s.checkAutoStart();
        await interaction.deferUpdate().catch(() => {});
        return s.refreshLobby();
      }
      if (action === 'leave') {
        if (!s.players.has(uid)) return reply('❌ أنت لست في اللوبي.');
        await s.removePlayer(uid);
        await interaction.deferUpdate().catch(() => {});
        return s.refreshLobby();
      }
      if (uid !== s.hostId) return reply('❌ فقط المضيف يستطيع ذلك.');
      if (action === 'cancel') {
        await interaction.deferUpdate().catch(() => {});
        return s.abort('ألغى المضيف اللعبة.');
      }
      if (s.players.size < s.def.min) return reply(`❌ نحتاج ${s.def.min} لاعبين على الأقل.`);
      await interaction.deferUpdate().catch(() => {});
      return s.start();
    }

    if (s.status !== 'running' || !s.def.onComponent) return reply('⌛ هذا الزر لم يعد متاحًا.');
    return await s.def.onComponent(s, interaction, action);
  } catch (err) {
    console.error('[Party] interaction failed:', err);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ حدث خطأ.', flags: 64 }).catch(() => {});
  }
}

// Hand back stakes of games interrupted by a restart (once, after the DB is ready).
dbx.get('SELECT 1').then(() => session.init()).catch(() => {});

module.exports = { parseTrigger, isStopCommand, isHelpCommand, helpEmbed, handleMessage, handleInteraction };
