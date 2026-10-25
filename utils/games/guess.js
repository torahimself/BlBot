'use strict';
// خمّن الدولة — guess the country from its flag, or from its capital.
// Players type the answer in the channel; the first correct one takes the round.

const { EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');
const { FLAGGABLE, COUNTRIES, matches, pick } = require('./countries.js');

const g = cfg.guess;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function questions(mode, rounds, rng = Math.random) {
  // Capital mode skips countries whose capital is shared (القدس, فيكتوريا).
  const capCount = new Map();
  for (const c of COUNTRIES) capCount.set(c.capEn, (capCount.get(c.capEn) || 0) + 1);
  const pool = (mode === 'capital' ? COUNTRIES.filter(c => capCount.get(c.capEn) === 1) : FLAGGABLE);
  const easy = pool.filter(c => c.easy);
  const hard = pool.filter(c => !c.easy);
  // Mostly well-known countries, a few harder ones near the end.
  const nHard = Math.floor(rounds / 3);
  const picked = [...pick(easy, rounds - nHard, rng), ...pick(hard, nHard, rng)];
  return pick(picked, picked.length, rng);   // shuffle together
}

const maskOf = (name) => [...name].map(ch => (ch === ' ' ? '   ' : '﹏')).join(' ');

function promptEmbed(s, q, n, total, hint) {
  const c = q.country;
  const e = new EmbedBuilder().setColor(0xFEE75C).setTitle(`🌍 الجولة ${n}/${total}`);
  if (s.options.mode === 'capital') {
    e.setDescription(`🏛️ **${c.capAr}** هي عاصمة أي دولة؟\n\nاكتب اسم الدولة في الشات!`);
  } else {
    e.setDescription(`# ${c.flag}\nما اسم هذه الدولة؟ اكتبها في الشات!`);
  }
  if (hint) e.addFields({ name: '💡 تلميح', value: `القارة: **${c.continentAr}**\nالاسم: ${maskOf(c.ar)}  (${[...c.ar].filter(x => x !== ' ').length} حروف)\nيبدأ بحرف **${[...c.ar][0] === 'ا' && c.ar.startsWith('ال') ? c.ar.slice(2, 3) : [...c.ar][0]}**` });
  e.setFooter({ text: `لديك ${Math.round(g.roundMs / 1000)} ثانية` });
  return e;
}

function scoreboard(s) {
  const rows = s.ids.map(id => ({ id, pts: s.data.scores.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
  return rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} ${s.mention(r.id)} — **${r.pts}**`).join('\n');
}

async function start(s) {
  const mode = s.options.mode || 'flag';
  const rounds = s.options.rounds || g.rounds;
  s.options.mode = mode;
  s.data.scores = new Map(s.ids.map(id => [id, 0]));
  s.data.current = null;
  const qs = questions(mode, rounds).map(country => ({ country }));

  await s.channel.send({ content: `🌍 **خمّن الدولة** — ${mode === 'capital' ? 'من العاصمة' : 'من العلم'} · ${rounds} جولات · أول إجابة صحيحة تأخذ النقطة!`, allowedMentions: { parse: [] } });
  await sleep(2500);

  for (let i = 0; i < qs.length; i++) {
    if (s.status !== 'running') return;
    const q = qs[i];
    const cur = { q, resolved: false, winner: null, done: null };
    const finished = new Promise(res => { cur.done = res; });
    s.data.current = cur;

    const msg = await s.channel.send({ embeds: [promptEmbed(s, q, i + 1, qs.length, false)] });
    const hintTimer = setTimeout(() => { if (!cur.resolved) msg.edit({ embeds: [promptEmbed(s, q, i + 1, qs.length, true)] }).catch(() => {}); }, g.hintAfterMs);
    const endTimer = setTimeout(() => cur.done(), g.roundMs);
    s.timers.add(hintTimer); s.timers.add(endTimer);

    await finished;
    clearTimeout(hintTimer); clearTimeout(endTimer);
    s.timers.delete(hintTimer); s.timers.delete(endTimer);
    s.data.current = null;
    if (s.status !== 'running') return;

    if (cur.winner) {
      s.data.scores.set(cur.winner, (s.data.scores.get(cur.winner) || 0) + 1);
      await s.channel.send({ content: `✅ ${s.mention(cur.winner)} أجاب صحيحًا: **${q.country.ar}** ${q.country.flag}  (+1)`, allowedMentions: { parse: [] } });
    } else {
      await s.channel.send(`⌛ انتهى الوقت! الجواب: **${q.country.ar}** ${q.country.flag}`);
    }
    if ((i + 1) % 4 === 0 && i + 1 < qs.length) {
      await s.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 النتائج حتى الآن').setDescription(scoreboard(s))], allowedMentions: { parse: [] } });
    }
    await sleep(2500);
  }

  // Results
  const top = Math.max(0, ...s.data.scores.values());
  const winners = top > 0 ? s.ids.filter(id => (s.data.scores.get(id) || 0) === top) : [];
  const board = scoreboard(s);
  const fin = await s.finish({ winners, active: s.ids.filter(id => s.players.get(id).active) });
  if (!fin) return;
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🏁 انتهت اللعبة')
      .setDescription(`${board}\n\n${winners.length ? `🏆 ${winners.map(i => `<@${i}>`).join(' و ')}` : 'لا يوجد فائز'}${fin.noteText}`)],
    allowedMentions: { parse: [] },
  });
}

// Every message in the channel while a round is open.
function onMessage(s, message) {
  const cur = s.data.current;
  if (!cur || cur.resolved || s.status !== 'running') return;
  if (!s.players.has(message.author.id)) return;
  const text = (message.content || '').trim();
  if (!text || text.length > 60) return;
  s.markActive(message.author.id);
  if (!matches(cur.q.country, text)) return;
  cur.resolved = true;
  cur.winner = message.author.id;
  message.react('✅').catch(() => {});
  cur.done();
}

module.exports = {
  type: 'guess', title: 'خمّن الدولة', emoji: '🌍', min: g.min, max: g.max,
  blurb: 'تظهر أعلام (أو عواصم) وعلى اللاعبين تخمين الدولة بأسرع ما يمكن. الأكثر نقاطًا يفوز!',
  start, onMessage, questions,
};
