'use strict';
// إنسان حيوان نبات جماد بلاد — turn-based version (Fizbo style).
//
// 5 rounds, one letter each. In every round the five categories are played one
// after another:
//   • a random player is picked and mentioned; they have `turnMs` (15 s) to TYPE
//     one answer in the channel (their first message is their answer);
//   • correct → +10 points and the category is done; wrong / out of time → another
//     random player gets the SAME category and letter, until someone answers or the
//     attempts for that category run out («لم يُجَب»);
//   • a live board («لوحة اللعبة») shows letters, categories, answers and scores.
// Answer rules live in categoryRules.js.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');
const rules = require('./categoryRules.js');

const c = cfg.categories;               // read at call time, so tests can tune it
const CATS = rules.CATS;
const LETTERS = c.letters;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

/** Boolean wrapper kept for callers that only need yes/no. */
function validAnswer(text, i, letter, used) { return rules.validate(text, i, letter, { used, crossCheck: c.crossCheck }).ok; }

const eligibleIds = (s) => s.ids.filter(id => !s.data.left.has(id));
const maxAttemptsFor = (s) => c.maxAttempts || Math.min(c.maxAttemptsCap, Math.max(4, 2 * s.players.size));
const num = (n) => (n > 0 ? `+${n}` : String(n));

// ── The board ────────────────────────────────────────────────────────────────
function boardRows(s) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pg:${s.id}:quit`).setLabel('انسحاب').setEmoji('🚪').setStyle(ButtonStyle.Secondary)
  )];
}

function boardEmbed(s) {
  const d = s.data;
  const cur = d.board[d.letterIdx];
  const lettersRow = d.letters.map((l, i) => (i < d.letterIdx ? `✅ ${l}` : i === d.letterIdx ? `▶️ **${l}**` : `⬜ ${l}`)).join('   ');

  const lines = [`**الحروف:** ${lettersRow}`, ''];
  if (cur) {
    lines.push(`**الحرف الحالي: ${cur.letter}**`);
    cur.cats.forEach((cell, i) => {
      const live = d.turn && !d.turn.resolved && d.turn.ci === i && d.letterIdx === d.board.indexOf(cur);
      if (cell.status === 'done') lines.push(`✅ ${CATS[i]}: **${cell.answer}** — <@${cell.userId}> (+${cell.points})`);
      else if (cell.status === 'failed') lines.push(`⛔ ${CATS[i]}: لم يُجَب`);
      else if (live) lines.push(`⏳ ${CATS[i]}: دور <@${d.turn.userId}>`);
      else lines.push(`⬜ ${CATS[i]}`);
    });
  }
  const past = d.board.slice(0, d.letterIdx);
  if (past.length) {
    lines.push('', '**الجولات السابقة:**');
    for (const r of past) {
      const parts = r.cats.map((cell, i) => (cell.status === 'done' ? `${cell.answer} (<@${cell.userId}> +${cell.points})` : `⛔ ${CATS[i]}`));
      lines.push(`**${r.letter}** — ${parts.join(' · ')}`);
    }
  }
  const scores = eligibleSorted(s).map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} <@${r.id}> — **${r.pts}**${d.left.has(r.id) ? ' 🚪' : ''}`).join('\n') || '—';
  return new EmbedBuilder().setColor(0xEB459E).setTitle('🔤 لوحة اللعبة — إنسان حيوان نبات جماد بلاد')
    .setDescription(lines.join('\n').slice(0, 4000))
    .addFields({ name: '🏆 النقاط', value: scores.slice(0, 1000) })
    .setFooter({ text: `الجولة ${Math.min(d.letterIdx + 1, d.letters.length)}/${d.letters.length}` });
}

