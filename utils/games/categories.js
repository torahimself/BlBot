'use strict';
// إنسان حيوان نبات جماد بلاد — the classic letters game.
// Each round has a letter; players fill five answers (Arabic only) in a form.
//   • unique valid answer      → 10 points
//   • same answer as someone   →  5 points
//   • invalid / empty          →  0
// "بلاد" is checked against the country and capital list; the other four
// categories accept any Arabic word that starts with the letter and isn't junk.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');
const { normalize, isArabicOnly, firstLetter } = require('./arabic.js');
const { isPlace } = require('./countries.js');
const { isJunk } = require('../economy/engine/textFilter.js');

const c = cfg.categories;
const CATS = ['إنسان', 'حيوان', 'نبات', 'جماد', 'بلاد'];
const LETTERS = ['ا', 'ب', 'ت', 'ج', 'ح', 'خ', 'د', 'ر', 'س', 'ش', 'ع', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'ي'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Is `text` an acceptable answer for category index `i` and `letter`? */
function validAnswer(text, i, letter) {
  const t = String(text || '').trim();
  if (!t || !isArabicOnly(t)) return false;
  const n = normalize(t);
  if (n.length < 2 || [...new Set([...n])].length < 2) return false;     // "اا"
  if (firstLetter(t) !== letter) return false;
  if (isJunk(n)) return false;
  if (i === 4) return isPlace(t);
  return true;
}

/** Scores one round. answers: Map(userId → string[5]). Returns Map(userId → { cells:[{text,ok,pts}], total }). */
function scoreRound(answers, letter, unique = c.pointsUnique, dup = c.pointsDuplicate) {
  const out = new Map();
  const counts = CATS.map(() => new Map());
  for (const [id, arr] of answers) {
    arr.forEach((t, i) => { if (validAnswer(t, i, letter)) { const k = normalize(t); counts[i].set(k, (counts[i].get(k) || 0) + 1); } });
  }
  for (const [id, arr] of answers) {
    const cells = arr.map((t, i) => {
      const ok = validAnswer(t, i, letter);
      const pts = ok ? (counts[i].get(normalize(t)) > 1 ? dup : unique) : 0;
      return { text: String(t || '').trim(), ok, pts };
    });
    out.set(id, { cells, total: cells.reduce((a, x) => a + x.pts, 0) });
  }
  return out;
}

function roundRow(s) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pg:${s.id}:answer`).setLabel('اكتب إجاباتك').setEmoji('✍️').setStyle(ButtonStyle.Primary));
}

function modalFor(s) {
  const r = s.data.round;
  const m = new ModalBuilder().setCustomId(`pg:${s.id}:m:answer`).setTitle(`الحرف: ${r.letter}`);
  CATS.forEach((cat, i) => {
    m.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`c${i}`).setLabel(`${cat} يبدأ بحرف ${r.letter}`).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)
    ));
  });
  return m;
}

async function start(s) {
  const rounds = s.options.rounds || c.rounds;
  s.data.totals = new Map(s.ids.map(id => [id, 0]));
  const letters = [...LETTERS].sort(() => Math.random() - 0.5).slice(0, rounds);
  await s.channel.send('🔤 **إنسان حيوان نبات جماد بلاد** — اضغط «اكتب إجاباتك» وأجب بالعربية فقط. أول من يسلّم يبدأ العدّ التنازلي لبقية اللاعبين!');
  await sleep(2500);

  for (let n = 0; n < letters.length; n++) {
    if (s.status !== 'running') return;
    const letter = letters[n];
    const r = { letter, answers: new Map(), deadline: Date.now() + c.roundMs, done: null, ended: false };
    const finished = new Promise(res => { r.done = res; });
    s.data.round = r;
    const msg = await s.channel.send({
      embeds: [new EmbedBuilder().setColor(0xEB459E).setTitle(`🔤 الجولة ${n + 1}/${letters.length}`)
        .setDescription(`# الحرف: ${letter}\nإنسان · حيوان · نبات · جماد · بلاد\n\n⏱️ تنتهي <t:${Math.floor(r.deadline / 1000)}:R>`)],
      components: [roundRow(s)],
    });
    r.arm = () => {
      if (r.timer) { clearTimeout(r.timer); s.timers.delete(r.timer); }
      r.timer = setTimeout(() => r.done(), Math.max(0, r.deadline - Date.now()));
      s.timers.add(r.timer);
    };
    r.arm();
    await finished;
    clearTimeout(r.timer); s.timers.delete(r.timer);
    r.ended = true;
    await msg.edit({ components: [] }).catch(() => {});
    if (s.status !== 'running') return;

    const scored = scoreRound(r.answers, letter);
    const lines = [];
    for (const id of s.ids) {
      const res = scored.get(id);
      if (!res) { lines.push(`${s.mention(id)} — لم يجب`); continue; }
      s.data.totals.set(id, (s.data.totals.get(id) || 0) + res.total);
      lines.push(`${s.mention(id)} — **+${res.total}**\n` + res.cells.map((x, i) => `${CATS[i]}: ${x.text ? `${x.ok ? '✅' : '❌'} ${x.text}${x.ok ? ` (${x.pts})` : ''}` : '—'}`).join(' · '));
    }
    await s.channel.send({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 نتائج حرف ${letter}`).setDescription(lines.join('\n\n').slice(0, 4000))],
      allowedMentions: { parse: [] },
    });
    await sleep(3000);
  }

  const rows = s.ids.map(id => ({ id, pts: s.data.totals.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
  const top = rows[0] ? rows[0].pts : 0;
  const winners = top > 0 ? rows.filter(r => r.pts === top).map(r => r.id) : [];
  const board = rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} <@${r.id}> — **${r.pts}**`).join('\n');
  const fin = await s.finish({ winners, active: s.ids.filter(id => s.players.get(id).active) });
  if (!fin) return;
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🏁 انتهت اللعبة')
      .setDescription(`${board}\n\n${winners.length ? `🏆 ${winners.map(i => `<@${i}>`).join(' و ')}` : 'لا يوجد فائز'}${fin.noteText}`)],
    allowedMentions: { parse: [] },
  });
}

