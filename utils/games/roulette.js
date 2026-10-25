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

function buttons(s, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pg:${s.id}:rkick`).setLabel('طرد لاعب').setEmoji('🎯').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`pg:${s.id}:rrand`).setLabel('طرد عشوائي').setEmoji('🎲').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`pg:${s.id}:rleave`).setLabel('انسحاب').setEmoji('🚪').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function pickMenu(s, chosen) {
  const opts = alive(s).filter(id => id !== chosen).slice(0, 25).map(id => ({
    label: `${s.data.num.get(id)} – ${COLOR_INFO[s.data.color.get(id)][1]} – ${s.name(id)}`.slice(0, 100),
    value: id,
    emoji: COLOR_INFO[s.data.color.get(id)][0],
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`pg:${s.id}:rsel`).setPlaceholder('اختر من تريد طرده...').addOptions(opts)
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
  while (s.status === 'running' && alive(s).length > 1) {
    round++;
    const left = alive(s);
    const chosen = pickRandom(s, left);                         // decided before the animation
    const slots = await Promise.all(left.map(async id => ({
      num: s.data.num.get(id), colorIdx: s.data.color.get(id), name: s.name(id), avatarUrl: await avatarUrlOf(s, id),
    })));
    const g = await wheel.render({ slots, selected: left.indexOf(chosen) });

    const spinEmbed = new EmbedBuilder().setColor(0xF1C40F)
      .setTitle(`🎡 الجولة ${round} — العجلة تدور...`)
      .setDescription(listLines(s, left))
      .setImage('attachment://wheel.gif')
      .setFooter({ text: `${left.length} لاعبين متبقين` });
    const msg = await s.channel.send({
      embeds: [spinEmbed],
      files: [new AttachmentBuilder(g.buffer, { name: 'wheel.gif' })],
      allowedMentions: { parse: [] },
    });
    await sleep(g.spinMs + r.revealPadMs);
    if (s.status !== 'running') return;

    // The chosen player decides.
    const turn = { chosen, resolved: false, done: null, decision: null, msg };
    const decided = new Promise(res => { turn.done = res; });
    s.data.turn = turn;
    const deadline = Date.now() + r.pickMs;
    const pickEmbed = new EmbedBuilder().setColor(0xE74C3C)
      .setTitle(`🎯 وقع الاختيار على ${s.data.num.get(chosen)} ${s.name(chosen)}`)
      .setDescription(`${s.mention(chosen)} — اختر ماذا تفعل!\n⏳ لديك حتى <t:${Math.floor(deadline / 1000)}:R> وإلا ستُطرد أنت من اللعبة!\n\n${listLines(s, left)}`)
      .setImage('attachment://wheel.gif');
    await msg.edit({ embeds: [pickEmbed], components: [buttons(s)], allowedMentions: { parse: [chosen] } }).catch(() => {});
    const timer = setTimeout(() => { if (!turn.resolved) { turn.resolved = true; turn.decision = { kind: 'timeout' }; turn.done(); } }, r.pickMs);
    s.timers.add(timer);

    await decided;
    clearTimeout(timer); s.timers.delete(timer);
    s.data.turn = null;
    if (s.status !== 'running') return;

    // Resolve the decision.
    const d = turn.decision;
    const others = left.filter(id => id !== chosen);
    let victim, text;
    if (d.kind === 'pick' && others.includes(d.target)) {
      victim = d.target;
      text = `🎯 ${s.mention(chosen)} اختار طرد ${tag(s, victim)}!`;
    } else if (d.kind === 'leave') {
      victim = chosen;
      text = `🚪 ${s.mention(chosen)} انسحب من اللعبة!`;
    } else if (d.kind === 'random') {
      victim = pickRandom(s, others);
      text = `🎲 ${s.mention(chosen)} اختار الطرد العشوائي… وخرج ${tag(s, victim)}!`;
    } else {
      victim = chosen;
      text = `⌛ ${s.mention(chosen)} لم يرد خلال ${Math.round(r.pickMs / 1000)} ثانية… فتم طرده من اللعبة!`;
    }
    s.data.alive.delete(victim);
    await msg.edit({ components: [buttons(s, true)], allowedMentions: { parse: [] } }).catch(() => {});
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
  if (!['rkick', 'rrand', 'rleave', 'rsel'].includes(action)) return refuse('⌛ هذا الزر لم يعد متاحًا.');
  if (!t || t.resolved) return refuse('⌛ انتهى هذا الدور.');
  if (uid !== t.chosen) return refuse(`❌ هذا الدور ليس لك — الدور على ${s.mention(t.chosen)}.`);

  if (action === 'rkick') {
    return interaction.reply({ content: '🎯 اختر اللاعب الذي تريد طرده:', components: [pickMenu(s, uid)], flags: 64 });
  }
  if (action === 'rsel') {
    const target = interaction.values && interaction.values[0];
    if (!target || target === uid || !s.data.alive.has(target)) {
      return interaction.update({ content: '❌ هذا اللاعب غير متاح — اضغط «طرد لاعب» مرة أخرى.', components: [] });
    }
    t.resolved = true; t.decision = { kind: 'pick', target };
    await interaction.update({ content: `✅ اخترت طرد ${s.name(target)}.`, components: [] });
    return t.done();
  }
  t.resolved = true;
  t.decision = { kind: action === 'rrand' ? 'random' : 'leave' };
  await interaction.deferUpdate().catch(() => {});
  return t.done();
}

// Called when the session ends (win, abort, crash): lets a game loop that is
// waiting for the chosen player's decision finish instead of hanging.
function cleanup(s) {
  const t = s.data && s.data.turn;
  if (t && !t.resolved) { t.resolved = true; t.decision = { kind: 'timeout' }; t.done(); }
}

module.exports = {
  type: 'roulette', title: 'روليت الطرد', emoji: '🎡', min: cfg.roulette.min, max: cfg.roulette.max,
  blurb: 'تدور العجلة وتختار لاعبًا، وهو يقرر طرد لاعب أو طرد عشوائي أو الانسحاب. آخر لاعب يبقى يفوز!',
  start, onComponent, cleanup, COLOR_INFO,
};