function eligibleSorted(s) {
  return s.ids.map(id => ({ id, pts: s.data.totals.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
}

async function postBoard(s) {
  const payload = { embeds: [boardEmbed(s)], components: boardRows(s), allowedMentions: { parse: [] } };
  s.data.boardMsg = await s.channel.send(payload).catch(() => null);
}
async function refreshBoard(s) {
  if (!s.data.boardMsg) return postBoard(s);
  const payload = { embeds: [boardEmbed(s)], components: boardRows(s), allowedMentions: { parse: [] } };
  try { await s.data.boardMsg.edit(payload); } catch (_) { await postBoard(s); }
}

// ── One player's turn ────────────────────────────────────────────────────────
// Resolves to { kind: 'correct'|'wrong'|'timeout'|'left'|'aborted', ... }.
// The first resolution wins; timers, duplicate events and a quit can't double it.
async function takeTurn(s, uid, ci, letter) {
  const d = s.data;
  const turn = { userId: uid, ci, letter, resolved: false, active: false, deadline: 0, seen: new Set(), timer: null, done: null };
  const finished = new Promise(res => { turn.done = res; });
  turn.settle = (result) => {
    if (turn.resolved) return false;
    turn.resolved = true;
    if (turn.timer) { clearTimeout(turn.timer); s.timers.delete(turn.timer); }
    turn.done(result);
    return true;
  };
  d.turn = turn;

  const shown = Date.now() + c.turnMs;
  await s.channel.send({
    content: `🎯 ${s.mention(uid)} دورك!\nالفئة: **${CATS[ci]}** · الحرف: **${letter}**\n⏱️ لديك ${Math.round(c.turnMs / 1000)} ثانية — اكتب إجابتك في الشات <t:${Math.floor(shown / 1000)}:R>`,
    allowedMentions: { users: [uid] },
  }).catch(() => {});

  if (s.status !== 'running') turn.settle({ kind: 'aborted' });
  else if (!eligibleIds(s).includes(uid)) turn.settle({ kind: 'left' });
  else {
    // The clock starts only now: the prompt is on screen.
    turn.deadline = Date.now() + c.turnMs;
    turn.active = true;
    turn.timer = setTimeout(() => turn.settle({ kind: 'timeout' }), c.turnMs);
    s.timers.add(turn.timer);
    refreshBoard(s).catch(() => {});
  }
  const result = await finished;
  d.turn = null;
  return result;
}

/** Called for every message in the game's channel while it runs (see index.js). Synchronous on purpose. */
function onMessage(s, message) {
  const turn = s.data && s.data.turn;
  if (!turn || turn.resolved || !turn.active) return;
  if (!message.author || message.author.id !== turn.userId) return;
  if (turn.seen.has(message.id)) return;                       // the same event delivered twice
  turn.seen.add(message.id);
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (!content) return;                                         // attachment / sticker only
  if (Date.now() > turn.deadline) return;                       // too late (the timer is about to fire)

  const v = rules.validate(content, turn.ci, turn.letter, { used: s.data.used, crossCheck: c.crossCheck });
  s.markActive(turn.userId);
  if (v.ok) {
    s.data.used.add(v.key);                                     // reserved immediately: nobody can reuse it
    turn.settle({ kind: 'correct', answer: v.answer, key: v.key });
  } else {
    turn.settle({ kind: 'wrong', reason: v.reason });
  }
}

/** A player gives up the game (button or leaving the server). Safe to call twice. */
function leave(s, uid) {
  if (!s.players.has(uid) || s.data.left.has(uid)) return false;
  s.data.left.add(uid);
  if (s.data.turn && s.data.turn.userId === uid) s.data.turn.settle({ kind: 'left' });   // skipped at once
  return true;
}

async function onComponent(s, interaction, action) {
  if (action !== 'quit') return interaction.reply({ content: '⌛ هذا الزر لم يعد متاحًا.', flags: 64 });
  const uid = interaction.user.id;
  if (!s.players.has(uid)) return interaction.reply({ content: '❌ أنت لست من اللاعبين.', flags: 64 });
  if (!leave(s, uid)) return interaction.reply({ content: 'لقد انسحبت بالفعل.', flags: 64 });
  await interaction.reply({ content: '🚪 انسحبت من اللعبة — لا يمكنك الفوز الآن.', flags: 64 });
  await s.channel.send({ content: `🚪 ${s.mention(uid)} انسحب من اللعبة.`, allowedMentions: { parse: [] } }).catch(() => {});
}

function cleanup(s) {                                          // session ended: free a waiting loop
  if (s.data && s.data.turn) s.data.turn.settle({ kind: 'aborted' });
}

// ── One category (retries with other players) ───────────────────────────────
async function playCategory(s, ci, letter) {
  const d = s.data;
  const cell = d.board[d.letterIdx].cats[ci];
  const max = maxAttemptsFor(s);
  let attempts = 0;
  let queue = [];
  let last = d.lastPlayer || null;

  while (attempts < max) {
    if (s.status !== 'running') return 'aborted';
    const eligible = eligibleIds(s);
    if (eligible.length < 2) return 'few';
    if (!queue.length) {
      queue = shuffle(eligible);
      if (queue.length > 1 && queue[0] === last) queue.push(queue.shift());   // not the same player twice in a row
    }
    const uid = queue.shift();
    if (!eligible.includes(uid)) continue;
    attempts++;
    last = uid;
    d.lastPlayer = uid;
    const r = await takeTurn(s, uid, ci, letter);

    if (r.kind === 'aborted') return 'aborted';
    if (r.kind === 'left') {
      attempts--;                                                // skipping a leaver is free
      await s.channel.send({ content: `⏭️ ${s.mention(uid)} غير متاح — ننتقل للاعب التالي.`, allowedMentions: { parse: [] } }).catch(() => {});
      continue;
    }
    if (r.kind === 'correct') {
      cell.status = 'done'; cell.answer = r.answer; cell.userId = uid; cell.points = c.pointsCorrect;
      d.totals.set(uid, (d.totals.get(uid) || 0) + c.pointsCorrect);
      d.roundPts.set(uid, (d.roundPts.get(uid) || 0) + c.pointsCorrect);
      await s.channel.send({ content: `✅ ${s.mention(uid)} إجابة صحيحة: **${r.answer}** (+${c.pointsCorrect})`, allowedMentions: { parse: [] } }).catch(() => {});
      return 'done';
    }
    const why = r.kind === 'timeout' ? '⌛ انتهى الوقت!' : `❌ إجابة غير صحيحة — ${rules.REASONS_AR[r.reason] || 'غير مقبولة'}.`;
    const more = attempts < max && eligibleIds(s).length >= 2;
    await s.channel.send({ content: `${s.mention(uid)} ${why}${more ? ' ننتقل للاعب آخر لنفس الفئة…' : ''}`, allowedMentions: { parse: [] } }).catch(() => {});
    await sleep(c.betweenTurnsMs);
  }
  cell.status = 'failed';
  await s.channel.send(`⛔ فئة **${CATS[ci]}** (حرف ${letter}): **لم يُجَب** — ننتقل للتالية.`).catch(() => {});
  return 'failed';
}

// ── The game ─────────────────────────────────────────────────────────────────
async function start(s) {
  const rounds = Math.min(s.options.rounds || c.rounds, LETTERS.length);
  const d = s.data;
  d.letters = shuffle(LETTERS).slice(0, rounds);
  d.letterIdx = 0;
  d.totals = new Map(s.ids.map(id => [id, 0]));
  d.roundPts = new Map();
  d.board = d.letters.map(letter => ({ letter, cats: CATS.map(() => ({ status: 'pending' })) }));
  d.used = new Set();
  d.left = new Set();
  d.turn = null;
  d.idle = 0;
  d.lastPlayer = null;
  d.boardMsg = null;
  let stopNote = '';

  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0xEB459E).setTitle('🔤 إنسان حيوان نبات جماد بلاد')
      .setDescription(`**${rounds}** جولات، حرف لكل جولة، و**5** فئات لكل حرف.\n• يُختار لاعب عشوائي لكل فئة ولديه **${Math.round(c.turnMs / 1000)} ثانية** ليكتب إجابته في الشات.\n• الإجابة الصحيحة = **${c.pointsCorrect}** نقاط. إن أخطأ أو انتهى وقته ينتقل الدور للاعب آخر لنفس الفئة.\n• الإجابات بالعربية فقط وتبدأ بالحرف المطلوب.`)],
    allowedMentions: { parse: [] },
  });
  await sleep(c.introMs);

  outer:
  for (let n = 0; n < d.letters.length; n++) {
    if (s.status !== 'running') return;
    d.letterIdx = n;
    d.roundPts = new Map();
    const letter = d.letters[n];
    await postBoard(s);
    await sleep(c.pauseMs);

    for (let ci = 0; ci < CATS.length; ci++) {
      if (s.status !== 'running') return;
      const res = await playCategory(s, ci, letter);
      if (res === 'aborted') return;
      await refreshBoard(s);
      if (res === 'few') { stopNote = '🚪 لم يبقَ لاعبون كافون — انتهت اللعبة.'; break outer; }
      d.idle = res === 'failed' ? d.idle + 1 : 0;
      if (d.idle >= c.maxIdleCategories) { stopNote = '😴 لم يتفاعل أحد — تم إنهاء اللعبة.'; break outer; }
      await sleep(c.pauseMs);
    }

    // End of the letter: this round's points, running totals.
    const roundLines = s.ids.map(id => ({ id, pts: d.roundPts.get(id) || 0 })).sort((a, b) => b.pts - a.pts)
      .map(r => `▫️ <@${r.id}> — **${num(r.pts)}**${d.left.has(r.id) ? ' 🚪' : ''}`).join('\n');
    const totalLines = eligibleSorted(s).map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} <@${r.id}> — **${r.pts}**`).join('\n');
    await s.channel.send({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 نتائج حرف ${letter} (${n + 1}/${d.letters.length})`)
        .addFields({ name: 'نقاط هذه الجولة', value: roundLines.slice(0, 1000) || '—' }, { name: 'المجموع', value: totalLines.slice(0, 1000) || '—' })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    if (n + 1 < d.letters.length) d.letterIdx = n + 1;       // so the next board shows the next letter
    else d.letterIdx = d.letters.length;
    if (n + 1 < d.letters.length) await sleep(c.roundPauseMs);
  }
  if (s.status !== 'running') return;

  // Final result. Players who quit keep their points but cannot win.
  const alive = eligibleIds(s);
  if (!alive.length) { await s.abort('انسحب جميع اللاعبين.'); return; }
  const rows = eligibleSorted(s);
  const top = Math.max(...alive.map(id => d.totals.get(id) || 0));
  const winners = top > 0 ? alive.filter(id => (d.totals.get(id) || 0) === top) : [];
  const board = rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} <@${r.id}> — **${r.pts}**${d.left.has(r.id) ? ' 🚪' : ''}`).join('\n');
  const fin = await s.finish({ winners, active: s.ids.filter(id => s.players.get(id).active) });
  if (!fin) return;
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🏁 انتهت اللعبة')
      .setDescription(`${stopNote ? stopNote + '\n\n' : ''}${board}\n\n${winners.length ? `🏆 ${winners.map(i => `<@${i}>`).join(' و ')}` : 'لا يوجد فائز'}${fin.noteText}`)],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

module.exports = {
  type: 'categories', title: 'إنسان حيوان نبات جماد بلاد', emoji: '🔤', min: c.min, max: c.max,
  blurb: 'خمسة حروف، وخمس فئات لكل حرف. يُختار لاعب عشوائي لكل فئة وعنده 15 ثانية ليكتب إجابته — الصحيحة بـ10 نقاط!',
  start, onMessage, onComponent, cleanup, leave, validAnswer, boardEmbed, CATS, LETTERS,
};
