'use strict';
// مافيا — point-and-click mafia (no DMs needed).
//   • «اعرف دورك»  shows your role privately (only you see it)
//   • Night: «استخدم قدرتك» opens a private menu — mafia pick a victim, the
//     doctor protects someone, the detective investigates. Citizens get a
//     look-alike menu that does nothing, so clicking it gives nothing away.
//   • Day: the dead player is announced, everyone talks, then votes with a menu.
// Winners: the town when no mafia is left; the mafia when they are as many as the rest.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');

const m = cfg.mafia;
const ROLES = {
  mafia:     { ar: 'مافيا',  emoji: '🔪', team: 'mafia', blurb: 'اقتل مواطنًا كل ليلة دون أن يكشفك أحد. اعرف زملاءك من القائمة.' },
  doctor:    { ar: 'طبيب',   emoji: '🩺', team: 'town',  blurb: 'اختر كل ليلة لاعبًا لتحميه من القتل (لا يمكنك حماية نفس الشخص ليلتين متتاليتين).' },
  detective: { ar: 'محقق',   emoji: '🕵️', team: 'town',  blurb: 'اختر كل ليلة لاعبًا لتعرف هل هو مافيا أم لا.' },
  citizen:   { ar: 'مواطن',  emoji: '🧑', team: 'town',  blurb: 'ابحث عن المافيا وصوّت لإقصائهم في النهار.' },
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mafiaCount(n) { return Math.max(1, Math.floor(n / 4)); }   // 5–7 → 1, 8–11 → 2, 12 → 3

function assignRoles(ids, rng = Math.random) {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const roles = new Map();
  const k = mafiaCount(ids.length);
  pool.forEach((id, i) => {
    if (i < k) roles.set(id, 'mafia');
    else if (i === k) roles.set(id, 'doctor');
    else if (i === k + 1) roles.set(id, 'detective');
    else roles.set(id, 'citizen');
  });
  return roles;
}

// 'town' | 'mafia' | null
function winner(alive, roles) {
  const maf = alive.filter(id => roles.get(id) === 'mafia').length;
  const town = alive.length - maf;
  if (maf === 0) return 'town';
  if (maf >= town) return 'mafia';
  return null;
}

// Picks the most-voted target; ties → random among the leaders; no votes → null.
function plurality(votes, rng = Math.random) {
  const counts = new Map();
  for (const t of votes) if (t) counts.set(t, (counts.get(t) || 0) + 1);
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  const lead = [...counts].filter(([, n]) => n === top).map(([t]) => t);
  return lead[Math.floor(rng() * lead.length)];
}

// Day vote: a tie means NOBODY is eliminated.
function voteResult(votes) {
  const counts = new Map();
  for (const t of votes) if (t && t !== 'skip') counts.set(t, (counts.get(t) || 0) + 1);
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  const lead = [...counts].filter(([, n]) => n === top);
  return lead.length === 1 ? lead[0][0] : null;
}

function resolveNight({ kill, save }) {
  if (!kill) return { dead: null, saved: false };
  if (save && save === kill) return { dead: null, saved: true };
  return { dead: kill, saved: false };
}

const aliveIds = (s) => s.ids.filter(id => s.data.alive.has(id));

function playerMenu(s, customId, placeholder, ids, extra = []) {
  const opts = ids.map(id => ({ label: s.name(id).slice(0, 90), value: id }));
  for (const e of extra) opts.push(e);
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(opts.slice(0, 25)));
}

function waitFor(s, ms, holder, key) {
  return new Promise((resolve) => {
    holder[key] = resolve;
    const t = setTimeout(resolve, ms);
    s.timers.add(t);
    holder[key + 'Timer'] = t;
  });
}

