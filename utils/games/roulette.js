'use strict';
// روليت — elimination roulette (Fizbo style).
//
// Every round a wheel spins and picks ONE remaining player (decided on the
// server before the animation). The chosen player must pick:
//   • طرد لاعب   — choose who to kick (private select menu)
//   • طرد عشوائي — kick a random other player
//   • انسحاب     — leave the game himself
// No answer within `pickMs` (15 s) → the chosen player is kicked himself.
// The last player standing wins the pot.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const cfg = require('./config.js');
const wheel = require('./wheel.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Colour name + emoji for wheel colour index 0–11 (same order as wheel.COLORS).
const COLOR_INFO = [
  ['🔴', 'أحمر'], ['🔵', 'أزرق'], ['🟢', 'أخضر'], ['🟠', 'برتقالي'], ['🟣', 'بنفسجي'], ['🟤', 'بني'],
  ['🩷', 'وردي'], ['🩵', 'سماوي'], ['🟡', 'أصفر'], ['🩶', 'رمادي'], ['🍏', 'ليموني'], ['🔷', 'نيلي'],
];

const rngOf = (s) => (s.options && s.options.rng) || Math.random;
const alive = (s) => s.ids.filter(id => s.data.alive.has(id));
const tag = (s, id) => `**${s.data.num.get(id)}** ${COLOR_INFO[s.data.color.get(id)][0]} ${s.mention(id)}`;

function listLines(s, ids) {
  return ids.map(id => {
    const [emoji, name] = COLOR_INFO[s.data.color.get(id)];
    return `**${s.data.num.get(id)}** – ${emoji} ${name} – ${s.mention(id)}`;
  }).join('\n');
}

// Every component carries the turn number (":<n>") so a button from an earlier turn can never act on the current one.
function buttons(s, n, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pg:${s.id}:rkick:${n}`).setLabel('طرد لاعب').setEmoji('🎯').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`pg:${s.id}:rrand:${n}`).setLabel('طرد عشوائي').setEmoji('🎲').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`pg:${s.id}:rleave:${n}`).setLabel('انسحاب').setEmoji('🚪').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function pickMenu(s, chosen, n) {
  const opts = alive(s).filter(id => id !== chosen).slice(0, 25).map(id => ({
    label: `${s.data.num.get(id)} – ${COLOR_INFO[s.data.color.get(id)][1]} – ${s.name(id)}`.slice(0, 100),
    value: id,
    emoji: COLOR_INFO[s.data.color.get(id)][0],
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`pg:${s.id}:rsel:${n}`).setPlaceholder('اختر من تريد طرده...').addOptions(opts)
  );
}

// Avatar URL of a player (png, 128px) from the bot's user cache/API; null when unavailable.
async function avatarUrlOf(s, id) {
  try {
    const client = s.channel && s.channel.client;
    if (!client || !client.users) return null;
    const u = client.users.cache.get(id) || await client.users.fetch(id);
    return u && u.displayAvatarURL ? u.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }) : null;
  } catch (_) { return null; }
}

function pickRandom(s, list) {
  return list[Math.floor(rngOf(s)() * list.length)];
}

// Removes players who left the server while the game was running.
async function dropGone(s) {
  const guild = s.channel && s.channel.guild;
  if (!guild || !guild.members || typeof guild.members.fetch !== 'function') return;
  for (const id of alive(s)) {
    try { await guild.members.fetch(id); }
    catch (err) {
      if (err && (err.code === 10007 || err.code === 10013)) {      // Unknown Member / Unknown User
        s.data.alive.delete(id);
        await s.channel.send({ content: `🚪 ${s.mention(id)} غادر السيرفر وتم استبعاده من اللعبة.`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  }
}

async function start(s) {
  const r = cfg.roulette;
  s.data.num = new Map();
  s.data.color = new Map();
  s.data.alive = new Set(s.ids);
  s.data.turn = null;
  s.ids.forEach((id, i) => { s.data.num.set(id, i + 1); s.data.color.set(id, i % 12); s.markActive(id); });

  await s.channel.send({
    content: `🎡 **روليت الطرد** — ${s.players.size} لاعبين. كل جولة تدور العجلة وتختار لاعبًا، وهو يقرر: **طرد لاعب** أو **طرد عشوائي** أو **انسحاب**. آخر لاعب يبقى يفوز!\n${listLines(s, s.ids)}`,
    allowedMentions: { parse: [] },
  });
  await sleep(r.pauseMs);

  let round = 0;
  while (s.status === 'running') {
    await dropGone(s);
    if (s.status !== 'running') return;
    const left = alive(s);
    if (left.length <= 1) break;
    round++;
    const chosen = pickRandom(s, left);                         // decided before the animation
    const slots = await Promise.all(left.map(async id => ({
      num: s.data.num.get(id), colorIdx: s.data.color.get(id), name: s.name(id), avatarUrl: await avatarUrlOf(s, id),
    })));
    const g = await wheel.render({ slots, selected: left.indexOf(chosen) });
    const file = () => new AttachmentBuilder(g.buffer, { name: 'wheel.gif' });

    // ── Two players left: no kicking — whoever the wheel picks wins. ──────
    if (left.length === 2) {
      const finalEmbed = new EmbedBuilder().setColor(0xF1C40F)
        .setTitle(`🎡 الجولة الأخيرة — العجلة تدور...`)
        .setDescription(`${listLines(s, left)}\n\nلم يتبقَّ سوى لاعبين، فمن تختاره العجلة **يفوز تلقائيًا**!`)
        .setImage('attachment://wheel.gif');
      await s.channel.send({ content: `${s.mention(chosen)}`, embeds: [finalEmbed], files: [file()], allowedMentions: { users: [chosen] } });
      await sleep(g.spinMs + r.revealPadMs);
      if (s.status !== 'running') return;
      const other = left.find(id => id !== chosen);
      s.data.alive.delete(other);
      await s.channel.send({
        content: `🎯 وقع الاختيار على ${tag(s, chosen)} — وبما أنه لم يتبقَّ سوى لاعبين فهو **يفوز تلقائيًا**!\n💀 **خرج من اللعبة:** ${s.mention(other)}`,
        allowedMentions: { parse: [] },
      });
      break;
    }

    // ── Normal turn: ONE message = mention + wheel + the three buttons. ───
    // Nothing has to be edited afterwards for the buttons to exist. The 15 s
    // start once the message is delivered AND the wheel has stopped spinning.
    const turn = { n: round, chosen, resolved: false, decision: null, done: null, timer: null };
    const decided = new Promise(res => { turn.done = res; });
    turn.resolve = (decision) => {                               // the ONLY way a turn is resolved
      if (turn.resolved) return false;
      turn.resolved = true; turn.decision = decision;
      if (turn.timer) { clearTimeout(turn.timer); s.timers.delete(turn.timer); }
      turn.done();
      return true;
    };
    s.data.turn = turn;                                          // set BEFORE sending: clicks are valid from the first moment
    const shownDeadline = Date.now() + g.spinMs + r.pickMs;
    const turnEmbed = new EmbedBuilder().setColor(0xE74C3C)
      .setTitle(`🎡 الجولة ${round} — ${left.length} لاعبين متبقين`)
      .setDescription(`🎯 ${s.mention(chosen)} — **الدور عليك!** اختر ماذا تفعل.\n⏳ لديك حتى <t:${Math.floor(shownDeadline / 1000)}:R> (بعد توقف العجلة) وإلا ستُطرد أنت من اللعبة!\n\n${listLines(s, left)}`)
      .setImage('attachment://wheel.gif');
    const msg = await s.channel.send({
      content: `${s.mention(chosen)}`,
      embeds: [turnEmbed],
      files: [file()],
      components: [buttons(s, turn.n)],
      allowedMentions: { users: [chosen] },
    });
    const sentAt = Date.now();
    if (!turn.resolved) {
      turn.timer = setTimeout(() => turn.resolve({ kind: 'timeout' }), g.spinMs + r.pickMs);
      s.timers.add(turn.timer);
    }

    await decided;
    s.data.turn = null;
    if (s.status !== 'running') return;

    // Let the wheel finish before the result is announced (a very fast click).
    const spinLeft = sentAt + g.spinMs - Date.now();
    if (spinLeft > 0) await sleep(spinLeft);
    if (s.status !== 'running') return;

    // Resolve the decision. The chosen player can never be the victim of a kick.
    const d = turn.decision;
    const others = left.filter(id => id !== chosen && s.data.alive.has(id));
    let victim, text;
    if (d.kind === 'pick' && others.includes(d.target)) {
      victim = d.target;
      text = `🎯 ${s.mention(chosen)} اختار طرد ${tag(s, victim)}!`;
    } else if (d.kind === 'random' && others.length) {
      victim = pickRandom(s, others);
      text = `🎲 ${s.mention(chosen)} اختار الطرد العشوائي… وخرج ${tag(s, victim)}!`;
    } else if (d.kind === 'leave') {
      victim = chosen;
      text = `🚪 ${s.mention(chosen)} انسحب من اللعبة!`;
    } else {
      victim = chosen;
      text = `⌛ ${s.mention(chosen)} لم يرد خلال ${Math.round(r.pickMs / 1000)} ثانية… فتم طرده من اللعبة!`;
    }
    s.data.alive.delete(victim);
    await msg.edit({ components: [buttons(s, turn.n, true)], allowedMentions: { parse: [] } }).catch(() => {});
    const remaining = alive(s);
    await s.channel.send({
      content: `${text}\n💀 **خرج من اللعبة:** ${s.mention(victim)} · المتبقون: ${remaining.length}`,
      allowedMentions: { parse: [] },
    });
    if (remaining.length > 1) await sleep(r.pauseMs);
  }

  if (s.status !== 'running') return;
  const winner = alive(s)[0];
  const done = await s.finish({ winners: winner ? [winner] : [], active: s.ids });
  if (!done) return;
  await s.channel.send({
    content: `🏆 **الفائز في روليت الطرد:** ${s.mention(winner)} 🎉${done.noteText}`,
    allowedMentions: { parse: [] },
  });
}

async function onComponent(s, interaction, action) {
  const t = s.data.turn;
  const uid = interaction.user.id;
  const refuse = (content) => interaction.reply({ content, flags: 64, allowedMentions: { parse: [] } });
  const [act, token] = String(action).split(':');
  if (!['rkick', 'rrand', 'rleave', 'rsel'].includes(act)) return refuse('⌛ هذا الزر لم يعد متاحًا.');
  // A component from an earlier turn (or one without a token) never acts on the current turn.
  if (!t || t.resolved || String(t.n) !== token) return refuse('⌛ انتهى هذا الدور.');
  if (uid !== t.chosen) return refuse(`❌ هذا الدور ليس لك — الدور على ${s.mention(t.chosen)}.`);

  if (act === 'rkick') {
    return interaction.reply({ content: '🎯 اختر اللاعب الذي تريد طرده:', components: [pickMenu(s, uid, t.n)], flags: 64 });
  }
  if (act === 'rsel') {
    const target = interaction.values && interaction.values[0];
    if (!target || target === uid || !s.data.alive.has(target)) {
      return interaction.update({ content: '❌ هذا اللاعب غير متاح — اضغط «طرد لاعب» مرة أخرى.', components: [] });
    }
    if (!t.resolve({ kind: 'pick', target })) return interaction.update({ content: '⌛ انتهى هذا الدور.', components: [] });
    return interaction.update({ content: `✅ اخترت طرد ${s.name(target)}.`, components: [] });
  }
  if (!t.resolve({ kind: act === 'rrand' ? 'random' : 'leave' })) return refuse('⌛ انتهى هذا الدور.');
  await interaction.deferUpdate().catch(() => {});
}

// Called when the session ends (win, abort, crash): lets a game loop that is
// waiting for the chosen player's decision finish instead of hanging.
function cleanup(s) {
  const t = s.data && s.data.turn;
  if (t && !t.resolved) t.resolve({ kind: 'timeout' });
}

module.exports = {
  type: 'roulette', title: 'روليت الطرد', emoji: '🎡', min: cfg.roulette.min, max: cfg.roulette.max,
  blurb: 'تدور العجلة وتختار لاعبًا، وهو يقرر طرد لاعب أو طرد عشوائي أو الانسحاب. آخر لاعب يبقى يفوز!',
  start, onComponent, cleanup, COLOR_INFO,
};
