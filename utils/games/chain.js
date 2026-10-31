'use strict';
// سلسلة كلمات — word chain. Each word must start with the last letter of the previous one.
// Turn by turn; a missed turn (time out) knocks the player out and the last one standing wins.
// Alone: keep the chain going as long as you can (a long enough chain counts as a win).

const { EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');
const rules = require('./categoryRules.js');
const { foldLetters, isArabicOnly } = require('./arabic.js');

const c = cfg.chain;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const STARTERS = ['سماء', 'كتاب', 'بحر', 'قمر', 'نهر', 'وردة', 'مدينة', 'شجرة', 'طائر', 'جبل', 'صحراء', 'مطر', 'نجمة', 'بيت', 'سفينة', 'حديقة'];

/** The word as a folded key without «ال» (what the game compares). */
const keyOf = (w) => rules.keyOf(w);

/** The letter the NEXT word must start with: the last letter, skipping a final ة / ء. */
function lastLetter(word) {
  const letters = [...String(word).replace(/ة/g, '').replace(/ء/g, '')];
  return [...foldLetters(letters.join('')).replace(/\s/g, '')].pop() || '';
}
const firstLetterOf = (word) => [...keyOf(word)][0] || '';

/** → { ok:true, key } or { ok:false, why } for `typed` as the answer to `need` (letter) with `used` keys. */
function check(typed, need, used) {
  const text = String(typed || '').trim();
  if (!text || /\s/.test(text) || [...text].length > 20 || !isArabicOnly(text)) return { ok: false, why: 'ignore' };
  const key = keyOf(text);
  if ([...key].length < 3) return { ok: false, why: 'short' };
  if (firstLetterOf(text) !== need) return { ok: false, why: 'letter' };
  if (used.has(key)) return { ok: false, why: 'used' };
  if (!rules.isRealWord(text)) return { ok: false, why: 'unknown' };
  return { ok: true, key };
}

function turnMs(n) { return Math.max(c.minTurnMs, c.turnMs - n * c.speedUpMs); }

async function start(s) {
  const start = STARTERS[Math.floor(Math.random() * STARTERS.length)];
  const order = [...s.ids].sort(() => Math.random() - 0.5);
  const alive = new Set(order);
  const solo = order.length === 1;
  const used = new Set([keyOf(start)]);
  let need = lastLetter(start);
  let words = 0, turn = 0, prev = start;
  s.data.current = null;
  s.data.words = 0;

  await s.channel.send({ content: `🔗 **سلسلة كلمات** — كل كلمة تبدأ بآخر حرف من الكلمة السابقة · ${solo ? 'العب وحدك واجعل السلسلة أطول ما يمكن' : 'من يتأخر يخرج، وآخر لاعب يفوز'}\nالكلمة الأولى: **${start}**`, allowedMentions: { parse: [] } });
  await sleep(c.introMs || 2500);

  while (s.status === 'running' && (solo || alive.size > 1) && words < c.maxWords) {
    const who = order[turn % order.length];
    turn++;
    if (!alive.has(who)) continue;
    const ms = turnMs(words);
    const cur = { player: who, need, resolved: false, word: null, done: null };
    const finished = new Promise(res => { cur.done = res; });
    s.data.current = cur;
    s.data.used = used;
    await s.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`🎯 دور ${s.mention(who)}\nاكتب كلمة تبدأ بحرف **${need}**  (بعد «${prev}»)\n⏱️ ${Math.round(ms / 1000)} ثانية`)], allowedMentions: { users: [who] } });
    const t = setTimeout(() => cur.done(), ms);
    s.timers.add(t);
    await finished;
    clearTimeout(t); s.timers.delete(t);
    s.data.current = null;
    if (s.status !== 'running') return;

    if (cur.word) {
      words++; s.data.words = words;
      used.add(cur.key);
      prev = cur.word;
      need = lastLetter(cur.word);
      if (!need) need = firstLetterOf(cur.word);
    } else {
      alive.delete(who);
      await s.channel.send({ content: `⌛ ${s.mention(who)} تأخر وخرج من اللعبة!${solo ? ` سلسلتك: **${words}** كلمة.` : ''}`, allowedMentions: { parse: [] } });
      if (solo) break;
      await sleep(1200);
    }
  }

  let winners;
  if (solo) winners = words >= c.soloWinAt ? order : [];
  else winners = alive.size === 1 ? [...alive] : [...alive];                     // reached the word cap: the survivors share it
  const fin = await s.finish({ winners, active: order.filter(id => s.players.get(id).active) });
  if (!fin) return;
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🏁 انتهت السلسلة')
      .setDescription(`🔗 طول السلسلة: **${words}** كلمة\n\n${winners.length ? `🏆 ${winners.map(i => `<@${i}>`).join(' و ')}` : 'لا يوجد فائز'}${solo && !winners.length ? `\n-# تحتاج ${c.soloWinAt} كلمات على الأقل لتفوز وحدك.` : ''}${fin.noteText}`)],
    allowedMentions: { parse: [] },
  });
}

// Only the player whose turn it is matters. Valid → accepted at once; a wrong word gets a ❌ and he can try again.
function onMessage(s, message) {
  const cur = s.data.current;
  if (!cur || cur.resolved || s.status !== 'running') return;
  if (message.author.id !== cur.player) return;
  const r = check(message.content, cur.need, s.data.used || new Set());
  if (r.ok) {
    s.markActive(cur.player);
    cur.resolved = true; cur.word = String(message.content).trim(); cur.key = r.key;
    message.react('✅').catch(() => {});
    cur.done();
  } else if (r.why !== 'ignore') {
    message.react(r.why === 'used' ? '♻️' : '❌').catch(() => {});
  }
}

module.exports = {
  type: 'chain', title: 'سلسلة كلمات', emoji: '🔗', min: c.min, max: c.max,
  blurb: 'كل كلمة تبدأ بآخر حرف من الكلمة السابقة. من يتأخر يخرج، وآخر لاعب يفوز!',
  start, onMessage, check, lastLetter,
};