// Buttons and the form.
async function onComponent(s, interaction, action) {
  const r = s.data.round;
  if (action === 'answer') {
    if (!s.players.has(interaction.user.id)) return interaction.reply({ content: '❌ أنت لست من اللاعبين.', flags: 64 });
    if (!r || r.ended) return interaction.reply({ content: '⌛ انتهت هذه الجولة.', flags: 64 });
    if (r.answers.has(interaction.user.id)) return interaction.reply({ content: '✅ لقد سلّمت إجاباتك بالفعل في هذه الجولة.', flags: 64 });
    return interaction.showModal(modalFor(s));
  }
  if (action === 'm:answer') {
    const uid = interaction.user.id;
    if (!s.players.has(uid)) return interaction.reply({ content: '❌ أنت لست من اللاعبين.', flags: 64 });
    if (!r || r.ended) return interaction.reply({ content: '⌛ انتهى الوقت — لم تُحسب إجاباتك.', flags: 64 });
    if (r.answers.has(uid)) return interaction.reply({ content: '✅ لقد سلّمت بالفعل.', flags: 64 });
    const arr = CATS.map((_, i) => interaction.fields.getTextInputValue(`c${i}`) || '');
    r.answers.set(uid, arr);
    s.markActive(uid);
    await interaction.reply({ content: '✅ تم استلام إجاباتك!', flags: 64 });
    if (r.answers.size >= s.players.size) { r.done(); return; }
    if (r.answers.size === 1) {
      // First hand-in: everyone else has a short time left.
      r.deadline = Math.min(r.deadline, Date.now() + c.stopMs);
      r.arm();
      await s.channel.send({ content: `🛑 ${s.mention(uid)} سلّم! بقي **${Math.round(c.stopMs / 1000)}** ثانية للبقية!`, allowedMentions: { parse: [] } }).catch(() => {});
    }
  }
}

module.exports = {
  type: 'categories', title: 'إنسان حيوان نبات جماد بلاد', emoji: '🔤', min: c.min, max: c.max,
  blurb: 'حرف عشوائي في كل جولة، وعليك كتابة خمس كلمات تبدأ به. الإجابة الفريدة بـ10 نقاط والمكررة بـ5!',
  start, onComponent, validAnswer, scoreRound, CATS, LETTERS,
};