async function night(s, n) {
  const d = s.data;
  d.night = { kills: new Map(), save: null, probe: null, acted: new Set(), done: null };
  const needed = aliveIds(s).filter(id => ['mafia', 'doctor', 'detective'].includes(d.roles.get(id)));
  d.night.needed = needed;

  const msg = await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x2C2F33).setTitle(`🌙 الليل ${n}`)
      .setDescription('حلّ الظلام على المدينة...\nاضغط **استخدم قدرتك** (الجميع يضغط، حتى المواطنين، حتى لا يُكشف أحد).')
      .setFooter({ text: `${Math.round(m.nightMs / 1000)} ثانية` })],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pg:${s.id}:act`).setLabel('استخدم قدرتك').setEmoji('🌙').setStyle(ButtonStyle.Secondary))],
  });
  await waitFor(s, m.nightMs, d.night, 'done');
  clearTimeout(d.night.doneTimer); s.timers.delete(d.night.doneTimer);
  await msg.edit({ components: [] }).catch(() => {});

  const kill = plurality([...d.night.kills.values()]);
  const res = resolveNight({ kill, save: d.night.save });
  d.lastSave = d.night.save;
  d.night = null;
  return res;
}

async function day(s, n, res) {
  const d = s.data;
  let text;
  if (res.dead) {
    d.alive.delete(res.dead);
    text = `☀️ **النهار ${n}**\n💀 وُجد ${s.mention(res.dead)} مقتولًا... وكان **${ROLES[d.roles.get(res.dead)].emoji} ${ROLES[d.roles.get(res.dead)].ar}**.`;
  } else if (res.saved) {
    text = `☀️ **النهار ${n}**\n🩺 حاولت المافيا القتل لكن **الطبيب أنقذ الضحية**! لم يمت أحد.`;
  } else {
    text = `☀️ **النهار ${n}**\n😴 مرّت الليلة بسلام — لم يمت أحد.`;
  }
  await s.channel.send({ content: text, allowedMentions: { parse: [] } });
  let w = winner(aliveIds(s), d.roles);
  if (w) return w;

  await s.channel.send({ content: `💬 **النقاش** (${Math.round(m.talkMs / 1000)} ثانية) — من المافيا؟\n👥 الأحياء: ${aliveIds(s).map(i => s.mention(i)).join(' ')}`, allowedMentions: { parse: [] } });
  await sleep(m.talkMs);
  if (s.status !== 'running') return null;

  d.vote = { votes: new Map(), done: null };
  const vmsg = await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('🗳️ التصويت').setDescription('اختر من تريد إقصاءه (تستطيع تغيير صوتك). التعادل = لا أحد يُقصى.').setFooter({ text: `${Math.round(m.voteMs / 1000)} ثانية` })],
    components: [playerMenu(s, `pg:${s.id}:vsel`, 'صوّت لإقصاء...', aliveIds(s), [{ label: 'تخطّي (لا أحد)', value: 'skip' }])],
  });
  await waitFor(s, m.voteMs, d.vote, 'done');
  clearTimeout(d.vote.doneTimer); s.timers.delete(d.vote.doneTimer);
  await vmsg.edit({ components: [] }).catch(() => {});

  const out = voteResult([...d.vote.votes.values()]);
  d.vote = null;
  if (out) {
    d.alive.delete(out);
    await s.channel.send({ content: `⚖️ قرّر الجميع إقصاء ${s.mention(out)} — وكان **${ROLES[d.roles.get(out)].emoji} ${ROLES[d.roles.get(out)].ar}**.`, allowedMentions: { parse: [] } });
  } else {
    await s.channel.send('⚖️ لم يُقصَ أحد (تعادل أو تخطّي).');
  }
  return winner(aliveIds(s), d.roles);
}

async function start(s) {
  const d = s.data;
  d.roles = assignRoles(s.ids);
  d.alive = new Set(s.ids);
  d.lastSave = null;
  const k = mafiaCount(s.ids.length);
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x99AAB5).setTitle('🎭 مافيا')
      .setDescription(`اللاعبون: ${s.ids.length} — **${k}** مافيا · طبيب · محقق · والبقية مواطنون.\nاضغط الزر لتعرف دورك (يظهر لك وحدك).`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pg:${s.id}:role`).setLabel('اعرف دورك').setEmoji('🎭').setStyle(ButtonStyle.Primary))],
  });
  await sleep(12000);

  let win = null;
  for (let n = 1; n <= 20 && !win; n++) {
    if (s.status !== 'running') return;
    const res = await night(s, n);
    if (s.status !== 'running') return;
    win = await day(s, n, res);
  }
  if (s.status !== 'running') return;

  const teamWin = win || 'town';
  const winners = s.ids.filter(id => ROLES[d.roles.get(id)].team === teamWin);
  const reveal = s.ids.map(id => `${ROLES[d.roles.get(id)].emoji} ${s.mention(id)} — ${ROLES[d.roles.get(id)].ar}${d.alive.has(id) ? '' : ' 💀'}`).join('\n');
  const fin = await s.finish({ winners, active: s.ids });
  if (!fin) return;
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(teamWin === 'town' ? 0x57F287 : 0xED4245)
      .setTitle(teamWin === 'town' ? '🏆 فاز المواطنون!' : '🔪 فازت المافيا!')
      .setDescription(`${reveal}${fin.noteText}`)],
    allowedMentions: { parse: [] },
  });
}

