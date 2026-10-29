'use strict';
// Entry point of the Arabic party games.
//
//   messageCreate  → handleMessage(message)      (never throws)
//   interactionCreate (customId "pg:…") → handleInteraction(interaction)
//
// Trigger: <sign><word> [bet]   —   .علم   .عاصمة   .مافيا   .انسان   .علم 500

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
    if (bet < cfg.trigger.minBet || bet > cfg.trigger.maxBet) {
      return { type, error: `❌ الرهان يجب أن يكون بين **${cfg.trigger.minBet}** و **${cfg.trigger.maxBet}** عملة (أو اتركه فارغًا للعب المجاني).` };
    }
  }
  return { type, bet };
}

const STOP_WORDS = new Set((cfg.trigger.stopWords || []).map(fold));
/** ".توقف" → true (the message is the stop command). */
function isStopCommand(content) {
  const sign = cfg.trigger.sign;
  if (typeof content !== 'string' || !content.startsWith(sign)) return false;
  const parts = content.slice(sign.length).trim().split(/\s+/).filter(Boolean);
  return parts.length === 1 && STOP_WORDS.has(fold(parts[0]));
}

/** The host of the game, or a member who can manage messages (a moderator), may stop it. */
function canStop(s, message) {
  if (s.hostId === message.author.id || s.starterId === message.author.id) return true;
  const perms = message.member && message.member.permissions;
  return !!(perms && typeof perms.has === 'function' && (perms.has('ManageMessages') || perms.has('Administrator')));
}

/** Stops the game running in this channel. Returns true when the message was a stop command. */
async function handleStop(message, s) {
  if (!s || s.status === 'done') return true;                       // nothing to stop: stay quiet
  if (!canStop(s, message)) {
    const note = await message.reply({ content: `⛔ فقط من بدأ اللعبة (<@${s.starterId || s.hostId}>) أو المشرف يستطيع إيقافها.`, allowedMentions: { parse: [] } }).catch(() => null);
    if (note && typeof note.delete === 'function') setTimeout(() => note.delete().catch(() => {}), 6000);
    return true;
  }
  await s.abort(`⏹️ أوقفها <@${message.author.id}>.`);
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

module.exports = { parseTrigger, isStopCommand, handleMessage, handleInteraction };