async function onComponent(s, interaction, action) {
  const d = s.data;
  const uid = interaction.user.id;
  if (!s.players.has(uid)) return interaction.reply({ content: '❌ أنت لست من اللاعبين.', flags: 64 });
  s.markActive(uid);

  if (action === 'role') {
    if (!d.roles) return interaction.reply({ content: '⏳ لم تبدأ اللعبة بعد.', flags: 64 });
    const role = d.roles.get(uid);
    const info = ROLES[role];
    let extra = '';
    if (role === 'mafia') {
      const mates = s.ids.filter(id => d.roles.get(id) === 'mafia' && id !== uid);
      extra = mates.length ? `\n🤝 زملاؤك: ${mates.map(i => `<@${i}>`).join(' ')}` : '\n(أنت المافيا الوحيد)';
    }
    return interaction.reply({ content: `${info.emoji} دورك: **${info.ar}**\n${info.blurb}${extra}`, flags: 64, allowedMentions: { parse: [] } });
  }

  if (action === 'act') {
    if (!d.night) return interaction.reply({ content: '☀️ ليس وقت الليل.', flags: 64 });
    if (!d.alive.has(uid)) return interaction.reply({ content: '💀 أنت خارج اللعبة.', flags: 64 });
    const role = d.roles.get(uid);
    const targets = aliveIds(s).filter(id => !(role === 'mafia' && d.roles.get(id) === 'mafia'));
    const placeholder = role === 'mafia' ? 'اختر الضحية...' : role === 'doctor' ? 'اختر من تحميه...' : role === 'detective' ? 'اختر من تحقق منه...' : 'اختر لاعبًا...';
    const list = role === 'doctor' ? aliveIds(s) : (role === 'detective' ? aliveIds(s).filter(id => id !== uid) : (role === 'mafia' ? targets : aliveIds(s).filter(id => id !== uid)));
    return interaction.reply({ content: '🌙 اختر:', components: [playerMenu(s, `pg:${s.id}:nsel`, placeholder, list)], flags: 64 });
  }

  if (action === 'nsel') {
    if (!d.night) return interaction.update({ content: '☀️ انتهى الليل.', components: [] });
    if (!d.alive.has(uid)) return interaction.update({ content: '💀 أنت خارج اللعبة.', components: [] });
    const target = interaction.values[0];
    const role = d.roles.get(uid);
    if (!d.alive.has(target)) return interaction.update({ content: '❌ هذا اللاعب غير موجود.', components: [] });
    let msg = '✅ تم تسجيل اختيارك.';
    if (role === 'mafia' && d.roles.get(target) !== 'mafia') { d.night.kills.set(uid, target); msg = `🔪 اخترت ${s.name(target)}.`; }
    else if (role === 'doctor') {
      if (target === d.lastSave) return interaction.update({ content: '❌ لا يمكنك حماية نفس الشخص ليلتين متتاليتين — اضغط الزر مرة أخرى.', components: [] });
      d.night.save = target; msg = `🩺 ستحمي ${s.name(target)}.`;
    } else if (role === 'detective') {
      if (!d.night.probe) {
        d.night.probe = target;
        msg = `🕵️ ${s.name(target)}: **${d.roles.get(target) === 'mafia' ? 'مافيا 🔪' : 'ليس مافيا ✅'}**`;
      } else msg = '🕵️ لقد حققت هذه الليلة بالفعل.';
    }
    d.night.acted.add(uid);
    await interaction.update({ content: msg, components: [] });
    if (d.night.needed.every(id => d.night.acted.has(id) || !d.alive.has(id))) { if (d.night.done) d.night.done(); }
    return;
  }

  if (action === 'vsel') {
    if (!d.vote) return interaction.reply({ content: '⌛ انتهى التصويت.', flags: 64 });
    if (!d.alive.has(uid)) return interaction.reply({ content: '💀 الأموات لا يصوّتون.', flags: 64 });
    const target = interaction.values[0];
    d.vote.votes.set(uid, target);
    await interaction.reply({ content: target === 'skip' ? '✅ صوّتّ للتخطّي.' : `✅ صوّتّ ضد ${s.name(target)}.`, flags: 64 });
    if (aliveIds(s).every(id => d.vote.votes.has(id))) d.vote.done();
  }
}

module.exports = {
  type: 'mafia', title: 'مافيا', emoji: '🎭', min: m.min, max: m.max,
  blurb: 'لعبة خداع: المافيا تقتل ليلًا والمواطنون يصوّتون نهارًا. الأدوار سرّية وتُعرض بزر!',
  start, onComponent, assignRoles, winner, plurality, voteResult, resolveNight, mafiaCount, ROLES,
};
